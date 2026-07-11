"""Tests for the in-process SSE bus + audit-event writer (Task 4).

Two concerns:

1. **Audit row on transition** — every successful ``transition`` writes an
   ``AuditEvent`` with the right ``event_type`` and payload (source/dest/ctx),
   even when called from a sync context with no running loop.
2. **publish/subscribe fan-out** — an async subscriber receives an
   SSE-formatted message after ``publish`` is called on the running loop.
"""

from __future__ import annotations

import asyncio
import uuid

import pytest
from sqlalchemy import select

from app.events import publish, subscribe, log_audit
from app.models import AuditEvent, Batch, Farmer
from app.statemachine import State, transition


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _make_batch(db_session, *, status: State = State.HARVESTED) -> Batch:
    """Insert a Farmer + a fresh Batch in ``status``; commit and return batch."""
    farmer = Farmer(name=f"farmer-{uuid.uuid4().hex[:8]}", lat=1.30, lng=103.85)
    db_session.add(farmer)
    db_session.flush()
    batch = Batch(
        farmer_id=farmer.id,
        crop="tomato",
        kg=20.0,
        status=status.value,
        capture_token=f"tok-{uuid.uuid4().hex}",
    )
    db_session.add(batch)
    db_session.commit()
    return batch


# ---------------------------------------------------------------------------
# Audit row is written on every successful transition (sync path).
# ---------------------------------------------------------------------------


def test_transition_writes_audit_event(db_session):
    """A successful transition appends exactly one AuditEvent row."""
    batch = _make_batch(db_session, status=State.HARVESTED)
    before = db_session.execute(select(AuditEvent)).scalars().all()

    transition(db_session, batch, State.GRADED_FARM, farm_grade="A")

    after = db_session.execute(select(AuditEvent)).scalars().all()
    assert len(after) == len(before) + 1

    event = after[-1]
    assert event.batch_id == batch.id
    assert event.event_type == "transition:GRADED_FARM"
    assert event.payload == {
        "from": "HARVESTED",
        "to": "GRADED_FARM",
        "farm_grade": "A",
    }


def test_transition_audit_payload_captures_full_ctx(db_session):
    """The ctx kwargs are merged into the audit payload."""
    batch = _make_batch(db_session, status=State.POOLED)
    transition(db_session, batch, State.CONTRACTED, contract_id=42)

    event = db_session.execute(
        select(AuditEvent).where(AuditEvent.batch_id == batch.id)
    ).scalars().first()
    assert event is not None
    assert event.payload == {
        "from": "POOLED",
        "to": "CONTRACTED",
        "contract_id": 42,
    }


def test_failed_transition_writes_no_audit_event(db_session):
    """An illegal transition raises and writes nothing to the audit log."""
    from app.statemachine import IllegalTransition

    batch = _make_batch(db_session, status=State.HARVESTED)
    with pytest.raises(IllegalTransition):
        transition(db_session, batch, State.PAID)  # forward skip — illegal

    rows = db_session.execute(
        select(AuditEvent).where(AuditEvent.batch_id == batch.id)
    ).scalars().all()
    assert rows == []


def test_log_audit_commits_row_directly(db_session):
    """log_audit inserts, commits, and returns the AuditEvent row."""
    batch = _make_batch(db_session, status=State.HARVESTED)
    event = log_audit(
        db_session,
        batch.id,
        "manual:event",
        {"note": "direct call"},
    )
    assert event.id is not None
    assert event.batch_id == batch.id
    assert event.event_type == "manual:event"
    assert event.payload == {"note": "direct call"}
    assert event.created_at is not None


# ---------------------------------------------------------------------------
# publish/subscribe fan-out (async).
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_publish_fans_out_to_subscriber():
    """A running subscriber receives an SSE-formatted message after publish."""
    gen = subscribe()
    # Prime the generator: the first yield only happens after a message is
    # put on the queue. subscribe() registers its queue on first await, but
    # the queue is added synchronously in the body before the first yield, so
    # it is already registered once we create the generator and step it once.
    # We step with anext to get past setup and into the queue.get() await.
    first_task = asyncio.create_task(gen.__anext__())

    # Give the loop a chance to enter subscribe() and register the queue.
    await asyncio.sleep(0)
    await asyncio.sleep(0)

    publish("ping", {"hello": "world"})

    message = await asyncio.wait_for(first_task, timeout=1.0)
    assert message == 'data: {"event": "ping", "payload": {"hello": "world"}}\n\n'

    await gen.aclose()


@pytest.mark.asyncio
async def test_publish_fans_out_to_multiple_subscribers():
    """Two concurrent subscribers both receive the published message."""
    gen_a = subscribe()
    gen_b = subscribe()
    task_a = asyncio.create_task(gen_a.__anext__())
    task_b = asyncio.create_task(gen_b.__anext__())

    await asyncio.sleep(0)
    await asyncio.sleep(0)

    publish("broadcast", {"n": 1})

    msg_a = await asyncio.wait_for(task_a, timeout=1.0)
    msg_b = await asyncio.wait_for(task_b, timeout=1.0)
    assert msg_a == msg_b
    assert '"broadcast"' in msg_a

    await gen_a.aclose()
    await gen_b.aclose()


@pytest.mark.asyncio
async def test_subscribe_cleans_up_on_close():
    """After a subscriber is closed/cancelled, it receives nothing new.

    Models the real-world teardown: Task 7's streaming endpoint will cancel
    the task running ``subscribe()`` when the client disconnects. Cancelling
    the task injects CancelledError into the awaiting ``queue.get()``, which
    runs the generator's ``finally`` and removes the queue from the set.
    """
    from app.events import _subscribers

    gen = subscribe()
    task = asyncio.create_task(gen.__anext__())
    await asyncio.sleep(0)
    await asyncio.sleep(0)

    # The generator has registered its queue while suspended at queue.get().
    assert len(_subscribers) == 1

    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    # finally block ran: the queue is no longer a subscriber.
    assert len(_subscribers) == 0

    # publish after teardown must not raise and nothing is enqueued.
    publish("after-close", {"x": 1})


@pytest.mark.asyncio
async def test_publish_after_all_subscribers_close_is_safe():
    """publish never raises even when the subscriber set just emptied."""
    gen = subscribe()
    task = asyncio.create_task(gen.__anext__())
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    publish("lonely", {"ok": True})  # must not raise
    await gen.aclose()


def test_publish_with_no_running_loop_does_not_crash():
    """Called from a sync context with no loop, publish is a graceful no-op."""
    publish("sync-call", {"ok": True})  # must not raise

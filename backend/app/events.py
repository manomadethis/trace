"""In-process SSE event bus + audit-event writer (spec §9 admin timeline).

Single-process asyncio pub/sub: each :func:`subscribe` caller gets its own
:class:`asyncio.Queue`; :func:`publish` fans a message out to every queue.
There is no external broker (Redis, etc.) — this is the MVP bus that Task 7's
``GET /admin/stream`` endpoint consumes.

Design notes
------------
* ``subscribe`` is an ``async`` generator yielding SSE-formatted strings
  (``data: {json}\\n\\n``). Its queue is unregistered on close/cancel.
* ``publish`` is a **sync** function so it can be called from the sync
  ``statemachine.transition`` path. When a loop is running it schedules a
  non-blocking ``put_nowait`` onto each subscriber queue via ``call_soon``;
  when no loop is running (sync test, CLI script) it degrades to a no-op so
  the caller never crashes. The audit *row* is the source of truth — the SSE
  fan-out is strictly best-effort.
* ``log_audit`` always writes the ``AuditEvent`` row and commits (source of
  truth), then publishes an ``"audit"`` event (best-effort).
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, AsyncGenerator

from sqlalchemy.orm import Session

from app.models import AuditEvent


# Per-subscriber queues. A subscriber is added on first setup of the generator
# and removed on close/cancel. Guarded by the GIL for the list mutation; the
# actual fan-out is scheduled on the running loop.
_subscribers: set[asyncio.Queue[dict[str, Any]]] = set()


def publish(event_type: str, payload: dict[str, Any]) -> None:
    """Fan ``payload`` out to every current subscriber, best-effort.

    Sync-safe: callable from the sync ``transition`` path. When an asyncio
    loop is running, each subscriber queue receives the message via a
    non-blocking ``put_nowait`` scheduled with ``call_soon`` (so we never
    block the caller). When no loop is running, this is a no-op — the audit
    row is still written by :func:`log_audit`, which is the source of truth.

    A full subscriber queue (slow consumer) drops the message: SSE is
    best-effort and a lagging browser should not wedge the state machine.
    """
    message = {"event": event_type, "payload": payload}

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        # No running loop — sync context. Nothing to fan out to; the audit
        # row (written by log_audit) is the durable record.
        return

    for queue in list(_subscribers):
        # call_soon runs on the loop's thread; put_nowait never blocks.
        # A FullQueue means a slow consumer — drop rather than wedge.
        loop.call_soon(_safe_put_nowait, queue, message)


def _safe_put_nowait(queue: asyncio.Queue[dict[str, Any]], message: dict[str, Any]) -> None:
    """put_nowait that swallows QueueFull (slow consumers drop messages)."""
    try:
        queue.put_nowait(message)
    except asyncio.QueueFull:
        pass


async def subscribe() -> AsyncGenerator[str, None]:
    """Yield SSE-formatted event strings (``data: {json}\\n\\n``) as they arrive.

    Each call gets its own queue. On generator close/cancellation the queue is
    removed from the subscriber set so :func:`publish` stops targeting it.
    """
    queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=256)
    _subscribers.add(queue)
    try:
        while True:
            message = await queue.get()
            yield f"data: {json.dumps(message)}\n\n"
    finally:
        # Cleanup on close (GeneratorExit) or cancellation — never leak.
        _subscribers.discard(queue)


def log_audit(
    db: Session,
    batch_id: int | None,
    event_type: str,
    payload: dict[str, Any],
) -> AuditEvent:
    """Append an ``AuditEvent`` row, commit, then publish (best-effort).

    The DB write is the source of truth and always happens. The SSE fan-out
    via :func:`publish` is best-effort: a no-op when no loop is running.

    Returns the persisted ``AuditEvent`` row.
    """
    event = AuditEvent(
        batch_id=batch_id,
        event_type=event_type,
        payload=payload,
    )
    db.add(event)
    db.commit()
    db.refresh(event)

    # Best-effort SSE fan-out. Publish after the commit so subscribers never
    # see an event for a row that failed to persist.
    publish("audit", {"batch_id": batch_id, "event_type": event_type, "payload": payload})

    return event

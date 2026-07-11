"""Admin routes (spec §4 + §9 admin timeline).

Two routes:

* ``GET /demand`` — admin-only aggregated demand view (stub, 501).
* ``GET /admin/stream`` — **real** Server-Sent-Events stream of audit/event
  bus messages (spec §9). Subscribes to the in-process event bus
  (:func:`app.events.subscribe`) and streams each message as an SSE frame.
  This is the live provenance timeline the admin UI tails.

Both are admin-gated. The SSE endpoint is implemented for real (no 501): the
Definition of Done checks that an authenticated admin can open the connection
and that it holds, streaming events as they are published.
"""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.auth import require_admin
from app.events import subscribe

# Two distinct prefixes share this module: ``/demand`` (no admin prefix) and
# ``/admin/stream``. We keep one router with no prefix and spell both paths in
# full on the decorators so the routes resolve at exactly those paths.
router = APIRouter(tags=["admin"])


@router.get("/demand")
def demand(_=Depends(require_admin)):
    """Admin-only aggregated demand view. Stub."""
    raise HTTPException(status_code=501, detail="Not implemented")


async def _event_generator():
    """Yield SSE-formatted frames from the event bus until the client closes.

    Thin async wrapper around :func:`app.events.subscribe` so the route handler
    stays a sync function (matching the role-dependency style elsewhere) while
    still returning an async generator for ``StreamingResponse``.
    """
    async for message in subscribe():
        yield message


@router.get("/admin/stream")
def admin_stream(_=Depends(require_admin)):
    """Live SSE stream of audit events for the admin timeline (spec §9).

    Returns a ``text/event-stream`` that stays open and pushes one SSE frame
    per published event. Authenticated via ``require_admin``; the dependency
    runs (and 401/403s) before the stream is established.
    """
    return StreamingResponse(_event_generator(), media_type="text/event-stream")

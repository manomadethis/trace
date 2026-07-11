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
from sqlalchemy.orm import Session

from app.auth import require_admin
from app.config import settings
from app.db import get_db
from app.events import subscribe
from app.models import Route
from app.services.aggregation import demand_feed

# Two distinct prefixes share this module: ``/demand`` (no admin prefix) and
# ``/admin/stream``. We keep one router with no prefix and spell both paths in
# full on the decorators so the routes resolve at exactly those paths.
router = APIRouter(tags=["admin"])


@router.get("/demand")
def demand(db: Session = Depends(get_db), _=Depends(require_admin)):
    """Admin-only aggregated demand view (spec §4).

    Simple pass-through of :func:`app.services.aggregation.demand_feed`: the
    anonymized ``{crop, grade, qty_band, urgency}`` feed with no buyer identity.
    """
    return demand_feed(db)


@router.post("/admin/demo/route-disruption")
def route_disruption(db: Session = Depends(get_db), _=Depends(require_admin)):
    """Demo toggle (spec §13 anomaly 2): wash out the primary Route.

    Flips the FIRST Route's ``washed_out`` to True so the next
    ``decide_route``/``run_handoff`` takes the route-disruption branch and
    reroutes to the fallback composter. 404 if no Route exists.
    """
    route = db.query(Route).first()
    if route is None:
        raise HTTPException(status_code=404, detail="No route found")
    route.washed_out = True
    db.commit()
    return {
        "route_id": route.id,
        "washed_out": True,
        "detail": "primary route disrupted — next handoff reroutes to fallback composter",
    }


# Hard-to-guess path token for the no-Shell reseed escape hatch. Security
# through obscurity is acceptable here — this only resets the demo DB (there is
# no real data to protect), and it lets a host where Render Shell/one-off jobs
# aren't available bootstrap the seed users with a single curl, no env-var
# setup required. Change this token if you want to lock it down.
RESEED_PATH_TOKEN = "bootstrap-trace-7f3a9c2e1b8d4e60"


@router.post(f"/admin/reseed/{RESEED_PATH_TOKEN}")
def reseed():
    """Bootstrap escape hatch: drop, recreate, and seed the DB over HTTP.

    For hosts where Render Shell / a one-off job isn't available. Gated by a
    hard-to-guess path token (no session auth, because the seed users don't
    exist yet to authenticate against — chicken-and-egg) and *not* by an env
    var, so it works on first deploy with zero dashboard setup.

    Returns ``{"ok": true, "detail": "Seed complete."}`` on success.
    """
    # Imported lazily to avoid importing seed (and its engine wiring) at
    # module-load time / in tests.
    from app.seed import reseed as _reseed

    _reseed()
    return {"ok": True, "detail": "Seed complete."}


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

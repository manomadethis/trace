"""Pickup routes (spec §4).

``GET /pickups`` is the composter's view of batches routed to them for
composting. It returns 501 until the routing slice implements it; the role
gate (composter only) is real.
"""

from fastapi import APIRouter, Depends, HTTPException

from app.auth import require_composter

router = APIRouter(prefix="/pickups", tags=["pickups"])


@router.get("")
def list_pickups(_=Depends(require_composter)):
    """Composter's inbound batches. Stub."""
    raise HTTPException(status_code=501, detail="Not implemented")

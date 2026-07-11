"""Offer routes (spec §4).

``GET /offers`` is the secondary-buyer market view. It returns 501 until the
routing slice implements it; the role gate (secondary buyer only) is real.
"""

from fastapi import APIRouter, Depends, HTTPException

from app.auth import require_buyer
from app.models import UserRole

router = APIRouter(prefix="/offers", tags=["offers"])


@router.get("")
def list_offers(_=Depends(require_buyer(UserRole.secondary_buyer))):
    """Secondary-buyer market view. Stub."""
    raise HTTPException(status_code=501, detail="Not implemented")

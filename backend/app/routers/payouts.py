"""Payout routes (spec §4).

``GET /payouts`` is admin-only and returns 501 until the payout slice lands.
The role gate is real so the 401/403 contract holds today.
"""

from fastapi import APIRouter, Depends, HTTPException

from app.auth import require_admin

router = APIRouter(prefix="/payouts", tags=["payouts"])


@router.get("")
def list_payouts(_=Depends(require_admin)):
    """Admin-only list of payouts. Stub."""
    raise HTTPException(status_code=501, detail="Not implemented")

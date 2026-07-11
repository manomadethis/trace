"""Batch routes (spec §4).

Two routes here:

* ``GET /batches`` — admin-only list (stub, 501 until the slice fills it in).
* ``POST /batches/{id}/dispute`` — premium buyer raises a dispute on a batch
  they received (stub, 501).

Both are gated by their real role dependency so the 401/403 contract is in
place now; the handlers return 501 until the implementing slice lands.
"""

from fastapi import APIRouter, Depends, HTTPException

from app.auth import require_admin, require_buyer
from app.models import UserRole

router = APIRouter(prefix="/batches", tags=["batches"])


@router.get("")
def list_batches(_=Depends(require_admin)):
    """Admin-only list of all batches. Stub — the slice implements this."""
    raise HTTPException(status_code=501, detail="Not implemented")


@router.post("/{batch_id}/dispute")
def dispute_batch(batch_id: int, _=Depends(require_buyer(UserRole.premium_buyer))):
    """Premium buyer disputes a batch they received. Stub."""
    raise HTTPException(status_code=501, detail="Not implemented")

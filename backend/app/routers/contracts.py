"""Contract routes (spec §4a/§4b).

Three routes:

* ``GET /contracts`` — admin-only list (stub, 501).
* ``GET /contracts/mine`` — **real**: returns the contracts scoped to the
  calling premium buyer's ``buyer_id`` (spec §4a). Proves per-buyer DB scoping:
  a buyer never sees another buyer's contracts.
* ``POST /contracts/{id}/confirm`` — premium buyer confirms a contract
  (stub, 501).

``GET /contracts`` is admin-gated; ``/mine`` and ``/confirm`` are
premium-buyer-gated. The role gates are real; only ``/mine`` has a real
handler today.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import require_admin, require_buyer
from app.db import get_db
from app.models import Contract, User, UserRole

router = APIRouter(prefix="/contracts", tags=["contracts"])


@router.get("")
def list_contracts(_=Depends(require_admin)):
    """Admin-only list of all contracts. Stub."""
    raise HTTPException(status_code=501, detail="Not implemented")


@router.get("/mine")
def my_contracts(
    user: User = Depends(require_buyer(UserRole.premium_buyer)),
    db: Session = Depends(get_db),
):
    """Contracts belonging to the calling premium buyer (spec §4a scoping).

    Filters strictly on ``buyer_id == current_user.buyer_id`` so a buyer can
    never see another buyer's contracts. Returns the fields the buyer UI needs:
    ``{id, crop, grade, kg_target, status}``.
    """
    rows = (
        db.query(Contract)
        .filter(Contract.buyer_id == user.buyer_id)
        .order_by(Contract.id)
        .all()
    )
    return [
        {
            "id": c.id,
            "crop": c.crop,
            "grade": c.grade,
            "kg_target": c.kg_target,
            "status": c.status.value if c.status else None,
        }
        for c in rows
    ]


@router.post("/{contract_id}/confirm")
def confirm_contract(
    contract_id: int,
    _=Depends(require_buyer(UserRole.premium_buyer)),
):
    """Premium buyer confirms a contract. Stub."""
    raise HTTPException(status_code=501, detail="Not implemented")

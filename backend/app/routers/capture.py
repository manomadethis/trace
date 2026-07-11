"""Capture route (spec §4 — farmer Telegram upload).

``POST /capture/{token}`` is the only unauthenticated route in TRACE: the
token in the URL *is* the auth (it is per-batch and time-boxed). Slice B
implements the real handler; for now it returns 501.

The router carries no prefix so the path is exactly ``/capture/{token}``.
"""

from fastapi import APIRouter, HTTPException

router = APIRouter(tags=["capture"])


@router.post("/capture/{token}")
def capture(token: str):
    """Farmer uploads a capture for a batch, authenticated by the URL token.

    No session/cookie: the token authorizes this single batch's upload. Stub.
    """
    raise HTTPException(status_code=501, detail="Not implemented")

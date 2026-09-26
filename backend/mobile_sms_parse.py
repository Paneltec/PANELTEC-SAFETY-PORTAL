"""v58.13.132p0 — POST /api/mobile/sms/parse.

Shared endpoint that both the web admin's "Paste SMS" pre-fill flow
AND the future Phase-2 mobile SMS-receiver call. The parser lives in
`sms_parser.py` so both worlds emit the same 7-field payload.

Never creates a job — parsing is idempotent + side-effect-free.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from auth import get_current_user
from sms_parser import parse_sms

router = APIRouter(tags=["mobile-sms-parse"])


class SmsParseIn(BaseModel):
    sms: str = Field(..., min_length=1, max_length=8000)


@router.post("/mobile/sms/parse")
async def parse_sms_endpoint(
    body: SmsParseIn,
    user: dict = Depends(get_current_user),
) -> dict:
    parsed = parse_sms(body.sms).to_dict()
    return {
        "parsed": parsed,
        # `missing` is the FE's cue for "which fields do we need the
        # operator to double-check". A dict-ish payload beats trying
        # to inspect `null` values in JS.
        "missing": [k for k, v in parsed.items()
                    if v is None or (isinstance(v, list) and not v)],
    }

"""GET /api/{resource}/{id}/pdf endpoints — one per capture record type.

Authentication options for the PDF endpoints:
  1) `Authorization: Bearer <user-jwt>` — normal user session (existing path)
  2) `?token=<pdf-token>` — short-lived JWT minted via POST /api/pdf-token

The pdf-token path exists because Edge / Chrome block <iframe src=blob:> for
PDFs, so we open the URL in a real new tab and let the browser's native PDF
viewer load it. The token is bound to a specific resource + record_id, expires
in 90 seconds, and carries no DB state.
"""
from __future__ import annotations
import os
from datetime import datetime, timezone, timedelta
from typing import Optional

import jwt
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

from auth import JWT_ALGORITHM, _secret, get_current_user
from db import db
from permissions import can, require_permission
from pdf_renderer import RENDERERS, filename_for

router = APIRouter(tags=["pdf"])

PDF_TOKEN_TTL_SECONDS = 90

# Resource → URL path-segment mapping (needed for absolute URL building).
RESOURCE_TO_PATH = {
    "swms": "swms",
    "pre_starts": "pre-starts",
    "site_diary": "site-diary",
    "hazards": "hazards",
    "incidents": "incidents",
    "inspections": "inspections",
}


# ---------- PDF token mint ----------

class PdfTokenIn(BaseModel):
    resource: str
    record_id: str
    action: str = Field(default="view", pattern="^(view|download)$")


def _build_absolute_url(request: Request, path: str) -> str:
    """Build an absolute URL preserving the public scheme/host through k8s ingress."""
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    host = (request.headers.get("x-forwarded-host")
            or request.headers.get("host")
            or request.url.netloc)
    return f"{proto}://{host}{path}"


@router.post("/pdf-token")
async def mint_pdf_token(body: PdfTokenIn, request: Request,
                         user: dict = Depends(get_current_user)):
    if body.resource not in RESOURCE_TO_PATH:
        raise HTTPException(400, "Unknown resource")
    if not await can(user, body.resource, "view"):
        raise HTTPException(403, f"Permission denied: {body.resource}.view")

    # Confirm the record exists in this org (defence in depth).
    _renderer, collection = RENDERERS[body.resource]
    doc = await db[collection].find_one(
        {"id": body.record_id, "org_id": user["org_id"]}, {"id": 1})
    if not doc:
        raise HTTPException(404, "Record not found")

    now = datetime.now(timezone.utc)
    payload = {
        "sub": user["id"],
        "org_id": user["org_id"],
        "resource": body.resource,
        "record_id": body.record_id,
        "action": body.action,
        "exp": now + timedelta(seconds=PDF_TOKEN_TTL_SECONDS),
        "iat": now,
        "type": "pdf-token",
    }
    token = jwt.encode(payload, _secret(), algorithm=JWT_ALGORITHM)
    path_prefix = RESOURCE_TO_PATH[body.resource]
    path = f"/api/{path_prefix}/{body.record_id}/pdf?token={token}"
    if body.action == "download":
        path += "&download=1"
    return {
        "token": token,
        "url": _build_absolute_url(request, path),
        "path": path,
        "expires_in": PDF_TOKEN_TTL_SECONDS,
    }


# ---------- Shared resolver: pdf-token query OR Bearer JWT ----------

async def _user_from_pdf_token(token: str, resource: str, record_id: str) -> dict:
    try:
        payload = jwt.decode(token, _secret(), algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "PDF token expired",
                            headers={"X-Auth-Reason": "pdf-token-expired"})
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid PDF token",
                            headers={"X-Auth-Reason": "pdf-token-invalid"})

    if payload.get("type") != "pdf-token":
        raise HTTPException(401, "Wrong token type",
                            headers={"X-Auth-Reason": "pdf-token-invalid"})
    if payload.get("resource") != resource or payload.get("record_id") != record_id:
        raise HTTPException(403, "Token does not match this record",
                            headers={"X-Auth-Reason": "pdf-token-mismatch"})

    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(401, "User not found",
                            headers={"X-Auth-Reason": "pdf-token-invalid"})
    # Honour token_version revocations even on short-lived pdf-tokens? No — these
    # are only minted for 90s on a fresh user-JWT request, so we trust them.
    return user


def _build(resource: str, path_prefix: str):
    renderer, collection = RENDERERS[resource]

    async def endpoint(
        record_id: str,
        request: Request,
        download: int = Query(0, description="1 → attachment, 0 → inline"),
        token: Optional[str] = Query(None, description="signed pdf-token; alternative to Bearer auth"),
    ):
        # Resolve user: pdf-token query wins, then fall back to Bearer JWT.
        if token:
            user = await _user_from_pdf_token(token, resource, record_id)
        else:
            # Manually invoke the user-JWT resolver (no FastAPI Depends here).
            user = await get_current_user(request, creds=None)
            if not await can(user, resource, "view"):
                raise HTTPException(403, f"Permission denied: {resource}.view")

        doc = await db[collection].find_one(
            {"id": record_id, "org_id": user["org_id"]}, {"_id": 0})
        if not doc:
            raise HTTPException(404, "Record not found")
        pdf_bytes = renderer(doc)
        fname = filename_for(doc, resource)
        disp = "attachment" if download else "inline"
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'{disp}; filename="{fname}"'},
        )

    endpoint.__name__ = f"pdf_{resource}"
    router.add_api_route(
        f"/{path_prefix}/{{record_id}}/pdf",
        endpoint, methods=["GET"], name=f"pdf-{resource}",
    )


_build("swms",        "swms")
_build("pre_starts",  "pre-starts")
_build("site_diary",  "site-diary")
_build("hazards",     "hazards")
_build("incidents",   "incidents")
_build("inspections", "inspections")

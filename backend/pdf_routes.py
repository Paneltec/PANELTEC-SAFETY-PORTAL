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
    # v58.13.48 — CS Incidents (XLSX-import reference_library rows).
    "cs_incidents": "cs-incidents",
}

# v58.13.48 — Some resources use a permission domain that differs
# from the resource key itself. Defaults to the resource key when
# absent — every legacy kind keeps its 1:1 mapping.
RESOURCE_TO_PERMISSION = {
    "cs_incidents": "reference_library",
}

# v58.13.48 — Some resources are org-scoped (records carry an
# `org_id`); others are global reference-library rows. Defaults to
# True. CS Incidents are XLSX-imported globals with no org_id, so
# the doc lookup must not filter on it.
RESOURCE_ORG_SCOPED = {
    "cs_incidents": False,
}

# v58.13.48 — Resource kinds that reach the PDF via the mirrored
# `POST /api/forms/submissions/pdf-token` branch instead of the
# direct `/pdf-token` endpoint (frontend `PdfActions` inspects
# `record.source === 'form_submission'` and switches paths). These
# kinds are NOT in `RESOURCE_TO_PATH` because they don't need a
# dedicated renderer — the form_submission renderer covers them —
# but the frontend contract test in
# `tests/backend_unit/test_action_availability_contract_v58_13_48.py`
# accepts them as valid `<CaptureCard resourceKind="X">` values.
MIRRORED_ONLY_KINDS = frozenset({"forms", "risk_assessments"})


def _perm_for(resource: str) -> str:
    return RESOURCE_TO_PERMISSION.get(resource, resource)


def _org_scoped(resource: str) -> bool:
    return RESOURCE_ORG_SCOPED.get(resource, True)


def _doc_query(resource: str, record_id: str, user: dict) -> dict:
    q = {"id": record_id}
    if _org_scoped(resource):
        q["org_id"] = user["org_id"]
    return q


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
    # v58.13.48 — permission alias (cs_incidents → reference_library).
    if not await can(user, _perm_for(body.resource), "view"):
        raise HTTPException(403, f"Permission denied: {_perm_for(body.resource)}.view")

    # Confirm the record exists in this org (defence in depth).
    # v58.13.48 — org_id filter is now opt-out for global reference-
    # library resources (see `RESOURCE_ORG_SCOPED`).
    _renderer, collection = RENDERERS[body.resource]
    doc = await db[collection].find_one(
        _doc_query(body.resource, body.record_id, user), {"id": 1})
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
    # New URL pattern looks like a normal static .pdf fetch — sidesteps ad-blockers
    # (Edge/Brave/etc.) that flag long ?token= query params as tracker beacons.
    # Action (view/download) is embedded in the JWT claim, no query string needed.
    path = f"/api/files/pdf/{token}.pdf"
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
        layout: Optional[str] = Query(None, description="SWMS only — 'civil' (default) or 'original'"),
        token: Optional[str] = Query(None, description="signed pdf-token; alternative to Bearer auth"),
    ):
        # Resolve user: pdf-token query wins, then fall back to Bearer JWT.
        if token:
            user = await _user_from_pdf_token(token, resource, record_id)
        else:
            user = await get_current_user(request, creds=None)
            # v58.13.48 — permission alias.
            if not await can(user, _perm_for(resource), "view"):
                raise HTTPException(403, f"Permission denied: {_perm_for(resource)}.view")

        doc = await db[collection].find_one(
            _doc_query(resource, record_id, user), {"_id": 0})
        if not doc:
            raise HTTPException(404, "Record not found")
        # Phase 4.x — SWMS endpoint honours ?layout=civil|original. Other
        # renderers don't accept kwargs.
        if resource == "swms":
            pdf_bytes = renderer(doc, layout=(layout or "civil"))
        else:
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


_build("swms",         "swms")
_build("pre_starts",   "pre-starts")
_build("site_diary",   "site-diary")
_build("hazards",      "hazards")
_build("incidents",    "incidents")
_build("inspections",  "inspections")
# v58.13.48 — CS Incidents legacy path (mirrors the sibling routes).
_build("cs_incidents", "cs-incidents")


# ---------- Path-based PDF endpoint (ad-blocker friendly) ----------
#
# Looks like a clean static file fetch ("...pdf"), no ?token= query, no varied
# resource path — sidesteps Edge/Brave/uBlock heuristics that flag long-token
# query strings as analytics beacons. The JWT carries the resource + record_id
# + action so we don't need them in the URL.
@router.get("/files/pdf/{token}.pdf")
async def pdf_by_token(token: str):
    try:
        payload = jwt.decode(token, _secret(), algorithms=[JWT_ALGORITHM])
    except jwt.InvalidTokenError:
        # 404 (not 401/403) — ad-blockers escalate from anything that looks
        # like an auth failure on a "static" URL.
        raise HTTPException(status_code=404, detail="Not found")
    if payload.get("type") != "pdf-token":
        raise HTTPException(status_code=404, detail="Not found")

    resource = payload.get("resource")
    record_id = payload.get("record_id")
    action = payload.get("action") or "view"
    if resource not in RENDERERS or not record_id:
        raise HTTPException(status_code=404, detail="Not found")

    user = await db.users.find_one({"id": payload.get("sub")}, {"_id": 0, "password_hash": 0})
    if not user or user.get("status") == "disabled":
        raise HTTPException(status_code=404, detail="Not found")
    if not await can(user, _perm_for(resource), "view"):
        raise HTTPException(status_code=404, detail="Not found")

    renderer, collection = RENDERERS[resource]
    doc = await db[collection].find_one(
        _doc_query(resource, record_id, user), {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")

    pdf_bytes = renderer(doc)
    fname = filename_for(doc, resource)
    disp = "attachment" if action == "download" else "inline"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'{disp}; filename="{fname}"'},
    )

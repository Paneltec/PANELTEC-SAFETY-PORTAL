"""v58.13.132hj — Universal PDF preview: source registry + adapters.

Bridges the DocLib PDF pipeline (`file_pdf.py`) to every OTHER file
surface in the app (worker cert files, HR docs, equipment docs,
schedule attachments, form submission attachments, SWMS source .docx,
insurance certs, unmatched worker docs).

Design principles:
  · Auth stays PER SOURCE. Each adapter re-uses the exact role gate
    of its native `/file` endpoint so we can't accidentally widen
    access by routing through a shared endpoint.
  · Bytes are fetched from wherever the source stores them (GridFS,
    `upload_storage` GridFS bucket, disk, or an external URL for
    SWMS source .docx).
  · Conversion is delegated to `file_pdf.convert_bytes_to_pdf`, using
    the `preview_pdf_cache` collection keyed by (source, ref_hash).
    Same source blob is cached per-source-per-user-visible-ref.
  · Routes shape mirrors the DocLib flow: mint a signed token, then
    the iframe fetches `/pdf?t=<token>&ref=<b64json>`.

Endpoints (both under `/api/preview` after `server.py` mounts the router):
  · POST /{source}/token   body: {ref: {...}}  → {token, expires_in}
  · GET  /{source}/pdf     query: t, ref (b64-url-encoded json), dl?

Rollback plan:
  Deleting this file + removing the two `server.py` include lines
  restores the pre-.132hj behaviour. No collection migration needed —
  the `preview_pdf_cache` collection is populated by this module only.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import time
from typing import Any, Awaitable, Callable, NamedTuple, Optional

import httpx
from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, Request

from auth import get_current_user
from db import db
from file_pdf import (
    convert_bytes_to_pdf,
    pdf_response_bytes,
    preview_secret_bytes,
)
from missing_file_response import missing_file_response
from motor.motor_asyncio import AsyncIOMotorGridFSBucket
from uploads_storage import read_upload

log = logging.getLogger("paneltec.preview")
router = APIRouter(prefix="/preview", tags=["preview"])


# ─────────────────────── shared helpers ───────────────────────

class ResolvedFile(NamedTuple):
    blob: bytes
    mime: str
    filename: str
    cache_key: str


def _fs_bucket() -> AsyncIOMotorGridFSBucket:
    """Legacy GridFS bucket used by simpro_zip_import (worker photos,
    HR docs, unmatched docs, cert files). Kept in sync with the same
    bucket name that module uses (`fs`)."""
    return AsyncIOMotorGridFSBucket(db)


async def _read_gridfs(gridfs_id: str) -> bytes:
    """Load a legacy-bucket blob by ObjectId hex string."""
    if not gridfs_id or len(gridfs_id) != 24:
        raise HTTPException(404, "File blob missing")
    try:
        stream = await _fs_bucket().open_download_stream(ObjectId(gridfs_id))
        return await stream.read()
    except Exception:
        raise HTTPException(404, "File blob missing")


def _mime_from_ext(filename: str, fallback: str = "application/octet-stream") -> str:
    ext = (filename or "").rsplit(".", 1)[-1].lower()
    return {
        "pdf": "application/pdf",
        "jpg": "image/jpeg", "jpeg": "image/jpeg",
        "png": "image/png", "webp": "image/webp",
        "heic": "image/heic", "heif": "image/heif",
        "txt": "text/plain", "csv": "text/csv", "md": "text/markdown",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "odt": "application/vnd.oasis.opendocument.text",
        "rtf": "application/rtf",
    }.get(ext, fallback)


def _stable_ref_hash(source: str, ref: dict) -> str:
    """Stable hash for a (source, ref) pair. Used both as cache key AND
    as the token subject so a token minted for `{source=cert, cert=A}`
    can't be replayed on `{source=cert, cert=B}`."""
    canonical = json.dumps(
        {"s": source, "r": ref}, sort_keys=True, separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


# ─────────────────────── signed preview token ───────────────────────

def _mint_preview_token(subject: str, user_id: str, ttl_seconds: int = 300) -> str:
    """HMAC-SHA256 signed token bound to (subject, user_id, exp).
    Parallel to `file_pdf._mint_preview_token` but uses `s` (subject)
    instead of `f` (file_id) as the payload key so the two token
    families can't be cross-verified."""
    payload = {"s": subject, "u": user_id, "exp": int(time.time()) + ttl_seconds}
    body = base64.urlsafe_b64encode(
        json.dumps(payload, separators=(",", ":")).encode(),
    ).rstrip(b"=").decode()
    sig = hmac.new(preview_secret_bytes(), body.encode(), hashlib.sha256).digest()
    sig_b64 = base64.urlsafe_b64encode(sig).rstrip(b"=").decode()
    return f"{body}.{sig_b64}"


def _verify_preview_token(token: str, subject: str) -> Optional[str]:
    try:
        body, sig_b64 = token.split(".", 1)
        expected = hmac.new(preview_secret_bytes(), body.encode(), hashlib.sha256).digest()
        got = base64.urlsafe_b64decode(sig_b64 + "==")
        if not hmac.compare_digest(expected, got):
            return None
        payload = json.loads(base64.urlsafe_b64decode(body + "==").decode())
        if payload.get("s") != subject:
            return None
        if int(payload.get("exp", 0)) < int(time.time()):
            return None
        return payload.get("u")
    except Exception:
        return None


# ─────────────────────── adapters ───────────────────────
#
# Each adapter takes `(ref, user)` and returns a `ResolvedFile` OR
# raises HTTPException. Adapters MUST re-check auth using the same
# role/ownership rules as the native `/file` endpoint of the source.
# The framework calls `get_current_user` before dispatching, so
# `user` is already an authenticated dict — adapters add scope /
# role checks on top.


async def _resolve_doc_file(ref: dict, user: dict) -> ResolvedFile:
    """Doc Library file → same route as `/files/{id}/pdf` uses.
    Included so a caller can uniformly route ALL file previews
    through `/preview/*` if they want. Optional — DocLib callers
    can keep using the existing `/files/{id}/pdf` route."""
    file_id = ref.get("file_id")
    if not file_id:
        raise HTTPException(400, "doc_file ref missing file_id")
    doc = await db.doc_files.find_one(
        {"id": file_id, "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0},
    )
    if not doc:
        raise HTTPException(404, "File not found")
    from pathlib import Path as _P
    from file_pdf import UPLOAD_DIR
    path = _P(UPLOAD_DIR) / doc["folder_id"] / doc["stored_name"]
    if not path.exists():
        raise missing_file_response()
    return ResolvedFile(
        blob=path.read_bytes(),
        mime=doc.get("mime") or "application/octet-stream",
        filename=doc.get("filename") or file_id,
        cache_key=f"doc_file:{file_id}",
    )


async def _resolve_cert_file(ref: dict, user: dict) -> ResolvedFile:
    """Worker certification file. Native endpoint role gate:
    admin / hseq_lead / hr_lead / supervisor / auditor / worker."""
    if user.get("role") not in {"admin", "hseq_lead", "hr_lead",
                                 "supervisor", "auditor", "worker"}:
        raise HTTPException(403, "Not authorized")
    worker_id = ref.get("worker_id")
    cert_id = ref.get("cert_id")
    if not (worker_id and cert_id):
        raise HTTPException(400, "cert_file ref missing worker_id / cert_id")
    cert = await db.worker_certifications.find_one(
        {"id": cert_id, "worker_id": worker_id, "org_id": user["org_id"],
         "deleted_at": None},
    )
    if not cert:
        raise HTTPException(404, "Cert not found")
    dfid = cert.get("doc_file_id") or ""
    if not dfid:
        raise HTTPException(404, "Cert has no attached file")
    filename = (cert.get("name") or "certificate") + ".pdf"
    # Simpro-imported certs → GridFS ObjectId hex.
    if len(dfid) == 24 and all(c in "0123456789abcdef" for c in dfid.lower()):
        blob = await _read_gridfs(dfid)
        return ResolvedFile(blob=blob, mime=_mime_from_ext(filename),
                            filename=filename,
                            cache_key=f"cert_file:{cert_id}")
    # Otherwise it's a doc_files.id → serve from disk via `_resolve_doc_file`.
    inner = await _resolve_doc_file({"file_id": dfid}, user)
    # Preserve the certificate's user-visible filename for the PDF header.
    return ResolvedFile(blob=inner.blob, mime=inner.mime,
                        filename=inner.filename, cache_key=f"cert_file:{cert_id}")


async def _resolve_hr_document(ref: dict, user: dict) -> ResolvedFile:
    """Private & Confidential worker HR doc. Admin / hr_lead only."""
    if user.get("role") not in {"admin", "hr_lead"}:
        raise HTTPException(403, "Not authorized")
    worker_id = ref.get("worker_id")
    doc_id = ref.get("doc_id")
    if not (worker_id and doc_id):
        raise HTTPException(400, "hr_document ref missing worker_id / doc_id")
    doc = await db.worker_hr_documents.find_one(
        {"id": doc_id, "worker_id": worker_id, "org_id": user["org_id"],
         "deleted_at": None},
    )
    if not doc:
        raise HTTPException(404, "HR document not found")
    gid = doc.get("gridfs_id")
    if not gid:
        raise HTTPException(404, "File blob missing")
    blob = await _read_gridfs(gid)
    filename = doc.get("filename") or "hr-doc"
    return ResolvedFile(blob=blob,
                        mime=doc.get("mime") or _mime_from_ext(filename),
                        filename=filename,
                        cache_key=f"hr_document:{doc_id}")


async def _resolve_unmatched_document(ref: dict, user: dict) -> ResolvedFile:
    """Simpro-imported unmatched worker document. Admin / hseq_lead / hr_lead."""
    if user.get("role") not in {"admin", "hseq_lead", "hr_lead"}:
        raise HTTPException(403, "Not authorized")
    worker_id = ref.get("worker_id")
    doc_id = ref.get("doc_id")
    if not (worker_id and doc_id):
        raise HTTPException(400, "unmatched_document ref missing worker_id / doc_id")
    doc = await db.worker_unmatched_documents.find_one(
        {"id": doc_id, "worker_id": worker_id, "org_id": user["org_id"],
         "deleted_at": None},
    )
    if not doc:
        raise HTTPException(404, "Unmatched document not found")
    gid = doc.get("gridfs_id")
    if not gid:
        raise HTTPException(404, "File blob missing")
    blob = await _read_gridfs(gid)
    filename = doc.get("filename") or "document"
    return ResolvedFile(blob=blob, mime=_mime_from_ext(filename),
                        filename=filename,
                        cache_key=f"unmatched_document:{doc_id}")


async def _resolve_equipment_document(ref: dict, user: dict) -> ResolvedFile:
    """Equipment Register attached document. Admin only (matches
    `_require_admin` on the native endpoint)."""
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    eid = ref.get("equipment_id")
    doc_id = ref.get("doc_id")
    if not (eid and doc_id):
        raise HTTPException(400, "equipment_document ref missing equipment_id / doc_id")
    eq = await db.equipment_register.find_one(
        {"id": eid, "org_id": user["org_id"], "deleted_at": None},
    )
    if not eq:
        raise HTTPException(404, "Equipment not found")
    rec = next((d for d in (eq.get("documents") or [])
                if d.get("id") == doc_id and d.get("deleted_at") is None), None)
    if not rec:
        raise HTTPException(404, "Document not found")
    hit = await read_upload("equipment_documents", [eid, rec["stored_name"]])
    if hit is None:
        raise HTTPException(410, "Document bytes missing")
    data, mime = hit
    filename = rec.get("filename") or rec.get("stored_name") or "document"
    return ResolvedFile(blob=data,
                        mime=rec.get("mime") or mime or _mime_from_ext(filename),
                        filename=filename,
                        cache_key=f"equipment_document:{doc_id}")


async def _resolve_schedule_attachment(ref: dict, user: dict) -> ResolvedFile:
    """Asset schedule attachment (Fleet service register etc.). Any
    authenticated org member can view — matches native endpoint."""
    aid = ref.get("asset_id")
    sid = ref.get("schedule_id")
    stored_name = ref.get("stored_name")
    if not (aid and sid and stored_name):
        raise HTTPException(400,
            "schedule_attachment ref missing asset_id / schedule_id / stored_name")
    doc = await db.asset_service_schedules.find_one(
        {"id": sid, "asset_id": aid, "org_id": user["org_id"]},
    )
    if not doc:
        raise HTTPException(404, "Schedule not found")
    rec = next((a for a in (doc.get("attachments") or [])
                if a.get("stored_name") == stored_name), None)
    if not rec:
        raise HTTPException(404, "Attachment not found")
    hit = await read_upload("schedule_attachments", [sid, stored_name])
    if hit is None:
        # Disk fallback path — matches native endpoint.
        from asset_service import SCHEDULE_ATTACHMENT_ROOT
        from pathlib import Path as _P
        path = _P(SCHEDULE_ATTACHMENT_ROOT) / sid / stored_name
        if not path.exists():
            raise missing_file_response()
        data = path.read_bytes()
        mime = rec.get("mime") or _mime_from_ext(rec.get("name") or stored_name)
    else:
        data, m2 = hit
        mime = rec.get("mime") or m2 or _mime_from_ext(rec.get("name") or stored_name)
    filename = rec.get("name") or stored_name
    return ResolvedFile(blob=data, mime=mime, filename=filename,
                        cache_key=f"schedule_attachment:{sid}:{stored_name}")


async def _resolve_submission_attachment(ref: dict, user: dict) -> ResolvedFile:
    """Form submission attachment (Incidents, Hazards, Inspections,
    SDS, Pre-starts — anything that uses the shared Forms module).
    Any authenticated org member — matches native endpoint."""
    submission_id = ref.get("submission_id")
    stored_name = ref.get("stored_name")
    if not (submission_id and stored_name):
        raise HTTPException(400,
            "submission_attachment ref missing submission_id / stored_name")
    sub = await db.form_submissions.find_one(
        {"id": submission_id, "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0, "fields": 1},
    )
    if not sub:
        raise HTTPException(404, "Submission not found")
    rec = None
    for f in sub.get("fields") or []:
        if f.get("type") != "attachment":
            continue
        for a in (f.get("value") or []):
            if a.get("stored_name") == stored_name and not a.get("deleted_at"):
                rec = a
                break
        if rec:
            break
    if not rec:
        raise HTTPException(404, "Attachment not found")
    hit = await read_upload("form_attachments", [submission_id, stored_name])
    if hit is None:
        from forms import ATTACHMENT_ROOT
        from pathlib import Path as _P
        path = _P(ATTACHMENT_ROOT) / submission_id / stored_name
        if not path.exists():
            raise missing_file_response()
        data = path.read_bytes()
        mime = rec.get("mime") or _mime_from_ext(rec.get("name") or stored_name)
    else:
        data, m2 = hit
        mime = rec.get("mime") or m2 or _mime_from_ext(rec.get("name") or stored_name)
    filename = rec.get("name") or stored_name
    return ResolvedFile(blob=data, mime=mime, filename=filename,
                        cache_key=f"submission_attachment:{submission_id}:{stored_name}")


async def _resolve_swms_source(ref: dict, user: dict) -> ResolvedFile:
    """SWMS source .docx. Stored as an EXTERNAL URL (Dropbox etc.) on
    `db.swms.source_file.url`. We fetch it server-side once, then the
    convert-bytes cache handles subsequent hits. Any authenticated
    org user can view the source of a SWMS in their org."""
    swms_id = ref.get("swms_id")
    if not swms_id:
        raise HTTPException(400, "swms_source ref missing swms_id")
    doc = await db.swms.find_one(
        {"id": swms_id, "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0, "source_file": 1, "title": 1},
    )
    if not doc:
        raise HTTPException(404, "SWMS not found")
    src = doc.get("source_file") or {}
    url = src.get("url")
    if not url:
        raise HTTPException(404, "SWMS has no source file")
    filename = src.get("filename") or f"{swms_id}.docx"
    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as c:
            r = await c.get(url)
            if r.status_code >= 400:
                raise HTTPException(502, f"Could not fetch SWMS source ({r.status_code})")
            data = r.content
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"SWMS source fetch failed: {e}")
    mime = src.get("content_type") or _mime_from_ext(filename)
    return ResolvedFile(blob=data, mime=mime, filename=filename,
                        cache_key=f"swms_source:{swms_id}")


async def _resolve_insurance_cert(ref: dict, user: dict) -> ResolvedFile:
    """Org insurance certificate (current or archived). Any
    authenticated org member — matches native endpoint."""
    policy_type = ref.get("policy_type")
    cert_id = ref.get("cert_id")  # None → current cert
    if not policy_type:
        raise HTTPException(400, "insurance_cert ref missing policy_type")
    field = f"{policy_type}_insurance"
    org = await db.orgs.find_one({"id": user["org_id"]},
                                  {"_id": 0, field: 1})
    block = (org or {}).get(field) or {}
    if cert_id:
        # Look in archived certs.
        prev = block.get("previous_certificates") or []
        rec = next((p for p in prev if p.get("certificate_id") == cert_id), None)
        if not rec:
            raise HTTPException(404, "Archived certificate not found")
        cid = cert_id
        filename = rec.get("certificate_filename") or f"{policy_type}.pdf"
    else:
        cid = block.get("certificate_id")
        if not cid:
            raise HTTPException(404, "No certificate on file")
        filename = block.get("certificate_filename") or f"{policy_type}.pdf"
    blob = await _read_gridfs(cid)
    return ResolvedFile(blob=blob, mime=_mime_from_ext(filename, "application/pdf"),
                        filename=filename,
                        cache_key=f"insurance_cert:{policy_type}:{cid}")


# ─────────────────────── registry ───────────────────────

_Adapter = Callable[[dict, dict], Awaitable[ResolvedFile]]

PREVIEW_SOURCES: dict[str, _Adapter] = {
    "doc_file": _resolve_doc_file,
    "cert_file": _resolve_cert_file,
    "hr_document": _resolve_hr_document,
    "unmatched_document": _resolve_unmatched_document,
    "equipment_document": _resolve_equipment_document,
    "schedule_attachment": _resolve_schedule_attachment,
    "submission_attachment": _resolve_submission_attachment,
    "swms_source": _resolve_swms_source,
    "insurance_cert": _resolve_insurance_cert,
}


def _get_adapter(source: str) -> _Adapter:
    if source not in PREVIEW_SOURCES:
        raise HTTPException(400, f"Unknown preview source: {source}")
    return PREVIEW_SOURCES[source]


def _decode_ref(ref_b64: str) -> dict:
    """Decode a base64-url-encoded JSON ref sent as a query param on
    `GET /pdf`. The ref is minted at token-request time and echoed
    back on the GET so the server can look up the source blob."""
    try:
        padded = ref_b64 + "=" * (-len(ref_b64) % 4)
        raw = base64.urlsafe_b64decode(padded.encode("ascii"))
        obj = json.loads(raw.decode("utf-8"))
        if not isinstance(obj, dict):
            raise ValueError("ref must decode to a JSON object")
        return obj
    except Exception as e:
        raise HTTPException(400, f"Invalid ref encoding: {e}")


# ─────────────────────── routes ───────────────────────

@router.post("/{source}/token")
async def preview_mint_token(
    source: str,
    body: dict,
    user: dict = Depends(get_current_user),
):
    """Mint a signed 5-minute preview token bound to (source, ref, user).

    Body: `{"ref": {...adapter-specific fields...}}`.

    Rehearses the adapter's auth + resolve step so the caller gets an
    immediate 404 / 403 / 415 back if their ref is bad — the iframe
    doesn't need to render a broken URL.
    """
    ref = body.get("ref") or {}
    if not isinstance(ref, dict):
        raise HTTPException(400, "ref must be an object")
    adapter = _get_adapter(source)
    # Rehearse auth by calling the adapter. We DON'T convert here —
    # just verify access. The adapter raises 403/404 as appropriate.
    await adapter(ref, user)
    subject = _stable_ref_hash(source, ref)
    token = _mint_preview_token(subject, user["id"])
    ref_b64 = base64.urlsafe_b64encode(
        json.dumps(ref, sort_keys=True, separators=(",", ":")).encode(),
    ).rstrip(b"=").decode()
    return {"token": token, "expires_in": 300, "ref_b64": ref_b64}


@router.get("/{source}/pdf")
async def preview_stream_pdf(
    source: str,
    request: Request,
    ref: str = Query(..., description="base64url-encoded JSON ref"),
    t: Optional[str] = Query(None, description="signed preview token"),
    dl: int = Query(0, ge=0, le=1),
):
    """Stream the converted PDF for a `(source, ref)` pair.

    Auth: EITHER a signed `?t=` token (iframe path, no Bearer header)
    OR a Bearer header (curl / non-iframe path). Both routes hit the
    same adapter, so the auth check is identical.
    """
    ref_obj = _decode_ref(ref)
    subject = _stable_ref_hash(source, ref_obj)
    if t:
        user_id = _verify_preview_token(t, subject)
        if not user_id:
            raise HTTPException(401, "Invalid or expired preview token")
        u = await db.users.find_one({"id": user_id}, {"_id": 0})
        if not u:
            raise HTTPException(401, "Token user not found")
        user = u
    else:
        user = await get_current_user(request, creds=None)
    adapter = _get_adapter(source)
    resolved = await adapter(ref_obj, user)
    pdf_bytes, pipeline = await convert_bytes_to_pdf(
        resolved.blob, resolved.mime, resolved.filename,
        cache_namespace=source, cache_key=resolved.cache_key,
    )
    return pdf_response_bytes(pdf_bytes, resolved.filename, bool(dl), pipeline)

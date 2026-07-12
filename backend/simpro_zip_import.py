"""Simpro ZIP Import — Phase D.

v160.3.2 — Worker-scoped and bulk ZIP upload path. Fills the gap left by
the API's inaccessible attachment folders (CERTIFICATES / EXPIRED /
INDUCTIONS / LICENCES / PRIVATE & CONFIDENTIAL).

ZIP structure expected (Simpro "Export Employee Documents"):
    Aaron Foster - Documents.zip
    ├── CERTIFICATES/…
    ├── EXPIRED/…
    ├── INDUCTIONS/…
    ├── LICENCES/…
    ├── PRIVATE & CONFIDENTIAL/…
    └── (optional photo at root or in Photo/)

Endpoints:
    POST /api/workers/{worker_id}/simpro-zip-import?dry_run=1
    POST /api/workers/{worker_id}/simpro-zip-import?dry_run=0
    POST /api/integrations/simpro/workers/bulk-zip-import?dry_run=…
        (multiple ZIPs, name-matched to workers)

PRIVATE folder files land in `worker_hr_documents` — permission-gated to
admin | hr_lead on read.
"""
from __future__ import annotations

import hashlib
import io
import logging
import re
import zipfile
from difflib import SequenceMatcher
from pathlib import PurePosixPath
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from motor.motor_asyncio import AsyncIOMotorGridFSBucket

from auth import require_roles
from db import db
from models import new_id, now_iso

log = logging.getLogger("paneltec.simpro.zip")

router = APIRouter(prefix="/workers", tags=["simpro-zip-import"])
bulk_router = APIRouter(prefix="/integrations/simpro/workers",
                        tags=["simpro-zip-import-bulk"])

MAX_ZIP_BYTES = 200 * 1024 * 1024  # 200 MB
PHOTO_EXTS = {".jpg", ".jpeg", ".png", ".webp"}
DOC_EXTS = {".pdf", ".jpg", ".jpeg", ".png", ".webp", ".doc", ".docx"}

FOLDER_ALIASES = {
    "certificates": "certificates", "certificate": "certificates", "certs": "certificates",
    "expired": "expired", "old": "expired", "ood": "expired",
    "expired ood": "expired",  # matches "EXPIRED / OOD" combined folder
    "inductions": "inductions", "induction": "inductions",
    "licences": "licences", "licenses": "licences", "licence": "licences",
    "private confidential": "private",
    "private and confidential": "private",
    "private": "private", "confidential": "private", "hr": "private",
    "photo": "photo", "photos": "photo",
}


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def _folder_key(path: str) -> Optional[str]:
    """Return one of certificates|expired|inductions|licences|private|photo|None.

    Handles combined folder names like ``EXPIRED / OOD/`` (single path
    part with slash-space) and nested ``CERTIFICATES/OOD/`` (OOD is a
    sub-folder = expired classification wins over parent). We iterate
    parts LAST-to-first so nested OOD wins over its parent.
    """
    parts = list(PurePosixPath(path).parts)
    # Nested OOD promotes the parent to expired
    for p in reversed(parts):
        if not p:
            continue
        n = _norm(p)
        if n in FOLDER_ALIASES:
            return FOLDER_ALIASES[n]
    return None


# v160.3.3 — worker identification from ZIP contents.
# Extracts likely name tokens from photo filenames + PDF filenames,
# fuzzy-matches to portal workers.
_NAME_STOPWORDS = {
    "photo", "pic", "picture", "aa", "exp", "iss", "ood", "cert", "certificate",
    "signed", "signature", "form", "letter", "policy", "employee", "employ",
    "confidential", "private", "attachment", "document", "documents",
    "induction", "licence", "license", "training", "refresher",
}


def _extract_name_tokens(zf: "zipfile.ZipFile") -> list[str]:
    """Return name-like tokens from photo + PDF filenames."""
    tokens: list[str] = []
    for info in zf.infolist():
        if info.is_dir():
            continue
        base = PurePosixPath(info.filename).stem
        norm = _norm(base)
        # Only keep alphabetical words 3-20 chars
        for w in norm.split():
            if 3 <= len(w) <= 20 and w.isalpha() and w not in _NAME_STOPWORDS:
                tokens.append(w)
    return tokens


async def _identify_worker(zip_bytes: bytes, org_id: str) -> tuple[Optional[dict], float, list[str]]:
    """Return (best_worker, confidence, top_tokens). None if no confident match."""
    try:
        zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
    except zipfile.BadZipFile:
        return None, 0.0, []
    tokens = _extract_name_tokens(zf)
    if not tokens:
        return None, 0.0, []
    from collections import Counter
    freq = Counter(tokens)
    top = [t for t, _ in freq.most_common(6)]

    best_worker, best_score = None, 0.0
    async for w in db.workers.find({"org_id": org_id, "deleted_at": None},
                                    {"_id": 0, "id": 1, "first_name": 1, "last_name": 1}):
        fn = _norm(w.get("first_name") or "")
        ln = _norm(w.get("last_name") or "")
        if not (fn or ln):
            continue
        # Score = weighted overlap: full-name hit + initials hit
        score = 0.0
        for t in top:
            if t == fn: score += 0.45
            elif t == ln: score += 0.45
            elif fn.startswith(t) or t.startswith(fn): score += 0.20
            elif ln.startswith(t) or t.startswith(ln): score += 0.20
        # Initials-only heuristic (AF, AH, AK, AG, DB)
        initials_a = (fn[:1] + ln[:1]).lower() if fn and ln else ""
        initials_b = (ln[:1] + fn[:1]).lower() if fn and ln else ""
        for t in freq:
            if t in (initials_a, initials_b) and len(t) == 2:
                score += 0.10 * min(freq[t], 5)
        if score > best_score:
            best_worker, best_score = w, score
    if best_score < 0.5:
        return None, round(best_score, 3), top
    return best_worker, round(best_score, 3), top


async def _load_slug_index() -> list[tuple[str, str]]:
    """Return [(normalised_alias, slug), …] from simpro_licence_mapping.
    Falls back to cert_kinds if the mapping is empty (shouldn't happen)."""
    out = []
    async for row in db.simpro_licence_mapping.find({}, {"_id": 0}):
        out.append((_norm(row.get("simpro_licence_name_raw") or ""), row["cert_kind_slug"]))
    async for row in db.cert_kinds.find({}, {"_id": 0}):
        out.append((_norm(row.get("name") or ""), row["slug"]))
        for v in row.get("simpro_variants") or []:
            out.append((_norm(v), row["slug"]))
    # De-dupe
    seen = set()
    deduped = []
    for k, v in out:
        if k and (k, v) not in seen:
            seen.add((k, v))
            deduped.append((k, v))
    return deduped


def _match_slug(filename: str, slug_index: list[tuple[str, str]]) -> tuple[Optional[str], float]:
    stem = _norm(PurePosixPath(filename).stem)
    if not stem:
        return None, 0.0
    best_slug, best_score = None, 0.0
    for alias, slug in slug_index:
        if not alias:
            continue
        # Prefer substring match, fall back to sequence ratio
        if alias in stem or stem in alias:
            score = 0.85 + 0.15 * (len(alias) / max(len(stem), 1))
        else:
            score = SequenceMatcher(None, stem, alias).ratio()
        if score > best_score:
            best_slug, best_score = slug, score
    if best_score < 0.55:
        return None, best_score
    return best_slug, round(best_score, 3)


async def _plan_zip(zip_bytes: bytes, worker_id: str, org_id: str) -> dict:
    """Parse ZIP → per-file plan. No writes. No GridFS. Read-only preview."""
    if len(zip_bytes) > MAX_ZIP_BYTES:
        raise HTTPException(413, f"ZIP too large ({len(zip_bytes)} > {MAX_ZIP_BYTES} bytes)")
    try:
        zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
    except zipfile.BadZipFile:
        raise HTTPException(400, "Not a valid ZIP file")

    slug_index = await _load_slug_index()
    # Existing simpro-linked certs on this worker (to route matches for "attach vs create")
    existing_certs: dict[str, dict] = {}
    async for c in db.worker_certifications.find(
        {"org_id": org_id, "worker_id": worker_id, "deleted_at": None},
        {"_id": 0},
    ):
        slug = c.get("cert_kind_slug") or _norm(c.get("name") or "")
        if slug:
            existing_certs.setdefault(slug, c)

    plan_files = []
    photo = None
    for info in zf.infolist():
        if info.is_dir():
            continue
        name = info.filename
        if info.file_size == 0:
            continue
        ext = PurePosixPath(name).suffix.lower()
        folder = _folder_key(name)
        base = PurePosixPath(name).name
        # Photo detection
        if ext in PHOTO_EXTS and (folder == "photo" or "photo" in _norm(base) or len(PurePosixPath(name).parts) == 1):
            photo = {"filename": base, "size": info.file_size, "zip_path": name}
            continue
        if ext not in DOC_EXTS:
            plan_files.append({
                "filename": base, "zip_path": name, "folder": folder,
                "size": info.file_size, "action": "skip_unsupported",
                "matched_slug": None, "match_score": 0.0, "attach_to_cert_id": None,
            })
            continue

        if folder == "private":
            sha = hashlib.sha256(zf.read(name)).hexdigest()
            # v160.3.3 — hash dedup for HR docs
            existing_hr = await db.worker_hr_documents.find_one(
                {"worker_id": worker_id, "org_id": org_id, "sha256": sha, "deleted_at": None}
            )
            plan_files.append({
                "filename": base, "zip_path": name, "folder": "private",
                "size": info.file_size,
                "action": "hr_dedup_skip" if existing_hr else "hr_folder",
                "matched_slug": None, "match_score": 0.0, "attach_to_cert_id": None,
                "sha256": sha,
            })
            continue

        # CERTS / EXPIRED / INDUCTIONS / LICENCES → try to match a cert_kind
        slug, score = _match_slug(base, slug_index)
        if not slug:
            plan_files.append({
                "filename": base, "zip_path": name, "folder": folder or "other",
                "size": info.file_size, "action": "unmatched",
                "matched_slug": None, "match_score": score, "attach_to_cert_id": None,
            })
            continue
        existing = existing_certs.get(slug)
        plan_files.append({
            "filename": base, "zip_path": name, "folder": folder or "other",
            "size": info.file_size,
            "action": "attach" if existing else "create",
            "matched_slug": slug, "match_score": score,
            "attach_to_cert_id": (existing or {}).get("id"),
            "attach_to_name": (existing or {}).get("name"),
            "is_expired_folder": folder == "expired",
        })

    counts = {
        "attach":       sum(1 for p in plan_files if p["action"] == "attach"),
        "create":       sum(1 for p in plan_files if p["action"] == "create"),
        "hr_folder":    sum(1 for p in plan_files if p["action"] == "hr_folder"),
        "hr_dedup_skip": sum(1 for p in plan_files if p["action"] == "hr_dedup_skip"),
        "unmatched":    sum(1 for p in plan_files if p["action"] == "unmatched"),
        "skipped":      sum(1 for p in plan_files if p["action"] == "skip_unsupported"),
        "photo":        1 if photo else 0,
        "total_files":  len(plan_files) + (1 if photo else 0),
    }
    return {"files": plan_files, "photo": photo, "counts": counts}


async def _commit_zip(
    zip_bytes: bytes, plan: dict, worker_id: str, org_id: str, user_id: str,
    fs: AsyncIOMotorGridFSBucket,
) -> dict:
    """Apply plan → GridFS uploads + collection writes."""
    zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
    ts = now_iso()
    written_files: list[dict] = []
    hr_docs: list[dict] = []
    created_certs: list[dict] = []
    unmatched_written: list[dict] = []
    photo_result = None

    # Ensure fs bucket exists (backup_service registers `bk_fs` on startup;
    # if this endpoint runs before that, create a fresh handle).
    for p in plan["files"]:
        if p["action"] in ("skip_unsupported", "unmatched"):
            # Land into "unmatched" holding for admin triage
            if p["action"] == "unmatched":
                blob = zf.read(p["zip_path"])
                gid = await fs.upload_from_stream(p["filename"], blob,
                                                    metadata={"kind": "unmatched_simpro_zip",
                                                              "org_id": org_id, "worker_id": worker_id})
                doc = {
                    "id": new_id(), "org_id": org_id, "worker_id": worker_id,
                    "filename": p["filename"], "zip_folder": p["folder"],
                    "gridfs_id": str(gid), "size": p["size"],
                    "match_score": p.get("match_score") or 0.0,
                    "source": "simpro_zip", "uploaded_by": user_id,
                    "uploaded_at": ts, "reviewed": False, "deleted_at": None,
                }
                await db.worker_unmatched_documents.insert_one(doc)
                doc.pop("_id", None)
                unmatched_written.append(doc)
            continue

        blob = zf.read(p["zip_path"])
        gid = await fs.upload_from_stream(
            p["filename"], blob,
            metadata={"kind": "simpro_zip_import", "org_id": org_id,
                       "worker_id": worker_id, "folder": p["folder"]},
        )
        gid_str = str(gid)

        if p["action"] == "hr_dedup_skip":
            continue  # already exists — skip write
        if p["action"] == "hr_folder":
            doc = {
                "id": new_id(), "org_id": org_id, "worker_id": worker_id,
                "filename": p["filename"], "folder": "private",
                "gridfs_id": gid_str, "size": p["size"],
                "sha256": p.get("sha256"),
                "source": "simpro_zip", "uploaded_by": user_id,
                "uploaded_at": ts, "deleted_at": None,
            }
            await db.worker_hr_documents.insert_one(doc)
            doc.pop("_id", None)
            hr_docs.append(doc)
            continue

        # attach OR create cert row
        cert_id = p.get("attach_to_cert_id")
        if p["action"] == "attach" and cert_id:
            await db.worker_certifications.update_one(
                {"id": cert_id, "org_id": org_id},
                {"$set": {"doc_file_id": gid_str,
                          "updated_at": ts,
                          "expired_folder": bool(p.get("is_expired_folder"))}},
            )
            written_files.append({"cert_id": cert_id, "filename": p["filename"],
                                    "action": "attach", "gridfs_id": gid_str})
        else:  # create
            new_cert = {
                "id": new_id(), "org_id": org_id, "worker_id": worker_id,
                "name": p["filename"].rsplit(".", 1)[0][:160],
                "issuer": "Simpro (ZIP import)",
                "issue_date": None,
                "expiry_date": None,
                "doc_file_id": gid_str,
                "doc_folder_id": None, "doc_seed_folder": "",
                "notes": "",
                "source": "simpro_zip",
                "cert_kind_slug": p.get("matched_slug"),
                "pending_review": True,
                "expired_folder": bool(p.get("is_expired_folder")),
                "created_by": user_id,
                "created_at": ts, "updated_at": ts, "deleted_at": None,
            }
            await db.worker_certifications.insert_one(new_cert)
            new_cert.pop("_id", None)
            created_certs.append(new_cert)
            written_files.append({"cert_id": new_cert["id"], "filename": p["filename"],
                                    "action": "create", "gridfs_id": gid_str})

    # Photo
    if plan.get("photo"):
        p = plan["photo"]
        blob = zf.read(p["zip_path"])
        gid = await fs.upload_from_stream(
            p["filename"], blob,
            metadata={"kind": "worker_photo", "org_id": org_id, "worker_id": worker_id},
        )
        photo_url = f"/api/workers/{worker_id}/photo/{gid}"
        await db.workers.update_one(
            {"id": worker_id, "org_id": org_id},
            {"$set": {"photo_url": photo_url, "photo_gridfs_id": str(gid), "updated_at": ts}},
        )
        photo_result = {"filename": p["filename"], "gridfs_id": str(gid), "photo_url": photo_url}

    return {
        "written_files": written_files, "hr_docs": hr_docs,
        "created_certs": created_certs,
        "unmatched_files": unmatched_written,
        "photo": photo_result,
        "counts": {
            "attached":   sum(1 for w in written_files if w.get("action") == "attach"),
            "created":    len(created_certs),
            "hr_docs":    len(hr_docs),
            "unmatched":  len(unmatched_written),
            "photo":      1 if photo_result else 0,
        },
    }


# ─────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────

def _fs_bucket() -> AsyncIOMotorGridFSBucket:
    """Fresh GridFS bucket handle. Cheap; motor caches under the hood."""
    return AsyncIOMotorGridFSBucket(db.client.get_database(db.name), bucket_name="bk_fs")


@router.post("/{worker_id}/simpro-zip-import")
async def worker_zip_import(
    worker_id: str,
    file: UploadFile = File(...),
    dry_run: int = Query(1),
    user: dict = Depends(require_roles("admin", "hseq_lead", "hr_lead")),
):
    w = await db.workers.find_one({"id": worker_id, "org_id": user["org_id"], "deleted_at": None})
    if not w:
        raise HTTPException(404, "Worker not found")
    zip_bytes = await file.read()
    if not zip_bytes:
        raise HTTPException(400, "Empty upload")
    plan = await _plan_zip(zip_bytes, worker_id, user["org_id"])
    if dry_run:
        return {"dry_run": True, "worker_id": worker_id, **plan}
    result = await _commit_zip(zip_bytes, plan, worker_id, user["org_id"], user["id"], _fs_bucket())
    return {"dry_run": False, "worker_id": worker_id, "plan": plan, "result": result}


@bulk_router.post("/identify-zip")
async def identify_zip(
    file: UploadFile = File(...),
    user: dict = Depends(require_roles("admin", "hseq_lead")),
):
    """v160.3.3 — quick worker-identification probe. Reads a single ZIP,
    peeks at photo + PDF filenames, returns best-worker candidate + top
    name tokens. Used by the BulkSimproZipModal to render an auto-match
    row before the user confirms."""
    raw = await file.read()
    w, score, tokens = await _identify_worker(raw, user["org_id"])
    return {
        "filename": file.filename,
        "size": len(raw),
        "matched_worker": ({"id": w["id"],
                              "name": f"{w.get('first_name','')} {w.get('last_name','')}".strip()}
                             if w else None),
        "match_score": score,
        "top_name_tokens": tokens,
    }


@bulk_router.post("/bulk-zip-import")
async def bulk_zip_import(
    files: list[UploadFile] = File(...),
    dry_run: int = Query(1),
    user: dict = Depends(require_roles("admin", "hseq_lead")),
):
    """Multiple ZIPs at once. v160.3.3 — worker identification now uses
    ZIP contents (photo + PDF filenames) instead of ZIP filename, since
    Simpro's export names them all `employee_attachments.zip`.
    """
    org_id = user["org_id"]
    per_zip = []
    for f in files:
        raw = await f.read()
        matched, score, tokens = await _identify_worker(raw, org_id)
        if not matched:
            per_zip.append({"filename": f.filename, "matched_worker": None,
                             "match_score": score, "top_name_tokens": tokens,
                             "error": "No confident worker match (< 0.5)"})
            continue
        try:
            plan = await _plan_zip(raw, matched["id"], org_id)
        except HTTPException as e:
            per_zip.append({"filename": f.filename,
                             "matched_worker": {"id": matched["id"],
                                                  "name": f"{matched.get('first_name','')} {matched.get('last_name','')}".strip()},
                             "match_score": score, "error": e.detail})
            continue
        entry = {"filename": f.filename,
                  "matched_worker": {"id": matched["id"],
                                       "name": f"{matched.get('first_name','')} {matched.get('last_name','')}".strip()},
                  "match_score": score,
                  "top_name_tokens": tokens,
                  "plan": plan}
        if not dry_run:
            entry["result"] = await _commit_zip(raw, plan, matched["id"], org_id, user["id"], _fs_bucket())
        per_zip.append(entry)
    return {"dry_run": bool(dry_run), "zips": per_zip,
             "total_zips": len(files),
             "matched": sum(1 for z in per_zip if z.get("matched_worker")),
             "unmatched": sum(1 for z in per_zip if not z.get("matched_worker"))}


# HR docs list — permission-gated.
@router.get("/{worker_id}/hr-documents")
async def list_hr_documents(
    worker_id: str,
    user: dict = Depends(require_roles("admin", "hr_lead")),
):
    rows = []
    async for d in db.worker_hr_documents.find(
        {"worker_id": worker_id, "org_id": user["org_id"], "deleted_at": None}
    ).sort([("uploaded_at", -1)]):
        d.pop("_id", None)
        rows.append(d)
    return {"documents": rows}


# Last sync marker for the Users page.
@bulk_router.get("/last-sync")
async def last_sync_marker(user: dict = Depends(require_roles("admin", "hseq_lead"))):
    latest = await db.worker_import_snapshots.find_one(
        {"org_id": user["org_id"]}, sort=[("run_at", -1)],
    )
    if not latest:
        return {"last_synced_at": None, "triggered_by": None, "counts": None}
    return {"last_synced_at": latest.get("run_at"),
            "triggered_by": latest.get("triggered_by"),
            "counts": latest.get("counts"),
            "snapshot_id": latest.get("id")}

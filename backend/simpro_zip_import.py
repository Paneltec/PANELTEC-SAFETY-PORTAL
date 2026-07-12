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

from fastapi import APIRouter, Body, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import StreamingResponse
from motor.motor_asyncio import AsyncIOMotorGridFSBucket

from auth import require_roles
from db import db
from models import new_id, now_iso

try:
    from bson import ObjectId  # motor / pymongo BSON id
except ImportError:  # pragma: no cover
    ObjectId = None  # type: ignore

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


# v160.3.4 — Auto-taxonomy suggestion for unmatched files.
# Purpose: for files that don't match ANY existing cert_kind, generate a
# candidate `cert_kind_slug` + human label so an admin can bulk-accept
# a batch of "same-looking" unknowns as a new kind. This is the primary
# lever to drop the unmatched rate from ~40% to ~5%.
_DATE_PATTERNS = (
    re.compile(r"\d{4}[-/_.]\d{1,2}[-/_.]\d{1,2}"),      # 2024-05-01
    re.compile(r"\d{1,2}[-/_.]\d{1,2}[-/_.]\d{2,4}"),    # 01/05/24
    re.compile(r"\b\d{6,8}\b"),                             # 010524 / 20240501
    re.compile(r"\b(?:19|20)\d{2}\b"),                      # bare year
)

_TAXONOMY_NOISE = {
    "expired", "expiry", "expires", "renewal", "renewed", "updated",
    "current", "new", "old", "final", "draft", "signed", "signature",
    "certificate", "cert", "certified", "ticket", "licence", "license",
    "card", "induction", "inducted", "training", "trained", "refresher",
    "copy", "scan", "scanned", "photo", "pic", "picture", "img", "image",
    "v1", "v2", "v3", "v4", "aa", "exp", "iss", "ood",
    "employee", "worker", "staff", "staffnew",
    "attachment", "document", "file", "form", "letter", "policy",
    "confidential", "private", "hr",
}


def _generate_taxonomy_suggestion(
    filename: str,
    worker_name_tokens: Optional[set[str]] = None,
) -> dict:
    """From an unmatched filename, produce a candidate cert_kind slug +
    human label + confidence. Confidence heuristic favours filenames
    with 2-4 clean tokens after date/noise stripping.

    v160.3.4 tightened: also strips the target worker's name tokens
    + auto-detected initial-pairs (DB / AK / DDB style) so filenames
    like ``Petuna - Daniel Butler - EXP …`` collapse to slug ``petuna``
    instead of leaking a personal name into the catalogue.
    """
    stem = PurePosixPath(filename).stem
    s = stem
    for pat in _DATE_PATTERNS:
        s = pat.sub(" ", s)
    # Split on any non-alnum, then de-noise.
    tokens = re.split(r"[^a-zA-Z]+", s)
    wn = worker_name_tokens or set()
    clean = []
    for t in tokens:
        if not t or not t.isalpha():
            continue
        tl = t.lower()
        if tl in _TAXONOMY_NOISE:
            continue
        if tl in wn:
            continue  # worker's own first/last name
        if len(t) <= 3 and t.isupper() and tl not in {"whs", "loto", "tc"}:
            # Likely initials (DB, AK, DDB, MC). Keep a small whitelist of
            # real cert acronyms that also happen to be short + uppercase.
            continue
        if len(tl) < 2 or len(tl) > 24:
            continue
        clean.append(tl)
    # Cap the token count to prevent runaway slugs from filenames that
    # accidentally survived the noise filter.
    clean = clean[:5]
    if not clean:
        return {"slug": None, "label": None, "confidence": 0.0}
    # Confidence sweet spot: 2-4 clean tokens is a strong signal.
    n = len(clean)
    conf = {1: 0.55, 2: 0.85, 3: 0.90, 4: 0.85, 5: 0.70}.get(n, 0.50)
    label = " ".join(w.capitalize() for w in clean)
    slug = "-".join(clean)
    return {"slug": slug, "label": label, "confidence": round(conf, 2)}


async def _load_existing_cert_slugs() -> set[str]:
    """All slugs currently in `cert_kinds` — used for dedupe on suggest."""
    out: set[str] = set()
    async for k in db.cert_kinds.find({}, {"_id": 0, "slug": 1}):
        s = k.get("slug")
        if s:
            out.add(s)
    return out


def _fuzzy_hit(candidate: str, existing: set[str], threshold: float = 0.80) -> Optional[str]:
    """Return an existing slug that fuzzy-matches candidate at >= threshold,
    or None. Prevents catalogue pollution when Auto-Taxonomy would
    otherwise duplicate a slug that's already in cert_kinds."""
    if candidate in existing:
        return candidate
    best_hit, best_score = None, 0.0
    for e in existing:
        r = SequenceMatcher(None, candidate, e).ratio()
        if r > best_score:
            best_hit, best_score = e, r
    if best_score >= threshold:
        return best_hit
    return None


def _aggregate_unmatched_suggestions(plan_files: list[dict],
                                       existing_slugs: set[str]) -> list[dict]:
    """Group unmatched-plan-file rows by generated slug. Return sorted
    groups with count, sample filenames, existing-slug hit (if any),
    and the auto-accept default flag.

    Per user-confirmed spec (v160.3.4):
      - auto_accept_default = True when count >= 3 OR confidence >= 0.85
        (AND the suggestion doesn't collide with an existing slug).
      - Groups whose suggestion fuzzy-hits an existing slug (>= 0.80)
        should NOT create a new cert_kind — the UI shows them as
        "route to existing".
    """
    groups: dict[str, dict] = {}
    for p in plan_files:
        if p.get("action") != "unmatched":
            continue
        sug = p.get("suggestion") or {}
        slug = sug.get("slug")
        if not slug:
            # No usable slug at all — leave as "no suggestion" bucket.
            g = groups.setdefault("__no_suggestion__", {
                "suggested_slug": None,
                "suggested_label": None,
                "confidence": 0.0,
                "existing_slug_hit": None,
                "count": 0,
                "sample_filenames": [],
                "zip_paths": [],
                "auto_accept_default": False,
            })
            g["count"] += 1
            if len(g["sample_filenames"]) < 5:
                g["sample_filenames"].append(p["filename"])
            g["zip_paths"].append(p["zip_path"])
            continue
        existing_hit = _fuzzy_hit(slug, existing_slugs)
        g = groups.setdefault(slug, {
            "suggested_slug": slug,
            "suggested_label": sug["label"],
            "confidence": sug["confidence"],
            "existing_slug_hit": existing_hit,
            "count": 0,
            "sample_filenames": [],
            "zip_paths": [],
        })
        g["count"] += 1
        if len(g["sample_filenames"]) < 5:
            g["sample_filenames"].append(p["filename"])
        g["zip_paths"].append(p["zip_path"])
    # Finalise auto_accept_default now that count is settled.
    for slug, g in groups.items():
        if slug == "__no_suggestion__":
            continue
        g["auto_accept_default"] = bool(
            g["existing_slug_hit"] is None
            and (g["count"] >= 3 or g["confidence"] >= 0.85)
        )
    # Sort: existing-hit rows first (route-to-existing is safest), then
    # auto-accept-default true, then by count desc.
    ordered = sorted(
        groups.values(),
        key=lambda g: (
            0 if g["existing_slug_hit"] else 1,
            0 if g.get("auto_accept_default") else 1,
            -g["count"],
        ),
    )
    return ordered


async def _plan_zip(zip_bytes: bytes, worker_id: str, org_id: str) -> dict:
    """Parse ZIP → per-file plan. No writes. No GridFS. Read-only preview."""
    if len(zip_bytes) > MAX_ZIP_BYTES:
        raise HTTPException(413, f"ZIP too large ({len(zip_bytes)} > {MAX_ZIP_BYTES} bytes)")
    try:
        zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
    except zipfile.BadZipFile:
        raise HTTPException(400, "Not a valid ZIP file")

    slug_index = await _load_slug_index()
    # v160.3.4 — resolve target worker's name tokens so auto-taxonomy
    # can strip them from filename-derived slugs. Prevents worker names
    # + initials from leaking into the cert_kinds catalogue.
    worker_doc = await db.workers.find_one(
        {"id": worker_id, "org_id": org_id},
        {"_id": 0, "first_name": 1, "last_name": 1},
    )
    worker_name_tokens: set[str] = set()
    if worker_doc:
        for fld in ("first_name", "last_name"):
            v = (worker_doc.get(fld) or "").strip().lower()
            if v:
                for part in re.split(r"[^a-z]+", v):
                    if len(part) >= 2:
                        worker_name_tokens.add(part)
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
                # v160.3.4 — auto-taxonomy candidate
                "suggestion": _generate_taxonomy_suggestion(base, worker_name_tokens),
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
    # v160.3.4 — aggregate auto-taxonomy suggestions for unmatched files.
    existing_slugs = await _load_existing_cert_slugs()
    unmatched_groups = _aggregate_unmatched_suggestions(plan_files, existing_slugs)
    return {"files": plan_files, "photo": photo, "counts": counts,
             "unmatched_groups": unmatched_groups}


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


# v160.3.4 — cert_kinds catalogue for the reclassify dropdown.
@bulk_router.get("/cert-kinds")
async def list_cert_kinds(user: dict = Depends(require_roles("admin", "hseq_lead", "hr_lead"))):
    rows = []
    async for k in db.cert_kinds.find({}, {"_id": 0, "slug": 1, "name": 1,
                                            "category": 1, "source": 1}):
        rows.append(k)
    rows.sort(key=lambda r: (r.get("name") or "").lower())
    return {"cert_kinds": rows}


# ─────────────────────────────────────────────────────────────
# v160.3.4 — Auto-taxonomy accept + Unmatched Documents triage
# ─────────────────────────────────────────────────────────────


@bulk_router.post("/accept-suggestions")
async def accept_taxonomy_suggestions(
    body: dict = Body(...),
    user: dict = Depends(require_roles("admin", "hseq_lead")),
):
    """Persist accepted auto-taxonomy suggestions into `cert_kinds`
    + `simpro_licence_mapping`. Idempotent — existing slugs get their
    `simpro_variants` merged; brand-new slugs get inserted with
    `source = 'auto_taxonomy'`.

    Body:
      {
        "suggestions": [
          {"slug": "...", "label": "...", "simpro_variants": ["..."]}
        ]
      }
    """
    suggestions = body.get("suggestions") or []
    if not isinstance(suggestions, list):
        raise HTTPException(400, "suggestions must be a list")
    created: list[str] = []
    merged: list[str] = []
    ts = now_iso()
    for s in suggestions:
        slug = (s or {}).get("slug")
        label = (s or {}).get("label") or slug
        variants = (s or {}).get("simpro_variants") or []
        if not slug or not label:
            continue
        # Idempotent cert_kinds upsert — merge variants on collision.
        existing = await db.cert_kinds.find_one({"slug": slug})
        if existing:
            merged_variants = list({*(existing.get("simpro_variants") or []),
                                     *variants})
            await db.cert_kinds.update_one(
                {"slug": slug},
                {"$set": {"simpro_variants": merged_variants,
                          "updated_at": ts}},
            )
            merged.append(slug)
        else:
            await db.cert_kinds.insert_one({
                "slug": slug,
                "name": label,
                "category": None,
                "requires_expiry": None,
                "simpro_variants": variants,
                "source_count": len(variants),
                "source": "auto_taxonomy",
                "created_by": user["id"],
                "created_at": ts,
                "updated_at": ts,
            })
            created.append(slug)
        # Mirror licence_mapping so future ZIP planner picks them up.
        for v in variants:
            if not v:
                continue
            await db.simpro_licence_mapping.update_one(
                {"simpro_licence_name_raw": v},
                {"$set": {"cert_kind_slug": slug,
                          "map_status": "auto_taxonomy",
                          "updated_at": ts},
                 "$setOnInsert": {"created_at": ts}},
                upsert=True,
            )
    log.info("auto_taxonomy accept · created=%d · merged=%d · user=%s",
              len(created), len(merged), user["id"])
    return {"created": created, "merged": merged,
             "total": len(created) + len(merged)}


# ── Unmatched Documents triage ─────────────────────────────────

@router.get("/{worker_id}/unmatched-documents")
async def list_unmatched_documents(
    worker_id: str,
    user: dict = Depends(require_roles("admin", "hseq_lead", "hr_lead")),
):
    """List all not-yet-triaged unmatched files for a worker."""
    rows = []
    async for d in db.worker_unmatched_documents.find(
        {"worker_id": worker_id, "org_id": user["org_id"], "deleted_at": None}
    ).sort([("uploaded_at", -1)]):
        d.pop("_id", None)
        rows.append(d)
    return {"documents": rows}


@router.get("/{worker_id}/unmatched-documents/{doc_id}/file")
async def stream_unmatched_document(
    worker_id: str,
    doc_id: str,
    user: dict = Depends(require_roles("admin", "hseq_lead", "hr_lead")),
):
    """Stream the GridFS blob so admins can preview before triaging."""
    doc = await db.worker_unmatched_documents.find_one(
        {"id": doc_id, "worker_id": worker_id, "org_id": user["org_id"],
         "deleted_at": None},
    )
    if not doc:
        raise HTTPException(404, "Unmatched document not found")
    fs = _fs_bucket()
    gid = doc.get("gridfs_id")
    if not gid or ObjectId is None:
        raise HTTPException(404, "File blob missing")
    try:
        stream = await fs.open_download_stream(ObjectId(gid))
    except Exception:
        raise HTTPException(404, "File blob missing")

    async def _iter():
        while True:
            chunk = await stream.readchunk()
            if not chunk:
                break
            yield chunk

    ext = (doc.get("filename") or "").rsplit(".", 1)[-1].lower()
    mime = {"pdf": "application/pdf", "jpg": "image/jpeg", "jpeg": "image/jpeg",
             "png": "image/png", "webp": "image/webp"}.get(ext, "application/octet-stream")
    return StreamingResponse(_iter(), media_type=mime,
                              headers={"Content-Disposition":
                                       f'inline; filename="{doc.get("filename") or "file"}"'})


@router.post("/{worker_id}/unmatched-documents/{doc_id}/reclassify")
async def reclassify_unmatched_document(
    worker_id: str,
    doc_id: str,
    body: dict = Body(...),
    user: dict = Depends(require_roles("admin", "hseq_lead")),
):
    """Reclassify an unmatched doc → create a `worker_certifications`
    row referencing the same GridFS blob. Marks the unmatched doc
    reviewed + soft-deleted (blob retained)."""
    doc = await db.worker_unmatched_documents.find_one(
        {"id": doc_id, "worker_id": worker_id, "org_id": user["org_id"],
         "deleted_at": None},
    )
    if not doc:
        raise HTTPException(404, "Unmatched document not found")
    slug = (body or {}).get("cert_kind_slug")
    if not slug:
        raise HTTPException(400, "cert_kind_slug required")
    ck = await db.cert_kinds.find_one({"slug": slug})
    if not ck:
        raise HTTPException(400, f"Unknown cert_kind_slug: {slug}")
    name = ((body or {}).get("cert_name")
             or ck.get("name")
             or doc["filename"].rsplit(".", 1)[0][:160])
    ts = now_iso()
    new_cert = {
        "id": new_id(),
        "org_id": user["org_id"],
        "worker_id": worker_id,
        "name": name,
        "issuer": "Simpro (ZIP import · reclassified)",
        "issue_date": None,
        "expiry_date": None,
        "doc_file_id": doc.get("gridfs_id"),
        "doc_folder_id": None,
        "doc_seed_folder": "",
        "notes": "",
        "source": "simpro_zip_reclassified",
        "cert_kind_slug": slug,
        "pending_review": True,
        "expired_folder": False,
        "created_by": user["id"],
        "created_at": ts,
        "updated_at": ts,
        "deleted_at": None,
    }
    await db.worker_certifications.insert_one(new_cert)
    new_cert.pop("_id", None)
    await db.worker_unmatched_documents.update_one(
        {"id": doc_id},
        {"$set": {"reviewed": True, "reviewed_by": user["id"],
                  "reviewed_at": ts,
                  "reclassified_to_cert_id": new_cert["id"],
                  "deleted_at": ts, "deleted_by": user["id"]}},
    )
    return {"cert": new_cert}


@router.post("/{worker_id}/unmatched-documents/{doc_id}/move-to-hr")
async def move_unmatched_to_hr(
    worker_id: str,
    doc_id: str,
    user: dict = Depends(require_roles("admin", "hr_lead")),
):
    """Move an unmatched doc into `worker_hr_documents` (private tier).
    Same GridFS blob is referenced — no duplicate upload."""
    doc = await db.worker_unmatched_documents.find_one(
        {"id": doc_id, "worker_id": worker_id, "org_id": user["org_id"],
         "deleted_at": None},
    )
    if not doc:
        raise HTTPException(404, "Unmatched document not found")
    ts = now_iso()
    hr_doc = {
        "id": new_id(),
        "org_id": user["org_id"],
        "worker_id": worker_id,
        "filename": doc.get("filename"),
        "folder": "private",
        "gridfs_id": doc.get("gridfs_id"),
        "size": doc.get("size"),
        "sha256": None,
        "source": "simpro_zip_moved_from_unmatched",
        "uploaded_by": user["id"],
        "uploaded_at": ts,
        "deleted_at": None,
    }
    await db.worker_hr_documents.insert_one(hr_doc)
    hr_doc.pop("_id", None)
    await db.worker_unmatched_documents.update_one(
        {"id": doc_id},
        {"$set": {"moved_to_hr_id": hr_doc["id"],
                  "reviewed": True, "reviewed_by": user["id"],
                  "reviewed_at": ts,
                  "deleted_at": ts, "deleted_by": user["id"]}},
    )
    return {"hr_document": hr_doc}


@router.delete("/{worker_id}/unmatched-documents/{doc_id}")
async def delete_unmatched_document(
    worker_id: str,
    doc_id: str,
    user: dict = Depends(require_roles("admin", "hseq_lead", "hr_lead")),
):
    """Soft-delete. `deleted_at` + `deleted_by` set; blob retained for
    30 days (garbage-collected out of band)."""
    doc = await db.worker_unmatched_documents.find_one(
        {"id": doc_id, "worker_id": worker_id, "org_id": user["org_id"],
         "deleted_at": None},
    )
    if not doc:
        raise HTTPException(404, "Unmatched document not found")
    ts = now_iso()
    await db.worker_unmatched_documents.update_one(
        {"id": doc_id},
        {"$set": {"deleted_at": ts, "deleted_by": user["id"]}},
    )
    return {"deleted": True, "doc_id": doc_id}

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

from fastapi import APIRouter, Body, Depends, Form, HTTPException, Query, Request, UploadFile, File
from fastapi.responses import StreamingResponse
from motor.motor_asyncio import AsyncIOMotorGridFSBucket

from auth import require_roles
from db import db
from missing_file_response import missing_file_response  # v58.13.132fq
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
    """Apply plan → GridFS uploads + collection writes.

    v160.3.4a — writes a `worker_import_snapshots` row capturing the
    pre-commit state (cert IDs, HR doc IDs, photo_url) so a live import
    can be rolled back by deleting the rows created after the snapshot's
    `run_at` timestamp.
    """
    zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
    ts = now_iso()
    written_files: list[dict] = []
    hr_docs: list[dict] = []
    created_certs: list[dict] = []
    unmatched_written: list[dict] = []
    photo_result = None

    # ── Snapshot pre-state for rollback safety.
    pre_worker = await db.workers.find_one(
        {"id": worker_id, "org_id": org_id},
        {"_id": 0, "photo_url": 1, "photo_gridfs_id": 1},
    ) or {}
    pre_cert_ids = [
        r["id"] async for r in db.worker_certifications.find(
            {"worker_id": worker_id, "org_id": org_id, "deleted_at": None},
            {"_id": 0, "id": 1},
        )
    ]
    pre_hr_ids = [
        r["id"] async for r in db.worker_hr_documents.find(
            {"worker_id": worker_id, "org_id": org_id, "deleted_at": None},
            {"_id": 0, "id": 1},
        )
    ]
    snapshot = {
        "id": new_id(),
        "org_id": org_id,
        "worker_id": worker_id,
        "kind": "simpro_zip_import",
        "run_at": ts,
        "triggered_by": user_id,
        "pre_state": {
            "photo_url": pre_worker.get("photo_url"),
            "photo_gridfs_id": pre_worker.get("photo_gridfs_id"),
            "cert_ids": pre_cert_ids,
            "hr_doc_ids": pre_hr_ids,
        },
        "counts": None,
        "created_at": ts,
    }
    await db.worker_import_snapshots.insert_one(snapshot)
    snapshot.pop("_id", None)
    snapshot_id = snapshot["id"]

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
            # v160.3.6 — opportunistically link to a matrix column so the
            # Inductions matrix lights up immediately (no post-import
            # backfill required for freshly-imported certs).
            _slug_hint = _induction_slug(p["filename"].rsplit(".", 1)[0])
            _col_key = None
            if _slug_hint:
                _col = await db.induction_columns.find_one(
                    {"org_id": org_id, "column_key": _slug_hint},
                    {"_id": 0, "column_key": 1},
                )
                if _col:
                    _col_key = _col["column_key"]
            # v160.3.7ai — Re-use prior admin decisions:
            # if this column already has ≥1 cert row that an admin has
            # personally released (pending_review=false, source=simpro_zip),
            # the mapping is considered "trusted" and future imports for
            # the same column_key ship un-pending. Rule is intentionally
            # conservative — a single accepted row is enough evidence
            # that the auto-slug matcher is doing the right thing for
            # THIS column, but doesn't change confidence anywhere else.
            _pending = True
            if _col_key:
                _prior_accepted = await db.worker_certifications.find_one(
                    {"org_id": org_id, "column_key": _col_key,
                     "source": "simpro_zip", "pending_review": False,
                     "deleted_at": None},
                    {"_id": 1},
                )
                if _prior_accepted:
                    _pending = False
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
                "column_key": _col_key,
                "pending_review": _pending,
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
        # v58.13.21 — Delete OLD GridFS blob first to preserve the
        # zero-orphan invariant. Mirrors workers.py:644-649 exactly:
        # if the delete fails (e.g. blob already gone / never
        # existed), log and continue — the fresh upload still
        # proceeds. `pre_worker` was captured above at L504 so no
        # extra round-trip.
        old_gid = pre_worker.get("photo_gridfs_id")
        if old_gid and ObjectId is not None:
            try:
                await fs.delete(ObjectId(old_gid))
            except Exception as e:
                log.warning(
                    "simpro.photo old-blob delete failed for worker=%s (may already be gone): %s",
                    worker_id, e,
                )
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

    counts = {
        "attached":   sum(1 for w in written_files if w.get("action") == "attach"),
        "created":    len(created_certs),
        "hr_docs":    len(hr_docs),
        "unmatched":  len(unmatched_written),
        "photo":      1 if photo_result else 0,
    }
    # Backfill counts + new-id manifest so the snapshot can drive a rollback.
    await db.worker_import_snapshots.update_one(
        {"id": snapshot_id},
        {"$set": {
            "counts": counts,
            "post_ids": {
                "new_cert_ids": [c["id"] for c in created_certs],
                "new_hr_doc_ids": [h["id"] for h in hr_docs],
                "new_unmatched_ids": [u["id"] for u in unmatched_written],
                "new_photo_gridfs_id": (photo_result or {}).get("gridfs_id"),
            },
        }},
    )
    return {
        "snapshot_id": snapshot_id,
        "written_files": written_files, "hr_docs": hr_docs,
        "created_certs": created_certs,
        "unmatched_files": unmatched_written,
        "photo": photo_result,
        "counts": counts,
    }


# ─────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────

def _fs_bucket() -> AsyncIOMotorGridFSBucket:
    """Fresh GridFS bucket handle. Cheap; motor caches under the hood.

    v58.13.71 — Repointed to the DEFAULT `fs` bucket (was `bk_fs`).
    The Simpro-ZIP import writes real user content — worker photos,
    HR documents, certification PDFs — so it belongs in the primary
    bucket, not the `bk_fs` backup-snapshot bucket. `workers.py::
    _fs_bucket()` was repointed in the same ship so reader/writer
    parity is preserved.
    """
    return AsyncIOMotorGridFSBucket(db.client.get_database(db.name), bucket_name="fs")


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


# v160.3.6 — Induction matrix backfill + workers zip-status derivation.

def _induction_slug(name: str) -> str:
    """Kebab-case a cert name for fuzzy induction matching."""
    s = re.sub(r"[^a-zA-Z0-9]+", "-", (name or "").lower()).strip("-")
    # Drop noise + numeric-only tokens.
    parts = [p for p in s.split("-") if p and not p.isdigit()]
    return "-".join(parts)


@bulk_router.post("/inductions/backfill-matrix-links")
async def backfill_matrix_links(
    body: dict = Body(default_factory=dict),
    user: dict = Depends(require_roles("admin", "hseq_lead")),
):
    """One-shot migration that links Simpro-imported certs to induction
    matrix columns via slug fuzzy match. Idempotent. If the org has zero
    matrix columns, they're auto-seeded from the observed induction cert
    names.

    Body: `{"dry_run": true|false}` — dry_run=true only reports counts
    without writing. Default is dry_run=false (writes).
    """
    org = user["org_id"]
    dry_run = bool((body or {}).get("dry_run", False))
    ts = now_iso()

    # 1. Load existing induction columns for this org.
    existing_cols: dict[str, dict] = {}  # slug -> {id, column_key, header}
    async for c in db.induction_columns.find({"org_id": org}, {"_id": 0}):
        header = (c.get("header") or "").strip()
        slug = _induction_slug(header)
        if slug:
            existing_cols[slug] = c

    # 2. Scan unlinked induction-family certs.
    unlinked: list[dict] = []
    async for cert in db.worker_certifications.find(
        {"org_id": org, "deleted_at": None,
         "$or": [{"column_key": None}, {"column_key": {"$exists": False}}]},
        {"_id": 0, "id": 1, "name": 1, "cert_kind_slug": 1, "worker_id": 1},
    ):
        nm = (cert.get("name") or "").lower()
        slug = (cert.get("cert_kind_slug") or "").lower()
        if "induction" in nm or "induction" in slug \
           or any(k in nm for k in ("licence", "license", "card", "ticket",
                                     "cpr", "first aid", "white card")):
            unlinked.append(cert)

    # 3. Auto-seed missing columns from observed cert names when the org
    #    has fewer than 20 columns (arbitrary "empty catalogue" threshold).
    seeded = 0
    if len(existing_cols) < 20:
        seen_slugs: dict[str, str] = {}
        for c in unlinked:
            seed_slug = _induction_slug(c.get("name") or "")
            if seed_slug and seed_slug not in existing_cols and seed_slug not in seen_slugs:
                seen_slugs[seed_slug] = c.get("name") or seed_slug
        # Cap to top-30 by cert-count occurrence to avoid catalogue explosion.
        slug_counts: dict[str, int] = {}
        for c in unlinked:
            s = _induction_slug(c.get("name") or "")
            if s and s not in existing_cols:
                slug_counts[s] = slug_counts.get(s, 0) + 1
        for slug in sorted(slug_counts.keys(), key=lambda k: -slug_counts[k])[:30]:
            header = seen_slugs.get(slug, slug).strip()
            column_key = slug
            category = "site_induction" if "induction" in slug else "competency"
            row = {
                "id": new_id(), "org_id": org, "header": header,
                "column_key": column_key, "category": category,
                "seed_source": "auto_backfill_v160_3_6",
                "created_by": user["id"], "created_at": ts, "updated_at": ts,
            }
            if not dry_run:
                await db.induction_columns.insert_one(row)
            existing_cols[slug] = row
            seeded += 1

    # 4. Fuzzy-link each unlinked cert to a column (threshold 0.85).
    linked = 0
    per_worker: dict[str, int] = {}
    slug_list = list(existing_cols.keys())
    for cert in unlinked:
        cslug = _induction_slug(cert.get("name") or "")
        if not cslug:
            continue
        # Exact hit first.
        best_slug, best_score = None, 0.0
        if cslug in existing_cols:
            best_slug, best_score = cslug, 1.0
        else:
            for s in slug_list:
                r = SequenceMatcher(None, cslug, s).ratio()
                if r > best_score:
                    best_slug, best_score = s, r
        if best_slug and best_score >= 0.85:
            if not dry_run:
                await db.worker_certifications.update_one(
                    {"id": cert["id"]},
                    {"$set": {"column_key": existing_cols[best_slug]["column_key"],
                              "updated_at": ts}},
                )
            linked += 1
            per_worker[cert["worker_id"]] = per_worker.get(cert["worker_id"], 0) + 1
    return {
        "dry_run": dry_run,
        "matrix_columns_created": seeded,
        "matrix_columns_total": len(existing_cols),
        "certs_scanned": len(unlinked),
        "certs_linked": linked,
        "certs_still_unlinked": len(unlinked) - linked,
        "workers_touched": len(per_worker),
    }


@bulk_router.get("/zip-status")
async def workers_zip_status(user: dict = Depends(require_roles("admin", "hseq_lead", "supervisor"))):
    """Return per-worker Simpro-ZIP application status. Powers the
    Workers-list `ZIP APPLIED / ZIP MISSING / MANUAL` pill."""
    org = user["org_id"]
    # Aggregate cert counts per worker for the ZIP-sourced set.
    pipeline = [
        {"$match": {"org_id": org, "deleted_at": None}},
        {"$group": {
            "_id": "$worker_id",
            "cert_count": {"$sum": 1},
            "zip_certs": {"$sum": {
                "$cond": [
                    {"$in": ["$source", ["simpro_zip", "simpro_zip_reclassified"]]},
                    1, 0,
                ]}},
        }},
    ]
    by_worker: dict[str, dict] = {}
    async for row in db.worker_certifications.aggregate(pipeline):
        by_worker[row["_id"]] = {"cert_count": row["cert_count"],
                                   "zip_certs": row["zip_certs"]}
    out: dict[str, dict] = {}
    async for w in db.workers.find(
        {"org_id": org, "deleted_at": None},
        {"_id": 0, "id": 1, "simpro_employee_id": 1, "photo_gridfs_id": 1},
    ):
        agg = by_worker.get(w["id"], {"cert_count": 0, "zip_certs": 0})
        simpro_sourced = w.get("simpro_employee_id") is not None
        zip_applied = bool(agg["zip_certs"] > 0 or w.get("photo_gridfs_id"))
        out[w["id"]] = {
            "cert_count": agg["cert_count"],
            "zip_applied": zip_applied,
            "simpro_sourced": simpro_sourced,
        }
    return {"workers": out}


# ─────────────────────────────────────────────────────────────
# v160.3.4b — File-serving endpoints for Simpro-imported blobs.
# All three accept the short-lived download JWT via `?token=`
# (get_current_user already supports it) OR a Bearer header.
# ─────────────────────────────────────────────────────────────

def _mime_from_filename(name: str) -> str:
    ext = (name or "").rsplit(".", 1)[-1].lower()
    return {
        "pdf": "application/pdf",
        "jpg": "image/jpeg", "jpeg": "image/jpeg",
        "png": "image/png", "webp": "image/webp",
        "heic": "image/heic", "heif": "image/heif",
    }.get(ext, "application/octet-stream")


async def _stream_gridfs(gridfs_id: str, filename: str):
    """Open a GridFS blob and return a StreamingResponse. Common path."""
    if not gridfs_id or ObjectId is None:
        raise HTTPException(404, "File blob missing")
    try:
        stream = await _fs_bucket().open_download_stream(ObjectId(gridfs_id))
    except Exception:
        raise HTTPException(404, "File blob missing")

    async def _iter():
        while True:
            chunk = await stream.readchunk()
            if not chunk:
                break
            yield chunk
    mime = _mime_from_filename(filename)
    return StreamingResponse(
        _iter(), media_type=mime,
        headers={"Content-Disposition":
                 f'inline; filename="{filename or "file"}"'},
    )


@router.get("/{worker_id}/photo/{gridfs_id}")
async def stream_worker_photo(
    worker_id: str,
    gridfs_id: str,
    user: dict = Depends(require_roles("admin", "hseq_lead", "hr_lead",
                                         "supervisor", "auditor", "worker")),
):
    """Serve a worker's profile photo from GridFS. Anyone in the org may
    view — matches the visibility of the workers list."""
    w = await db.workers.find_one(
        {"id": worker_id, "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0, "photo_gridfs_id": 1, "first_name": 1, "last_name": 1},
    )
    if not w:
        raise HTTPException(404, "Worker not found")
    # Only serve the blob if it matches what's registered on the worker.
    if w.get("photo_gridfs_id") != gridfs_id:
        raise HTTPException(404, "Photo not linked to worker")
    fn = f'{(w.get("first_name") or "worker").lower()}-{(w.get("last_name") or "").lower()}.jpg'
    return await _stream_gridfs(gridfs_id, fn)


@router.get("/{worker_id}/certifications/{cert_id}/file")
async def stream_cert_file(
    worker_id: str,
    cert_id: str,
    request: Request,
    # v58.13.51 — Default to INLINE on the disk branch so the behaviour
    # matches the GridFS branch (which already emits inline via
    # `_stream_gridfs`). Prior to this ship the disk branch triggered
    # a "Save As" prompt because Starlette's default disposition for
    # `FileResponse(filename=...)` is `attachment`.
    download: int = Query(0, ge=0, le=1),
    user: dict = Depends(require_roles("admin", "hseq_lead", "hr_lead",
                                         "supervisor", "auditor", "worker")),
):
    """Serve a cert's attached file. Handles BOTH storage backends:
      - GridFS (Simpro ZIP imports): `doc_file_id` is a 24-hex ObjectId.
      - `doc_files` (legacy upload flow): `doc_file_id` is a UUID → look
        up the file row and serve directly (preserves the caller's
        download token).
    """
    cert = await db.worker_certifications.find_one(
        {"id": cert_id, "worker_id": worker_id, "org_id": user["org_id"],
         "deleted_at": None},
    )
    if not cert:
        raise HTTPException(404, "Cert not found")
    dfid = cert.get("doc_file_id") or ""
    if not dfid:
        raise HTTPException(404, "Cert has no attached file")
    # GridFS ObjectId hex? 24 chars, all hex.
    if len(dfid) == 24 and all(c in "0123456789abcdef" for c in dfid.lower()):
        filename = (cert.get("name") or "certificate") + ".pdf"
        return await _stream_gridfs(dfid, filename)
    # Otherwise it's a `doc_files.id` — serve from local disk directly.
    df = await db.doc_files.find_one(
        {"id": dfid, "org_id": user["org_id"], "deleted_at": None},
    )
    if not df:
        raise HTTPException(404, "File not found")
    from pathlib import Path as _Path
    from fastapi.responses import FileResponse
    from document_library import UPLOAD_DIR as _DOC_UPLOAD_DIR
    path = _Path(_DOC_UPLOAD_DIR) / df["folder_id"] / df["stored_name"]
    if not path.exists():
        raise missing_file_response()
    return FileResponse(
        str(path),
        media_type=df.get("mime") or "application/octet-stream",
        filename=df.get("filename"),
        content_disposition_type="attachment" if download else "inline",
    )


@router.get("/{worker_id}/hr-documents/{doc_id}/file")
async def stream_hr_document(
    worker_id: str,
    doc_id: str,
    user: dict = Depends(require_roles("admin", "hr_lead")),
):
    """Serve an HR document from GridFS. Admin/hr_lead only."""
    doc = await db.worker_hr_documents.find_one(
        {"id": doc_id, "worker_id": worker_id, "org_id": user["org_id"],
         "deleted_at": None},
    )
    if not doc:
        raise HTTPException(404, "HR document not found")
    return await _stream_gridfs(doc.get("gridfs_id"), doc.get("filename") or "hr-doc")


# v58.13.132fi — Admin-managed CRUD on `worker_hr_documents`.
# Pre-.132fi the collection was populated only by the Simpro zip
# importer. Admins now get a full drop-zone / notes / soft-delete
# surface on the worker edit page (Section D of the .132fg brief).

_HR_DOC_MAX_BYTES = 50 * 1024 * 1024  # 50 MB — matches Certifications.
_HR_DOC_ALLOWED_MIME_PREFIXES = (
    "application/pdf", "image/", "text/",
    "application/msword",
    "application/vnd.openxmlformats-officedocument",
    "application/vnd.ms-excel",
)


def _hr_mime_allowed(mime: str) -> bool:
    m = (mime or "").lower()
    return any(m.startswith(p) for p in _HR_DOC_ALLOWED_MIME_PREFIXES)


@router.post("/{worker_id}/hr-documents", status_code=201)
async def upload_hr_document(
    worker_id: str,
    file: UploadFile = File(...),
    notes: str = Form(""),
    user: dict = Depends(require_roles("admin", "hr_lead")),
):
    """Admin upload — Private & Confidential file. GridFS-backed."""
    # Worker exists?
    w = await db.workers.find_one(
        {"id": worker_id, "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0, "id": 1},
    )
    if not w:
        raise HTTPException(404, "Worker not found")
    # Mime allow-list.
    if not _hr_mime_allowed(file.content_type or ""):
        raise HTTPException(400, f"Unsupported file type: {file.content_type or 'unknown'}")
    # Size guard — read into memory (matches existing cert upload pattern).
    blob = await file.read()
    if len(blob) > _HR_DOC_MAX_BYTES:
        raise HTTPException(413, f"File exceeds {_HR_DOC_MAX_BYTES // (1024*1024)} MB limit")
    if len(blob) == 0:
        raise HTTPException(400, "Empty file")
    gid = await _fs_bucket().upload_from_stream(
        file.filename or "hr-doc", blob,
        metadata={"kind": "worker_hr_document", "org_id": user["org_id"],
                   "worker_id": worker_id},
    )
    ts = now_iso()
    doc = {
        "id": new_id(), "org_id": user["org_id"], "worker_id": worker_id,
        "filename": file.filename or "hr-doc", "folder": "private",
        "gridfs_id": str(gid), "size": len(blob),
        "mime_type": file.content_type or "",
        "notes": (notes or "").strip(),
        "source": "admin_upload", "uploaded_by": user["id"],
        "uploaded_at": ts, "deleted_at": None,
    }
    await db.worker_hr_documents.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.patch("/{worker_id}/hr-documents/{doc_id}")
async def patch_hr_document(
    worker_id: str, doc_id: str,
    body: dict = Body(...),
    user: dict = Depends(require_roles("admin", "hr_lead")),
):
    """Notes-only edit. Filename and file blob are immutable — re-upload
    if you need to replace the file."""
    existing = await db.worker_hr_documents.find_one(
        {"id": doc_id, "worker_id": worker_id,
         "org_id": user["org_id"], "deleted_at": None},
    )
    if not existing:
        raise HTTPException(404, "HR document not found")
    updates: dict = {"updated_at": now_iso(), "updated_by": user["id"]}
    if "notes" in body:
        updates["notes"] = str(body["notes"] or "").strip()
    await db.worker_hr_documents.update_one(
        {"id": doc_id}, {"$set": updates},
    )
    fresh = await db.worker_hr_documents.find_one({"id": doc_id})
    fresh.pop("_id", None)
    return fresh


@router.delete("/{worker_id}/hr-documents/{doc_id}", status_code=204)
async def delete_hr_document(
    worker_id: str, doc_id: str,
    user: dict = Depends(require_roles("admin", "hr_lead")),
):
    """Soft-delete + archive_audit trail entry."""
    doc = await db.worker_hr_documents.find_one(
        {"id": doc_id, "worker_id": worker_id,
         "org_id": user["org_id"], "deleted_at": None},
    )
    if not doc:
        raise HTTPException(404, "HR document not found")
    ts = now_iso()
    await db.worker_hr_documents.update_one(
        {"id": doc_id},
        {"$set": {"deleted_at": ts, "deleted_by": user["id"]}},
    )
    # v58.13.132fj — archive_audit trail. Use the shared helper for
    # consistency with document_library / certifications / insurance.
    from archive_audit_helpers import record_file_archive_audit
    await record_file_archive_audit(
        module="hr_documents", resource="worker_hr_documents",
        resource_id=doc_id, filename=doc.get("filename"),
        worker_id=worker_id, user=user,
    )
    return None


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


# v160.3.4a — org-wide unmatched-documents summary for the dashboard tile.
@bulk_router.get("/unmatched-summary")
async def unmatched_summary(user: dict = Depends(require_roles("admin", "hseq_lead", "hr_lead"))):
    """Aggregate: how many unmatched documents are awaiting triage across
    the org, and across how many distinct workers. Powers the Dashboard
    triage tile — worker/supervisor/auditor roles never see this route."""
    pipeline = [
        {"$match": {"org_id": user["org_id"], "deleted_at": None}},
        {"$group": {"_id": "$worker_id", "n": {"$sum": 1}}},
    ]
    total_docs = 0
    worker_ids: list[str] = []
    async for row in db.worker_unmatched_documents.aggregate(pipeline):
        total_docs += int(row.get("n") or 0)
        if row.get("_id"):
            worker_ids.append(row["_id"])
    return {
        "total_docs": total_docs,
        "worker_count": len(worker_ids),
        "first_worker_id": worker_ids[0] if worker_ids else None,
    }


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

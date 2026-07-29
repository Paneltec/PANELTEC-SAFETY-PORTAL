"""v160.3.9.12a — Bulk-import Daily Pre-Start PDFs.

Backend + endpoints only. Wizard UI comes in v160.3.9.12b.

Flow:
  POST /pre-starts/bulk-import/init      → create job, resolve URL
  POST /pre-starts/bulk-import/{id}/start → kick off async worker
  GET  /pre-starts/bulk-import/{id}/status → poll progress
  GET  /pre-starts/bulk-import/{id}/report → final per-PDF results
  POST /pre-starts/bulk-import/{id}/approve → after dry-run OK, resume full run

Job state machine:
  init → downloading → dryrun → awaiting_approval
                             → processing → complete
                             → failed
"""
from __future__ import annotations

import asyncio
import base64
import io
import json
import logging
import os
import re
import subprocess
import tempfile
import uuid
import zipfile
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from db import db
from auth import get_current_user

log = logging.getLogger("paneltec.bulk_import_prestarts")
router = APIRouter(prefix="/pre-starts/bulk-import", tags=["bulk-import"])

_WRITE_ROLES = {"admin", "manager", "hseq_lead"}


async def ensure_indexes() -> None:
    """Idempotent index setup — called from server startup."""
    try:
        await db.bulk_import_jobs.create_index("id", unique=True)
        await db.bulk_import_jobs.create_index([("org_id", 1), ("created_at", -1)])
        await db.bulk_import_dryrun.create_index([("job_id", 1), ("filename", 1)],
                                                 unique=True)
        await db.bulk_import_dryrun.create_index([("job_id", 1), ("status", 1)])
    except Exception as e:  # pragma: no cover — bootstrap only
        log.warning("bulk_import index setup: %s", e)

# All 6 pre-start template names + their labels (used by the classifier prompt).
_TEMPLATE_HINTS = {
    "536805af-e397-451f-94f0-30296d8f3a97": "Daily Pre-Start",
    "d9008c00-e3b1-4de1-a909-bdf7db4f262a": "CVT Daily Pre-Start",
    "388c3c70-4cd6-4b7b-9ed1-067fae0fa8f9": "Weekly Pre-Start",
    "915f2303-71ca-4735-adc1-1e798d74851d": "Tip Truck Daily Pre-Start",
    "e62bee35-1769-455d-8c30-6200a3c6eb08": "Vacuum Truck (VT) Daily Pre-Start",
    "225cd097-2c2d-4963-9b92-1f8554894db8": "Plant Pre-Start Checklist (Heavy Equipment)",
}


def _require_admin(user: dict) -> None:
    if (user.get("role") or "").lower() not in _WRITE_ROLES:
        raise HTTPException(403, "Admin / manager / HSEQ lead only.")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _audit(user: dict, action: str, payload: dict) -> None:
    try:
        await db.audit_logs.insert_one({
            "org_id": user.get("org_id"), "actor_id": user.get("id"),
            "actor_name": user.get("name") or user.get("email"),
            "action": action, "at": _now_iso(), **payload,
        })
    except Exception as e:
        log.warning("audit write failed: %s", e)


# ────────────────── URL resolver ──────────────────

def _dropbox_dl_swap(url: str) -> str:
    """Swap Dropbox share links `dl=0` → `dl=1` so they stream directly."""
    if "dropbox.com" in url and "dl=0" in url:
        return url.replace("dl=0", "dl=1")
    return url


async def _resolve_and_head(url: str) -> tuple[str, Optional[int]]:
    """Follow redirects to the final CDN URL and return (final_url, size)."""
    url = _dropbox_dl_swap(url)
    async with httpx.AsyncClient(follow_redirects=True, timeout=60.0) as c:
        r = await c.head(url)
        r.raise_for_status()
        size = int(r.headers.get("content-length") or 0) or None
        final = str(r.url)
    return final, size


# ────────────────── Claude helpers ──────────────────

async def _claude_classify(png_b64: str) -> dict:
    """Ask Claude which of the 6 templates this PDF page best matches."""
    from ai import _claude_json  # reuse the existing helper
    names = list(_TEMPLATE_HINTS.values())
    system = ("You classify photos of Australian pre-start check-sheets. "
              "Return JSON only.")
    user = ("Which of these template names best matches this form? "
            f"Options: {json.dumps(names)}. "
            'Respond as {"template_name": "…", "confidence": 0.0-1.0}.')
    return await _claude_json(system, user, image_b64=png_b64)


async def _claude_extract(png_b64: str, template: dict) -> dict:
    """Extract structured values keyed by field label from the PDF page."""
    from ai import _claude_json
    labels = [f["label"] for f in template.get("fields", [])]
    system = "You extract filled pre-start check-sheet values. Return JSON only."
    user = (
        f"Template: {template.get('name')}. "
        f"For each of these field labels, extract the filled value: "
        f"{json.dumps(labels)}. "
        'Return {"date":"YYYY-MM-DD","worker_name":"…","plant_or_vehicle":"…",'
        '"site":"…","gps_map_present":true|false,"signature_present":true|false,'
        '"checklist":{"<label>":"Pass|Fail|N/A|Yes|No|<text>"},"notes":"…"}. '
        "Use exact label strings as keys. Omit fields you cannot see."
    )
    return await _claude_json(system, user, image_b64=png_b64)


# ────────────────── Fuzzy match ──────────────────

def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (s or "").lower())


async def _match_worker(name: str, org_id: str) -> tuple[Optional[str], float]:
    if not name: return None, 0.0
    target = _norm(name)
    best_id, best_score = None, 0.0
    async for w in db.workers.find({"org_id": org_id, "deleted_at": None},
                                    {"_id": 0, "id": 1, "first_name": 1, "last_name": 1}):
        cand = _norm(f"{w.get('first_name','')} {w.get('last_name','')}")
        if not cand: continue
        # Simple containment score; production could use rapidfuzz.
        score = 1.0 if cand == target else (
            0.9 if target in cand or cand in target else 0.0)
        if score > best_score:
            best_id, best_score = w["id"], score
    return (best_id, best_score) if best_score >= 0.85 else (None, best_score)


async def _match_site(name: str, org_id: str) -> Optional[str]:
    if not name: return None
    target = _norm(name)
    async for s in db.sites.find({"org_id": org_id, "deleted_at": None},
                                  {"_id": 0, "id": 1, "name": 1}):
        if _norm(s.get("name", "")) == target: return s["id"]
    return None


# ────────────────── PDF → PNG ──────────────────

def _pdf_first_page_png_b64(pdf_bytes: bytes) -> Optional[str]:
    """pdftoppm the first page of `pdf_bytes` → PNG → base64."""
    with tempfile.TemporaryDirectory() as td:
        pdf_path = os.path.join(td, "in.pdf")
        with open(pdf_path, "wb") as f:
            f.write(pdf_bytes)
        try:
            subprocess.run(
                ["pdftoppm", "-png", "-r", "110", "-f", "1", "-l", "1",
                 pdf_path, os.path.join(td, "page")],
                check=True, capture_output=True, timeout=30,
            )
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
            log.warning("pdftoppm failed: %s", e)
            return None
        for fn in sorted(os.listdir(td)):
            if fn.startswith("page") and fn.endswith(".png"):
                return base64.b64encode(open(os.path.join(td, fn), "rb").read()).decode()
    return None


# ────────────────── Models ──────────────────

class InitBody(BaseModel):
    source: str  # "url" | "upload"
    url: Optional[str] = None
    filename: Optional[str] = None


class ApproveBody(BaseModel):
    approve: bool = True


# ────────────────── Endpoints ──────────────────

@router.post("/init", status_code=201)
async def init_job(body: InitBody, user: dict = Depends(get_current_user)):
    _require_admin(user)
    if body.source == "url":
        if not body.url:
            raise HTTPException(400, "url required for source='url'")
        final_url, size = await _resolve_and_head(body.url)
    else:
        final_url, size = None, None

    job_id = str(uuid.uuid4())
    doc = {
        "id": job_id, "org_id": user["org_id"], "actor_id": user.get("id"),
        "source": body.source, "url_input": body.url, "url_final": final_url,
        "filename": body.filename, "size_bytes": size,
        "state": "init",
        "processed": 0, "failed": 0, "total": None,
        "errors": [], "template_hits": {}, "created_at": _now_iso(),
    }
    await db.bulk_import_jobs.insert_one(doc)
    await _audit(user, "bulk_import.init",
                 {"job_id": job_id, "source": body.source, "size": size})
    return {"job_id": job_id, "size_bytes": size, "url_final": final_url}


@router.post("/{job_id}/start", status_code=202)
async def start_job(job_id: str, user: dict = Depends(get_current_user)):
    _require_admin(user)
    job = await db.bulk_import_jobs.find_one({"id": job_id, "org_id": user["org_id"]}, {"_id": 0})
    if not job:
        raise HTTPException(404, "job not found")
    if job["state"] not in {"init", "awaiting_approval"}:
        raise HTTPException(400, f"job in state {job['state']}, cannot start")

    mode = "full_run" if job["state"] == "awaiting_approval" else "dry_run"
    await db.bulk_import_jobs.update_one({"id": job_id},
        {"$set": {"state": "downloading" if mode == "dry_run" else "processing",
                  "started_at": _now_iso(), "mode": mode}})
    # Fire the worker in the background — do NOT await.
    asyncio.create_task(_run_job(job_id, mode))
    await _audit(user, "bulk_import.start", {"job_id": job_id, "mode": mode})
    return {"job_id": job_id, "mode": mode}


@router.get("/{job_id}/status")
async def status(job_id: str, user: dict = Depends(get_current_user)):
    _require_admin(user)
    job = await db.bulk_import_jobs.find_one({"id": job_id, "org_id": user["org_id"]}, {"_id": 0})
    if not job:
        raise HTTPException(404, "job not found")
    return job


@router.get("/{job_id}/report")
async def report(job_id: str, user: dict = Depends(get_current_user)):
    _require_admin(user)
    job = await db.bulk_import_jobs.find_one({"id": job_id, "org_id": user["org_id"]}, {"_id": 0})
    if not job:
        raise HTTPException(404, "job not found")
    dryrun = []
    async for r in db.bulk_import_dryrun.find({"job_id": job_id}, {"_id": 0}):
        dryrun.append(r)
    return {"job": job, "dryrun_results": dryrun}


@router.post("/{job_id}/approve")
async def approve(job_id: str, body: ApproveBody, user: dict = Depends(get_current_user)):
    _require_admin(user)
    job = await db.bulk_import_jobs.find_one({"id": job_id, "org_id": user["org_id"]}, {"_id": 0})
    if not job:
        raise HTTPException(404, "job not found")
    if job["state"] != "awaiting_approval":
        raise HTTPException(400, "job not awaiting approval")
    if not body.approve:
        await db.bulk_import_jobs.update_one({"id": job_id},
            {"$set": {"state": "cancelled", "cancelled_at": _now_iso()}})
        return {"job_id": job_id, "state": "cancelled"}
    # Kick off the full run.
    await db.bulk_import_jobs.update_one({"id": job_id},
        {"$set": {"state": "processing", "resumed_at": _now_iso()}})
    asyncio.create_task(_run_job(job_id, "full_run"))
    await _audit(user, "bulk_import.approve", {"job_id": job_id})
    return {"job_id": job_id, "state": "processing"}


# ────────────────── Worker ──────────────────

async def _stream_download(url: str, dest_path: str) -> int:
    """Streaming download to disk. Returns bytes written."""
    total = 0
    async with httpx.AsyncClient(follow_redirects=True, timeout=None) as c:
        async with c.stream("GET", url) as r:
            r.raise_for_status()
            with open(dest_path, "wb") as f:
                async for chunk in r.aiter_bytes(chunk_size=1 << 20):
                    f.write(chunk); total += len(chunk)
    return total


async def _process_one_pdf(job: dict, filename: str, pdf_bytes: bytes,
                           templates_by_id: dict, org_id: str) -> dict:
    """Classifier + extractor + fuzzy match for one PDF. Persists to
    `bulk_import_dryrun`. Returns the persisted record dict."""
    png_b64 = await asyncio.to_thread(_pdf_first_page_png_b64, pdf_bytes)
    if not png_b64:
        rec = {"job_id": job["id"], "filename": filename,
               "status": "failed", "reason": "pdftoppm failed",
               "at": _now_iso()}
        await db.bulk_import_dryrun.replace_one(
            {"job_id": job["id"], "filename": filename}, rec, upsert=True)
        return rec
    try:
        cls = await _claude_classify(png_b64)
        tpl_name = (cls or {}).get("template_name") or "Daily Pre-Start"
        tpl_id = next((k for k, v in _TEMPLATE_HINTS.items() if v == tpl_name),
                      "536805af-e397-451f-94f0-30296d8f3a97")
        template = templates_by_id.get(tpl_id) or {}
        ext = await _claude_extract(png_b64, template)
        worker_id, worker_conf = await _match_worker(ext.get("worker_name", ""), org_id)
        site_id = await _match_site(ext.get("site", ""), org_id)
        rec = {
            "job_id": job["id"], "filename": filename,
            "status": "ok",
            "classifier": cls, "extracted": ext,
            "template_id": tpl_id, "template_name": tpl_name,
            "worker_match": {"id": worker_id, "confidence": worker_conf,
                             "needs_review": worker_id is None},
            "site_match": {"id": site_id},
            "at": _now_iso(),
        }
    except Exception as e:
        rec = {"job_id": job["id"], "filename": filename,
               "status": "failed", "reason": f"claude: {e}", "at": _now_iso()}
    await db.bulk_import_dryrun.replace_one(
        {"job_id": job["id"], "filename": filename}, rec, upsert=True)
    return rec


async def _run_job(job_id: str, mode: str):
    """The async worker. Downloads zip, iterates PDFs, runs classifier +
    extractor per PDF, updates job progress."""
    job = await db.bulk_import_jobs.find_one({"id": job_id}, {"_id": 0})
    if not job: return
    org_id = job["org_id"]
    dry_limit = 20 if mode == "dry_run" else None
    try:
        # 1. Download ZIP.
        with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as tf:
            zip_path = tf.name
        await _stream_download(job["url_final"] or job["url_input"], zip_path)

        # 2. Load pre-start templates once for extraction.
        templates_by_id = {}
        async for t in db.form_templates.find(
                {"org_id": org_id, "deleted_at": None, "category": "pre_start"},
                {"_id": 0}):
            templates_by_id[t["id"]] = t

        # 3. Iterate zip entries.
        zf = zipfile.ZipFile(zip_path, "r")
        pdf_names = [n for n in zf.namelist() if n.lower().endswith(".pdf")]
        total = min(len(pdf_names), dry_limit) if dry_limit else len(pdf_names)
        await db.bulk_import_jobs.update_one({"id": job_id},
            {"$set": {"state": "extracting" if mode == "dry_run" else "processing",
                      "total": total}})

        # 4. Process with a 5-way concurrency limit.
        # zipfile.ZipFile.read() is NOT safe for concurrent calls on the same
        # handle — serialise reads via a dedicated lock, then hand the bytes
        # off to `_process_one_pdf` which is safe to run concurrently.
        sem = asyncio.Semaphore(5)
        zip_lock = asyncio.Lock()
        processed = 0

        async def _one(name):
            nonlocal processed
            async with sem:
                async with zip_lock:
                    data = await asyncio.to_thread(zf.read, name)
                rec = await _process_one_pdf(job, name, data, templates_by_id, org_id)
                processed += 1
                await db.bulk_import_jobs.update_one({"id": job_id},
                    {"$set": {"processed": processed}})
                if rec["status"] == "ok" and mode == "full_run":
                    # Insert into form_submissions with metadata flag.
                    await db.form_submissions.insert_one({
                        "id": str(uuid.uuid4()), "org_id": org_id,
                        "template_id": rec["template_id"],
                        "template_name_snapshot": rec["template_name"],
                        "fields": [], "source": "bulk_import",
                        "submitted_at": _now_iso(),
                        "submitted_by_id": job["actor_id"],
                        "metadata": {"imported_via": "bulk_import_v160.3.9.12",
                                     "job_id": job_id, "src_filename": name},
                        "deleted_at": None,
                    })

        await asyncio.gather(*[_one(n) for n in pdf_names[:total]])

        # 5. Final state transition.
        new_state = "awaiting_approval" if mode == "dry_run" else "complete"
        await db.bulk_import_jobs.update_one({"id": job_id},
            {"$set": {"state": new_state, "finished_at": _now_iso()}})
        try: os.unlink(zip_path)
        except OSError: pass
    except Exception as e:
        log.exception("bulk_import job %s failed", job_id)
        await db.bulk_import_jobs.update_one({"id": job_id},
            {"$set": {"state": "failed", "error": str(e),
                      "finished_at": _now_iso()}})

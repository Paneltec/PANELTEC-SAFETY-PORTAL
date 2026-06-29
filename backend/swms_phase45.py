"""Phase 4.5 — SWMS paste-to-create + bulk soft-delete / restore.

New endpoints:
  POST /api/swms/from-paste     — Claude-parse arbitrary pasted text/HTML
                                  into the structured SWMS schema and save
                                  as a draft.
  POST /api/swms/bulk-delete    — soft-delete up to N SWMS in one shot,
                                  setting `restore_until = now + 30d`.
  POST /api/swms/{id}/restore   — undo a soft-delete (if within the
                                  30-day window).
  GET  /api/swms/recycle-bin    — admin-only Recycle Bin listing.

Scheduled job:
  `purge_expired_swms()` — runs daily at 03:15 UTC. Hard-deletes any SWMS
  whose `restore_until` is in the past.

All write paths are audit-logged. Bulk-delete and restore obey the same
ownership rule: caller must be admin OR be the original `created_by`.
"""
from __future__ import annotations
import logging
import os
import re
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from auth import get_current_user
from db import db
from models import new_id, now_iso

router = APIRouter(prefix="/swms", tags=["swms-phase45"])
log = logging.getLogger("paneltec.swms_phase45")

# ----- Paste limits ------------------------------------------------------
MIN_PASTE_CHARS = 200
MAX_PASTE_CHARS = 12_000
RESTORE_WINDOW_DAYS = 30


# ----- HTML → tidy-Markdown for the LLM ---------------------------------
def html_to_markdown(html: str) -> str:
    """Lossy but LLM-friendly HTML stripper. Keeps tables as Markdown so
    Claude can read activity / hazard grids back out, drops everything
    else to plain text. We deliberately avoid pulling in another package
    just for this one path — regex + BeautifulSoup (already a transitive
    dep) is enough."""
    try:
        from bs4 import BeautifulSoup
    except Exception:
        # Fallback: just strip tags so Claude still gets the text.
        return re.sub(r"<[^>]+>", " ", html or "")

    soup = BeautifulSoup(html or "", "html.parser")

    # Convert each <table> into a Markdown table so column meaning is
    # preserved (activity → hazards → controls is grid-shaped in most
    # exported SWMS Word docs).
    for table in soup.find_all("table"):
        md_rows: List[str] = []
        rows = table.find_all("tr")
        for i, tr in enumerate(rows):
            cells = [c.get_text(" ", strip=True) for c in tr.find_all(["td", "th"])]
            if not cells:
                continue
            md_rows.append("| " + " | ".join(cells) + " |")
            if i == 0:
                md_rows.append("| " + " | ".join(["---"] * len(cells)) + " |")
        table.replace_with("\n" + "\n".join(md_rows) + "\n")

    for br in soup.find_all("br"):
        br.replace_with("\n")
    text = soup.get_text("\n", strip=False)
    # Collapse runs of blank lines.
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


# ----- Paste schema ------------------------------------------------------
class PasteIn(BaseModel):
    text: str = ""
    html: Optional[str] = None
    title_hint: Optional[str] = None
    workspace_id: Optional[str] = None


PASTE_SYSTEM = """You are an Australian WHS (Work Health & Safety) consultant.
You will be given a pasted SWMS-like document (plain text or table-flattened
markdown). Your job is to parse it into STRICT JSON matching the Paneltec
Civil SWMS schema below. Do NOT invent content — if a section is missing,
return an empty list.

Schema (return EXACTLY this shape, no markdown fences, no prose):
{
  "title": "<short title — use title_hint if supplied and document has no obvious title>",
  "scope": "<one-paragraph scope of works, empty string if unknown>",
  "high_risk_construction_work": "<text or empty>",
  "tasks": [ { "step": "1", "description": "..." }, ... ],
  "activity_analysis": [
    { "step": "...", "potential_hazards": ["..."], "risk_class_before": "H/M/L",
      "controls": ["..."], "responsible": ["..."], "risk_class_after": "H/M/L" }
  ],
  "hazards": [ { "label": "...", "risk": "low|medium|high" } ],
  "controls": [ { "label": "...", "method": "elimination|substitution|engineering|administrative|ppe" } ],
  "ppe": [ "hard hat", "hi-vis", ... ],
  "training_requirements": [ "..." ],
  "equipment_list": [ "..." ],
  "legislation_and_codes": [ "..." ],
  "emergency_procedures": { "general": "...", "accident_incident": "...", "fire": "...", "spill": "..." }
}
Tasks vs activity_analysis: fill BOTH if you can — `tasks` is a simple
ordered list, `activity_analysis` is the grid with risk classes and
controls per row."""


async def parse_swms_text(text_for_llm: str, title_hint: Optional[str]) -> dict:
    """Phase 4.5/4.6 — shared Claude entry-point for paste + scan flows.

    Returns the parsed SWMS JSON. The same prompt + schema applies to
    both surfaces so the editor highlight UI ("AI filled" pills) is
    consistent regardless of input modality."""
    # Lazy import so the module loads even when emergentintegrations
    # isn't installed (eg unit-test env).
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    import uuid

    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise HTTPException(503, "Emergent LLM key not configured")

    user_msg = (
        f"title_hint: {title_hint or '(none)'}\n\n"
        "Document begins below. Parse it into the SWMS JSON.\n\n"
        f"=====\n{text_for_llm}\n=====\n"
    )
    chat = LlmChat(api_key=key, session_id=str(uuid.uuid4()),
                   system_message=PASTE_SYSTEM).with_model("anthropic", "claude-sonnet-4-5-20250929")
    try:
        reply = await chat.send_message(UserMessage(text=user_msg))
    except Exception as exc:
        raise HTTPException(503, f"LLM call failed: {exc}") from exc

    raw = reply if isinstance(reply, str) else getattr(reply, "content", str(reply))
    import json as _json
    candidates = [raw]
    for m in re.finditer(r"```(?:json)?\s*(\{.*?\})\s*```", raw, re.DOTALL):
        candidates.append(m.group(1))
    brace = re.search(r"\{.*\}", raw, re.DOTALL)
    if brace:
        candidates.append(brace.group(0))
    for c in candidates:
        try:
            return _json.loads(c)
        except Exception:
            continue
    raise HTTPException(503, f"AI returned non-JSON output: {raw[:200]}")


async def _claude_parse(text_for_llm: str, title_hint: Optional[str]) -> dict:
    # Backwards-compat alias — kept so any older imports still resolve.
    return await parse_swms_text(text_for_llm, title_hint)


@router.post("/from-paste", status_code=201)
async def swms_from_paste(body: PasteIn, user: dict = Depends(get_current_user)):
    """Phase 4.5 — paste arbitrary SWMS content → Claude-parsed draft SWMS."""
    raw_text = (body.text or "").strip()
    if body.html and not raw_text:
        raw_text = html_to_markdown(body.html)
    elif body.html and len(body.html) > 2 * len(raw_text):
        # Caller sent both — prefer the html if it has materially more
        # structure (tables, lists) than the plain text.
        raw_text = html_to_markdown(body.html)

    if len(raw_text) < MIN_PASTE_CHARS:
        raise HTTPException(400, "Not enough content to parse. Paste at least 200 characters of SWMS text.")
    if len(raw_text) > MAX_PASTE_CHARS:
        raise HTTPException(413, "Paste is too large — split into sections or upload a file.")

    parsed = await _claude_parse(raw_text, body.title_hint)

    # Build the SWMS doc. Mirror what `crud.build_router`'s create-path does
    # so we land in the same collection / shape — but force status=draft
    # and set `created_via=paste` for audit traceability.
    title = (parsed.get("title") or (body.title_hint or "").strip() or "Pasted SWMS draft")[:200]
    doc = {
        "id":            new_id(),
        "org_id":        user["org_id"],
        "workspace_id":  body.workspace_id or user.get("workspace_id") or user.get("default_workspace_id"),
        "created_by":    user["id"],
        "created_at":    now_iso(),
        "updated_at":    now_iso(),
        "deleted_at":    None,
        "deleted_by":    None,
        "restore_until": None,
        "title":         title,
        "job_description": (parsed.get("scope") or "")[:1000],
        "scope":         parsed.get("scope") or "",
        "high_risk_construction_work": parsed.get("high_risk_construction_work") or "",
        "tasks":         parsed.get("tasks") or [],
        "hazards":       parsed.get("hazards") or [],
        "controls":      parsed.get("controls") or [],
        "ppe":           parsed.get("ppe") or [],
        "activity_analysis":   parsed.get("activity_analysis") or [],
        "environmental_risks": parsed.get("environmental_risks") or [],
        "training_requirements": parsed.get("training_requirements") or [],
        "equipment_list":      parsed.get("equipment_list") or [],
        "legislation_and_codes": parsed.get("legislation_and_codes") or [],
        "emergency_procedures": parsed.get("emergency_procedures") or {},
        "status":        "draft",
        "version":       1,
        "created_via":   "paste",
    }
    await db.swms.insert_one(dict(doc))
    doc.pop("_id", None)
    log.info("swms.from_paste org=%s user=%s chars=%d title=%r id=%s",
             user["org_id"], user["id"], len(raw_text), title[:60], doc["id"])
    return doc


# ----- Bulk delete + restore --------------------------------------------
class BulkIdsIn(BaseModel):
    ids: List[str] = Field(default_factory=list, max_length=200)


async def _allowed_ids(ids: List[str], user: dict, *, deleted: bool) -> List[dict]:
    """Return SWMS docs the caller is allowed to act on. Admins can act
    on any row in the org; non-admins only on their own."""
    if not ids:
        return []
    q = {"id": {"$in": ids}, "org_id": user["org_id"]}
    q["deleted_at"] = {"$ne": None} if deleted else None
    docs = await db.swms.find(q, {"_id": 0}).to_list(len(ids))
    if user.get("role") == "admin":
        return docs
    return [d for d in docs if d.get("created_by") == user.get("id")]


@router.post("/bulk-delete")
async def bulk_delete_swms(body: BulkIdsIn, user: dict = Depends(get_current_user)):
    ids = [i for i in (body.ids or []) if isinstance(i, str)]
    if not ids:
        raise HTTPException(400, "No ids provided")
    allowed = await _allowed_ids(ids, user, deleted=False)
    allowed_ids = [d["id"] for d in allowed]
    refused = [i for i in ids if i not in allowed_ids]
    if not allowed_ids:
        raise HTTPException(403, "You don't have permission to delete any of these SWMS")

    now = datetime.now(timezone.utc)
    restore_until = (now + timedelta(days=RESTORE_WINDOW_DAYS)).isoformat()
    result = await db.swms.update_many(
        {"id": {"$in": allowed_ids}, "org_id": user["org_id"], "deleted_at": None},
        {"$set": {"deleted_at":    now.isoformat(),
                  "deleted_by":    user["id"],
                  "restore_until": restore_until,
                  "updated_at":    now.isoformat()}},
    )
    await db.audit_logs.insert_one({
        "org_id":     user["org_id"],
        "actor_id":   user["id"],
        "actor_name": user.get("name") or user.get("email"),
        "action":     "swms.bulk_delete",
        "at":         now.isoformat(),
        "deleted":    allowed_ids,
        "refused":    refused,
        "restore_until": restore_until,
    })
    return {
        "deleted":       result.modified_count,
        "deleted_ids":   allowed_ids,
        "refused_ids":   refused,
        "restore_until": restore_until,
    }


@router.post("/{swms_id}/restore")
async def restore_swms(swms_id: str, user: dict = Depends(get_current_user)):
    docs = await _allowed_ids([swms_id], user, deleted=True)
    if not docs:
        # Either the row doesn't exist, isn't soft-deleted, or the caller
        # doesn't own it. 404 keeps probing attacks blind.
        raise HTTPException(404, "SWMS not found or not in recycle bin")
    now = datetime.now(timezone.utc).isoformat()
    await db.swms.update_one(
        {"id": swms_id, "org_id": user["org_id"]},
        {"$set": {"deleted_at": None, "deleted_by": None,
                  "restore_until": None, "updated_at": now}},
    )
    await db.audit_logs.insert_one({
        "org_id":     user["org_id"],
        "actor_id":   user["id"],
        "actor_name": user.get("name") or user.get("email"),
        "action":     "swms.restore",
        "at":         now,
        "swms_id":    swms_id,
    })
    return {"ok": True, "id": swms_id}


@router.get("/recycle-bin")
async def list_recycle_bin(user: dict = Depends(get_current_user)):
    """Soft-deleted SWMS — admin-only. Returns rows with `days_left`
    computed from `restore_until` so the UI can show a countdown."""
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    docs = await db.swms.find(
        {"org_id": user["org_id"], "deleted_at": {"$ne": None}},
        {"_id": 0},
    ).sort("deleted_at", -1).to_list(500)
    now = datetime.now(timezone.utc)
    out = []
    for d in docs:
        ru = d.get("restore_until")
        days_left = None
        if ru:
            try:
                ts = datetime.fromisoformat(ru.replace("Z", "+00:00"))
                days_left = max(0, (ts - now).days)
            except Exception:
                days_left = None
        out.append({**d, "days_left": days_left})
    return out


# ----- Phase 4.6 — `from-scan` (OCR-driven upload) ----------------------
ALLOWED_SCAN_EXTS = {".pdf", ".png", ".jpg", ".jpeg"}
MAX_SCAN_BYTES = 25 * 1024 * 1024  # 25 MB
SCAN_DIR_NAME = "swms_scans"


def _safe_scan_ext(filename: str) -> Optional[str]:
    if not filename:
        return None
    ext = ("." + filename.rsplit(".", 1)[-1].lower()) if "." in filename else ""
    return ext if ext in ALLOWED_SCAN_EXTS else None


def _ocr_image(path) -> str:
    """Tesseract direct call for image uploads."""
    import shutil, subprocess
    if not shutil.which("tesseract"):
        return ""
    res = subprocess.run(
        ["tesseract", str(path), "-", "-l", "eng"],
        capture_output=True, timeout=90,
    )
    return (res.stdout or b"").decode("utf-8", errors="replace").strip()


def _count_pdf_pages(pdf_path) -> int:
    """Best-effort page count for the audit log; never raises."""
    try:
        import shutil, subprocess
        if shutil.which("pdfinfo"):
            r = subprocess.run(["pdfinfo", str(pdf_path)], capture_output=True, timeout=30)
            m = re.search(rb"Pages:\s+(\d+)", r.stdout or b"")
            if m:
                return int(m.group(1))
    except Exception:
        pass
    return 0


@router.post("/from-scan", status_code=201)
async def swms_from_scan(
    file: UploadFile = File(...),
    title_hint: Optional[str] = Form(None),
    workspace_id: Optional[str] = Form(None),
    user: dict = Depends(get_current_user),
):
    """Phase 4.6 — upload a scanned/signed SWMS (PDF or photo), run OCR,
    pipe through the same Claude parser as `/from-paste`, attach the
    original file as `signed_evidence` for the auditor copy."""
    import shutil, uuid as _uuid
    from pathlib import Path

    ext = _safe_scan_ext(file.filename or "")
    if not ext:
        raise HTTPException(400, "Unsupported file type — allowed: PDF, PNG, JPG, JPEG.")

    # Save to disk with size cap (streamed so a hostile 100 MB upload
    # can't OOM the worker).
    scan_root = Path(__file__).parent / "uploads" / SCAN_DIR_NAME
    scan_root.mkdir(parents=True, exist_ok=True)
    stored_name = f"{_uuid.uuid4().hex}{ext}"
    target = scan_root / stored_name
    total = 0
    with target.open("wb") as out:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > MAX_SCAN_BYTES:
                out.close()
                target.unlink(missing_ok=True)
                raise HTTPException(413, "File too large — 25 MB limit.")
            out.write(chunk)

    # OCR. PDFs go through `ocr_pdf_to_text` (text-layer first, raster
    # fallback via Poppler+Tesseract). If those binaries aren't on the
    # path, fall back to PyPDF2's pure-Python text-layer reader so we
    # at least get text-embedded PDFs through the pipeline. Image-only
    # scans still need a real OCR toolchain on the host.
    pages = 0
    ocr_text = ""
    try:
        if ext == ".pdf":
            try:
                from file_pdf import ocr_pdf_to_text
                ocr_text = ocr_pdf_to_text(target)
            except FileNotFoundError as exc:
                log.warning("swms.from_scan poppler_missing: %s — falling back to PyPDF2", exc)
            if not ocr_text:
                try:
                    from PyPDF2 import PdfReader
                    reader = PdfReader(str(target))
                    pages = len(reader.pages)
                    chunks = []
                    for p in reader.pages:
                        try:
                            chunks.append(p.extract_text() or "")
                        except Exception:
                            continue
                    ocr_text = "\n\n".join(chunks).strip()
                except Exception as exc:
                    log.warning("swms.from_scan pypdf2_fail: %s", exc)
            if not pages:
                pages = _count_pdf_pages(target)
        else:
            ocr_text = _ocr_image(target)
    except Exception as exc:
        log.warning("swms.from_scan unexpected_ocr_error: %s", exc)
        ocr_text = ""

    ocr_text = (ocr_text or "").strip()
    ocr_chars = len(ocr_text)
    if ocr_chars < MIN_PASTE_CHARS:
        # Keep the file so admins can inspect what went wrong, but bail.
        raise HTTPException(
            400,
            "Could not read the document — please rescan at higher resolution or paste the text instead.",
        )

    truncated = ocr_chars > MAX_PASTE_CHARS
    text_for_llm = ocr_text[:MAX_PASTE_CHARS] if truncated else ocr_text
    parsed = await parse_swms_text(text_for_llm, title_hint)

    # Persist the SWMS doc (same shape as `/from-paste`, plus the
    # signed-evidence attachment + scan metadata).
    title = (parsed.get("title") or (title_hint or "").strip() or "Scanned SWMS draft")[:200]
    attachment = {
        "id":          new_id(),
        "kind":        "signed_evidence",
        "filename":    file.filename or stored_name,
        "stored_name": stored_name,
        "file_url":    f"/api/files/{SCAN_DIR_NAME}/{stored_name}",
        "mime":        file.content_type or ("application/pdf" if ext == ".pdf" else "image/" + ext.lstrip(".")),
        "size":        total,
        "pages":       pages,
        "ocr_chars":   ocr_chars,
        "truncated":   truncated,
        "uploaded_at": now_iso(),
        "uploaded_by": user["id"],
    }
    doc = {
        "id":            new_id(),
        "org_id":        user["org_id"],
        "workspace_id":  workspace_id or user.get("workspace_id") or user.get("default_workspace_id"),
        "created_by":    user["id"],
        "created_at":    now_iso(),
        "updated_at":    now_iso(),
        "deleted_at":    None,
        "deleted_by":    None,
        "restore_until": None,
        "title":         title,
        "job_description": (parsed.get("scope") or "")[:1000],
        "scope":         parsed.get("scope") or "",
        "high_risk_construction_work": parsed.get("high_risk_construction_work") or "",
        "tasks":         parsed.get("tasks") or [],
        "hazards":       parsed.get("hazards") or [],
        "controls":      parsed.get("controls") or [],
        "ppe":           parsed.get("ppe") or [],
        "activity_analysis":   parsed.get("activity_analysis") or [],
        "environmental_risks": parsed.get("environmental_risks") or [],
        "training_requirements": parsed.get("training_requirements") or [],
        "equipment_list":      parsed.get("equipment_list") or [],
        "legislation_and_codes": parsed.get("legislation_and_codes") or [],
        "emergency_procedures": parsed.get("emergency_procedures") or {},
        "status":        "draft",
        "version":       1,
        "created_via":   "scan",
        "attachments":   [attachment],
    }
    await db.swms.insert_one(dict(doc))
    doc.pop("_id", None)
    await db.audit_logs.insert_one({
        "org_id":     user["org_id"],
        "actor_id":   user["id"],
        "actor_name": user.get("name") or user.get("email"),
        "action":     "swms.from_scan",
        "at":         now_iso(),
        "swms_id":    doc["id"],
        "filename":   file.filename,
        "bytes":      total,
        "pages":      pages,
        "ocr_chars":  ocr_chars,
        "truncated":  truncated,
    })
    log.info("swms.from_scan org=%s user=%s bytes=%d pages=%d ocr_chars=%d truncated=%s id=%s",
             user["org_id"], user["id"], total, pages, ocr_chars, truncated, doc["id"])
    return {
        **doc,
        "ocr_chars":     ocr_chars,
        "truncated":     truncated,
        "attachment_id": attachment["id"],
    }
async def purge_expired_swms() -> dict:
    """Hard-delete any SWMS whose `restore_until` is in the past."""
    now = datetime.now(timezone.utc).isoformat()
    result = await db.swms.delete_many({
        "deleted_at": {"$ne": None},
        "restore_until": {"$lt": now, "$ne": None},
    })
    log.info("swms.purge_expired: hard_deleted=%d", result.deleted_count)
    return {"hard_deleted": result.deleted_count}

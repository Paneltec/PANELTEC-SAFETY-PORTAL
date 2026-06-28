"""Phase 4.1 — Worker induction QR.

Adds three things to the existing Workers register:
  • A unique `scan_token` per worker, backfilled idempotently on import.
  • A printable ID-card PDF (wallet / lanyard / A4 sheet) + standalone QR PNG.
  • A public `/scan/worker/{token}` resolver returning a sanitised profile, plus
    an authed `site-signin` endpoint that records attendance into a new
    `site_signins` collection.

Permissions: the public resolver is intentionally open (no JWT) — callers see
only sanitised fields. Card generation requires `admin`/`manager` OR self.
NFC pairing requires `admin`/`manager`.
"""
from __future__ import annotations
import io
import os
import secrets
import string
from datetime import datetime, timezone
from typing import Optional

import qrcode
from fastapi import APIRouter, Depends, HTTPException, Path, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

from auth import get_current_user
from db import db

_ALPHABET = string.ascii_letters + string.digits
_SEED_KEY = "workers.scan_tokens_seeded_at"

router = APIRouter(prefix="/workers", tags=["worker-qr"])
scan_router = APIRouter(prefix="/scan/worker", tags=["worker-scan"])


def _gen_token(n: int = 10) -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(n))


def _public_app_url() -> str:
    """Customer-facing URL used inside the QR. Falls back to the request-derived
    URL via `REACT_APP_BACKEND_URL` env var so QR codes work in preview env."""
    return (os.environ.get("REACT_APP_BACKEND_URL")
            or os.environ.get("PUBLIC_APP_URL")
            or "").rstrip("/")


def _require_self_or_manager(user: dict, worker: dict, write: bool = False) -> None:
    """Owners always see their own card; managers/admins everywhere; HSEQ
    leads can view but not write. Used by the QR + PDF endpoints."""
    role = user.get("role")
    is_self = (worker.get("email") or "").lower() == (user.get("email") or "").lower()
    if write:
        if role not in {"admin", "manager"} and not is_self:
            raise HTTPException(403, "Admin or self required")
    else:
        if role not in {"admin", "manager", "hseq_lead"} and not is_self:
            raise HTTPException(403, "Not authorised")


# ────────────────── Backfill ──────────────────

async def backfill_scan_tokens() -> dict:
    """Idempotent — gated by `migration_state.workers.scan_tokens_seeded_at`.
    Also patches any later-imported worker that's missing a token, so this is
    safe to call from server startup repeatedly."""
    seeded = 0
    cursor = db.workers.find(
        {"$or": [{"scan_token": None}, {"scan_token": {"$exists": False}}],
         "deleted_at": None},
        {"_id": 0, "id": 1},
    )
    async for w in cursor:
        # Collision-safe even with the 62-char alphabet: 10 chars × 62^10 = ~8e17
        # of namespace, but loop once just in case to keep things bulletproof.
        for _ in range(4):
            token = _gen_token()
            res = await db.workers.update_one(
                {"id": w["id"], "scan_token": {"$in": [None]}},
                {"$set": {"scan_token": token, "id_card_version": 0}},
            )
            if res.modified_count:
                seeded += 1
                break
            # else token collision (~impossible) — retry.
    now = datetime.now(timezone.utc).isoformat()
    await db.migration_state.update_one(
        {"_id": _SEED_KEY},
        {"$set": {"at": now, "last_seeded": seeded}},
        upsert=True,
    )
    return {"seeded": seeded, "at": now}


# ────────────────── QR helpers ──────────────────

def _make_qr_png(url: str, box_size: int = 8) -> bytes:
    qr = qrcode.QRCode(border=1, box_size=box_size, error_correction=qrcode.constants.ERROR_CORRECT_M)
    qr.add_data(url); qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buf = io.BytesIO(); img.save(buf, format="PNG")
    return buf.getvalue()


async def _resolve_worker(worker_id: str, user: dict) -> dict:
    w = await db.workers.find_one(
        {"id": worker_id, "org_id": user["org_id"], "deleted_at": None}, {"_id": 0},
    )
    if not w:
        raise HTTPException(404, "Worker not found")
    return w


def _scan_url(token: str) -> str:
    return f"{_public_app_url()}/scan/worker/{token}"


# ────────────────── /api/workers/{id}/qr.png ──────────────────

@router.get("/{worker_id}/qr.png")
async def worker_qr_png(worker_id: str = Path(...), user: dict = Depends(get_current_user)):
    w = await _resolve_worker(worker_id, user)
    _require_self_or_manager(user, w, write=False)
    if not w.get("scan_token"):
        # Lazy backfill in case migration missed this row.
        token = _gen_token()
        await db.workers.update_one({"id": w["id"]}, {"$set": {"scan_token": token}})
        w["scan_token"] = token
    png = _make_qr_png(_scan_url(w["scan_token"]))
    return StreamingResponse(io.BytesIO(png), media_type="image/png",
                             headers={"Cache-Control": "private, max-age=300"})


# ────────────────── /api/workers/{id}/id-card.pdf ──────────────────

def _draw_wallet_card(c: canvas.Canvas, w: dict, x: float, y: float):
    """ID-1 credit-card size (85.6 × 54 mm) — name, role, company, QR."""
    W, H = 85.6 * mm, 54 * mm
    c.setStrokeColorRGB(0.85, 0.88, 0.93)
    c.setFillColorRGB(1, 1, 1)
    c.roundRect(x, y, W, H, 4 * mm, stroke=1, fill=1)
    # Header strip
    c.setFillColorRGB(0.17, 0.42, 1.0)  # Paneltec blue
    c.roundRect(x, y + H - 9 * mm, W, 9 * mm, 4 * mm, stroke=0, fill=1)
    c.setFillColorRGB(1, 1, 1)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(x + 4 * mm, y + H - 6 * mm, "PANELTEC CIVIL")
    c.setFont("Helvetica", 6)
    c.drawRightString(x + W - 4 * mm, y + H - 6 * mm, "WORKER ID")

    # Name + role
    c.setFillColorRGB(0.05, 0.1, 0.16)
    c.setFont("Helvetica-Bold", 11)
    name = _full_name(w)
    c.drawString(x + 4 * mm, y + H - 16 * mm, name[:30])
    c.setFont("Helvetica", 8)
    role = w.get("trade") or w.get("position") or w.get("role") or "—"
    c.setFillColorRGB(0.3, 0.4, 0.5)
    c.drawString(x + 4 * mm, y + H - 21 * mm, role[:36])
    c.drawString(x + 4 * mm, y + H - 26 * mm, (w.get("company_label") or "Paneltec")[:36])
    # Token text (small)
    c.setFont("Courier", 6)
    c.drawString(x + 4 * mm, y + 3 * mm, (w.get("scan_token") or "—"))

    # QR — bottom-right square
    qr_png = _make_qr_png(_scan_url(w["scan_token"]), box_size=4)
    from reportlab.lib.utils import ImageReader
    img = ImageReader(io.BytesIO(qr_png))
    qr_size = 24 * mm
    c.drawImage(img, x + W - qr_size - 3 * mm, y + 3 * mm,
                width=qr_size, height=qr_size, preserveAspectRatio=True, mask='auto')


def _draw_lanyard_card(c: canvas.Canvas, w: dict, x: float, y: float):
    """Portrait 100 × 150 mm with larger QR + emergency contact line."""
    W, H = 100 * mm, 150 * mm
    c.setFillColorRGB(1, 1, 1)
    c.setStrokeColorRGB(0.85, 0.88, 0.93)
    c.roundRect(x, y, W, H, 5 * mm, stroke=1, fill=1)
    c.setFillColorRGB(0.17, 0.42, 1.0)
    c.roundRect(x, y + H - 16 * mm, W, 16 * mm, 5 * mm, stroke=0, fill=1)
    c.setFillColorRGB(1, 1, 1)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(x + 6 * mm, y + H - 10 * mm, "PANELTEC CIVIL")
    c.setFont("Helvetica", 8)
    c.drawString(x + 6 * mm, y + H - 14 * mm, "Site Worker ID")

    c.setFillColorRGB(0.05, 0.1, 0.16)
    c.setFont("Helvetica-Bold", 16)
    c.drawString(x + 6 * mm, y + H - 30 * mm, _full_name(w)[:24])
    c.setFont("Helvetica", 10)
    c.setFillColorRGB(0.3, 0.4, 0.5)
    c.drawString(x + 6 * mm, y + H - 38 * mm, (w.get("trade") or w.get("position") or w.get("role") or "—")[:30])
    c.drawString(x + 6 * mm, y + H - 45 * mm, (w.get("company_label") or "Paneltec")[:30])

    # Big QR centre-bottom
    from reportlab.lib.utils import ImageReader
    qr_png = _make_qr_png(_scan_url(w["scan_token"]), box_size=8)
    img = ImageReader(io.BytesIO(qr_png))
    qr_size = 60 * mm
    c.drawImage(img, x + (W - qr_size) / 2, y + 18 * mm,
                width=qr_size, height=qr_size, preserveAspectRatio=True, mask='auto')

    c.setFont("Helvetica", 7)
    c.setFillColorRGB(0.4, 0.45, 0.55)
    c.drawCentredString(x + W / 2, y + 12 * mm, "Scan this QR to view profile, certifications and site sign-in.")
    c.drawCentredString(x + W / 2, y + 7 * mm, f"Token: {w.get('scan_token') or '—'}")


@router.get("/{worker_id}/id-card.pdf")
async def worker_id_card_pdf(
    worker_id: str = Path(...),
    layout: str = Query("wallet", pattern=r"^(wallet|lanyard|avery)$"),
    user: dict = Depends(get_current_user),
):
    w = await _resolve_worker(worker_id, user)
    _require_self_or_manager(user, w, write=False)
    if not w.get("scan_token"):
        token = _gen_token()
        await db.workers.update_one({"id": w["id"]}, {"$set": {"scan_token": token}})
        w["scan_token"] = token

    buf = io.BytesIO()

    if layout == "wallet":
        # Single ID-1 card on its own page (85.6 × 54 mm).
        c = canvas.Canvas(buf, pagesize=(85.6 * mm, 54 * mm))
        _draw_wallet_card(c, w, 0, 0)
        c.showPage(); c.save()
    elif layout == "lanyard":
        c = canvas.Canvas(buf, pagesize=(100 * mm, 150 * mm))
        _draw_lanyard_card(c, w, 0, 0)
        c.showPage(); c.save()
    else:  # avery — A4 sheet of wallet cards (2 cols × 5 rows = 10 cards).
        c = canvas.Canvas(buf, pagesize=A4)
        W, H = A4
        card_w, card_h = 85.6 * mm, 54 * mm
        margin_x = (W - 2 * card_w - 6 * mm) / 2
        margin_y = 15 * mm
        for i in range(10):
            col, row = i % 2, i // 2
            x = margin_x + col * (card_w + 6 * mm)
            y = H - margin_y - (row + 1) * card_h - row * 4 * mm
            _draw_wallet_card(c, w, x, y)
        c.showPage(); c.save()

    # Stamp the issued_at + bump version on first generation.
    await db.workers.update_one(
        {"id": w["id"]},
        {"$set": {"id_card_issued_at": datetime.now(timezone.utc).isoformat()},
         "$inc": {"id_card_version": 1}},
    )
    return StreamingResponse(io.BytesIO(buf.getvalue()), media_type="application/pdf",
                             headers={"Content-Disposition": f'inline; filename="worker-{w["id"][:8]}-{layout}.pdf"'})


# ────────────────── NFC pairing ──────────────────

class NFCPairIn(BaseModel):
    nfc_uid: str


@router.post("/{worker_id}/nfc-pair")
async def nfc_pair(worker_id: str, body: NFCPairIn, user: dict = Depends(get_current_user)):
    w = await _resolve_worker(worker_id, user)
    _require_self_or_manager(user, w, write=True)
    uid = (body.nfc_uid or "").strip().upper()
    if not uid or len(uid) < 4:
        raise HTTPException(422, "Invalid NFC UID")
    # NFC UIDs should be globally unique per org so we can resolve them at scan time.
    dup = await db.workers.find_one({"org_id": user["org_id"], "nfc_uid": uid,
                                     "id": {"$ne": worker_id}, "deleted_at": None}, {"_id": 0, "id": 1})
    if dup:
        raise HTTPException(409, f"NFC UID already paired with worker {dup['id'][:8]}")
    await db.workers.update_one({"id": worker_id}, {"$set": {"nfc_uid": uid}})
    return {"ok": True, "nfc_uid": uid}


@router.delete("/{worker_id}/nfc-pair")
async def nfc_unpair(worker_id: str, user: dict = Depends(get_current_user)):
    w = await _resolve_worker(worker_id, user)
    _require_self_or_manager(user, w, write=True)
    await db.workers.update_one({"id": worker_id}, {"$unset": {"nfc_uid": ""}})
    return {"ok": True}


# ────────────────── Public scan resolver ──────────────────

def _full_name(w: dict) -> str:
    fn = (w.get("first_name") or "").strip()
    ln = (w.get("last_name") or "").strip()
    full = f"{fn} {ln}".strip()
    return full or w.get("name") or "Worker"


def _sanitise_worker(w: dict, certifications: list, swms: list, active_signin: Optional[dict]) -> dict:
    return {
        "id": w["id"],
        "name": _full_name(w),
        "role": w.get("role") or w.get("position"),
        "trade": w.get("trade") or w.get("position"),
        "company": w.get("company_label") or "Paneltec",
        "photo_url": w.get("photo_url"),
        "scan_token": w.get("scan_token"),
        "certifications": certifications,
        "assigned_swms": swms,
        "active_site_today": active_signin,
    }


@scan_router.get("/{scan_token}")
async def scan_worker(scan_token: str):
    """Public — no auth. Returns the sanitised profile for the wallet card."""
    w = await db.workers.find_one(
        {"scan_token": scan_token, "deleted_at": None},
        {"_id": 0},
    )
    if not w:
        raise HTTPException(404, "Unknown worker scan token")

    # Sanitised certifications (name + status + expires_at).
    certs = []
    async for cert in db.worker_certifications.find(
        {"worker_id": w["id"], "deleted_at": None},
        {"_id": 0, "name": 1, "status": 1, "expires_at": 1},
    ).limit(50):
        certs.append({
            "name": cert.get("name"),
            "status": cert.get("status") or "current",
            "expires_at": cert.get("expires_at"),
        })

    # Assigned SWMS — fetch latest org-wide SWMS (placeholder: all org swms,
    # tagged with ack_required if assigned_to_workers includes this id).
    swms = []
    async for s in db.swms.find(
        {"org_id": w["org_id"], "deleted_at": None},
        {"_id": 0, "id": 1, "title": 1, "version": 1, "assigned_worker_ids": 1},
    ).limit(20):
        if w["id"] in (s.get("assigned_worker_ids") or []):
            swms.append({"id": s["id"], "title": s.get("title"),
                         "version": s.get("version"), "ack_required": True})

    # Active site sign-in today (open row — no signed_out_at).
    today = datetime.now(timezone.utc).date().isoformat()
    active = await db.site_signins.find_one(
        {"worker_id": w["id"], "signed_out_at": None,
         "signed_in_at": {"$gte": today}},
        {"_id": 0, "site_id": 1, "site_name": 1, "signed_in_at": 1},
        sort=[("signed_in_at", -1)],
    )
    active_card = None
    if active:
        active_card = {"id": active.get("site_id"), "name": active.get("site_name")}

    return _sanitise_worker(w, certs, swms, active_card)


class SiteSignInIn(BaseModel):
    site_id: str
    site_name: Optional[str] = None
    gps: Optional[dict] = None


@scan_router.post("/{scan_token}/site-signin")
async def scan_worker_site_signin(
    scan_token: str, body: SiteSignInIn,
    user: dict = Depends(get_current_user),
):
    """Record an attendance row. **Phase 3.9c RBAC fix**: only admin/manager/
    hseq_lead may sign in another worker. Workers themselves may sign in
    only their *own* lanyard (worker.email == user.email)."""
    w = await db.workers.find_one(
        {"scan_token": scan_token, "deleted_at": None},
        {"_id": 0},
    )
    if not w:
        raise HTTPException(404, "Unknown worker scan token")
    if w["org_id"] != user["org_id"]:
        raise HTTPException(403, "Cross-org sign-in is not allowed")

    role = user.get("role")
    is_supervisor = role in {"admin", "manager", "hseq_lead"}
    is_self = (
        user.get("email") and w.get("email")
        and user["email"].lower() == w["email"].lower()
    )
    if not (is_supervisor or is_self):
        raise HTTPException(
            403,
            "Only admin/manager/HSEQ leads can sign in another worker; "
            "workers can only sign themselves in.",
        )

    # Phase 3.9c — prefer the WORKER's workspace_id so attendance lands on the
    # right site even when the supervisor is logged into multiple workspaces.
    workspace_id = (
        w.get("workspace_id")
        or (user.get("workspace_ids") or [None])[0]
    )

    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": _gen_token(12),
        "org_id": user["org_id"],
        "worker_id": w["id"],
        "worker_name": _full_name(w),
        "site_id": body.site_id,
        "site_name": body.site_name,
        "signed_in_at": now,
        "signed_out_at": None,
        "signed_in_by_user_id": user["id"],
        "signed_in_by_name": user.get("name") or user.get("email"),
        "gps": body.gps,
        "source": "worker_qr",
        "workspace_id": workspace_id,
        "self_signin": bool(is_self and not is_supervisor),
    }
    await db.site_signins.insert_one(doc)
    doc.pop("_id", None)
    return {"ok": True, "signin": doc}

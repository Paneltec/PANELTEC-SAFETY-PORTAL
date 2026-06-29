"""Phase 4.3 — Supplier Induction QR.

Mirrors the Site QR pattern (sites_qr.py) for contractor companies. Each
contractor gets a `scan_token` so a supplier sticker on a hi-vis lanyard or
business-card-shaped print resolves to a public induction landing where the
supplier acknowledges the org's required docs and rules.

Endpoints:
  • GET    /api/scan/supplier/{scan_token}                    PUBLIC
  • POST   /api/scan/supplier/{scan_token}/complete-induction AUTH
  • GET    /api/contractors/{id}/scan-pdf?layout=lanyard|business_card  ADMIN

Tampered/unknown tokens → 404 (no info leak).
"""
from __future__ import annotations
import io
import secrets
import string
from datetime import datetime, timezone, timedelta

import qrcode
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

from auth import get_current_user
from db import db
from models import new_id, now_iso
from workers_qr import _public_app_url

_ALPHABET = string.ascii_letters + string.digits

scan_router = APIRouter(prefix="/scan/supplier", tags=["supplier-scan"])
contractors_qr_router = APIRouter(prefix="/contractors", tags=["contractors-qr"])

EDIT_ROLES = {"admin", "manager", "hseq_lead"}


def _gen_token(n: int = 12) -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(n))


async def _ensure_scan_token(contractor: dict) -> str:
    if contractor.get("scan_token"):
        return contractor["scan_token"]
    token = _gen_token(12)
    await db.contractors.update_one(
        {"id": contractor["id"]},
        {"$set": {"scan_token": token, "scan_token_at": now_iso()}},
    )
    return token


def _supplier_scan_url(token: str) -> str:
    base = _public_app_url() or ""
    return f"{base}/scan/supplier/{token}"


def _make_qr_png(data: str, box: int = 8) -> bytes:
    q = qrcode.QRCode(box_size=box, border=2)
    q.add_data(data); q.make(fit=True)
    img = q.make_image()
    buf = io.BytesIO(); img.save(buf, format="PNG")
    return buf.getvalue()


# ────────────────── PUBLIC resolver ──────────────────

@scan_router.get("/{scan_token}")
async def resolve_supplier_scan(scan_token: str):
    """Public landing — supplier holds the URL on their phone or a printed
    badge. Returns sanitised contractor info + the doc types the org wants
    them to acknowledge during induction."""
    c = await db.contractors.find_one({"scan_token": scan_token,
                                       "deleted_at": None}, {"_id": 0})
    if not c:
        raise HTTPException(404, "Scan token not recognised")

    # Surface the doc-types the contractor has on file (their own compliance
    # picture) + any active SWMS that name this contractor in applies_to.
    docs = [{
        "type": d.get("type"),
        "status": d.get("status"),
        "expiry_date": d.get("expiry_date"),
        "filename": d.get("filename"),
    } for d in (c.get("documents") or [])]

    swms_rows: list[dict] = []
    async for s in db.swms.find(
        {"org_id": c["org_id"], "deleted_at": None,
         "status": {"$ne": "superseded"}},
        {"_id": 0, "id": 1, "title": 1, "code": 1, "version": 1, "applies_to": 1},
    ).limit(50):
        applies = s.get("applies_to") or {}
        if c["id"] in (applies.get("company_ids") or []):
            swms_rows.append({
                "id": s["id"], "title": s.get("title"),
                "code": s.get("code"), "version": s.get("version"),
            })

    return {
        "scan_token": scan_token,
        "contractor": {
            "id": c["id"],
            "name": c.get("name"),
            "abn": c.get("abn"),
            "trade": c.get("trade"),
            "contact_email": c.get("contact_email"),
            "compliance_summary": c.get("compliance_summary") or {},
        },
        "documents": docs,
        "active_swms": swms_rows,
        "induction_url": f"/api/scan/supplier/{scan_token}/complete-induction",
    }


class CompleteInductionIn(BaseModel):
    worker_id: str | None = None
    acknowledged_docs: list[str] = []
    acknowledged_swms: list[str] = []
    signature_blob_id: str | None = None


@scan_router.post("/{scan_token}/complete-induction")
async def complete_supplier_induction(
    scan_token: str, body: CompleteInductionIn,
    user: dict = Depends(get_current_user),
):
    c = await db.contractors.find_one({"scan_token": scan_token,
                                       "deleted_at": None}, {"_id": 0})
    if not c:
        raise HTTPException(404, "Scan token not recognised")
    if c.get("org_id") != user["org_id"]:
        # Cross-org scan attempts get the same 404 as a tampered token.
        raise HTTPException(404, "Scan token not recognised")

    doc = {
        "id": new_id(),
        "org_id": c["org_id"],
        "contractor_id": c["id"],
        "contractor_name": c.get("name"),
        "worker_id": body.worker_id or user.get("worker_id") or user["id"],
        "acknowledged_docs": body.acknowledged_docs or [],
        "acknowledged_swms": body.acknowledged_swms or [],
        "signature_blob_id": body.signature_blob_id,
        "completed_at": now_iso(),
        "completed_by_user_id": user["id"],
        "source": "qr",
    }
    await db.supplier_inductions.insert_one(dict(doc))
    expires_at = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
    doc.pop("_id", None)
    return {**doc, "induction_expires_at": expires_at}


# ────────────────── ADMIN — Supplier QR PDF ──────────────────

def _require_admin(user: dict) -> None:
    if user.get("role") not in EDIT_ROLES:
        raise HTTPException(403, "Permission denied: contractors.edit")


@contractors_qr_router.get("/{contractor_id}/scan-pdf")
async def contractor_scan_pdf(
    contractor_id: str,
    layout: str = Query("business_card", regex="^(lanyard|business_card)$"),
    user: dict = Depends(get_current_user),
):
    _require_admin(user)
    c = await db.contractors.find_one(
        {"id": contractor_id, "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0},
    )
    if not c:
        raise HTTPException(404, "Contractor not found")
    token = await _ensure_scan_token(c)
    qr_png = _make_qr_png(_supplier_scan_url(token),
                           box=10 if layout == "lanyard" else 7)

    buf = io.BytesIO()
    if layout == "lanyard":
        # ID-2 portrait — 74 × 105 mm — fits a standard lanyard sleeve.
        W, H = 74 * mm, 105 * mm
        c_pdf = canvas.Canvas(buf, pagesize=(W, H))
        # Header bar
        c_pdf.setFillColorRGB(0.17, 0.42, 1.0)
        c_pdf.rect(0, H - 22 * mm, W, 22 * mm, fill=1, stroke=0)
        c_pdf.setFillColorRGB(1, 1, 1)
        c_pdf.setFont("Helvetica-Bold", 13)
        c_pdf.drawCentredString(W / 2, H - 10 * mm, "SUPPLIER INDUCTION")
        c_pdf.setFont("Helvetica", 8)
        c_pdf.drawCentredString(W / 2, H - 17 * mm, "Paneltec Civil WHS")

        # Name + ABN
        c_pdf.setFillColorRGB(0, 0, 0)
        c_pdf.setFont("Helvetica-Bold", 12)
        c_pdf.drawCentredString(W / 2, H - 32 * mm, (c.get("name") or "Supplier")[:32])
        if c.get("abn"):
            c_pdf.setFont("Helvetica", 8)
            c_pdf.setFillColorRGB(0.3, 0.4, 0.5)
            c_pdf.drawCentredString(W / 2, H - 38 * mm, f"ABN {c['abn']}")

        # QR (centred)
        from reportlab.lib.utils import ImageReader
        qr_size = 50 * mm
        c_pdf.drawImage(ImageReader(io.BytesIO(qr_png)),
                         (W - qr_size) / 2, 22 * mm,
                         qr_size, qr_size)

        c_pdf.setFillColorRGB(0.4, 0.45, 0.55)
        c_pdf.setFont("Helvetica", 7)
        c_pdf.drawCentredString(W / 2, 15 * mm, "Scan to complete the induction")
        c_pdf.setFont("Helvetica-Oblique", 6)
        c_pdf.drawCentredString(W / 2, 9 * mm, f"Token: {token}")
        c_pdf.showPage(); c_pdf.save()
    else:
        # Business-card 85.6 × 54 mm
        W, H = 85.6 * mm, 54 * mm
        c_pdf = canvas.Canvas(buf, pagesize=(W, H))
        c_pdf.setStrokeColorRGB(0.85, 0.88, 0.93)
        c_pdf.setFillColorRGB(1, 1, 1)
        c_pdf.roundRect(0, 0, W, H, 3 * mm, stroke=1, fill=1)
        # Left text block
        c_pdf.setFillColorRGB(0.17, 0.42, 1.0)
        c_pdf.setFont("Helvetica-Bold", 8)
        c_pdf.drawString(4 * mm, H - 6 * mm, "PANELTEC CIVIL")
        c_pdf.setFillColorRGB(0.3, 0.4, 0.5)
        c_pdf.setFont("Helvetica", 6)
        c_pdf.drawString(4 * mm, H - 10 * mm, "Supplier induction")

        c_pdf.setFillColorRGB(0.05, 0.1, 0.16)
        c_pdf.setFont("Helvetica-Bold", 10)
        c_pdf.drawString(4 * mm, H - 22 * mm, (c.get("name") or "Supplier")[:28])
        c_pdf.setFont("Helvetica", 7)
        c_pdf.setFillColorRGB(0.3, 0.4, 0.5)
        c_pdf.drawString(4 * mm, H - 28 * mm,
                          (c.get("trade") or c.get("contact_name") or "—")[:32])
        if c.get("abn"):
            c_pdf.drawString(4 * mm, H - 33 * mm, f"ABN {c['abn']}")
        c_pdf.setFont("Helvetica", 6)
        c_pdf.drawString(4 * mm, 5 * mm, "Scan to complete induction →")
        c_pdf.setFont("Courier", 5)
        c_pdf.drawString(4 * mm, 2.5 * mm, f"Token: {token}")

        from reportlab.lib.utils import ImageReader
        qr_size = 36 * mm
        c_pdf.drawImage(ImageReader(io.BytesIO(qr_png)),
                         W - qr_size - 4 * mm, (H - qr_size) / 2,
                         qr_size, qr_size)
        c_pdf.showPage(); c_pdf.save()

    buf.seek(0)
    return StreamingResponse(buf, media_type="application/pdf",
        headers={"Content-Disposition":
                 f'inline; filename="supplier-{contractor_id[:8]}-{layout}.pdf"'})

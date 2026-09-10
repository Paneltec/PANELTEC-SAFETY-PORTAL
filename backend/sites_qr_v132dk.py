"""v58.13.132dk — Persistent Site QR endpoints.

Delivers one printable output — the A4 signage PDF — encoding the
persistent `${PUBLIC_APP_URL}/sign-on/{site_id}` URL:

  GET /api/sites/{site_id}/qr-signage.pdf → A4 gate-signage layout

Plus a public resolver that keeps depot-gate stickers working forever:

  GET /api/sign-on/{site_id}              → 302 → /scan/site/{token}

The token is regenerated on demand (see `_ensure_scan_token`), so a
sticker printed once keeps working even if the internal scan_token
is rotated — the public URL is on `site_id`, not the token.

Access control mirrors the pre-existing `scan-pdf` endpoint:
`require_permission("sites","view")` + `_require_site_admin` (admin
role only). Nothing is persisted to disk — every response streams
from an in-memory buffer.

Scope note: earlier draft of this module exposed `qr.png` + a plain
centred-QR `qr.pdf`. Stephen simplified to just the A4 signage flow
during the .132dk build — one button, one output.
"""
from __future__ import annotations

import io

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse, StreamingResponse
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

from db import db
from permissions import require_permission
from sites_qr import (
    _ensure_scan_token,
    _make_qr_png,
    _require_site_admin,
)
from workers_qr import _public_app_url

sites_router = APIRouter(prefix="/sites", tags=["sites-qr-v132dk"])
public_router = APIRouter(prefix="/sign-on", tags=["sites-qr-v132dk-public"])


def _persistent_signon_url(site_id: str) -> str:
    """v58.13.132dk — Persistent URL that goes on the printed sticker.

    NOT to be confused with `sites_qr._site_scan_url(token)`, which
    encodes the rotating scan_token. The token URL is what the QR
    ultimately resolves to (via the redirect below); the persistent
    URL is what admins print — same string forever, regardless of
    token rotation."""
    base = (_public_app_url() or "").rstrip("/")
    return f"{base}/sign-on/{site_id}"


async def _get_site_or_404(site_id: str, org_id: str) -> dict:
    site = await db.simpro_sites.find_one(
        {"simpro_site_id": site_id, "org_id": org_id}, {"_id": 0},
    )
    if not site:
        raise HTTPException(404, "Site not found")
    return site


def _reportlab_image(png_bytes: bytes):
    """reportlab's `drawImage` accepts an `ImageReader` around a
    file-like — wrap the in-memory PNG bytes so we never hit disk."""
    from reportlab.lib.utils import ImageReader
    return ImageReader(io.BytesIO(png_bytes))


def _signage_pdf(qr_png: bytes, site_name: str, address: str,
                 sticker_url: str) -> bytes:
    """Full-page A4 signage: header + QR (~50% of page) + name +
    instructions + Paneltec footer."""
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    page_w, page_h = A4

    # Header band.
    c.setFillColorRGB(0.06, 0.11, 0.20)  # slate
    c.rect(0, page_h - 32 * mm, page_w, 32 * mm, fill=1, stroke=0)
    c.setFillColorRGB(1, 1, 1)
    c.setFont("Helvetica-Bold", 34)
    c.drawCentredString(page_w / 2, page_h - 22 * mm, "SIGN IN HERE")

    # QR block (~50% of the short edge).
    qr_size = 130 * mm
    qr_x = (page_w - qr_size) / 2
    qr_y = (page_h - 32 * mm) - qr_size - 12 * mm
    c.drawImage(_reportlab_image(qr_png), qr_x, qr_y, qr_size, qr_size)

    # Site name + address.
    c.setFillColorRGB(0.06, 0.11, 0.20)
    c.setFont("Helvetica-Bold", 24)
    c.drawCentredString(page_w / 2, qr_y - 14 * mm, site_name[:60])
    if address:
        c.setFillColorRGB(0.36, 0.41, 0.51)
        c.setFont("Helvetica", 11)
        c.drawCentredString(page_w / 2, qr_y - 22 * mm, address[:100])

    # Instructions.
    c.setFillColorRGB(0.06, 0.11, 0.20)
    c.setFont("Helvetica", 13)
    c.drawCentredString(page_w / 2, 42 * mm,
        "Scan with your phone camera to sign in for this site.")
    c.setFillColorRGB(0.36, 0.41, 0.51)
    c.setFont("Helvetica", 9)
    c.drawCentredString(page_w / 2, 34 * mm, sticker_url)

    # Footer branding.
    c.setFillColorRGB(0.99, 0.50, 0.08)  # Paneltec orange
    c.setFont("Helvetica-Bold", 10)
    c.drawCentredString(page_w / 2, 18 * mm, "PANELTEC CIVIL · WHS COMPLIANCE")

    c.showPage()
    c.save()
    buf.seek(0)
    return buf.getvalue()


@sites_router.get("/{site_id}/qr-signage.pdf")
async def site_qr_signage_pdf(
    site_id: str,
    user: dict = Depends(require_permission("sites", "view")),
):
    _require_site_admin(user)
    site = await _get_site_or_404(site_id, user["org_id"])
    url = _persistent_signon_url(site["simpro_site_id"])
    qr_png = _make_qr_png(url, box=14)
    pdf = _signage_pdf(
        qr_png,
        site.get("name") or "Site",
        site.get("address_full") or site.get("address") or "",
        url,
    )
    return StreamingResponse(
        io.BytesIO(pdf),
        media_type="application/pdf",
        headers={
            "Content-Disposition":
                f'inline; filename="site-{site_id}-signage.pdf"',
        },
    )


# ─── Public resolver: /sign-on/{site_id} → /scan/site/{token} ───

@public_router.get("/{site_id}")
async def resolve_persistent_signon(site_id: str):
    """v58.13.132dk — Persistent public entrypoint.

    The QR sticker on the depot gate encodes `.../sign-on/<site_id>`
    forever. This handler looks up the site by `site_id`, ensures
    it has a live scan_token (idempotent create-if-missing), then
    302s to the existing `/scan/site/<token>` flow so the pre-
    existing sign-on UI keeps working unchanged.

    Anyone with the URL can hit this — no auth required. We do NOT
    leak the org_id back to the caller; a missing site returns 404.
    Soft-deleted sites are treated as missing to avoid info leak.
    """
    site = await db.simpro_sites.find_one(
        {"simpro_site_id": site_id,
         "$or": [{"deleted_at": None}, {"deleted_at": {"$exists": False}}]},
        {"_id": 0},
    )
    if not site:
        raise HTTPException(404, "Site not found")
    token = await _ensure_scan_token(site)
    return RedirectResponse(url=f"/scan/site/{token}", status_code=302)


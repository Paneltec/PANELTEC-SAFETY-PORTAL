"""Mobile Onboarding Cards PDF — v58.13.132ad.

`GET /api/mobile/onboarding/cards.pdf` — admin-only endpoint that
returns a printable PDF of onboarding cards. Each card is
100×62mm (business-card-plus) and encodes a fresh
`paneltec://onboard?token=<opaque>&preload=<civil|viatec>` deep
link that the mobile app redeems via `POST /api/mobile/onboarding/redeem`.

Modes:
  ?worker_id=X               single card (single page 100×62mm)
  ?worker_ids=X,Y,Z          multi-card, 4-up on A4
  ?all=true                  every active non-archived worker, 4-up on A4
  ?expires_days=N            override the default 7-day token TTL
                             (server-clamped 1..90)

Idempotency: if a worker already has an unused, unexpired
`mobile_onboarding_tokens` row, that row is reused (no burn).

Skip conditions (bulk mode only — single-worker requests 404):
  · worker archived / soft-deleted
  · worker has no simpro_employee_id (needed by the existing
    /issue-token contract)

Response: application/pdf stream + Content-Disposition attachment.

Audit: writes one `user_audit` row with action
`onboarding_cards_generated`.
"""
from __future__ import annotations
import io
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen.canvas import Canvas

from db import db
from auth import get_current_user
from models import now_iso, new_id
from pdf_card_template import (
    header_band, chevron, qr_image, footer_brand,
    ORANGE, SLATE_INK, SLATE_MUTED, SLATE_BORDER, WHITE,
)


router = APIRouter(tags=["mobile-onboarding-cards"])


# Card dimensions — single card page.
CARD_W = 100 * mm
CARD_H = 62 * mm

# 4-up A4 slot dimensions (with 10mm margins, 8mm gutter).
A4_W, A4_H = A4
GRID_MARGIN = 10 * mm
GRID_GUTTER = 8 * mm
SLOT_W = (A4_W - 2 * GRID_MARGIN - GRID_GUTTER) / 2
SLOT_H = (A4_H - 2 * GRID_MARGIN - 3 * GRID_GUTTER) / 4


def _read_running_version() -> str:
    """Best-effort read of RUNNING_VERSION from frontend/src/lib/version.js."""
    import os
    import re
    path = os.path.abspath(os.path.join(
        os.path.dirname(__file__), "..", "frontend", "src", "lib", "version.js",
    ))
    try:
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()
        m = re.search(r"export\s+const\s+RUNNING_VERSION\s*=\s*['\"]([^'\"]+)['\"]", text)
        if m:
            # Compact form: "paneltec-v160.3.9.58.13.132ad" → "v58.13.132ad"
            v = m.group(1)
            tail = v.split(".58.")
            if len(tail) == 2:
                return f"v58.{tail[1]}"
            return v
    except Exception:
        pass
    return "v1.0"


async def _require_admin(user: dict) -> None:
    role = (user.get("role") or "").lower()
    if role not in ("admin", "owner"):
        raise HTTPException(403, "Admin role required")


async def _get_or_issue_token(worker: dict, issuer_id: str, ttl_days: int) -> Optional[str]:
    """Return an unused, unexpired token for the worker — reuse if
    possible, else mint a new one. Returns None if worker lacks
    `simpro_employee_id` (bulk-skip signal)."""
    sid = worker.get("simpro_employee_id")
    if not sid:
        return None

    now = datetime.now(timezone.utc)
    # Reuse existing unused unexpired token.
    existing = await db.mobile_onboarding_tokens.find_one(
        {"simpro_employee_id": sid, "org_id": worker["org_id"], "used": False},
        {"_id": 0, "token": 1, "expires_at": 1},
        sort=[("created_at", -1)],
    )
    if existing:
        try:
            exp = datetime.fromisoformat(existing["expires_at"])
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if exp > now:
                return existing["token"]
        except Exception:
            pass

    token_str = secrets.token_urlsafe(24)
    expires = now + timedelta(days=ttl_days)
    await db.mobile_onboarding_tokens.insert_one({
        "id": new_id(),
        "token": token_str,
        "simpro_employee_id": sid,
        "company_id": worker.get("company_id"),
        "org_id": worker["org_id"],
        "issued_by": issuer_id,
        "used": False,
        "expires_at": expires.isoformat(),
        "created_at": now_iso(),
    })
    return token_str


def _preload_for(worker: dict) -> str:
    """Match the mobile deep-link `preload=` param used by
    `mobile/app/(auth)/welcome.tsx`."""
    company = (worker.get("company") or worker.get("division") or "").lower()
    if "viatec" in company:
        return "viatec"
    return "civil"


def _public_base_url() -> str:
    """v58.13.132ae — public HTTPS base for the QR landing page.

    Prefer PUBLIC_APP_BASE_URL from env; fall back to the preview URL
    so existing test cards keep working until production DNS lands.
    """
    return (
        os.environ.get("PUBLIC_APP_BASE_URL")
        or "https://whs-compliance.preview.emergentagent.com"
    ).rstrip("/")


def _install_url(token: str, worker: dict) -> str:
    """v58.13.132ae — QR now encodes an HTTPS universal-landing URL.

    Was:  paneltec://onboard?token=<token>&preload=<div>
          → phone camera failed with "no app to open this" for
            uninstalled workers (the exact bug .132ae fixes).
    Now:  <PUBLIC_APP_BASE_URL>/m/onboard/<token>?preload=<div>
          → public HTTPS page that shows an install panel for
            iOS / Android, and offers a `paneltec://onboard?...`
            re-open button for the already-installed case.
    """
    base = _public_base_url()
    preload = _preload_for(worker)
    return f"{base}/m/onboard/{token}?preload={preload}"


def _render_card(c: Canvas, x0: float, y0: float, w: float, h: float,
                 worker_name: str, install_url: str, version_tag: str) -> None:
    """Draw one onboarding card into the canvas at (x0, y0) with size (w, h)."""
    # ── Header band (navy strip + orange chevron + wordmark) ──
    band_h = 14 * mm
    header_band(
        c, x0, y0 + h - band_h, w, band_h,
        eyebrow="FIELD APP",
    )

    # ── QR block (centered, sized to card) ──
    qr_size = min(28 * mm, h - band_h - 24 * mm)
    qr_x = x0 + (w - qr_size) / 2
    qr_y = y0 + h - band_h - qr_size - 4 * mm
    c.drawImage(qr_image(install_url, box_size=8, border=1),
                qr_x, qr_y, width=qr_size, height=qr_size,
                preserveAspectRatio=True, mask='auto')

    # ── 3-step instructions ──
    c.setFillColor(SLATE_INK)
    c.setFont("Helvetica-Bold", 6.5)
    steps_y = qr_y - 4 * mm
    c.drawCentredString(x0 + w / 2, steps_y,
                        "1. Open camera   2. Scan QR   3. Install & sign in")

    # ── Employee name line (pre-filled, dashed underline) ──
    name_y = steps_y - 7 * mm
    c.setFont("Helvetica", 6)
    c.setFillColor(SLATE_MUTED)
    c.drawString(x0 + 5 * mm, name_y + 1 * mm, "Employee name:")

    # Dashed line under the printed name.
    c.setDash(1.5, 1.5)
    c.setStrokeColor(SLATE_BORDER)
    c.setLineWidth(0.4)
    line_start = x0 + 5 * mm + 20 * mm
    line_end = x0 + w - 5 * mm
    c.line(line_start, name_y - 0.5 * mm, line_end, name_y - 0.5 * mm)
    c.setDash()

    # Printed name overlay.
    c.setFillColor(SLATE_INK)
    c.setFont("Helvetica-Bold", 8)
    c.drawString(line_start + 1 * mm, name_y + 0.8 * mm, worker_name or "")

    # ── Footer ──
    foot_y = y0 + 3 * mm
    c.setFillColor(SLATE_MUTED)
    c.setFont("Helvetica", 5.5)
    c.drawString(x0 + 5 * mm, foot_y, "For Paneltec Civil employees only.")

    # Bottom-right: chevron + version tag.
    tag_x = x0 + w - 5 * mm
    c.setFont("Helvetica-Bold", 6)
    c.setFillColor(ORANGE)
    c.drawRightString(tag_x, foot_y, version_tag)
    chevron(c, tag_x - 14 * mm, foot_y + 0.4 * mm, size=1.6)
    chevron(c, tag_x - 11 * mm, foot_y + 0.4 * mm, size=1.6)


def _fetch_workers(org_id: str, worker_id: Optional[str] = None,
                   worker_ids: Optional[List[str]] = None,
                   all_active: bool = False) -> list:
    """Return the workers list for the requested mode. Async wrapper
    lives in the endpoint; this shape is kept sync-ish to keep the
    Motor cursor materialisation explicit."""
    raise NotImplementedError("use _fetch_workers_async")


async def _fetch_workers_async(org_id: str, worker_id: Optional[str],
                               worker_ids: Optional[List[str]],
                               all_active: bool) -> list:
    q: dict = {"org_id": org_id, "deleted_at": None}
    if worker_id:
        q["id"] = worker_id
    elif worker_ids:
        q["id"] = {"$in": worker_ids}
    else:
        # all_active
        q["active"] = True

    proj = {
        "_id": 0, "id": 1, "org_id": 1, "first_name": 1, "last_name": 1,
        "simpro_employee_id": 1, "company_id": 1, "company": 1, "division": 1,
        "active": 1, "deleted_at": 1, "email": 1,
    }
    rows = []
    async for w in db.workers.find(q, proj).sort([("last_name", 1), ("first_name", 1)]):
        rows.append(w)
    return rows


@router.get("/mobile/onboarding/cards.pdf")
async def onboarding_cards_pdf(
    worker_id: Optional[str] = None,
    worker_ids: Optional[str] = None,
    all: bool = False,  # noqa: A002 — matches user-brief query param name
    expires_days: int = Query(7, ge=1, le=90),
    user: dict = Depends(get_current_user),
) -> Response:
    await _require_admin(user)

    ids_list: Optional[List[str]] = None
    if worker_ids:
        ids_list = [s.strip() for s in worker_ids.split(",") if s.strip()]

    if not worker_id and not ids_list and not all:
        raise HTTPException(400, "Pass one of: worker_id, worker_ids, all=true")

    workers = await _fetch_workers_async(
        user["org_id"], worker_id, ids_list, all_active=all,
    )

    if worker_id and not workers:
        raise HTTPException(404, "Worker not found")

    version_tag = _read_running_version()

    # ── Render PDF ──
    buf = io.BytesIO()
    single_card = bool(worker_id) or len(workers) == 1

    if single_card and len(workers) == 1:
        c = Canvas(buf, pagesize=(CARD_W, CARD_H))
    else:
        c = Canvas(buf, pagesize=A4)

    generated = 0
    skipped = []
    slot = 0  # 0..3 within an A4 page

    for w in workers:
        token = await _get_or_issue_token(w, user["id"], expires_days)
        if not token:
            skipped.append({
                "id": w.get("id"),
                "name": f"{w.get('first_name','')} {w.get('last_name','')}".strip(),
                "reason": "no simpro_employee_id",
            })
            continue

        name = f"{w.get('first_name','')} {w.get('last_name','')}".strip() or "—"
        install_url = _install_url(token, w)

        if single_card and len(workers) == 1:
            _render_card(c, 0, 0, CARD_W, CARD_H, name, install_url, version_tag)
            c.showPage()
            generated += 1
            break

        # A4 4-up layout.
        col = slot % 2
        row = slot // 2
        x = GRID_MARGIN + col * (SLOT_W + GRID_GUTTER)
        y = A4_H - GRID_MARGIN - (row + 1) * SLOT_H - row * GRID_GUTTER
        _render_card(c, x, y, SLOT_W, SLOT_H, name, install_url, version_tag)
        generated += 1
        slot += 1
        if slot >= 4:
            c.showPage()
            slot = 0

    if not single_card and slot > 0:
        c.showPage()

    c.save()
    pdf_bytes = buf.getvalue()

    if generated == 0:
        raise HTTPException(422, {
            "error": "no cards generated",
            "skipped": skipped,
        })

    # Audit row (best-effort — failure never breaks the response).
    try:
        await db.user_audit.insert_one({
            "id": new_id(),
            "org_id": user["org_id"],
            "actor_id": user["id"],
            "actor_email": user.get("email"),
            "action": "onboarding_cards_generated",
            "count": generated,
            "skipped_count": len(skipped),
            "mode": "single" if worker_id else "bulk" if all else "selection",
            "ts": now_iso(),
        })
    except Exception:
        pass

    date_str = datetime.now(timezone.utc).strftime("%Y%m%d")
    filename = f"onboarding_cards_{date_str}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Paneltec-Generated": str(generated),
            "X-Paneltec-Skipped": str(len(skipped)),
        },
    )

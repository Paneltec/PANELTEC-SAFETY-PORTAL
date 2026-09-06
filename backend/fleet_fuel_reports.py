"""v58.13.131d — Fuel Reporting endpoints.

Read-only aggregations over `fuel_transactions` for the Fuel
Reporting page at `/app/fleet/fuel`.  All computed on-demand — no
materialised report cache in this phase.

Endpoints (all `/api/fleet/fuel/reports*`, gated by
`FLEET_REGISTER_ENABLED` + `assets.view` — reports are read-only):

  · GET  /fleet/fuel/reports              — JSON aggregation
  · GET  /fleet/fuel/reports/export       — CSV re-export
  · POST /fleet/fuel/reports/email        — on-demand email snapshot
                                            (assets.edit)

Rules (unchanged from `.131c`):
  · No cron. No BackgroundTask. Email fires INSIDE the HTTP request.
  · The `send_context` ContextVar gate stays intact.
  · Comms Safe Mode honoured — 200 with `sent=false, safe_mode=true`.
  · Rate-limit: 5 sends per user per 10 minutes (429 on 6th).
"""
from __future__ import annotations
import csv
import io
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from permissions import require_permission
from db import db
from models import new_id, now_iso
from fleet import require_fleet_register_enabled

log = logging.getLogger("paneltec.fuel.reports")

router = APIRouter(prefix="/fleet/fuel/reports", tags=["fleet-fuel"])

_RATE_LIMIT_WINDOW_S = 600     # 10 minutes
_RATE_LIMIT_MAX = 5            # sends per user per window


# ── Aggregation ─────────────────────────────────────────────────
def _period_key(date_iso: str, period: str) -> str:
    """Bucket a YYYY-MM-DD string into a weekly or monthly key."""
    if not date_iso or len(date_iso) < 10:
        return "unknown"
    try:
        d = datetime.strptime(date_iso[:10], "%Y-%m-%d").date()
    except ValueError:
        return "unknown"
    if period == "weekly":
        # ISO week — Mon-based. Key format `YYYY-Www` (sortable).
        iso_year, iso_week, _ = d.isocalendar()
        return f"{iso_year}-W{iso_week:02d}"
    return d.strftime("%Y-%m")


def _dpl(litres: float, total_price: float) -> Optional[float]:
    if not litres or litres <= 0 or not total_price or total_price <= 0:
        return None
    return total_price / litres


async def _aggregate(
    *, org_id: str, scope: str, period: str,
    from_date: Optional[str], to_date: Optional[str],
) -> dict:
    """Group fuel transactions by (scope, period) and by scope alone.

    Returns:
        {
          rows: [{key, label, litres, total_price, fills,
                  avg_fill_l, dpl, delta_dpl}, ...],
          periods: [{period, litres, total_price, fills}, ...],
          top_dpl_outliers: [{key, label, dpl, litres, total_price,
                              date_iso}, ...],
          totals: {litres, total_price, fills, unique_keys},
          filters: {scope, period, from, to},
        }
    """
    q: dict = {"org_id": org_id, "deleted_at": None}
    if from_date or to_date:
        rng: dict = {}
        if from_date: rng["$gte"] = from_date
        if to_date:   rng["$lte"] = to_date + "T23:59:59"
        q["timestamp"] = rng

    projection = {
        "asset_id": 1, "registration": 1, "description": 1,
        "driver": 1, "date_iso": 1, "timestamp": 1,
        "litres": 1, "total_price": 1,
        # v58.13.131i — per-row L/100km so the per-vehicle rollup can
        # surface an Avg L/100km column.
        "litres_per_100km": 1,
    }
    txs = [d async for d in db.fuel_transactions.find(q, projection)]

    # Key selector per scope.
    def _key_label(t: dict) -> tuple[str, str]:
        if scope == "employee":
            k = (t.get("driver") or "").strip() or "(no driver)"
            return k, k
        if scope == "vehicle":
            k = t.get("asset_id") or t.get("registration") or "(unattributed)"
            label = t.get("registration") or t.get("description") or k
            return k, label
        # admin — org-wide, single bucket.
        return "org", "Organisation total"

    # Roll-up per key.
    rollup: dict = {}
    period_totals: dict = {}
    outlier_rows: list = []
    for t in txs:
        litres = float(t.get("litres") or 0) or 0.0
        price = float(t.get("total_price") or 0) or 0.0
        if litres <= 0:
            continue
        k, label = _key_label(t)
        bucket = rollup.setdefault(k, {
            "key": k, "label": label, "litres": 0.0, "total_price": 0.0,
            "fills": 0,
            # v58.13.131i — accumulate L/100km values across a scope so
            # the row-level rollup can report a mean.
            "_lp100_values": [],
        })
        bucket["litres"] += litres
        bucket["total_price"] += price
        bucket["fills"] += 1
        lp100 = t.get("litres_per_100km")
        if lp100 is not None:
            bucket["_lp100_values"].append(float(lp100))

        pk = _period_key(t.get("date_iso") or (t.get("timestamp") or "")[:10], period)
        pt = period_totals.setdefault(pk, {"period": pk, "litres": 0.0,
                                            "total_price": 0.0, "fills": 0})
        pt["litres"] += litres
        pt["total_price"] += price
        pt["fills"] += 1

        d = _dpl(litres, price)
        if d is not None:
            outlier_rows.append({
                "key": k, "label": label, "dpl": d,
                "litres": litres, "total_price": price,
                "date_iso": t.get("date_iso") or "",
                "timestamp": t.get("timestamp") or "",
            })

    # Delta $/L vs previous period — compute per-key $/L for the
    # latest vs the previous period bucket (based on max period key
    # in this range).
    delta_by_key: dict = _compute_delta_by_key(txs, scope, period, _key_label)

    rows = []
    for v in rollup.values():
        dpl_val = _dpl(v["litres"], v["total_price"])
        avg = v["litres"] / v["fills"] if v["fills"] else 0.0
        lp100_values = v.get("_lp100_values") or []
        avg_lp100 = (
            round(sum(lp100_values) / len(lp100_values), 2)
            if lp100_values else None
        )
        rows.append({
            "key": v["key"], "label": v["label"],
            "litres": round(v["litres"], 3),
            "total_price": round(v["total_price"], 2),
            "fills": v["fills"],
            "avg_fill_l": round(avg, 2),
            "dpl": round(dpl_val, 4) if dpl_val is not None else None,
            "delta_dpl": delta_by_key.get(v["key"]),
            # v58.13.131i — Avg L/100km per row (null when no fills
            # in this scope had a computed L/100km).
            "avg_lp100": avg_lp100,
            "lp100_sample": len(lp100_values),
        })
    rows.sort(key=lambda r: -r["total_price"])

    # Top-5 $/L outliers (procurement signal). Only rows with a
    # non-null dpl. Ties broken by earliest date_iso.
    outlier_rows.sort(key=lambda r: (-r["dpl"], r["date_iso"]))
    top5 = [{
        "key": r["key"], "label": r["label"],
        "dpl": round(r["dpl"], 4),
        "litres": round(r["litres"], 3),
        "total_price": round(r["total_price"], 2),
        "date_iso": r["date_iso"],
    } for r in outlier_rows[:5]]

    periods = sorted(period_totals.values(), key=lambda p: p["period"])
    for p in periods:
        p["litres"] = round(p["litres"], 3)
        p["total_price"] = round(p["total_price"], 2)

    totals = {
        "litres": round(sum(r["litres"] for r in rows), 3),
        "total_price": round(sum(r["total_price"] for r in rows), 2),
        "fills": sum(r["fills"] for r in rows),
        "unique_keys": len(rows),
    }

    return {
        "rows": rows,
        "periods": periods,
        "top_dpl_outliers": top5,
        "totals": totals,
        "filters": {
            "scope": scope, "period": period,
            "from": from_date or "", "to": to_date or "",
        },
    }


def _compute_delta_by_key(txs, scope, period, key_label) -> dict:
    """Per-key $/L delta between the latest and previous period buckets
    within the current dataset. Returns {key: delta_dpl (float | None)}.
    """
    per_key_period: dict = {}
    period_keys: set = set()
    for t in txs:
        litres = float(t.get("litres") or 0) or 0.0
        price = float(t.get("total_price") or 0) or 0.0
        if litres <= 0:
            continue
        k, _ = key_label(t)
        pk = _period_key(t.get("date_iso") or (t.get("timestamp") or "")[:10], period)
        period_keys.add(pk)
        bucket = per_key_period.setdefault((k, pk), {"litres": 0.0, "total_price": 0.0})
        bucket["litres"] += litres
        bucket["total_price"] += price
    if len(period_keys) < 2:
        return {}
    ordered = sorted(p for p in period_keys if p != "unknown")
    if len(ordered) < 2:
        return {}
    latest, prev = ordered[-1], ordered[-2]
    out: dict = {}
    keys = {k for (k, _) in per_key_period.keys()}
    for k in keys:
        curr = per_key_period.get((k, latest))
        past = per_key_period.get((k, prev))
        cd = _dpl(curr["litres"], curr["total_price"]) if curr else None
        pd_ = _dpl(past["litres"], past["total_price"]) if past else None
        if cd is None or pd_ is None:
            out[k] = None
        else:
            out[k] = round(cd - pd_, 4)
    return out


async def _leaderboards(*, org_id: str, from_date, to_date) -> dict:
    """v58.13.131d — Admin rollup leaderboards. Employee-scoped top-10
    tables for: highest $, highest $/L, most fills — with a per-key
    delta ($/L) vs prior period (defaults to prior calendar month
    when no explicit range is present)."""
    curr = await _aggregate(org_id=org_id, scope="employee", period="monthly",
                             from_date=from_date, to_date=to_date)
    rows = curr["rows"]
    top_by_cost = [_lb_row(r) for r in sorted(rows, key=lambda r: -r["total_price"])[:10]]
    with_dpl = [r for r in rows if r.get("dpl") is not None]
    top_by_dpl = [_lb_row(r) for r in sorted(with_dpl, key=lambda r: -r["dpl"])[:10]]
    top_by_fills = [_lb_row(r) for r in sorted(rows, key=lambda r: -r["fills"])[:10]]
    return {
        "top_by_cost": top_by_cost,
        "top_by_dpl": top_by_dpl,
        "top_by_fills": top_by_fills,
    }


def _lb_row(r: dict) -> dict:
    return {
        "key": r["key"], "label": r["label"],
        "total_price": r["total_price"],
        "litres": r["litres"],
        "fills": r["fills"],
        "dpl": r.get("dpl"),
        "delta_dpl": r.get("delta_dpl"),
    }


# ── Endpoints ───────────────────────────────────────────────────
@router.get("")
async def fuel_reports(
    scope: str = Query("admin", pattern=r"^(employee|vehicle|admin)$"),
    period: str = Query("monthly", pattern=r"^(weekly|monthly)$"),
    from_date: Optional[str] = Query(None, alias="from"),
    to_date: Optional[str] = Query(None, alias="to"),
    _flag: None = Depends(require_fleet_register_enabled),
    user: dict = Depends(require_permission("assets", "view")),
):
    data = await _aggregate(
        org_id=user["org_id"], scope=scope, period=period,
        from_date=from_date, to_date=to_date,
    )
    if scope == "admin":
        data["leaderboards"] = await _leaderboards(
            org_id=user["org_id"], from_date=from_date, to_date=to_date,
        )
    return data


@router.get("/export")
async def fuel_report_export(
    scope: str = Query("admin", pattern=r"^(employee|vehicle|admin)$"),
    period: str = Query("monthly", pattern=r"^(weekly|monthly)$"),
    from_date: Optional[str] = Query(None, alias="from"),
    to_date: Optional[str] = Query(None, alias="to"),
    _flag: None = Depends(require_fleet_register_enabled),
    user: dict = Depends(require_permission("assets", "view")),
):
    data = await _aggregate(
        org_id=user["org_id"], scope=scope, period=period,
        from_date=from_date, to_date=to_date,
    )

    async def _stream():
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow([
            f"{scope.title()}", "Litres", "Total price", "Fills",
            "Avg fill (L)", "$/L", "Delta $/L (vs prev)",
        ])
        yield buf.getvalue()
        buf.seek(0); buf.truncate(0)
        for r in data["rows"]:
            w.writerow([
                r["label"], r["litres"], r["total_price"], r["fills"],
                r["avg_fill_l"],
                r["dpl"] if r["dpl"] is not None else "",
                r["delta_dpl"] if r["delta_dpl"] is not None else "",
            ])
            yield buf.getvalue()
            buf.seek(0); buf.truncate(0)

    filename = f"fuel-report-{scope}-{period}.csv"
    return StreamingResponse(
        _stream(), media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Email endpoint ──────────────────────────────────────────────
class EmailReportIn(BaseModel):
    to: list[str] = Field(default_factory=list)
    cc: list[str] = Field(default_factory=list)
    note: str = ""
    scope: str = "admin"
    period: str = "monthly"
    # v58.13.131d — Rename `from_date` / `to_date` fields WITHOUT
    # pydantic aliases. The old `alias="to"` on `to_date` collided
    # with the `to` recipients field. Frontend now sends
    # `from_date` / `to_date` literally.
    from_date: Optional[str] = None
    to_date: Optional[str] = None
    include_pdf: bool = True
    include_csv: bool = True


async def _rate_limited(*, org_id: str, user_id: str) -> bool:
    """Rate-limit: max 5 sends per user per 10 minutes.

    Counts BOTH `sent=true` AND `sent=false` (safe-mode) rows so a
    Safe-Mode-on org can't spam the endpoint either."""
    cutoff = (datetime.now(timezone.utc) - timedelta(seconds=_RATE_LIMIT_WINDOW_S)).isoformat()
    recent = await db.fuel_report_emails_sent.count_documents({
        "org_id": org_id,
        "sent_by": user_id,
        "sent_at": {"$gte": cutoff},
    })
    return recent >= _RATE_LIMIT_MAX


def _render_report_pdf(data: dict, *, org_name: str = "Paneltec Civil") -> bytes:
    """Simple in-request PDF snapshot via reportlab. Kept minimal —
    the goal is a printable audit trail, not a design showcase."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    W, H = A4
    y = H - 18 * mm

    def line(text, *, dy=6*mm, size=10, bold=False, color=(0, 0, 0)):
        nonlocal y
        c.setFillColorRGB(*color)
        c.setFont("Helvetica-Bold" if bold else "Helvetica", size)
        c.drawString(15 * mm, y, text[:120])
        y -= dy

    line(org_name, size=8, color=(0.44, 0.42, 0.94))
    line("Fuel Report — Snapshot", size=16, bold=True, dy=10*mm)
    f = data.get("filters", {})
    line(f"Scope: {f.get('scope','')}   Period: {f.get('period','')}"
         f"   Range: {f.get('from','') or '—'} → {f.get('to','') or '—'}",
         size=9, color=(0.3, 0.3, 0.3))
    t = data.get("totals", {})
    line(f"Total litres: {t.get('litres', 0):.2f} L    "
         f"Total cost: ${t.get('total_price', 0):.2f}    "
         f"Fills: {t.get('fills', 0)}    Unique keys: {t.get('unique_keys', 0)}",
         size=10, dy=8*mm)

    # Top-5 $/L outliers.
    line("TOP 5 · $/L OUTLIERS (procurement signal)", size=9, bold=True, color=(0.6, 0.3, 0))
    outliers = data.get("top_dpl_outliers", [])
    if not outliers:
        line("  — No fills with pricing data in range.", size=9, color=(0.5, 0.5, 0.5))
    for o in outliers:
        line(
            f"  ${o.get('dpl', 0):.3f}/L · {o.get('label','')} · "
            f"{o.get('litres',0):.2f} L · ${o.get('total_price',0):.2f} · {o.get('date_iso','')}",
            size=9,
        )
    y -= 4 * mm

    line("BREAKDOWN", size=9, bold=True, color=(0.17, 0.42, 1))
    rows = data.get("rows", [])
    if not rows:
        line("  — No rows in range.", size=9, color=(0.5, 0.5, 0.5))
    for r in rows[:30]:
        if y < 20 * mm:
            c.showPage()
            y = H - 18 * mm
        dpl = r.get("dpl")
        dpl_s = f"${dpl:.3f}/L" if dpl is not None else "$—"
        line(
            f"  {r.get('label','')}   ·   {r.get('litres',0):.2f} L   ·   "
            f"${r.get('total_price',0):.2f}   ·   {r.get('fills',0)} fills   ·   {dpl_s}",
            size=8,
        )

    c.showPage()
    c.save()
    return buf.getvalue()


def _render_report_csv_bytes(data: dict) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Label", "Litres", "Total price", "Fills",
                "Avg fill (L)", "$/L", "Delta $/L (vs prev)"])
    for r in data.get("rows", []):
        w.writerow([
            r["label"], r["litres"], r["total_price"], r["fills"],
            r["avg_fill_l"],
            r["dpl"] if r["dpl"] is not None else "",
            r["delta_dpl"] if r["delta_dpl"] is not None else "",
        ])
    return buf.getvalue().encode("utf-8")


@router.post("/email")
async def fuel_report_email(
    payload: EmailReportIn,
    _flag: None = Depends(require_fleet_register_enabled),
    user: dict = Depends(require_permission("assets", "edit")),
):
    """On-demand email of a fuel report snapshot. Runs INSIDE the
    HTTP request — no cron, no BackgroundTask. Honours Comms Safe
    Mode. Rate-limited to 5 sends per user per 10 minutes."""
    # 1. Validate recipients.
    to = [e.strip() for e in (payload.to or []) if e and "@" in e]
    cc = [e.strip() for e in (payload.cc or []) if e and "@" in e]
    if not to:
        # Default to caller's own address so the button always works.
        if user.get("email"):
            to = [user["email"]]
        else:
            raise HTTPException(status_code=400, detail="no valid recipients")
    if not (payload.include_pdf or payload.include_csv):
        raise HTTPException(status_code=400, detail="must include at least one attachment format")

    # 2. Rate limit.
    if await _rate_limited(org_id=user["org_id"], user_id=user["id"]):
        raise HTTPException(
            status_code=429,
            detail=f"Rate limit: max {_RATE_LIMIT_MAX} report emails per "
                   f"{_RATE_LIMIT_WINDOW_S // 60} minutes. Try again shortly.",
        )

    # 3. Build report + attachments.
    data = await _aggregate(
        org_id=user["org_id"], scope=payload.scope, period=payload.period,
        from_date=payload.from_date, to_date=payload.to_date,
    )
    if payload.scope == "admin":
        data["leaderboards"] = await _leaderboards(
            org_id=user["org_id"],
            from_date=payload.from_date, to_date=payload.to_date,
        )

    attachments: list = []
    tmp_paths: list = []
    import tempfile, os
    filters_snap = data["filters"]
    stem = f"fuel-report-{filters_snap['scope']}-{filters_snap['period']}-{now_iso()[:10]}"
    if payload.include_pdf:
        pdf_bytes = _render_report_pdf(data)
        f = tempfile.NamedTemporaryFile(delete=False, suffix=".pdf",
                                         prefix="paneltec_fuelreport_")
        f.write(pdf_bytes); f.close()
        tmp_paths.append(f.name)
        attachments.append({
            "filename": f"{stem}.pdf",
            "local_path": f.name,
        })
    if payload.include_csv:
        csv_bytes = _render_report_csv_bytes(data)
        f = tempfile.NamedTemporaryFile(delete=False, suffix=".csv",
                                         prefix="paneltec_fuelreport_")
        f.write(csv_bytes); f.close()
        tmp_paths.append(f.name)
        attachments.append({
            "filename": f"{stem}.csv",
            "local_path": f.name,
        })

    # 4. Build body.
    note_html = ""
    if (payload.note or "").strip():
        note_html = f"<p>{payload.note.strip()}</p><hr/>"
    t = data.get("totals", {})
    body_html = (
        f"{note_html}"
        f"<p>Fuel report snapshot — <strong>{filters_snap['scope']}</strong> · "
        f"{filters_snap['period']}, range "
        f"{filters_snap.get('from','') or '—'} → {filters_snap.get('to','') or '—'}.</p>"
        f"<p>Total litres: <strong>{t.get('litres', 0):.2f} L</strong><br/>"
        f"Total cost: <strong>${t.get('total_price', 0):.2f}</strong><br/>"
        f"Fills: <strong>{t.get('fills', 0)}</strong><br/>"
        f"Unique keys: <strong>{t.get('unique_keys', 0)}</strong></p>"
        f"<p style=\"color:#64748b;font-size:12px\">Sent by "
        f"{(user.get('email') or user.get('id'))} · Paneltec Civil</p>"
    )
    subject = f"Paneltec Fuel Report — {filters_snap['scope'].title()} · {now_iso()[:10]}"

    # 5. Comms Safe Mode branch — mirror the pattern used elsewhere.
    from comms_safe_mode import is_blocked as _safe_blocked
    safe_mode_on = await _safe_blocked(user["org_id"])
    message_id = None
    sent_flag = False
    if safe_mode_on:
        # Log intent, return 200 with safe_mode=True.
        pass
    else:
        # Live send via queue_email_doc → graph_send_mail (which
        # itself honours the request-context gate). We surface the
        # RESULT status back to the caller so a Graph error becomes
        # a visible failure, not a silent "sent" claim.
        from email_outbox import queue_email_doc
        res = await queue_email_doc(
            org_id=user["org_id"],
            to=to, cc=cc, subject=subject, body_html=body_html,
            attachments=attachments,
            resource_kind="fleet_fuel_report",
            created_by=user["id"],
        )
        message_id = res.get("id")
        status = res.get("status")
        sent_flag = status == "sent"
        if status == "blocked":
            # Provider (Graph) blocked us AFTER Safe Mode check — likely
            # M365 not connected. Mark that but keep 200 so the audit
            # row still lands.
            safe_mode_on = True

    # 6. Audit trail.
    audit = {
        "id": new_id(),
        "org_id": user["org_id"],
        "sent_by": user["id"],
        "sent_by_email": user.get("email"),
        "sent_to": to,
        "cc": cc,
        "note": (payload.note or "")[:2000],
        "filters_snapshot": filters_snap,
        "format": {
            "pdf": bool(payload.include_pdf),
            "csv": bool(payload.include_csv),
        },
        "sent": sent_flag,
        "safe_mode": bool(safe_mode_on),
        "message_id": message_id,
        "sent_at": now_iso(),
    }
    await db.fuel_report_emails_sent.insert_one(dict(audit))

    # 7. Cleanup temp attachment files.
    for p in tmp_paths:
        try:
            os.unlink(p)
        except OSError:
            pass

    resp = {
        "sent": sent_flag,
        "safe_mode": bool(safe_mode_on),
        "message_id": message_id,
    }
    if safe_mode_on:
        resp["would_have_sent_to"] = to
    return resp


# ── Indexes ─────────────────────────────────────────────────────
async def ensure_indexes() -> None:
    await db.fuel_report_emails_sent.create_index(
        [("org_id", 1), ("sent_by", 1), ("sent_at", -1)],
    )
    await db.fuel_report_emails_sent.create_index([("id", 1)], unique=True)

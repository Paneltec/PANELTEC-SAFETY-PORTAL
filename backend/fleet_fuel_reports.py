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



# v58.13.132bz — Shared helper: given a list of txn_ids in an org,
# return {txn_id: {"linked": <rego|None>, "inferred": <rego|None>}}
# where `linked` comes from the txn's formal `asset_id` link and
# `inferred` falls back to the CSV `registration` string.
async def _resolve_regos_for_txns(org_id: str, txn_ids: list) -> dict:
    ids = [t for t in (txn_ids or []) if t]
    if not ids:
        return {}
    out: dict = {}
    asset_ids_needed: set = set()
    async for tx in db.fuel_transactions.find(
        {"id": {"$in": ids}, "org_id": org_id, "deleted_at": None},
        {"_id": 0, "id": 1, "asset_id": 1, "registration": 1},
    ):
        out[tx["id"]] = {
            "linked": None,
            "inferred": (tx.get("registration") or "").strip() or None,
            "_asset_id": tx.get("asset_id"),
        }
        if tx.get("asset_id"):
            asset_ids_needed.add(tx["asset_id"])
    if asset_ids_needed:
        id_to_rego: dict = {}
        async for a in db.assets.find(
            {"org_id": org_id, "id": {"$in": list(asset_ids_needed)},
             "deleted_at": None},
            {"_id": 0, "id": 1, "rego_serial": 1, "name": 1},
        ):
            id_to_rego[a["id"]] = a.get("rego_serial") or a.get("name") or ""
        for tid, meta in out.items():
            aid = meta.pop("_asset_id", None)
            if aid and id_to_rego.get(aid):
                meta["linked"] = id_to_rego[aid]
                # Formal link supersedes inferred.
                meta["inferred"] = None
    else:
        for meta in out.values():
            meta.pop("_asset_id", None)
    return out



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
        # v58.13.132aw — Carry `time_local` through so the Top-5
        # Highest-fill + $/L-outlier panels can show HH:MM alongside
        # the date. Same field that already powers the drilldown.
        "time_local": 1,
        # v58.13.132ax — Row `id` so the Top-5 rows can open the
        # reusable FuelTransactionDetailModal via txnId prop.
        "id": 1,
        "litres": 1, "total_price": 1,
        # v58.13.131i — per-row L/100km so the per-vehicle rollup can
        # surface an Avg L/100km column.
        "litres_per_100km": 1,
        # v58.13.131o — card→worker resolution.
        "card_number": 1, "resolved_driver_name": 1,
        "resolved_driver_worker_id": 1,
        # v58.13.132t — surface provisional-price marker
        "price_source": 1,
    }
    txs = [d async for d in db.fuel_transactions.find(q, projection)]

    # v58.13.132t — Any row currently carrying the .132t provisional
    # $3.00 placeholder? Answer surfaces on `totals.has_provisional`
    # so the FE can render the amber banner.
    has_provisional = any(
        (t.get("price_source") == "provisional_static_3.00") for t in txs
    )

    # Key selector per scope.
    def _key_label(t: dict) -> tuple[str, str]:
        if scope == "employee":
            # v58.13.131o — Prefer the card→worker resolved name. Fall
            # back to the CSV "Driver" free-text column. Final fallback
            # for rows with an unlinked card_number is
            # `Card {n} (unlinked)` so admins can see how many rows
            # are pending a card link.
            resolved = (t.get("resolved_driver_name") or "").strip()
            if resolved:
                return resolved, resolved
            csv_driver = (t.get("driver") or "").strip()
            if csv_driver:
                return csv_driver, csv_driver
            card = (t.get("card_number") or "").strip()
            if card:
                # v58.13.132bz — Format as "Card N · unlinked" (middle-
                # dot separator) so the aggregation label matches the
                # rest of the app. The `.132bu` inferred-rego pass runs
                # AFTER this label is built and can upgrade the display
                # further downstream.
                label = f"Card {card} · unlinked"
                return f"CARD:{card}", label
            return "(no driver)", "(no driver)"
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
            # v58.13.132ak — track the most recent fill per key so the
            # FE Per-Employee / Per-Vehicle / Admin tables can sort by
            # "Last fill" (date desc). Compared as ISO date strings —
            # lexicographic order ≡ chronological.
            "_latest_date_iso": "",
            "_latest_timestamp": "",
            # v58.13.132bo — track distinct SmartFill card numbers seen
            # under this key so the Top 10 leaderboard row can drive a
            # click-through to the per-card drill-down drawer.
            "_card_numbers": set(),
        })
        bucket["litres"] += litres
        bucket["total_price"] += price
        bucket["fills"] += 1
        lp100 = t.get("litres_per_100km")
        if lp100 is not None:
            bucket["_lp100_values"].append(float(lp100))
        card_num = (t.get("card_number") or "").strip()
        if card_num:
            bucket["_card_numbers"].add(card_num)
        # Track newest fill for this key.
        di = t.get("date_iso") or ""
        ts = t.get("timestamp") or ""
        if di > bucket["_latest_date_iso"]:
            bucket["_latest_date_iso"] = di
        if ts > bucket["_latest_timestamp"]:
            bucket["_latest_timestamp"] = ts

        pk = _period_key(t.get("date_iso") or (t.get("timestamp") or "")[:10], period)
        pt = period_totals.setdefault(pk, {"period": pk, "litres": 0.0,
                                            "total_price": 0.0, "fills": 0})
        pt["litres"] += litres
        pt["total_price"] += price
        pt["fills"] += 1

        d = _dpl(litres, price)
        outlier_rows.append({
            "key": k, "label": label,
            "dpl": d,
            "litres": litres, "total_price": price,
            "date_iso": t.get("date_iso") or "",
            "timestamp": t.get("timestamp") or "",
            # v58.13.132aw — carry `time_local` (HH:MM:SS) so the
            # Top 5 panels can render alongside the date.
            "time_local": t.get("time_local") or "",
            # v58.13.132ax — carry the row `id` through so Top 5
            # panels can drive click-to-detail.
            "id": t.get("id"),
            # v58.13.132aj — Carry the provisional marker + per-fill
            # metadata through so the Top 5 · Highest fills and
            # $/L-outliers panels can render honestly.
            "price_source": t.get("price_source"),
            "registration": t.get("registration") or "",
            "description": t.get("description") or "",
            "driver": (t.get("resolved_driver_name")
                       or t.get("driver") or ""),
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
            # v58.13.132ak — newest fill per key. FE default-sorts on
            # this (desc) so the most recently-fuelled worker / vehicle
            # sits at the top of the table.
            "latest_fill_date_iso": v.get("_latest_date_iso") or "",
            "latest_fill_timestamp": v.get("_latest_timestamp") or "",
            # v58.13.132bo — sorted list of distinct SmartFill cards
            # seen under this row. Used by the Top-10 leaderboards to
            # drive click-through to the per-card drill-down drawer.
            "card_numbers": sorted(v.get("_card_numbers") or []),
        })
    # v58.13.132ak — Default sort: newest fill first (primary),
    # highest total $ as tiebreaker. Rows with an empty
    # `latest_fill_date_iso` sink to the bottom.
    rows.sort(
        key=lambda r: (
            r["latest_fill_date_iso"] or "",
            r["total_price"],
        ),
        reverse=True,
    )

    # v58.13.132bz — Per-row cascade rego enrichment. Matches the
    # leaderboard path from .132bq/.132bu so Per Employee / Per
    # Vehicle tables show "Card N · REGO" instead of a bare label.
    all_card_nums: set = set()
    for r in rows:
        for cn in r.get("card_numbers") or []:
            all_card_nums.add(cn)
    if all_card_nums:
        card_to_rego_linked: dict = {}
        async for a in db.assets.find(
            {"org_id": org_id, "deleted_at": None,
             "smartfill_card_number": {"$in": list(all_card_nums)}},
            {"_id": 0, "smartfill_card_number": 1,
             "rego_serial": 1, "name": 1},
        ):
            cn = (a.get("smartfill_card_number") or "").strip()
            if cn:
                card_to_rego_linked[cn] = a.get("rego_serial") or a.get("name") or ""
        # Inferred pass — for unlinked cards, take majority asset_id
        # in the last 90 days.
        card_to_rego_inferred: dict = {}
        unlinked = [c for c in all_card_nums if c not in card_to_rego_linked]
        if unlinked:
            cutoff = (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()
            pipeline = [
                {"$match": {"org_id": org_id, "deleted_at": None,
                            "card_number": {"$in": unlinked},
                            "timestamp": {"$gte": cutoff},
                            "asset_id": {"$nin": [None, ""]}}},
                {"$group": {"_id": {"card": "$card_number",
                                     "asset_id": "$asset_id"},
                            "n": {"$sum": 1}}},
                {"$sort": {"n": -1}},
            ]
            best: dict = {}
            async for row in db.fuel_transactions.aggregate(pipeline):
                card = row["_id"]["card"]
                aid = row["_id"]["asset_id"]
                if card not in best or row["n"] > best[card][1]:
                    best[card] = (aid, row["n"])
            asset_ids = list({v[0] for v in best.values()})
            if asset_ids:
                id_to_rego: dict = {}
                async for a in db.assets.find(
                    {"org_id": org_id, "id": {"$in": asset_ids},
                     "deleted_at": None},
                    {"_id": 0, "id": 1, "rego_serial": 1, "name": 1},
                ):
                    id_to_rego[a["id"]] = a.get("rego_serial") or a.get("name") or ""
                for card, (aid, _n) in best.items():
                    rego = id_to_rego.get(aid)
                    if rego:
                        card_to_rego_inferred[card] = rego
        for r in rows:
            cards = r.get("card_numbers") or []
            r["linked_rego"] = next(
                (card_to_rego_linked[c] for c in cards
                 if c in card_to_rego_linked and card_to_rego_linked[c]),
                None,
            )
            r["inferred_rego"] = (
                None if r["linked_rego"] else next(
                    (card_to_rego_inferred[c] for c in cards
                     if c in card_to_rego_inferred and card_to_rego_inferred[c]),
                    None,
                )
            )
    else:
        for r in rows:
            r["linked_rego"] = None
            r["inferred_rego"] = None

    # Top-5 $/L outliers (procurement signal). Only rows with a
    # non-null dpl. Ties broken by earliest date_iso.
    # v58.13.132aj — Also exclude provisional-priced rows so the
    # $/L outlier signal is real, not driven by the $3.00 placeholder.
    real_priced = [r for r in outlier_rows
                    if r["dpl"] is not None
                    and r.get("price_source") != "provisional_static_3.00"]
    real_priced.sort(key=lambda r: (-r["dpl"], r["date_iso"]))
    # v58.13.132bz — Enrich outlier rows with linked / inferred rego
    # so the FE outlier table can show the vehicle involved in each
    # $/L outlier fill (not just "Organisation total").
    outlier_regos = await _resolve_regos_for_txns(
        org_id, [r.get("id") for r in real_priced[:5] if r.get("id")],
    )
    top_dpl_outliers_real = [{
        "key": r["key"], "label": r["label"],
        "dpl": round(r["dpl"], 4),
        "litres": round(r["litres"], 3),
        "total_price": round(r["total_price"], 2),
        "date_iso": r["date_iso"],
        # v58.13.132aw — surface HH:MM alongside the date.
        "time_local": r.get("time_local") or "",
        # v58.13.132ax — expose the txn id so the row click opens the
        # reusable FuelTransactionDetailModal.
        "id": r.get("id"),
        # v58.13.132bz — resolved rego for this outlier fill
        # (formal asset_id link → linked; else registration text
        # from the CSV → inferred; else null).
        "linked_rego": outlier_regos.get(r.get("id"), {}).get("linked"),
        "inferred_rego": outlier_regos.get(r.get("id"), {}).get("inferred"),
    } for r in real_priced[:5]]

    # Back-compat top_dpl_outliers (includes provisional rows) —
    # kept so the PDF renderer + any consumer still on the .131d
    # shape doesn't 500. FE uses `top_by_fill_litres` now.
    all_priced = [r for r in outlier_rows if r["dpl"] is not None]
    all_priced.sort(key=lambda r: (-r["dpl"], r["date_iso"]))
    top5 = [{
        "key": r["key"], "label": r["label"],
        "dpl": round(r["dpl"], 4),
        "litres": round(r["litres"], 3),
        "total_price": round(r["total_price"], 2),
        "date_iso": r["date_iso"],
        "time_local": r.get("time_local") or "",
        "id": r.get("id"),
    } for r in all_priced[:5]]

    # v58.13.132aj — Top 5 · Highest fills (per-transaction, sorted
    # by litres desc). Includes provisional rows because the metric
    # here is volume, not $/L. Ties broken by newest timestamp.
    by_litres = sorted(
        outlier_rows,
        key=lambda r: (-r["litres"], r.get("timestamp") or ""),
        reverse=False,
    )
    top_by_fill_litres = [{
        "key": r["key"], "label": r["label"],
        "litres": round(r["litres"], 3),
        "total_price": round(r["total_price"], 2),
        "dpl": (round(r["dpl"], 4) if r["dpl"] is not None else None),
        "date_iso": r["date_iso"],
        # v58.13.132aw — HH:MM for the header caption.
        "time_local": r.get("time_local") or "",
        "timestamp": r.get("timestamp") or "",
        "price_source": r.get("price_source"),
        "registration": r.get("registration") or "",
        "driver": r.get("driver") or "",
        # v58.13.132ax — click-through to detail modal.
        "id": r.get("id"),
    } for r in by_litres[:5]]

    periods = sorted(period_totals.values(), key=lambda p: p["period"])
    for p in periods:
        p["litres"] = round(p["litres"], 3)
        p["total_price"] = round(p["total_price"], 2)

    totals = {
        "litres": round(sum(r["litres"] for r in rows), 3),
        "total_price": round(sum(r["total_price"] for r in rows), 2),
        "fills": sum(r["fills"] for r in rows),
        "unique_keys": len(rows),
        # v58.13.132t — Provisional marker
        "has_provisional": has_provisional,
    }

    # v58.13.132aj — Latest transaction date across the org (NOT
    # filtered by the current range). Powers the Fuel Report
    # empty-state banner so admins can see how stale the pipeline is
    # without leaving the page. One indexed query.
    latest_doc = await db.fuel_transactions.find_one(
        {"org_id": org_id, "deleted_at": None},
        {"_id": 0, "date_iso": 1, "timestamp": 1},
        sort=[("timestamp", -1)],
    )
    totals["latest_txn_date_iso"] = (latest_doc or {}).get("date_iso") or ""
    totals["latest_txn_timestamp"] = (latest_doc or {}).get("timestamp") or ""

    return {
        "rows": rows,
        "periods": periods,
        "top_dpl_outliers": top5,
        # v58.13.132aj — new payload additions.
        "top_dpl_outliers_real": top_dpl_outliers_real,
        "top_by_fill_litres": top_by_fill_litres,
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
    when no explicit range is present).

    v58.13.132bz — Rego enrichment (linked + inferred) is now done
    inside `_aggregate`, so this function is a thin slicer over
    pre-enriched rows.
    """
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
        "card_numbers": r.get("card_numbers") or [],
        # v58.13.132bq — primary linked vehicle rego (formal
        # `assets.smartfill_card_number` link).
        "linked_rego": r.get("linked_rego"),
        # v58.13.132bu — inferred rego derived from majority `asset_id`
        # over the last 90d when no formal link exists.
        "inferred_rego": r.get("inferred_rego"),
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
    detail: bool = Query(False),  # v58.13.132aj — per-fill CSV mode
    _flag: None = Depends(require_fleet_register_enabled),
    user: dict = Depends(require_permission("assets", "view")),
):
    data = await _aggregate(
        org_id=user["org_id"], scope=scope, period=period,
        from_date=from_date, to_date=to_date,
    )

    # v58.13.132aj — Metadata header block prepended to every CSV
    # so exports are self-describing (fixes the .131d issue where an
    # exported file gave no clue what date range it covered).
    generated_iso = datetime.now(timezone.utc).isoformat()
    generated_by = user.get("email") or user.get("id") or ""

    async def _stream_aggregated():
        buf = io.StringIO()
        w = csv.writer(buf)
        # Metadata block.
        w.writerow(["Report range", from_date or "", to_date or ""])
        w.writerow(["Scope", scope])
        w.writerow(["Period", period])
        w.writerow(["Generated", generated_iso])
        w.writerow(["Generated by", generated_by])
        w.writerow(["Latest txn on file",
                    data.get("totals", {}).get("latest_txn_date_iso") or ""])
        w.writerow([])  # blank separator row
        # Data header — .132ak swap: `Fills` → `Last fill` to match
        # the on-screen table order (Employee/Vehicle/Admin now sort
        # by newest fill first).
        w.writerow([
            f"{scope.title()}", "Last fill", "Litres", "Total price",
            "Avg fill (L)", "$/L", "Delta $/L (vs prev)",
        ])
        yield buf.getvalue()
        buf.seek(0); buf.truncate(0)
        for r in data["rows"]:
            w.writerow([
                r["label"],
                r.get("latest_fill_date_iso", ""),
                r["litres"], r["total_price"],
                r["avg_fill_l"],
                r["dpl"] if r["dpl"] is not None else "",
                r["delta_dpl"] if r["delta_dpl"] is not None else "",
            ])
            yield buf.getvalue()
            buf.seek(0); buf.truncate(0)

    async def _stream_detail():
        buf = io.StringIO()
        w = csv.writer(buf)
        # Metadata block.
        w.writerow(["Report range", from_date or "", to_date or ""])
        w.writerow(["Scope", scope])
        w.writerow(["Period", period])
        w.writerow(["Generated", generated_iso])
        w.writerow(["Generated by", generated_by])
        w.writerow(["Detail mode", "per-fill"])
        w.writerow(["Latest txn on file",
                    data.get("totals", {}).get("latest_txn_date_iso") or ""])
        w.writerow([])
        # Per-fill header.
        w.writerow([
            "Date", "Time", "Vehicle rego", "Vehicle desc",
            "Driver", "Litres", "Total price", "$/L", "Price source",
            "Anomaly flags",
            # v58.13.132au — SmartFill portal id, blank for legacy
            # CSV rows that never had a txn_id.
            "Transaction ID",
        ])
        yield buf.getvalue()
        buf.seek(0); buf.truncate(0)
        # Stream from DB — respects same range filter as aggregation.
        q: dict = {"org_id": user["org_id"], "deleted_at": None}
        if from_date or to_date:
            rng: dict = {}
            if from_date: rng["$gte"] = from_date
            if to_date:   rng["$lte"] = to_date + "T23:59:59"
            q["timestamp"] = rng
        projection = {
            "_id": 0, "date_iso": 1, "time_local": 1, "timestamp": 1,
            "registration": 1, "description": 1, "driver": 1,
            "resolved_driver_name": 1,
            "litres": 1, "total_price": 1,
            "computed_price_per_litre": 1, "price_source": 1,
            "anomaly_flags": 1,
            # v58.13.132au — surface the SmartFill portal id in the
            # CSV so admins can cross-reference DB rows against the
            # SmartFill portal directly.
            "transaction_id": 1,
        }
        async for t in db.fuel_transactions.find(q, projection).sort("timestamp", -1):
            litres = t.get("litres")
            price = t.get("total_price")
            dpl = t.get("computed_price_per_litre")
            if dpl is None and litres and price and litres > 0:
                try:
                    dpl = round(float(price) / float(litres), 4)
                except Exception:
                    dpl = None
            flags = t.get("anomaly_flags") or []
            flag_rules = "|".join(sorted({f.get("rule", "") for f in flags if f.get("rule")}))
            driver = (t.get("resolved_driver_name")
                      or t.get("driver") or "")
            w.writerow([
                t.get("date_iso") or "",
                (t.get("time_local") or "")[:8],
                t.get("registration") or "",
                t.get("description") or "",
                driver,
                litres if litres is not None else "",
                price if price is not None else "",
                dpl if dpl is not None else "",
                t.get("price_source") or "",
                flag_rules,
                t.get("transaction_id") or "",
            ])
            yield buf.getvalue()
            buf.seek(0); buf.truncate(0)

    filename = (f"fuel-report-detail-{scope}-{period}.csv"
                if detail
                else f"fuel-report-{scope}-{period}.csv")
    return StreamingResponse(
        _stream_detail() if detail else _stream_aggregated(),
        media_type="text/csv",
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

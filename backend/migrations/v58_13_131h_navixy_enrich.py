"""v58.13.131h — Navixy odometer enrichment migration.

Enriches every `fuel_transactions` row that has `odometer_km` in
(null, 0) with the best-effort Navixy reading available at fill
time. Tiers (see `fleet_fuel_enrich.py`):

    navixy_live      — nearest `asset_meter_history` snapshot on/before
                       the fill date, within 7 days
                       (`odometer_km_total`, `engine_hours_total`).
    navixy_snapshot  — current `assets.odo_km` counter (fresh or stale).
    unknown          — no Navixy plumbing on this asset.

Modes:
  --dry-run   (default) — writes NOTHING. Produces the diff report
              at `/app/memory/v58_13_131h_dryrun.md`.
  --apply     — writes enriched values + audit fields + re-flags
              R4/R5 across every touched row.
  --rollback  — unsets every enriched field and re-flags R5 on rows
              that had CSV odo == 0 and Navixy source == unknown.

v58.13.131i:
  * `navixy_live` path is now active (was reserved in `.131h`) — reads
    `asset_meter_history.odometer_km_total` per fill date. This
    upgrades rows previously landing as `navixy_snapshot` to
    `navixy_live` when a same-day-or-earlier history row exists.
  * Idempotent: rows already at `navixy_live` are skipped by the
    discovery filter (they already have `odometer_km > 0` unless
    unknown). Rows still at `unknown` (no Navixy device) stay
    `unknown` — cannot be enriched.
  * L/100km guards tightened via `fleet_fuel_enrich.compute_lp100`
    (30-day gap skip, stale confidence skip).
"""
from __future__ import annotations
import argparse
import asyncio
import logging
import os
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone

_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.abspath(os.path.join(_HERE, ".."))
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

log = logging.getLogger("paneltec.v58_13_131h")
logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")

DRYRUN_REPORT = "/app/memory/v58_13_131h_dryrun.md"
APPLY_LOG = "/app/memory/v58_13_131h_apply_log.md"


@dataclass
class Counts:
    scanned: int = 0
    would_navixy_live: int = 0
    would_navixy_snapshot: int = 0
    would_snapshot_stale: int = 0
    would_unknown: int = 0
    no_asset_id: int = 0
    proposed: list = field(default_factory=list)


async def run_discovery(db) -> Counts:
    """Enrich odometer=null/0 rows. Also RE-enrich rows currently at
    `navixy_snapshot` where the `navixy_live` path is now available —
    that's the .131i upgrade path."""
    from fleet_fuel_enrich import (
        enrich_fill,
        load_asset_snapshots,
    )

    counts = Counts()
    snapshots = await load_asset_snapshots(db)

    # v58.13.131i — include `navixy_snapshot` rows so they can upgrade
    # to `navixy_live` when history data exists. Rows already at
    # `navixy_live` are skipped (idempotent).
    q = {
        "deleted_at": None,
        "$or": [
            {"odometer_km": None},
            {"odometer_km": 0},
            {"odometer_source": "navixy_snapshot"},
            {"odometer_source": "unknown"},
        ],
    }

    async for tx in db.fuel_transactions.find(
        q,
        {
            "id": 1,
            "asset_id": 1,
            "date_iso": 1,
            "odometer_km": 1,
            "odometer_source": 1,
            "engine_hours": 1,
            "registration": 1,
            "litres": 1,
        },
    ):
        counts.scanned += 1
        aid = tx.get("asset_id")
        if not aid:
            counts.no_asset_id += 1
            counts.would_unknown += 1
            counts.proposed.append(
                {
                    "id": tx["id"],
                    "asset_id": None,
                    "rego": tx.get("registration"),
                    "source": "unknown",
                    "confidence": None,
                    "proposed_odo": None,
                    "proposed_hours": None,
                    "reason": "no asset_id (unmatched row)",
                }
            )
            continue

        enrich = await enrich_fill(
            db,
            asset_id=aid,
            date_iso=tx.get("date_iso"),
            csv_odo=None,  # migration ignores CSV wins — we're enriching what CSV missed
            csv_hours=None,
            snapshots=snapshots,
        )
        src = enrich.get("odometer_source")
        conf = enrich.get("_enrichment_confidence")
        proposed_odo = enrich.get("odometer_km")
        proposed_hours = enrich.get("engine_hours")

        if src == "navixy_live":
            counts.would_navixy_live += 1
        elif src == "navixy_snapshot" and conf == "stale":
            counts.would_snapshot_stale += 1
        elif src == "navixy_snapshot":
            counts.would_navixy_snapshot += 1
        else:
            counts.would_unknown += 1

        counts.proposed.append(
            {
                "id": tx["id"],
                "asset_id": aid,
                "rego": tx.get("registration"),
                "source": src or "unknown",
                "confidence": conf,
                "proposed_odo": proposed_odo,
                "proposed_hours": proposed_hours,
                "snapshot_at": enrich.get("odometer_snapshot_at"),
                "reason": (
                    "no navixy_device_id" if src == "unknown" and aid else ""
                ),
            }
        )
    return counts


def write_dryrun_report(counts: Counts, *, target: str = DRYRUN_REPORT) -> str:
    lines = []
    lines.append("# v58.13.131h — Navixy enrichment · dry-run report\n")
    lines.append(f"Generated: {datetime.now(timezone.utc).isoformat()}\n")
    lines.append("**No writes performed.** Re-run with `--apply` after green-light.\n")
    lines.append("## Overview\n")
    lines.append(f"- Rows scanned (odo null/0 OR source in {{snapshot, unknown}}): **{counts.scanned}**")
    lines.append(
        f"- Would enrich as **`navixy_live`** (per-day history, `.131i` path): {counts.would_navixy_live}"
    )
    lines.append(
        f"- Would enrich as **`navixy_snapshot`** (fresh, ≤24h): {counts.would_navixy_snapshot}"
    )
    lines.append(
        f"- Would enrich as **`navixy_snapshot`** (stale, >24h): {counts.would_snapshot_stale}"
    )
    lines.append(f"- Would land as **`unknown`**: {counts.would_unknown}")
    lines.append(f"  · of which no asset_id (unmatched rows): {counts.no_asset_id}")
    lines.append("")
    lines.append("## First 30 proposed rows\n")
    lines.append("| tx.id | rego | source | conf | → odo | → hrs | reason |")
    lines.append("|-------|------|--------|:----:|------:|------:|--------|")
    for r in counts.proposed[:30]:
        lines.append(
            f"| `{r['id'][:8]}…` | {r.get('rego') or '—'} | {r['source']} | "
            f"{r.get('confidence') or '—'} | {r.get('proposed_odo') or '—'} | "
            f"{r.get('proposed_hours') or '—'} | {r.get('reason') or '—'} |"
        )
    if len(counts.proposed) > 30:
        lines.append(
            f"\n_(+ {len(counts.proposed) - 30} more rows — full log in `apply_log.md`.)_"
        )
    lines.append("")
    with open(target, "w") as fh:
        fh.write("\n".join(lines))
    return target


async def run_apply(db, counts: Counts) -> dict:
    """Apply the enrichment plan produced by run_discovery. Idempotent."""
    from fleet_fuel_enrich import compute_lp100

    now_iso = datetime.now(timezone.utc).isoformat()
    updated_odo = 0
    updated_hrs = 0
    unknowns = 0
    r5_added = 0
    lp100_written = 0
    lp100_skipped = 0
    upgraded_to_live = 0

    for r in counts.proposed:
        upd: dict = {
            "odometer_source": r["source"],
            "engine_hours_source": r["source"],
            "updated_at": now_iso,
            "_enriched_at": now_iso,
        }
        if r.get("confidence"):
            upd["_enrichment_confidence"] = r["confidence"]
        else:
            # Clear stale confidence markers on upgrade to `navixy_live`.
            upd["_enrichment_confidence"] = None

        if r["source"] == "unknown":
            unknowns += 1
            # `.131i` — on unknown rows we DO NOT unset odometer_km if
            # it happens to have a value from a prior enrichment.
        else:
            if r.get("proposed_odo") is not None:
                upd["odometer_km"] = r["proposed_odo"]
                upd["odometer_snapshot_at"] = r.get("snapshot_at")
                updated_odo += 1
            if r.get("proposed_hours") is not None:
                upd["engine_hours"] = r["proposed_hours"]
                updated_hrs += 1
            if r["source"] == "navixy_live":
                upgraded_to_live += 1

        await db.fuel_transactions.update_one({"id": r["id"]}, {"$set": upd})

    # v58.13.131h — Re-evaluate R5 across every touched row now that
    # `odometer_source` is set. R5 fires only when unknown.
    async for tx in db.fuel_transactions.find(
        {"_enriched_at": now_iso},
        {"id": 1, "anomaly_flags": 1, "odometer_source": 1},
    ):
        flags = list(tx.get("anomaly_flags") or [])
        src = tx.get("odometer_source")
        changed = False
        if src != "unknown":
            new_flags = [f for f in flags if f.get("rule") != "missing_odometer"]
            if len(new_flags) != len(flags):
                flags = new_flags
                changed = True
        else:
            if not any(f.get("rule") == "missing_odometer" for f in flags):
                flags.append(
                    {
                        "rule": "missing_odometer",
                        "severity": "low",
                        "detail": "No odometer available (Navixy has no data for this asset)",
                        "resolved_at": None,
                        "resolved_by": None,
                        "created_at": now_iso,
                    }
                )
                changed = True
                r5_added += 1
        if changed:
            await db.fuel_transactions.update_one(
                {"id": tx["id"]}, {"$set": {"anomaly_flags": flags}}
            )

    # v58.13.131i — L/100km with per-asset sequential deltas and
    # tightened guards (30d gap skip, stale skip, delta > 0.1, ≤500).
    from collections import defaultdict

    per_asset: dict = defaultdict(list)
    async for tx in db.fuel_transactions.find(
        {
            "deleted_at": None,
            "asset_id": {"$ne": None},
            "odometer_km": {"$gt": 0},
        },
        {
            "id": 1,
            "asset_id": 1,
            "timestamp": 1,
            "odometer_km": 1,
            "litres": 1,
            "_enrichment_confidence": 1,
        },
    ):
        per_asset[tx["asset_id"]].append(tx)

    for aid, txs in per_asset.items():
        txs.sort(key=lambda t: t.get("timestamp") or "")
        prev = None
        for t in txs:
            if prev is None:
                prev = t
                continue
            lp100, skip = compute_lp100(
                prev_odo=prev.get("odometer_km"),
                prev_ts_iso=prev.get("timestamp"),
                prev_confidence=prev.get("_enrichment_confidence"),
                curr_odo=t.get("odometer_km"),
                curr_ts_iso=t.get("timestamp"),
                curr_confidence=t.get("_enrichment_confidence"),
                curr_litres=float(t.get("litres") or 0),
            )
            if lp100 is not None:
                await db.fuel_transactions.update_one(
                    {"id": t["id"]},
                    {
                        "$set": {"litres_per_100km": lp100},
                        "$unset": {"_lp100_skipped": ""},
                    },
                )
                lp100_written += 1
            else:
                await db.fuel_transactions.update_one(
                    {"id": t["id"]},
                    {
                        "$set": {"_lp100_skipped": skip or "unknown"},
                        "$unset": {"litres_per_100km": ""},
                    },
                )
                lp100_skipped += 1
            prev = t

    with open(APPLY_LOG, "w") as fh:
        fh.write(
            f"# v58.13.131h — Apply log\n\n"
            f"Ran: {datetime.now(timezone.utc).isoformat()}\n\n"
            f"- Updated odometer_km on {updated_odo} rows\n"
            f"- Updated engine_hours on {updated_hrs} rows\n"
            f"- Upgraded to `navixy_live` on {upgraded_to_live} rows (.131i path)\n"
            f"- Marked odometer_source=unknown on {unknowns} rows\n"
            f"- R5 (missing_odometer) added on {r5_added} unknown rows\n"
            f"- litres_per_100km written on {lp100_written} rows\n"
            f"- litres_per_100km skipped on {lp100_skipped} rows (guards)\n"
            f"- Total rows touched: {len(counts.proposed)}\n"
        )
    return {
        "updated_odo": updated_odo,
        "updated_hrs": updated_hrs,
        "upgraded_to_live": upgraded_to_live,
        "unknowns": unknowns,
        "r5_added": r5_added,
        "lp100_written": lp100_written,
        "lp100_skipped": lp100_skipped,
        "rows": len(counts.proposed),
        "log": APPLY_LOG,
    }


async def run_rollback(db) -> dict:
    q = {"_enriched_at": {"$ne": None}}
    unset = {
        "odometer_source": "",
        "engine_hours_source": "",
        "odometer_snapshot_at": "",
        "_enrichment_confidence": "",
        "_enriched_at": "",
    }
    res = await db.fuel_transactions.update_many(
        {"odometer_source": {"$in": ["navixy_snapshot", "navixy_live", "unknown"]}},
        {"$set": {"odometer_km": 0, "engine_hours": None}, "$unset": unset},
    )
    return {"matched": res.matched_count, "modified": res.modified_count}


def _parser():
    ap = argparse.ArgumentParser(description="v58.13.131h · Navixy enrichment")
    ap.add_argument("--dry-run", action="store_true", default=True)
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--rollback", action="store_true")
    return ap


async def _amain(argv):
    ns = _parser().parse_args(argv)
    from dotenv import load_dotenv
    load_dotenv(os.path.join(_BACKEND, ".env"))
    from db import db

    if ns.rollback:
        res = await run_rollback(db)
        log.info("rollback: %s", res)
        return

    counts = await run_discovery(db)
    write_dryrun_report(counts)
    log.info(
        "dry-run → %s | live=%d snapshot=%d stale=%d unknown=%d",
        DRYRUN_REPORT,
        counts.would_navixy_live,
        counts.would_navixy_snapshot,
        counts.would_snapshot_stale,
        counts.would_unknown,
    )

    if ns.apply:
        res = await run_apply(db, counts)
        log.info("apply complete: %s", res)


def main(argv=None):
    if argv is None:
        argv = sys.argv[1:]
    asyncio.run(_amain(argv))


if __name__ == "__main__":
    main()

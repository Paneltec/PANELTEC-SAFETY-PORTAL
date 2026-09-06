"""v58.13.122b — plant_maintenance `latest_usage_reading` back-fill.

Parses historical free-text usage readings into the structured
`mileage_at_service` / `hours_at_service` fields introduced with the
Fleet Register rebuild (.121). Clears the "Grey / No Data" pills on
Fleet Register and gives accurate service-schedule health.

Modes:
  --dry-run   (default) — writes NOTHING to DB. Produces the diff
              report at `/app/memory/v58_13_122b_dryrun_diff.md`.
  --apply     — writes only `high` and `medium` confidence rows.
              Sets `mileage_at_service_backfilled=true` and/or
              `hours_at_service_backfilled=true` on each updated row.
              Writes the run log at
              `/app/memory/v58_13_122b_apply_log.md`.
  --rollback  — unsets `mileage_at_service` / `hours_at_service` on
              every row where the corresponding `_backfilled` flag is
              True. Idempotent.

The `--discover` step (default when no other flag is given) also
writes the pattern histogram to
`/app/memory/v58_13_122b_pattern_report.md`.

Notes:
  · The current DB has 689 rows with non-empty `latest_usage_reading`.
    ZERO of them contain an explicit unit token — every one is a bare
    formatted number (e.g. `"189,517.00"`). This means the asset-kind
    heuristic ("plant→hours, vehicle→km") fires on essentially every
    row. The parser still handles explicit-unit strings (`"142,350 km"`,
    `"3,215 hrs"`, `"142000 km / 3215 hrs"`, `kkm` typo…) so re-imports
    can benefit.
  · Trailers are treated as `km` (odometer via tow-vehicle).
  · `plant_maintenance.registration_no` → `assets.rego_serial` is the
    canonical join used to resolve `asset.kind`.
"""
from __future__ import annotations
import argparse
import asyncio
import logging
import os
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

# Ensure `backend` is importable when this script is run directly.
_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.abspath(os.path.join(_HERE, ".."))
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

log = logging.getLogger("paneltec.v58_13_122b")
logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")

MEMORY_DIR = "/app/memory"
PATTERN_REPORT = f"{MEMORY_DIR}/v58_13_122b_pattern_report.md"
DRYRUN_DIFF   = f"{MEMORY_DIR}/v58_13_122b_dryrun_diff.md"
APPLY_LOG     = f"{MEMORY_DIR}/v58_13_122b_apply_log.md"
MANUAL_OVERRIDES_FILE = os.path.join(_HERE, "v58_13_122b_manual_overrides.json")

# Rejection thresholds (spec).
MAX_KM = 2_000_000
MAX_HRS = 100_000

# Kinds treated as "hours" assets when using the kind heuristic.
HOURS_KINDS = {"plant"}
# Everything else (vehicle, trailer, unknown) → km via heuristic. But
# `unknown` is downgraded to `low` confidence and NOT written.
KM_KINDS = {"vehicle", "trailer"}


# ── Parser ─────────────────────────────────────────────────────
@dataclass
class ParseResult:
    km: Optional[int] = None
    hours: Optional[int] = None
    confidence: str = "low"        # high | medium | low
    reason: str = ""               # human-readable trace for reports
    kind_heuristic_used: bool = False


_KM_UNITS  = ("km", "kms", "kkm", "kilometres", "kilometers", "kilometer", "kilometre")
_HRS_UNITS = ("hrs", "hr", "hours", "hour", "h")


def _num(s: str) -> Optional[float]:
    """Strip commas + whitespace, parse as float, or return None."""
    if s is None: return None
    cleaned = s.replace(",", "").replace(" ", "").strip()
    if not cleaned:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def _plausible_km(v: Optional[float]) -> bool:
    return v is not None and 0 < v <= MAX_KM


def _plausible_hrs(v: Optional[float]) -> bool:
    return v is not None and 0 < v <= MAX_HRS


def _extract_units(raw: str) -> ParseResult:
    """Try to extract explicit-unit numbers from the string.

    Returns a ParseResult where `km` and/or `hours` may be set to
    integers, `confidence="high"`, and `reason` traces the tokens.
    """
    s = raw.strip().lower()
    r = ParseResult()

    # Whitespace-only separator format: "12,345 km 500 hrs".  We
    # normalise multiple separators (`/`, `&`, ` and `) to spaces
    # so a single regex sweep can pick up every unit-tagged number.
    normalised = re.sub(r"\band\b|[/&]", " ", s)
    normalised = re.sub(r"\s+", " ", normalised)

    # Regex: capture a number (with optional , or . separators) followed
    # by a unit token from the two lists.  `kkm` typo → treat as `km`.
    unit_alt = "|".join(sorted(_KM_UNITS + _HRS_UNITS, key=len, reverse=True))
    pat = re.compile(
        rf"([-+]?\d{{1,3}}(?:,\d{{3}})*(?:\.\d+)?|\d+(?:\.\d+)?)\s*({unit_alt})\b",
        re.IGNORECASE,
    )
    km_val: Optional[float] = None
    hrs_val: Optional[float] = None
    hits = []
    for m in pat.finditer(normalised):
        num_s, unit = m.group(1), m.group(2).lower()
        v = _num(num_s)
        if v is None:
            continue
        if unit in _KM_UNITS:
            km_val = v
            hits.append(f"km:{num_s}{unit}")
        elif unit in _HRS_UNITS:
            hrs_val = v
            hits.append(f"hrs:{num_s}{unit}")

    if _plausible_km(km_val):
        r.km = int(round(km_val))
    if _plausible_hrs(hrs_val):
        r.hours = int(round(hrs_val))
    if r.km is not None or r.hours is not None:
        # If one of them was rejected as implausible, note it.
        if km_val is not None and not _plausible_km(km_val):
            hits.append(f"km_rejected:{km_val}>{MAX_KM}")
        if hrs_val is not None and not _plausible_hrs(hrs_val):
            hits.append(f"hrs_rejected:{hrs_val}>{MAX_HRS}")
        r.confidence = "high"
        r.reason = "explicit_unit " + " ".join(hits)
        return r

    # Explicit-unit path found nothing plausible — but the string
    # DID contain a unit token that was rejected. Return low.
    if hits or km_val is not None or hrs_val is not None:
        r.confidence = "low"
        r.reason = "unit_token_implausible " + " ".join(hits)
        return r
    return r  # confidence still "low", reason empty — no unit tokens


def parse_reading(raw: str, *, asset_kind: Optional[str] = None) -> ParseResult:
    """Parse a `latest_usage_reading` free-text string.

    Returns:
        ParseResult with (km, hours, confidence, reason). Writers must
        only persist `high` and `medium` confidence rows.
    """
    if raw is None:
        return ParseResult(reason="null")
    s = str(raw).strip()
    if not s:
        return ParseResult(reason="empty")

    # 1. Explicit unit tokens win.
    r = _extract_units(s)
    if r.confidence == "high":
        return r
    if r.reason.startswith("unit_token_implausible"):
        return r  # low, don't fall through to heuristic

    # 2. Bare number path — use asset-kind heuristic.
    #    Some historical rows use `/` or ` and ` or `&` to join two
    #    bare numbers. Split on those; if we get exactly two bare
    #    numbers AND the asset is a vehicle, treat "km / hours".
    parts = [p.strip() for p in re.split(r"[/&]|\band\b", s, flags=re.IGNORECASE) if p.strip()]
    parts_num = [_num(p) for p in parts]

    if len(parts_num) == 2 and all(v is not None for v in parts_num) and asset_kind == "vehicle":
        km_v, hrs_v = parts_num
        km_ok = _plausible_km(km_v)
        hrs_ok = _plausible_hrs(hrs_v)
        if km_ok or hrs_ok:
            r = ParseResult()
            if km_ok:  r.km = int(round(km_v))
            if hrs_ok: r.hours = int(round(hrs_v))
            r.confidence = "medium"
            r.reason = f"vehicle_two_bare km={km_v} hrs={hrs_v}"
            r.kind_heuristic_used = True
            return r

    # Otherwise: single bare number (or > 2 parts – bail).
    if len(parts_num) != 1 or parts_num[0] is None:
        return ParseResult(reason=f"ambiguous_parts={parts!r}")

    v = parts_num[0]
    if asset_kind in HOURS_KINDS:
        if _plausible_hrs(v):
            return ParseResult(
                hours=int(round(v)), confidence="medium",
                reason=f"bare_hrs kind={asset_kind}", kind_heuristic_used=True,
            )
        return ParseResult(
            reason=f"bare_implausible_hrs kind={asset_kind} v={v}",
        )
    if asset_kind in KM_KINDS:
        if _plausible_km(v):
            return ParseResult(
                km=int(round(v)), confidence="medium",
                reason=f"bare_km kind={asset_kind}", kind_heuristic_used=True,
            )
        return ParseResult(
            reason=f"bare_implausible_km kind={asset_kind} v={v}",
        )

    # asset_kind unknown/None → we CANNOT resolve. Low confidence.
    return ParseResult(
        reason=f"bare_no_kind v={v}",
    )


# ── Discovery + migration runner ───────────────────────────────
@dataclass
class RunCounts:
    scanned: int = 0
    parseable_km: int = 0
    parseable_hrs: int = 0
    parseable_both: int = 0
    unparseable: int = 0
    would_write_km_only: int = 0
    would_write_hrs_only: int = 0
    would_write_both: int = 0
    would_skip_low: int = 0
    would_skip_implausible: int = 0
    kind_heuristic_hits: int = 0
    kind_map: dict = field(default_factory=lambda: {"plant": 0, "vehicle": 0, "trailer": 0, "unknown": 0})
    pattern_hist: dict = field(default_factory=dict)
    samples_unparseable: list = field(default_factory=list)
    proposed_rows: list = field(default_factory=list)  # for dry-run diff


async def _load_asset_kind_by_rego(db) -> dict:
    """Return a `{rego_serial: kind}` map for O(1) lookups."""
    out = {}
    async for a in db.assets.find(
        {"kind": {"$in": ["plant", "vehicle", "trailer"]}},
        {"rego_serial": 1, "kind": 1},
    ):
        rego = (a.get("rego_serial") or "").strip()
        if rego:
            out[rego] = a["kind"]
    return out


async def run_discovery(db) -> RunCounts:
    """Read-only pass — builds the RunCounts and the proposed_rows list."""
    counts = RunCounts()
    kind_by_rego = await _load_asset_kind_by_rego(db)
    q = {"latest_usage_reading": {"$type": "string", "$ne": ""}}
    async for pm in db.plant_maintenance.find(q, {
        "id": 1, "_id": 1, "latest_usage_reading": 1, "registration_no": 1,
        "mileage_at_service": 1, "hours_at_service": 1, "date_completed": 1,
    }):
        counts.scanned += 1
        raw = (pm.get("latest_usage_reading") or "").strip()
        counts.pattern_hist[raw] = counts.pattern_hist.get(raw, 0) + 1

        rego = (pm.get("registration_no") or "").strip()
        kind = kind_by_rego.get(rego)
        counts.kind_map[kind or "unknown"] = counts.kind_map.get(kind or "unknown", 0) + 1

        r = parse_reading(raw, asset_kind=kind)
        if r.kind_heuristic_used:
            counts.kind_heuristic_hits += 1
        if r.km is not None: counts.parseable_km += 1
        if r.hours is not None: counts.parseable_hrs += 1
        if r.km is not None and r.hours is not None: counts.parseable_both += 1
        if r.km is None and r.hours is None:
            counts.unparseable += 1
            if len(counts.samples_unparseable) < 20:
                counts.samples_unparseable.append({
                    "_id": str(pm.get("_id") or pm.get("id")),
                    "reading": raw,
                    "kind": kind,
                    "reason": r.reason,
                })

        # Determine whether we WOULD write on --apply.
        current_km = pm.get("mileage_at_service")
        current_hrs = pm.get("hours_at_service")
        would_write_km  = r.km is not None and current_km in (None, 0) and r.confidence in ("high", "medium")
        would_write_hrs = r.hours is not None and current_hrs in (None, 0) and r.confidence in ("high", "medium")

        # v58.13.122b — Counter semantics:
        #   `would_skip_implausible` — the parser saw a number that
        #      failed the plausibility gate (>2M km / >100k hrs).
        #   `would_skip_low` — every other low-confidence outcome that
        #      wasn't a trivially empty string (e.g. bare number
        #      without asset-kind context, ambiguous multi-part).
        if r.reason.startswith("bare_implausible") or r.reason.startswith("unit_token_implausible"):
            counts.would_skip_implausible += 1
        elif r.confidence == "low" and r.reason not in ("", "empty", "null"):
            counts.would_skip_low += 1

        if would_write_km and would_write_hrs:
            counts.would_write_both += 1
        elif would_write_km:
            counts.would_write_km_only += 1
        elif would_write_hrs:
            counts.would_write_hrs_only += 1

        if would_write_km or would_write_hrs:
            counts.proposed_rows.append({
                "_id": str(pm.get("_id") or pm.get("id")),
                "id": pm.get("id"),
                "rego": rego,
                "kind": kind,
                "reading": raw,
                "current_km": current_km,
                "current_hrs": current_hrs,
                "proposed_km": r.km if would_write_km else None,
                "proposed_hrs": r.hours if would_write_hrs else None,
                "confidence": r.confidence,
                "reason": r.reason,
            })
    return counts


def write_pattern_report(counts: RunCounts) -> str:
    lines = []
    lines.append("# v58.13.122b — Pattern discovery report\n")
    lines.append(f"Generated: {datetime.now(timezone.utc).isoformat()}\n")
    lines.append("## Overview\n")
    lines.append(f"- Total rows scanned: **{counts.scanned}**")
    lines.append(f"- Parseable KM: **{counts.parseable_km}**")
    lines.append(f"- Parseable hours: **{counts.parseable_hrs}**")
    lines.append(f"- Both extractable: **{counts.parseable_both}**")
    lines.append(f"- Unparseable: **{counts.unparseable}**")
    lines.append(f"- Asset-kind heuristic fired on: **{counts.kind_heuristic_hits}** rows\n")
    lines.append("## Asset kind distribution (via `registration_no` → `assets.rego_serial`)\n")
    for k, v in counts.kind_map.items():
        lines.append(f"- `{k}`: {v}")
    lines.append("")
    lines.append("## Top-30 `latest_usage_reading` strings\n")
    lines.append("| # | Count | Reading |")
    lines.append("|---|-------|---------|")
    top = sorted(counts.pattern_hist.items(), key=lambda kv: -kv[1])[:30]
    for i, (s, n) in enumerate(top, 1):
        # Escape pipes just in case
        safe = s.replace("|", "\\|")
        lines.append(f"| {i} | {n} | `{safe}` |")
    lines.append("")
    lines.append("## Unparseable samples (up to 20)\n")
    if not counts.samples_unparseable:
        lines.append("- ✅ None — every non-empty string produced at least one value.")
    else:
        lines.append("| _id | Reading | Kind | Reason |")
        lines.append("|-----|---------|------|--------|")
        for s in counts.samples_unparseable:
            r = s["reading"].replace("|", "\\|")
            reason = s["reason"].replace("|", "\\|")
            lines.append(f"| `{s['_id']}` | `{r}` | {s['kind']} | {reason} |")
    lines.append("")
    with open(PATTERN_REPORT, "w") as fh:
        fh.write("\n".join(lines))
    return PATTERN_REPORT


def write_dryrun_diff(counts: RunCounts) -> str:
    lines = []
    lines.append("# v58.13.122b — Dry-run diff report\n")
    lines.append(f"Generated: {datetime.now(timezone.utc).isoformat()}\n")
    lines.append("**No writes performed.** Re-run with `--apply` after the user green-lights this diff.\n")
    lines.append("## Would-write counts\n")
    lines.append(f"- Would write **km only**: {counts.would_write_km_only}")
    lines.append(f"- Would write **hours only**: {counts.would_write_hrs_only}")
    lines.append(f"- Would write **both**: {counts.would_write_both}")
    lines.append(f"- Would **skip · low confidence** (parseable but ambiguous): {counts.would_skip_low}")
    lines.append(f"- Would **skip · implausible** (>{MAX_KM:,} km / >{MAX_HRS:,} hrs): {counts.would_skip_implausible}")
    lines.append(f"- Would touch **{len(counts.proposed_rows)} rows** total.\n")
    lines.append("## First 50 proposed rows\n")
    lines.append("| _id | rego | kind | reading | current_km | current_hrs | → km | → hrs | conf | reason |")
    lines.append("|-----|------|------|---------|-----------:|------------:|-----:|------:|:----:|--------|")
    for row in counts.proposed_rows[:50]:
        lines.append(
            f"| `{row['_id'][:8]}…` | {row['rego']} | {row['kind']} | `{row['reading']}` | "
            f"{row['current_km'] or '—'} | {row['current_hrs'] or '—'} | "
            f"{row['proposed_km'] or '—'} | {row['proposed_hrs'] or '—'} | "
            f"{row['confidence']} | {row['reason']} |"
        )
    if len(counts.proposed_rows) > 50:
        lines.append(f"\n_(+ {len(counts.proposed_rows) - 50} more rows omitted for brevity — full log lands in `apply_log.md`.)_")
    lines.append("")
    with open(DRYRUN_DIFF, "w") as fh:
        fh.write("\n".join(lines))
    return DRYRUN_DIFF


async def run_apply(db, counts: RunCounts) -> dict:
    """Persist `high` and `medium` confidence rows and audit.

    After the bulk pass, applies any user-confirmed manual overrides
    from `v58_13_122b_manual_overrides.json` (see spec — H01PZ
    historical value was a decimal-place error).
    """
    now = datetime.now(timezone.utc).isoformat()
    updated_km = 0
    updated_hrs = 0
    override_writes = 0
    lines = []
    lines.append("# v58.13.122b — Apply run log\n")
    lines.append(f"Started: {now}\n")
    lines.append("## Bulk back-fill\n")
    lines.append("| _id | rego | kind | reading | wrote_km | wrote_hrs | conf | timestamp |")
    lines.append("|-----|------|------|---------|---------:|----------:|:----:|-----------|")
    for row in counts.proposed_rows:
        upd: dict = {"updated_at": now}
        if row["proposed_km"] is not None:
            upd["mileage_at_service"] = float(row["proposed_km"])
            upd["mileage_at_service_backfilled"] = True
            upd["mileage_at_service_backfill_source"] = row["reading"]
            updated_km += 1
        if row["proposed_hrs"] is not None:
            upd["hours_at_service"] = float(row["proposed_hrs"])
            upd["hours_at_service_backfilled"] = True
            upd["hours_at_service_backfill_source"] = row["reading"]
            updated_hrs += 1
        if len(upd) == 1:  # only updated_at set — nothing to write
            continue
        # Prefer canonical `id` when present; fall back to `_id`.
        match = {"id": row["id"]} if row.get("id") else {"_id": row["_id"]}
        await db.plant_maintenance.update_one(match, {"$set": upd})
        lines.append(
            f"| `{row['_id'][:8]}…` | {row['rego']} | {row['kind']} | `{row['reading']}` | "
            f"{row['proposed_km'] or '—'} | {row['proposed_hrs'] or '—'} | "
            f"{row['confidence']} | {now} |"
        )

    # ── Manual overrides ────────────────────────────────────────
    overrides = _load_manual_overrides()
    lines.append(f"\n## Manual overrides ({len(overrides)} rego(s))\n")
    if not overrides:
        lines.append("_(no overrides configured)_\n")
    else:
        lines.append("| rego | kind | value | rows_touched | reason |")
        lines.append("|------|------|------:|-------------:|--------|")
        for rego, spec in overrides.items():
            kind = (spec.get("kind") or "").lower()
            val = spec.get("value")
            reason = spec.get("reason") or ""
            if kind not in ("km", "hours") or not isinstance(val, (int, float)):
                lines.append(f"| {rego} | {kind or '—'} | {val} | 0 | SKIPPED · invalid spec |")
                continue
            fld = "mileage_at_service" if kind == "km" else "hours_at_service"
            upd = {
                fld: float(val),
                f"{fld}_backfilled": True,
                f"{fld}_backfill_source": "manual_override",
                f"{fld}_backfill_reason": reason,
                # v58.13.122b — override marker + reason. Powers the
                # "Reading corrected" pill on FleetRegister.
                "_backfill_manual_override": True,
                "_backfill_manual_reason": reason,
                "updated_at": now,
            }
            res = await db.plant_maintenance.update_many(
                {"registration_no": rego, "deleted_at": None},
                {"$set": upd},
            )
            override_writes += res.modified_count
            if kind == "km":
                updated_km += res.modified_count
            else:
                updated_hrs += res.modified_count
            lines.append(f"| {rego} | {kind} | {val} | {res.modified_count} | {reason} |")

    lines.append(f"\n**Total km fields written:** {updated_km}")
    lines.append(f"**Total hours fields written:** {updated_hrs}")
    lines.append(f"**Total bulk rows touched:** {len(counts.proposed_rows)}")
    lines.append(f"**Total override rows written:** {override_writes}")
    lines.append(f"\nFinished: {datetime.now(timezone.utc).isoformat()}")
    with open(APPLY_LOG, "w") as fh:
        fh.write("\n".join(lines))
    return {"updated_km": updated_km, "updated_hrs": updated_hrs,
            "rows": len(counts.proposed_rows),
            "override_writes": override_writes,
            "log": APPLY_LOG}


def _load_manual_overrides() -> dict:
    """Load the manual-override JSON. Missing file → empty dict (not
    an error). Corrupt JSON is a hard error so the operator notices."""
    import json
    if not os.path.exists(MANUAL_OVERRIDES_FILE):
        log.info("no manual overrides file at %s — skipping override pass",
                 MANUAL_OVERRIDES_FILE)
        return {}
    with open(MANUAL_OVERRIDES_FILE, "r") as fh:
        return json.load(fh)


async def run_rollback(db) -> dict:
    """Idempotent rollback: unset backfilled fields (bulk + override)."""
    q = {"$or": [
        {"mileage_at_service_backfilled": True},
        {"hours_at_service_backfilled": True},
        {"_backfill_manual_override": True},
    ]}
    unset = {
        "mileage_at_service": "",
        "hours_at_service": "",
        "mileage_at_service_backfilled": "",
        "hours_at_service_backfilled": "",
        "mileage_at_service_backfill_source": "",
        "hours_at_service_backfill_source": "",
        "mileage_at_service_backfill_reason": "",
        "hours_at_service_backfill_reason": "",
        "_backfill_manual_override": "",
        "_backfill_manual_reason": "",
    }
    res = await db.plant_maintenance.update_many(q, {"$unset": unset})
    return {"matched": res.matched_count, "modified": res.modified_count}


# ── CLI entrypoint ─────────────────────────────────────────────
def _parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description="v58.13.122b · plant_maintenance reading back-fill")
    ap.add_argument("--dry-run", action="store_true", default=True, help="(default) read-only")
    ap.add_argument("--apply", action="store_true", help="write high/medium confidence rows")
    ap.add_argument("--rollback", action="store_true", help="unset every backfilled field")
    return ap


async def _amain(argv):
    ns = _parser().parse_args(argv)
    from dotenv import load_dotenv
    load_dotenv(os.path.join(_BACKEND, ".env"))
    from db import db  # imports after env loaded

    if ns.rollback:
        res = await run_rollback(db)
        log.info("rollback: matched=%d modified=%d", res["matched"], res["modified"])
        return

    counts = await run_discovery(db)
    write_pattern_report(counts)
    log.info("pattern report → %s", PATTERN_REPORT)

    if ns.apply:
        res = await run_apply(db, counts)
        log.info("apply complete: %s", res)
        return

    # Default: dry-run diff.
    write_dryrun_diff(counts)
    log.info("dry-run diff → %s", DRYRUN_DIFF)
    log.info(
        "would write · km_only=%d hrs_only=%d both=%d · skip_low=%d skip_implausible=%d",
        counts.would_write_km_only, counts.would_write_hrs_only,
        counts.would_write_both, counts.would_skip_low, counts.would_skip_implausible,
    )


def main(argv=None):
    if argv is None:
        argv = sys.argv[1:]
    asyncio.run(_amain(argv))


if __name__ == "__main__":
    main()

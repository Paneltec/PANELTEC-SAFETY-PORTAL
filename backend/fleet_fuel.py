"""v58.13.131b — SmartFill Fuel CSV Importer (backend only).

Confirmed schema per user's Portal Transaction-detail screenshot.
See `/app/memory/smartfill_discovery_v58_13_131.md` (`.131b addendum`).

Endpoints (all `/api/fleet/fuel/*`, guarded by
`FLEET_REGISTER_ENABLED` + existing `assets.view` / `assets.edit`):

  · POST   /fleet/fuel/import-csv
  · GET    /fleet/fuel/batches
  · GET    /fleet/fuel/batches/{id}
  · DELETE /fleet/fuel/batches/{id}
  · GET    /fleet/fuel/transactions
  · GET    /fleet/fuel/anomalies
  · POST   /fleet/fuel/anomalies/{txn_id}/resolve
  · POST   /fleet/fuel/anomalies/{txn_id}/dismiss
  · POST   /fleet/fuel/transactions/{txn_id}/match
  · GET    /fleet/fuel/stats
  · GET    /fleet/assets/{asset_id}/fuel
  · GET    /fleet/fuel/export

Dedupe:
  · Primary: `transaction_id` UNIQUE.
  · Fallback (txn_id missing): `(key_code, timestamp, litres)`.

Match order (per row):
  1. key_code    → assets.smartfill_key_code
  2. card_number → assets.smartfill_card_number
  3. registration→ assets.rego_serial  (case-insensitive)
  4. Fuzzy description → assets.name   (difflib 0.85)
  5. Else unmatched.

Anomaly rules (evaluated on-insert, per-row post-match):
  · R1 unusual_hour       — local hour outside [05:00, 19:00). LOW.
  · R2 capacity_exceed    — litres > cap × 1.10. HIGH.
  · R3 stat_spike         — μ + 2σ vs last 20 fills, activate at ≥ 5 prior. MEDIUM.
  · R4 reading_regress    — odometer OR engine_hours below last known. MEDIUM.
  · R5 missing_odometer   — odometer==0 AND asset has prior >0 reading. LOW.
  · R6 unit_mismatch      — Units column != "Litres" → HARD-REJECT (not a flag).

Never emails/SMS. Inbox-only. No cron.
"""
from __future__ import annotations
import csv
import difflib
import hashlib
import io
import logging
import re
import statistics
from datetime import datetime, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from permissions import require_permission
from db import db
from models import new_id, now_iso
from fleet import require_fleet_register_enabled

log = logging.getLogger("paneltec.fuel")

router = APIRouter(prefix="/fleet/fuel", tags=["fleet-fuel"])
asset_router = APIRouter(prefix="/fleet/assets", tags=["fleet-fuel"])

_DEFAULT_TZ = "Australia/Brisbane"
_HOUR_WINDOW = range(5, 19)
_ROLLING_WINDOW = 20
_ROLLING_MIN_PRIOR = 5
_FUZZY_CUTOFF = 0.85

# Canonical field → CSV header aliases. Normaliser strips non-alnum
# + lowercases before comparing, so "Transaction Id", "TransactionID",
# "TRANS_ID", "trans-id" all resolve to the same key.
_COLUMN_ALIASES: dict[str, tuple[str, ...]] = {
    "transaction_id": ("transactionid", "transid", "transactionnumber", "txnid"),
    "date":           ("date",),
    "time":           ("time",),
    "datetime":       ("datetime", "timestamp"),
    "key_code":       ("keycode", "keyorcode", "key", "code", "fobcode"),
    "card_number":    ("cardnumber", "card"),
    "description":    ("description", "vehicle", "name"),
    "registration":   ("registration", "rego", "regoserial"),
    "location":       ("from", "site", "location", "depot", "fromsite"),
    "litres":         ("litres", "liters", "quantity", "qty", "volume"),
    "units":          ("units", "unit"),
    "fuel_type":      ("fueltype", "fuel"),
    "pump":           ("pump",),
    "odometer_km":    ("odometer", "odometerkm", "odo", "km"),
    "engine_hours":   ("enginehours", "hours"),
    "driver":         ("driver", "drivername"),
    "total_price":    ("totalprice", "price", "cost", "total",
                       # v58.13.131g — real-world CSV alias expansion.
                       "amount", "value", "$"),
}
_ALL_ALIASES = {a for al in _COLUMN_ALIASES.values() for a in al} | {"actions"}


# ── Utilities ────────────────────────────────────────────────────
def _norm_header(h: str) -> str:
    """Lowercase + strip non-alnum. `Transaction Id` → `transactionid`."""
    return re.sub(r"[^a-z0-9]", "", (h or "").lower())


def _map_headers(fieldnames: list[str]) -> tuple[dict, list[str]]:
    normed: dict[str, str] = {_norm_header(f): f for f in fieldnames}
    mapping: dict = {}
    for canon, aliases in _COLUMN_ALIASES.items():
        for a in aliases:
            if a in normed:
                mapping[canon] = normed[a]
                break
    ignored = [f for f in fieldnames if _norm_header(f) not in _ALL_ALIASES]
    return mapping, ignored


def _parse_date(raw: str) -> Optional[str]:
    raw = (raw or "").strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(raw, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def _parse_time(raw: str) -> Optional[str]:
    raw = (raw or "").strip()
    for fmt in ("%H:%M:%S", "%H:%M", "%I:%M:%S %p", "%I:%M %p"):
        try:
            return datetime.strptime(raw, fmt).strftime("%H:%M:%S")
        except ValueError:
            continue
    return None


def _parse_datetime(raw: str) -> Optional[tuple[str, str]]:
    """Combined `Date/Time` field parser — returns `(date_iso, time_local)`."""
    raw = (raw or "").strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S",
                "%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M",
                "%Y-%m-%d %H:%M"):
        try:
            dt = datetime.strptime(raw, fmt)
            return dt.strftime("%Y-%m-%d"), dt.strftime("%H:%M:%S")
        except ValueError:
            continue
    return None


def _local_to_utc(date_iso: str, time_local: str, tz_name: str) -> Optional[datetime]:
    try:
        naive = datetime.strptime(f"{date_iso} {time_local}", "%Y-%m-%d %H:%M:%S")
        return naive.replace(tzinfo=ZoneInfo(tz_name)).astimezone(timezone.utc)
    except (ValueError, KeyError):
        return None


def _parse_float(raw: str) -> Optional[float]:
    try:
        return float((raw or "").strip().replace(",", ""))
    except (ValueError, AttributeError):
        return None


def _parse_int(raw: str) -> Optional[int]:
    raw = (raw or "").strip()
    if not raw:
        return None
    try:
        return int(float(raw.replace(",", "")))
    except (ValueError, AttributeError):
        return None


def _sniff_dialect(text: str) -> str:
    sample = text[:4096]
    try:
        return csv.Sniffer().sniff(sample, delimiters=",;\t|").delimiter
    except csv.Error:
        # Heuristic fallback: pick delimiter with highest count on line 1.
        first = sample.splitlines()[0] if sample else ""
        return max([",", ";", "\t", "|"], key=first.count)


def _row_hash(row: dict) -> str:
    canon = "|".join(f"{k}={row[k]}" for k in sorted(row))
    return hashlib.sha256(canon.encode("utf-8")).hexdigest()


# ── Vehicle matching ────────────────────────────────────────────
async def _resolve_asset(
    *, org_id: str, key_code: str, card_number: str, registration: str,
    description: str, _asset_cache: Optional[list[dict]] = None,
) -> tuple[Optional[str], str]:
    """Returns `(asset_id, match_status)`. match_status is `matched`
    or `unmatched`. Manual overrides use `manual` via the /match endpoint."""
    # 1. key_code
    if key_code:
        a = await db.assets.find_one(
            {"org_id": org_id, "smartfill_key_code": key_code}, {"id": 1},
        )
        if a:
            return a["id"], "matched"

    # 2. card_number
    if card_number:
        a = await db.assets.find_one(
            {"org_id": org_id, "smartfill_card_number": card_number}, {"id": 1},
        )
        if a:
            return a["id"], "matched"

    # 3. registration
    if registration:
        a = await db.assets.find_one(
            {"org_id": org_id, "rego_serial": registration.strip().upper()}, {"id": 1},
        )
        if a:
            return a["id"], "matched"

    # 4. Fuzzy on description.
    if description:
        if _asset_cache is None:
            _asset_cache = [
                d async for d in db.assets.find(
                    {"org_id": org_id, "name": {"$ne": None}},
                    {"id": 1, "name": 1},
                )
            ]
        names = [a.get("name") or "" for a in _asset_cache]
        matches = difflib.get_close_matches(description, names, n=1, cutoff=_FUZZY_CUTOFF)
        if matches:
            for a in _asset_cache:
                if a.get("name") == matches[0]:
                    return a["id"], "matched"

    return None, "unmatched"


# ── Anomaly detection ───────────────────────────────────────────
# v58.13.131g — Rule set is now conditional per batch and per org.
# `_ALL_RULES` names every rule the detector CAN emit; `_evaluate_
# anomalies` accepts an `enabled` set so the caller can suppress
# specific rules for this batch (odometerless fleet) or globally
# (`org_settings.fleet_tracks_odometers=False`).
_ALL_RULES = {"unusual_hour", "capacity_exceed", "stat_spike",
              "reading_regress", "missing_odometer"}
_ODOMETER_RULES = {"reading_regress", "missing_odometer"}  # R4 + R5


def _compose_dedupe_hash(
    *, card_number: str, key_code: str, registration: str,
    timestamp: str, litres: float,
) -> Optional[str]:
    """v58.13.131g — SHA256 composite hash for dedupe when
    `transaction_id` is absent. Real-world SmartFill exports without
    txn_id use `(card|key|rego, timestamp, litres)` as a natural key.

    Returns None only if all three identifier fields are blank AND
    there's therefore nothing meaningful to hash — the row will have
    already been rejected upstream in that case.
    """
    import hashlib
    key = (card_number or "").strip() or (key_code or "").strip() or (registration or "").strip().upper()
    if not key:
        return None
    payload = f"{key}|{timestamp}|{litres:.3f}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


async def _fleet_tracks_odometers(org_id: str) -> bool:
    """v58.13.131g — Deprecated stub. Original .131g brief called
    for an org-scoped toggle; the amendment replaced that with per-
    row Navixy enrichment (shipping in .131h). Kept as a stub so
    existing callers/tests don't crash; always returns True (i.e.
    fleet DOES track odometers, just not via the SmartFill CSV).
    """
    return True


async def _evaluate_anomalies(
    *, org_id: str, asset_id: Optional[str], litres: float,
    filled_at_utc: str, local_tz: str,
    odometer_km: Optional[int], engine_hours: Optional[float],
    enabled_rules: Optional[set] = None,
    odometer_source: Optional[str] = None,
) -> list[dict]:
    """Return list of `{rule, severity, detail, resolved_at, resolved_by}`.

    `enabled_rules` gates which rule paths run. `None` = every rule."""
    flags: list[dict] = []
    now = now_iso()
    enabled = enabled_rules if enabled_rules is not None else _ALL_RULES

    def _flag(rule: str, severity: str, detail: str):
        if rule not in enabled:
            return
        flags.append({
            "rule": rule, "severity": severity, "detail": detail,
            "resolved_at": None, "resolved_by": None, "created_at": now,
        })

    # R1 unusual_hour.
    try:
        dt_utc = datetime.fromisoformat(filled_at_utc.replace("Z", "+00:00"))
        local = dt_utc.astimezone(ZoneInfo(local_tz))
        if local.hour not in _HOUR_WINDOW:
            _flag("unusual_hour", "low",
                  f"Fill at local hour {local.hour:02d} (expected 05–18)")
    except (ValueError, KeyError):
        pass

    if not asset_id:
        return flags

    asset = await db.assets.find_one(
        {"id": asset_id, "org_id": org_id},
        {"fuel_tank_capacity_l": 1, "odo_km": 1, "hours_meter": 1},
    ) or {}

    # R2 capacity_exceed.
    cap = asset.get("fuel_tank_capacity_l")
    if cap:
        try:
            threshold = float(cap) * 1.10
            if litres > threshold:
                _flag("capacity_exceed", "high",
                      f"{litres:.3f}L > {threshold:.2f}L (cap {cap}L × 1.10)")
        except (TypeError, ValueError):
            pass

    # R3 stat_spike — last 20 fills for this asset.
    try:
        cursor = (db.fuel_transactions
                  .find({"org_id": org_id, "asset_id": asset_id, "deleted_at": None},
                        {"litres": 1})
                  .sort("timestamp", -1)
                  .limit(_ROLLING_WINDOW))
        samples = [d["litres"] async for d in cursor if d.get("litres") is not None]
        if len(samples) >= _ROLLING_MIN_PRIOR:
            mu = statistics.mean(samples)
            sigma = statistics.stdev(samples) if len(samples) >= 2 else 0.0
            threshold = mu + 2 * sigma
            if sigma > 0 and litres > threshold:
                _flag("stat_spike", "medium",
                      f"{litres:.3f}L > μ+2σ ({threshold:.2f}L, n={len(samples)})")
    except statistics.StatisticsError:
        pass

    # R4 reading_regress.
    if odometer_km is not None and odometer_km > 0:
        prev_odo = asset.get("odo_km")
        if prev_odo is not None and prev_odo > 0 and odometer_km < int(prev_odo):
            _flag("reading_regress", "medium",
                  f"odo {odometer_km}km < last known {int(prev_odo)}km")
    if engine_hours is not None:
        prev_h = asset.get("hours_meter")
        if prev_h is not None and engine_hours < float(prev_h):
            _flag("reading_regress", "medium",
                  f"hours {engine_hours}h < last known {float(prev_h):.1f}h")

    # R5 missing_odometer — v58.13.131i fires when Navixy has no odo
    # for this asset (`odometer_source == "unknown"`), matching how the
    # `.131h` migration flags rows. Falls back to legacy odo==0 check.
    if odometer_source == "unknown":
        _flag("missing_odometer", "low",
              "No odometer available (Navixy has no data for this asset)")
    elif odometer_km == 0:
        prev_odo = asset.get("odo_km")
        if prev_odo is not None and int(prev_odo) > 0:
            _flag("missing_odometer", "low",
                  f"Odometer reported as 0 but asset last known at {int(prev_odo)}km")

    return flags


# ── CSV import ──────────────────────────────────────────────────
class ImportResult(BaseModel):
    batch_id: str
    rows_total: int
    rows_inserted: int
    rows_duplicate: int
    rows_unmatched: int
    rows_anomalous: int
    rows_rejected: int
    unmatched_regos: list[str]
    header_warnings: list[str]
    errors: list[dict]


async def _import_csv(
    *, content: bytes, filename: str, org_id: str,
    workspace_id: Optional[str], user_id: str,
    local_tz: str = _DEFAULT_TZ,
) -> ImportResult:
    text = content.decode("utf-8-sig", errors="replace")
    delimiter = _sniff_dialect(text)
    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
    fieldnames = reader.fieldnames or []
    mapping, ignored = _map_headers(fieldnames)

    header_warnings: list[str] = []
    if ignored:
        header_warnings.append(f"Ignored columns: {ignored}")

    # Must have (transaction_id OR (date AND time) OR datetime) + litres.
    # v58.13.131g — At-least-one-identifier requirement dropped at the
    # HEADER level; missing identifiers are enforced row-by-row (with
    # description-fallback for unmatched cases).
    has_ts = ("transaction_id" in mapping
              or "datetime" in mapping
              or ("date" in mapping and "time" in mapping))
    if not has_ts:
        raise HTTPException(status_code=400,
                            detail="CSV must have Date+Time OR Datetime OR Transaction Id column")
    if "litres" not in mapping:
        raise HTTPException(status_code=400,
                            detail="CSV missing required column: Litres")

    # ── v58.13.131g — Peek at every data row so the pre-loop can
    # decide which rules to suppress for this batch. This is one
    # linear scan of the CSV in memory; the main loop rewinds and
    # re-parses via a fresh iterator.
    peek_reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
    peek_rows = list(peek_reader)
    total_data_rows = len(peek_rows)
    price_col = mapping.get("total_price")
    odo_col = mapping.get("odometer_km")
    price_rows = 0
    zero_odo_rows = 0
    for row in peek_rows:
        if price_col and _parse_float(row.get(price_col, "")) not in (None, 0):
            price_rows += 1
        if odo_col:
            odo_val = _parse_int(row.get(odo_col, ""))
            if odo_val == 0 or odo_val is None:
                zero_odo_rows += 1
        else:
            zero_odo_rows += 1
    price_coverage_pct = (
        round(100.0 * price_rows / total_data_rows, 2)
        if total_data_rows else 0.0
    )
    zero_odo_pct = (
        (100.0 * zero_odo_rows / total_data_rows)
        if total_data_rows else 100.0
    )

    # Rule enablement — v58.13.131h removed the .131g interim R4/R5
    # auto-suppress. R5 now fires per-row when Navixy enrichment
    # returns `odometer_source == "unknown"` (see enrichment path
    # below). R4 runs against enriched values.
    enabled_rules = set(_ALL_RULES)
    rules_suppressed: list[dict] = []

    # R7 (procurement_outlier) still needs ≥3 priced rows this month.
    r7_will_skip = price_rows < 3
    if r7_will_skip:
        rules_suppressed.append({
            "rules": ["procurement_outlier"],
            "reason": "No price data on ≥3 rows this batch — R7 has no math.",
            "scope": "batch",
        })

    batch_id = new_id()
    inserted = duplicate = unmatched = anomalous = rejected = 0
    unmatched_set: set[str] = set()
    errors: list[dict] = []
    preview_sample: list[dict] = []

    _asset_cache = [
        d async for d in db.assets.find(
            {"org_id": org_id, "name": {"$ne": None}},
            {"id": 1, "name": 1},
        )
    ]

    # v58.13.131i — Preload Navixy asset snapshots once so each row's
    # enrichment call is O(1) against the in-memory dict. `.131h`
    # ship memo item #6 claimed this was wired but wasn't — this is
    # the actual wire-up.
    from fleet_fuel_enrich import enrich_fill, load_asset_snapshots
    _asset_snapshots = await load_asset_snapshots(db)

    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)

    for row_num, raw_row in enumerate(reader, start=2):
        try:
            if len(preview_sample) < 5:
                preview_sample.append(dict(raw_row))

            # ── R6 unit_mismatch — hard-reject before any other work.
            units_raw = (raw_row.get(mapping.get("units", ""), "") or "").strip()
            if units_raw and units_raw.lower() not in ("litres", "liters", "l"):
                rejected += 1
                errors.append({
                    "row": row_num,
                    "error": f"R6 unit_mismatch: Units='{units_raw}' (expected Litres)",
                })
                continue

            # Datetime — prefer combined `datetime` column, else Date+Time.
            date_iso: Optional[str] = None
            time_local: Optional[str] = None
            if "datetime" in mapping:
                pair = _parse_datetime(raw_row.get(mapping["datetime"], ""))
                if pair:
                    date_iso, time_local = pair
            if date_iso is None:
                date_iso = _parse_date(raw_row.get(mapping.get("date", ""), ""))
                time_local = _parse_time(raw_row.get(mapping.get("time", ""), ""))

            litres = _parse_float(raw_row.get(mapping.get("litres", ""), ""))
            transaction_id = (raw_row.get(mapping.get("transaction_id", ""), "") or "").strip() or None
            key_code = (raw_row.get(mapping.get("key_code", ""), "") or "").strip()
            card_number = (raw_row.get(mapping.get("card_number", ""), "") or "").strip()
            registration = (raw_row.get(mapping.get("registration", ""), "") or "").strip().upper()
            # v58.13.131g — Parse description early so the identifier
            # fallback check can consider it as a soft-identity hint.
            description = (raw_row.get(mapping.get("description", ""), "") or "").strip()

            if not date_iso or not time_local or litres is None:
                rejected += 1
                errors.append({"row": row_num, "error": "Missing/invalid date/time/litres"})
                continue
            if not (transaction_id or key_code or card_number or registration or description):
                # v58.13.131g — Reject only when ALL identifiers +
                # description are blank. Rows with a description
                # (like "Daniel Butler" / "Office") fall through to
                # unmatched with the description as the hint.
                rejected += 1
                errors.append({"row": row_num, "error": "No identifier (txn_id / key_code / card / rego / description)"})
                continue

            dt_utc = _local_to_utc(date_iso, time_local, local_tz)
            if not dt_utc:
                rejected += 1
                errors.append({"row": row_num, "error": "Could not build UTC timestamp"})
                continue
            timestamp = dt_utc.isoformat()

            location = (raw_row.get(mapping.get("location", ""), "") or "").strip()
            fuel_type = (raw_row.get(mapping.get("fuel_type", ""), "") or "").strip()
            pump = _parse_int(raw_row.get(mapping.get("pump", ""), ""))
            odometer_km = _parse_int(raw_row.get(mapping.get("odometer_km", ""), ""))
            engine_hours = _parse_float(raw_row.get(mapping.get("engine_hours", ""), ""))
            total_price = _parse_float(raw_row.get(mapping.get("total_price", ""), ""))
            driver_raw = (raw_row.get(mapping.get("driver", ""), "") or "").strip()
            driver = None if driver_raw.lower() in ("", "no driver is assigned.", "none") else driver_raw

            # Dedupe — v58.13.131g composite-hash fallback.
            #   1. `transaction_id` unique per org (SmartFill portal).
            #   2. Composite SHA256 of (card|key|rego, timestamp, litres)
            #      stored in `dedupe_hash`. Handles the real-world
            #      export shape where transaction_id is absent.
            dedupe_hash = _compose_dedupe_hash(
                card_number=card_number, key_code=key_code,
                registration=registration, timestamp=timestamp,
                litres=litres,
            )
            dup = None
            if transaction_id:
                dup = await db.fuel_transactions.find_one(
                    {"org_id": org_id, "transaction_id": transaction_id, "deleted_at": None},
                    {"id": 1},
                )
            if not dup and dedupe_hash:
                dup = await db.fuel_transactions.find_one(
                    {"org_id": org_id, "dedupe_hash": dedupe_hash, "deleted_at": None},
                    {"id": 1},
                )
            # Backwards-compat: also check the old key_code_fallback
            # index so pre-.131g batches remain de-duplicated.
            if not dup:
                dedup_kc = (
                    key_code
                    or (f"REGO:{registration}" if registration else "")
                    or card_number
                )
                if dedup_kc:
                    dup = await db.fuel_transactions.find_one(
                        {"org_id": org_id, "key_code_fallback": dedup_kc,
                         "timestamp": timestamp, "litres": litres, "deleted_at": None},
                        {"id": 1},
                    )
            if dup:
                duplicate += 1
                continue

            asset_id, match_status = await _resolve_asset(
                org_id=org_id, key_code=key_code, card_number=card_number,
                registration=registration, description=description,
                _asset_cache=_asset_cache,
            )
            if match_status == "unmatched":
                unmatched += 1
                unmatched_set.add(registration or key_code or card_number or "?")

            # v58.13.131i — Navixy enrichment BEFORE anomaly evaluation
            # so R4/R5 see the enriched odometer, not the raw CSV value.
            _enrich = await enrich_fill(
                db,
                asset_id=asset_id,
                date_iso=date_iso,
                csv_odo=odometer_km,
                csv_hours=engine_hours,
                snapshots=_asset_snapshots,
            )
            odometer_km = _enrich.get("odometer_km", odometer_km)
            engine_hours = _enrich.get("engine_hours", engine_hours)

            anomaly_flags = await _evaluate_anomalies(
                org_id=org_id, asset_id=asset_id, litres=litres,
                filled_at_utc=timestamp, local_tz=local_tz,
                odometer_km=odometer_km, engine_hours=engine_hours,
                enabled_rules=enabled_rules,
                odometer_source=_enrich.get("odometer_source"),
            )
            if anomaly_flags:
                anomalous += 1

            doc = {
                "id": new_id(),
                "org_id": org_id,
                "workspace_id": workspace_id,
                "import_batch_id": batch_id,
                "import_row_number": row_num,
                "source": "smartfill_csv",
                # Time.
                "date_iso": date_iso,
                "time_local": time_local,
                "timestamp": timestamp,
                "local_tz": local_tz,
                # Identity.
                "transaction_id": transaction_id,
                "key_code": key_code or None,
                "key_code_fallback": (
                    key_code
                    or (f"REGO:{registration}" if registration else "")
                    or card_number
                ),
                # v58.13.131g — Composite dedupe hash + audit of the
                # suppressed rule set at import time.
                "dedupe_hash": dedupe_hash,
                "_rules_suppressed_at_import": sorted(_ALL_RULES - enabled_rules),
                "card_number": card_number or None,
                "registration": registration or None,
                "description": description,
                "driver": driver,
                "from_site": location,
                "fuel_type": fuel_type,
                "pump": pump,
                "units": units_raw or "Litres",
                # Metrics.
                "litres": litres,
                "total_price": total_price,
                "odometer_km": odometer_km,
                "engine_hours": engine_hours,
                # v58.13.131i — Navixy enrichment provenance.
                "odometer_source": _enrich.get("odometer_source", "unknown"),
                "engine_hours_source": _enrich.get("engine_hours_source", "unknown"),
                "_enrichment_confidence": _enrich.get("_enrichment_confidence"),
                "odometer_snapshot_at": _enrich.get("odometer_snapshot_at"),
                "_enriched_at": now_iso(),
                # Attribution.
                "asset_id": asset_id,
                "match_status": match_status,
                # Anomaly.
                "anomaly_flags": anomaly_flags,
                # Audit.
                "raw_row": dict(raw_row),
                "raw_row_hash": _row_hash(dict(raw_row)),
                "imported_at": now_iso(),
                "imported_by": user_id,
                "deleted_at": None,
                "created_at": now_iso(),
                "updated_at": now_iso(),
            }
            await db.fuel_transactions.insert_one(doc)
            inserted += 1
        except Exception as e:  # pylint: disable=broad-except
            rejected += 1
            errors.append({"row": row_num, "error": str(e)[:200]})
            log.warning("fuel import row=%s error=%s", row_num, str(e)[:200])

    total = inserted + duplicate + rejected
    await db.fuel_import_batches.insert_one({
        "id": batch_id, "org_id": org_id, "workspace_id": workspace_id,
        "filename": filename, "uploaded_by": user_id,
        "uploaded_at": now_iso(),
        "rows_total": total, "rows_inserted": inserted,
        "rows_duplicate": duplicate, "rows_unmatched": unmatched,
        "rows_anomalous": anomalous, "rows_rejected": rejected,
        "unmatched_regos": sorted(unmatched_set),
        "header_warnings": header_warnings,
        "preview_sample": preview_sample,
        "status": "complete", "error_summary": errors[:20],
        # v58.13.131g — Rule config audit + coverage stats +
        # detected column set (verbatim from the CSV header, so a
        # future dropped column is diagnosable from the batch doc
        # alone).
        "rules_suppressed": rules_suppressed,
        "enabled_rules_at_import": sorted(enabled_rules),
        "price_coverage_pct": price_coverage_pct,
        "zero_odometer_pct": round(zero_odo_pct, 2),
        "columns_detected": list(fieldnames),
        "deleted_at": None,
    })

    # v58.13.131d — R7 procurement_outlier post-import pass. Recomputes
    # the top-3 $/L transactions for the CURRENT calendar month across
    # all matched rows, and flags them with R7 (severity=medium).
    # Idempotent: clears prior R7 flags in the same month first so
    # the leaderboard stays accurate as more data lands.
    r7_flagged = await _reflag_procurement_outliers(org_id=org_id, local_tz=local_tz)

    return ImportResult(
        batch_id=batch_id, rows_total=total, rows_inserted=inserted,
        rows_duplicate=duplicate, rows_unmatched=unmatched,
        rows_anomalous=anomalous + r7_flagged, rows_rejected=rejected,
        unmatched_regos=sorted(unmatched_set),
        header_warnings=header_warnings, errors=errors[:50],
    )


# ── R7 procurement_outlier ──────────────────────────────────────
async def _reflag_procurement_outliers(*, org_id: str, local_tz: str) -> int:
    """Recompute R7 top-3 $/L for the current calendar month.

    Idempotent: clears every existing R7 flag in the current month
    before assigning new ones. Ties broken deterministically by the
    earliest `timestamp` (older wins the higher rank), then by `id`.
    Returns the count of rows that received a fresh R7 flag.
    """
    try:
        now_local = datetime.now(ZoneInfo(local_tz))
    except (KeyError, ValueError):
        now_local = datetime.now(timezone.utc)
    month_prefix = now_local.strftime("%Y-%m")

    # Fetch all matched rows in the current month with valid $/L.
    q = {
        "org_id": org_id,
        "deleted_at": None,
        "asset_id": {"$ne": None},
        "date_iso": {"$regex": f"^{month_prefix}"},
        "litres": {"$gt": 0},
        "total_price": {"$gt": 0},
    }
    rows = [d async for d in db.fuel_transactions.find(
        q, {"id": 1, "litres": 1, "total_price": 1,
            "timestamp": 1, "anomaly_flags": 1},
    )]

    # Compute $/L and rank.
    ranked = []
    for r in rows:
        litres = float(r.get("litres") or 0)
        price = float(r.get("total_price") or 0)
        if litres <= 0 or price <= 0:
            continue
        dpl = price / litres
        ranked.append((dpl, r.get("timestamp") or "", r.get("id"), r))
    # Highest $/L first. Ties broken by earliest timestamp (older wins),
    # then by id.
    ranked.sort(key=lambda t: (-t[0], t[1], t[2] or ""))
    top = ranked[:3]
    top_ids = {t[3]["id"] for t in top}

    # Clear any existing R7 flags in this month for rows NOT in the new top-3.
    now = now_iso()
    cleared = 0
    for _, _, _, doc in ranked:
        if doc["id"] in top_ids:
            continue
        flags = list(doc.get("anomaly_flags") or [])
        if not any(f.get("rule") == "procurement_outlier" for f in flags):
            continue
        new_flags = [f for f in flags if f.get("rule") != "procurement_outlier"]
        await db.fuel_transactions.update_one(
            {"id": doc["id"], "org_id": org_id},
            {"$set": {"anomaly_flags": new_flags, "updated_at": now}},
        )
        cleared += 1

    # Apply R7 flag to new top-3 (idempotent: if already flagged, refresh
    # the detail string with the current rank/N).
    n = len(ranked)
    fresh = 0
    for rank, (dpl, _, _, doc) in enumerate(top, start=1):
        flags = list(doc.get("anomaly_flags") or [])
        new_detail = f"Top-3 $/L this month at {dpl:.3f} $/L (rank #{rank} of {n})"
        existing = next((f for f in flags if f.get("rule") == "procurement_outlier"), None)
        if existing:
            existing["detail"] = new_detail
            existing["severity"] = "medium"
        else:
            flags.append({
                "rule": "procurement_outlier",
                "severity": "medium",
                "detail": new_detail,
                "resolved_at": None,
                "resolved_by": None,
                "created_at": now,
            })
            fresh += 1
        await db.fuel_transactions.update_one(
            {"id": doc["id"], "org_id": org_id},
            {"$set": {"anomaly_flags": flags, "updated_at": now}},
        )
    log.info("fuel R7 procurement_outlier month=%s ranked=%d cleared=%d fresh=%d",
             month_prefix, n, cleared, fresh)
    return fresh


def _require_admin(user: dict) -> None:
    # v58.13.131c — Strict `admin` role only. CSV imports mutate
    # fleet-wide financial + fuel data, so `hseq_lead` (also has
    # `assets.edit`) is intentionally excluded here. Per-row anomaly
    # actions (resolve / dismiss / manual-match) remain on
    # `assets.edit` — see `_flip_anomaly` / `match_txn`.
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="admin only")


# ── Endpoints ───────────────────────────────────────────────────
@router.post("/import-csv", response_model=ImportResult)
async def import_csv_ep(
    file: UploadFile = File(...),
    local_tz: str = Query(_DEFAULT_TZ),
    _flag: None = Depends(require_fleet_register_enabled),
    user: dict = Depends(require_permission("assets", "edit")),
):
    _require_admin(user)
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")
    return await _import_csv(
        content=content, filename=file.filename or "unknown.csv",
        org_id=user["org_id"], workspace_id=user.get("workspace_id"),
        user_id=user["id"], local_tz=local_tz,
    )


@router.get("/batches")
async def list_batches(
    page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=100),
    _flag: None = Depends(require_fleet_register_enabled),
    user: dict = Depends(require_permission("assets", "view")),
):
    q = {"org_id": user["org_id"], "deleted_at": None}
    total = await db.fuel_import_batches.count_documents(q)
    cursor = (db.fuel_import_batches.find(q, {"_id": 0})
              .sort("uploaded_at", -1)
              .skip((page - 1) * size).limit(size))
    return {"items": [d async for d in cursor], "total": total, "page": page, "size": size}


@router.get("/batches/{batch_id}")
async def get_batch(
    batch_id: str,
    _flag: None = Depends(require_fleet_register_enabled),
    user: dict = Depends(require_permission("assets", "view")),
):
    b = await db.fuel_import_batches.find_one(
        {"id": batch_id, "org_id": user["org_id"]}, {"_id": 0},
    )
    if not b:
        raise HTTPException(status_code=404, detail="batch not found")
    tx_active = await db.fuel_transactions.count_documents(
        {"import_batch_id": batch_id, "org_id": user["org_id"], "deleted_at": None},
    )
    return {**b, "rows_active": tx_active}


@router.delete("/batches/{batch_id}")
async def delete_batch(
    batch_id: str,
    _flag: None = Depends(require_fleet_register_enabled),
    user: dict = Depends(require_permission("assets", "edit")),
):
    _require_admin(user)
    b = await db.fuel_import_batches.find_one(
        {"id": batch_id, "org_id": user["org_id"]}, {"id": 1},
    )
    if not b:
        raise HTTPException(status_code=404, detail="batch not found")
    r = await db.fuel_transactions.update_many(
        {"org_id": user["org_id"], "import_batch_id": batch_id, "deleted_at": None},
        {"$set": {"deleted_at": now_iso(), "updated_at": now_iso()}},
    )
    await db.fuel_import_batches.update_one(
        {"id": batch_id, "org_id": user["org_id"]},
        {"$set": {"deleted_at": now_iso(), "deleted_by": user["id"], "status": "deleted"}},
    )
    return {"batch_id": batch_id, "rows_deleted": r.modified_count}


@router.get("/transactions")
async def list_transactions(
    asset_id: Optional[str] = Query(None),
    batch_id: Optional[str] = Query(None),
    from_date: Optional[str] = Query(None, alias="from"),
    to_date: Optional[str] = Query(None, alias="to"),
    from_site: Optional[str] = Query(None),
    fuel_type: Optional[str] = Query(None),
    driver: Optional[str] = Query(None),
    key_code: Optional[str] = Query(None),
    anomaly_only: bool = Query(False),
    match_status: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
    _flag: None = Depends(require_fleet_register_enabled),
    user: dict = Depends(require_permission("assets", "view")),
):
    q: dict = {"org_id": user["org_id"], "deleted_at": None}
    if asset_id:      q["asset_id"] = asset_id
    if batch_id:      q["import_batch_id"] = batch_id
    if from_site:     q["from_site"] = from_site
    if fuel_type:     q["fuel_type"] = fuel_type
    if driver:        q["driver"] = driver
    if key_code:      q["key_code"] = key_code
    if match_status:  q["match_status"] = match_status
    if anomaly_only:  q["anomaly_flags"] = {"$ne": []}
    if from_date or to_date:
        rng: dict = {}
        if from_date: rng["$gte"] = from_date
        if to_date:   rng["$lte"] = to_date + "T23:59:59"
        q["timestamp"] = rng
    total = await db.fuel_transactions.count_documents(q)
    cursor = (db.fuel_transactions.find(q, {"_id": 0})
              .sort("timestamp", -1)
              .skip((page - 1) * size).limit(size))
    return {"items": [d async for d in cursor], "total": total, "page": page, "size": size}


@router.get("/anomalies")
async def list_anomalies(
    rule: Optional[str] = Query(None),
    resolved: Optional[bool] = Query(None),
    count_only: bool = Query(False),
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
    _flag: None = Depends(require_fleet_register_enabled),
    user: dict = Depends(require_permission("assets", "view")),
):
    q: dict = {"org_id": user["org_id"], "deleted_at": None,
               "anomaly_flags": {"$ne": []}}
    if resolved is True:
        q["anomaly_flags"] = {"$elemMatch": {
            "resolved_at": {"$ne": None}, **({"rule": rule} if rule else {})
        }}
    elif resolved is False:
        q["anomaly_flags"] = {"$elemMatch": {
            "resolved_at": None, **({"rule": rule} if rule else {})
        }}
    elif rule:
        q["anomaly_flags.rule"] = rule
    total = await db.fuel_transactions.count_documents(q)
    # v58.13.131c — `count_only=true` short-circuits the full page fetch.
    # Powers the FleetRegister anomaly banner without paying for the
    # 50-row body payload every render.
    if count_only:
        return {"count": total}
    cursor = (db.fuel_transactions.find(q, {"_id": 0})
              .sort("timestamp", -1)
              .skip((page - 1) * size).limit(size))
    return {"items": [d async for d in cursor], "total": total, "page": page, "size": size}


class AnomalyActionIn(BaseModel):
    rule: str
    note: Optional[str] = None


async def _flip_anomaly(txn_id: str, org_id: str, user_id: str,
                         payload: AnomalyActionIn, action: str) -> dict:
    tx = await db.fuel_transactions.find_one(
        {"id": txn_id, "org_id": org_id}, {"anomaly_flags": 1},
    )
    if not tx:
        raise HTTPException(status_code=404, detail="tx not found")
    updated = 0
    flags = tx.get("anomaly_flags") or []
    for f in flags:
        if f.get("rule") == payload.rule and not f.get("resolved_at"):
            f["resolved_at"] = now_iso()
            f["resolved_by"] = user_id
            f["resolved_action"] = action
            if payload.note:
                f["resolved_note"] = payload.note
            updated += 1
    await db.fuel_transactions.update_one(
        {"id": txn_id, "org_id": org_id},
        {"$set": {"anomaly_flags": flags, "updated_at": now_iso()}},
    )
    if updated == 0:
        raise HTTPException(status_code=404, detail="rule not found or already resolved")
    return {"txn_id": txn_id, "rule": payload.rule, action: updated}


@router.post("/anomalies/{txn_id}/resolve")
async def resolve_anomaly(
    txn_id: str, payload: AnomalyActionIn,
    _flag: None = Depends(require_fleet_register_enabled),
    user: dict = Depends(require_permission("assets", "edit")),
):
    return await _flip_anomaly(txn_id, user["org_id"], user["id"], payload, "resolved")


@router.post("/anomalies/{txn_id}/dismiss")
async def dismiss_anomaly(
    txn_id: str, payload: AnomalyActionIn,
    _flag: None = Depends(require_fleet_register_enabled),
    user: dict = Depends(require_permission("assets", "edit")),
):
    return await _flip_anomaly(txn_id, user["org_id"], user["id"], payload, "dismissed")


class MatchIn(BaseModel):
    asset_id: str


@router.post("/transactions/{txn_id}/match")
async def match_txn(
    txn_id: str, payload: MatchIn,
    _flag: None = Depends(require_fleet_register_enabled),
    user: dict = Depends(require_permission("assets", "edit")),
):
    asset = await db.assets.find_one(
        {"id": payload.asset_id, "org_id": user["org_id"]}, {"id": 1},
    )
    if not asset:
        raise HTTPException(status_code=404, detail="asset not found")
    r = await db.fuel_transactions.update_one(
        {"id": txn_id, "org_id": user["org_id"]},
        {"$set": {"asset_id": payload.asset_id, "match_status": "manual",
                  "updated_at": now_iso()}},
    )
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="tx not found")
    return {"txn_id": txn_id, "asset_id": payload.asset_id, "match_status": "manual"}


@router.get("/stats")
async def fuel_stats(
    from_date: Optional[str] = Query(None, alias="from"),
    to_date: Optional[str] = Query(None, alias="to"),
    _flag: None = Depends(require_fleet_register_enabled),
    user: dict = Depends(require_permission("assets", "view")),
):
    q: dict = {"org_id": user["org_id"], "deleted_at": None}
    if from_date or to_date:
        rng: dict = {}
        if from_date: rng["$gte"] = from_date
        if to_date:   rng["$lte"] = to_date + "T23:59:59"
        q["timestamp"] = rng

    total_litres = 0.0
    total_fills = 0
    by_asset: dict = {}
    by_month: dict = {}
    by_site: dict = {}
    anomaly_open = 0
    anomaly_by_rule: dict = {}

    async for d in db.fuel_transactions.find(q, {
        "asset_id": 1, "registration": 1, "litres": 1, "timestamp": 1,
        "anomaly_flags": 1, "from_site": 1,
    }):
        total_fills += 1
        litres = d.get("litres") or 0
        total_litres += litres
        key = d.get("asset_id") or d.get("registration") or "unattributed"
        v = by_asset.setdefault(key, {"litres": 0.0, "fills": 0,
                                       "asset_id": d.get("asset_id"),
                                       "registration": d.get("registration")})
        v["litres"] += litres
        v["fills"] += 1
        ts = d.get("timestamp") or ""
        month = ts[:7] if len(ts) >= 7 else "unknown"
        by_month.setdefault(month, {"litres": 0.0, "fills": 0})
        by_month[month]["litres"] += litres
        by_month[month]["fills"] += 1
        site = d.get("from_site") or "unknown"
        by_site.setdefault(site, {"litres": 0.0, "fills": 0})
        by_site[site]["litres"] += litres
        by_site[site]["fills"] += 1
        for f in d.get("anomaly_flags") or []:
            rule = f.get("rule")
            if rule:
                anomaly_by_rule[rule] = anomaly_by_rule.get(rule, 0) + 1
                if not f.get("resolved_at"):
                    anomaly_open += 1

    return {
        "total_litres": round(total_litres, 3),
        "total_fills": total_fills,
        "unique_vehicles": len(by_asset),
        "top_by_litres": sorted(by_asset.values(), key=lambda x: -x["litres"])[:5],
        "top_by_fills": sorted(by_asset.values(), key=lambda x: -x["fills"])[:5],
        "by_month": [{"month": m, **v} for m, v in sorted(by_month.items())],
        "by_site": [{"site": s, **v} for s, v in sorted(by_site.items(), key=lambda kv: -kv[1]["litres"])],
        "anomaly_open_count": anomaly_open,
        "anomaly_by_rule": anomaly_by_rule,
    }


@asset_router.get("/{asset_id}/fuel")
async def asset_fuel_feed(
    asset_id: str,
    from_date: Optional[str] = Query(None, alias="from"),
    to_date: Optional[str] = Query(None, alias="to"),
    _flag: None = Depends(require_fleet_register_enabled),
    user: dict = Depends(require_permission("assets", "view")),
):
    q: dict = {"org_id": user["org_id"], "asset_id": asset_id, "deleted_at": None}
    if from_date or to_date:
        rng: dict = {}
        if from_date: rng["$gte"] = from_date
        if to_date:   rng["$lte"] = to_date + "T23:59:59"
        q["timestamp"] = rng
    txs = [d async for d in db.fuel_transactions.find(q, {"_id": 0}).sort("timestamp", -1).limit(500)]
    recent_litres = [t["litres"] for t in txs[:20] if t.get("litres") is not None]
    return {
        "asset_id": asset_id, "transactions": txs,
        "rolling_last_20": {
            "count": len(recent_litres),
            "total_litres": round(sum(recent_litres), 3),
            "mean_litres": round(statistics.mean(recent_litres), 2) if recent_litres else None,
            "stdev_litres": round(statistics.stdev(recent_litres), 2) if len(recent_litres) >= 2 else None,
        },
    }


@router.get("/export")
async def export_csv_ep(
    asset_id: Optional[str] = Query(None),
    batch_id: Optional[str] = Query(None),
    from_date: Optional[str] = Query(None, alias="from"),
    to_date: Optional[str] = Query(None, alias="to"),
    anomaly_only: bool = Query(False),
    _flag: None = Depends(require_fleet_register_enabled),
    user: dict = Depends(require_permission("assets", "view")),
):
    q: dict = {"org_id": user["org_id"], "deleted_at": None}
    if asset_id:      q["asset_id"] = asset_id
    if batch_id:      q["import_batch_id"] = batch_id
    if anomaly_only:  q["anomaly_flags"] = {"$ne": []}
    if from_date or to_date:
        rng: dict = {}
        if from_date: rng["$gte"] = from_date
        if to_date:   rng["$lte"] = to_date + "T23:59:59"
        q["timestamp"] = rng

    async def _stream():
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow([
            "Transaction Id", "Date", "Time", "Key/Code", "Card Number",
            "Registration", "Description", "Driver", "From", "Litres",
            "Units", "Total Price", "Fuel Type", "Pump", "Odometer",
            "Engine Hours", "Match Status", "Anomaly Rules", "Batch Id",
        ])
        yield buf.getvalue()
        buf.seek(0); buf.truncate(0)
        async for d in db.fuel_transactions.find(q, {"_id": 0}).sort("timestamp", -1):
            rules = ",".join(sorted({f.get("rule", "") for f in d.get("anomaly_flags") or []}))
            writer.writerow([
                d.get("transaction_id") or "",
                d.get("date_iso") or "", d.get("time_local") or "",
                d.get("key_code") or "", d.get("card_number") or "",
                d.get("registration") or "", d.get("description") or "",
                d.get("driver") or "", d.get("from_site") or "",
                d.get("litres") if d.get("litres") is not None else "",
                d.get("units") or "",
                d.get("total_price") if d.get("total_price") is not None else "",
                d.get("fuel_type") or "",
                d.get("pump") if d.get("pump") is not None else "",
                d.get("odometer_km") if d.get("odometer_km") is not None else "",
                d.get("engine_hours") if d.get("engine_hours") is not None else "",
                d.get("match_status") or "", rules,
                d.get("import_batch_id") or "",
            ])
            yield buf.getvalue()
            buf.seek(0); buf.truncate(0)

    return StreamingResponse(
        _stream(), media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="fuel_transactions.csv"'},
    )


# ── Ensure indexes on module import ─────────────────────────────
async def ensure_indexes() -> None:
    await db.fuel_transactions.create_index([("org_id", 1), ("timestamp", -1)])
    await db.fuel_transactions.create_index([("org_id", 1), ("asset_id", 1), ("timestamp", -1)])
    # v58.13.131h — Soft-delete + partial-unique-index fix. The
    # partial filter now also requires `deleted_at: null` so that
    # re-importing an identical CSV after a batch delete works.
    try:
        await db.fuel_transactions.drop_index("dedup_by_txn_id")
    except Exception:
        pass
    await db.fuel_transactions.create_index(
        [("org_id", 1), ("transaction_id", 1)],
        unique=True, name="dedup_by_txn_id",
        partialFilterExpression={"transaction_id": {"$type": "string"},
                                   "deleted_at": None},
    )
    try:
        await db.fuel_transactions.drop_index("dedup_by_hash")
    except Exception:
        pass
    await db.fuel_transactions.create_index(
        [("org_id", 1), ("dedupe_hash", 1)],
        unique=True, name="dedup_by_hash",
        partialFilterExpression={"dedupe_hash": {"$type": "string"},
                                   "deleted_at": None},
    )
    try:
        await db.fuel_transactions.drop_index("dedup_by_composite")
    except Exception:
        pass
    await db.fuel_transactions.create_index(
        [("org_id", 1), ("key_code_fallback", 1), ("timestamp", 1), ("litres", 1)],
        unique=True, name="dedup_by_composite",
        partialFilterExpression={"key_code_fallback": {"$type": "string"},
                                   "deleted_at": None},
    )
    await db.fuel_transactions.create_index([("import_batch_id", 1)])
    await db.fuel_transactions.create_index([("anomaly_flags.rule", 1)])
    await db.fuel_transactions.create_index([("org_id", 1), ("match_status", 1)])
    await db.fuel_transactions.create_index([("org_id", 1), ("from_site", 1)])
    await db.fuel_transactions.create_index([("org_id", 1), ("key_code", 1)])
    await db.fuel_import_batches.create_index([("org_id", 1), ("uploaded_at", -1)])
    await db.fuel_import_batches.create_index([("id", 1)], unique=True)

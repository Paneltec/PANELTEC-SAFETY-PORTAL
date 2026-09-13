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
import os
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
from fuel_price_settings import (
    PROVISIONAL_PRICE_SOURCES,
    effective_total_price,
    get_org_price_state,
)

log = logging.getLogger("paneltec.fuel")

router = APIRouter(prefix="/fleet/fuel", tags=["fleet-fuel"])
asset_router = APIRouter(prefix="/fleet/assets", tags=["fleet-fuel"])

_DEFAULT_TZ = "Australia/Brisbane"
_HOUR_WINDOW = range(5, 19)
_ROLLING_WINDOW = 20
_ROLLING_MIN_PRIOR = 5
_FUZZY_CUTOFF = 0.85

# v58.13.131n — Fuel import upsert-on-duplicate feature flag.
#   Default ON — matches the shipping user directive ("act on real-world
#   re-exports of the SmartFill CSV with new columns without losing the
#   original 547 rows"). Flip to `false` in supervisor env to fall back
#   to the pre-.131n behaviour (reject-as-duplicate).
_FUEL_UPSERT_ENABLED = (
    os.environ.get("FUEL_IMPORT_UPSERT_ENABLED", "true").strip().lower()
    in ("1", "true", "yes", "on")
)

# Fields eligible for upsert-fill on duplicate. All are NULLABLE in
# the fuel_transactions shape — the immutable identity fields
# (`id`, `org_id`, `timestamp`, `litres`, `dedupe_hash`,
# `raw_row_hash`, `import_batch_id`, `imported_at`, `imported_by`,
# `source`) are NOT in this list and are never touched by an upsert.
# `anomaly_flags` is handled separately (re-evaluated when a
# metrics-relevant field is filled).
_UPSERT_FILL_FIELDS: tuple[str, ...] = (
    "transaction_id", "key_code", "card_number", "registration",
    "description", "driver", "from_site", "fuel_type", "pump",
    "total_price", "unit_price", "odometer_km", "engine_hours",
    "job", "job_code",
)
# Filling any of these triggers a per-row anomaly re-evaluation.
_UPSERT_ANOMALY_TRIGGER_FIELDS: frozenset[str] = frozenset({
    "total_price", "odometer_km", "engine_hours",
})


# v58.13.131o (post-ship amendment) — Compute $/L from
# Total Price ÷ Litres per row. SmartFill's own `Unit Price` column
# is stale on this account (Pricing Module wasn't updated weekly, so
# it reads a constant $3.000 all year). `total_price` is what the
# operator actually paid, so we trust that + the litre count.
#
# Displayed everywhere the UI previously showed `unit_price`
# (reports, AssetDrawer Fuel tab). R7 outlier math uses this value.
# The raw `unit_price` field stays on the doc for audit but is
# never rendered.
def _compute_price_per_litre(total_price, litres) -> Optional[float]:
    try:
        tp = float(total_price) if total_price is not None else None
        lt = float(litres) if litres is not None else None
    except (TypeError, ValueError):
        return None
    if tp is None or lt is None or lt <= 0:
        return None
    return round(tp / lt, 3)

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
    "driver":         ("driver", "drivername", "drivername1", "drivernamefull"),
    "total_price":    ("totalprice", "price", "cost", "total",
                       # v58.13.131g — real-world CSV alias expansion.
                       "amount", "value", "$"),
    # v58.13.131n — Job costing columns from the new SmartFill export.
    "job":            ("job", "jobname", "jobreference", "jobref"),
    "job_code":       ("jobcode", "jobno", "jobnumber", "jobid"),
    # `Price per Litre` is derivable from total_price/litres, but we
    # still capture it verbatim so a future report can prefer the
    # source-of-truth value over the derived one.
    "unit_price":     ("unitprice", "priceperlitre", "pricelitre",
                       "priceperliter", "pricelitre", "dollarsperlitre"),
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
    # v58.13.132ap — SmartFill Transactions:Read emits `16 May 2025`
    # style dates. Added `%d %b %Y` + `%d %B %Y` so those rows land
    # in the same pipeline as CSV imports.
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%m/%d/%Y",
                "%d %b %Y", "%d %B %Y"):
        try:
            return datetime.strptime(raw, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def _parse_time(raw: str) -> Optional[str]:
    raw = (raw or "").strip()
    # v58.13.132ap — SmartFill emits `2:30pm` (no space before AM/PM).
    # Python's `%p` needs upper-case AM/PM, so we upper the AM/PM
    # segment before parsing.
    up = raw
    if raw and raw[-2:].lower() in ("am", "pm") and raw[-3:-2] != " ":
        up = raw[:-2] + " " + raw[-2:].upper()
    elif raw and raw[-2:].lower() in ("am", "pm"):
        up = raw[:-2] + raw[-2:].upper()
    for fmt in ("%H:%M:%S", "%H:%M", "%I:%M:%S %p", "%I:%M %p"):
        try:
            return datetime.strptime(up, fmt).strftime("%H:%M:%S")
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
) -> tuple[Optional[str], Optional[str], str, bool]:
    """Returns `(asset_id, worker_id, match_status, attribution_pending)`.

    `match_status` enum:
        matched                    — resolved via key_code/card/rego/fuzzy
        matched_via_fuel_card      — resolved from fuel_cards mapping
        matched_worker_via_card    — fuel_cards says attribution_kind=worker
        shared_via_fuel_card       — fuel_cards says attribution_kind=shared
        unmatched                  — nothing resolved

    `attribution_pending` is True when the card either has no
    `fuel_cards` doc yet or its doc is `attribution_kind=unassigned` —
    signals the ingest to stamp `attribution_pending: true` on the fill
    so admin knows to review.

    v58.13.132w — Step 0 consults `fuel_cards` before the legacy
    key_code/card/rego/fuzzy waterfall. When a brand-new card_number
    is seen, an `unassigned` `fuel_cards` doc is auto-created so the
    admin UI can surface it for manual attribution.
    """
    # ── Step 0 — fuel_cards lookup + auto-create for new cards ──
    fc = None
    if card_number:
        fc = await db.fuel_cards.find_one(
            {"org_id": org_id, "card_number": card_number}
        )
        if fc:
            kind = fc.get("attribution_kind")
            if kind == "vehicle" and fc.get("asset_id"):
                return fc["asset_id"], None, "matched_via_fuel_card", False
            if kind == "worker" and fc.get("worker_id"):
                return None, fc["worker_id"], "matched_worker_via_card", False
            if kind == "shared":
                return None, None, "shared_via_fuel_card", False
            # attribution_kind == "unassigned" — fall through to
            # legacy waterfall but flag pending.
    # Track pending intent for the final return; legacy resolution
    # may still succeed via key_code/rego and give admin a hint about
    # what the correct attribution should be, but the FUEL_CARDS row
    # is the source of truth for future ingests.
    pending = bool(card_number) and (fc is None or fc.get("attribution_kind") == "unassigned")

    # 1. key_code
    if key_code:
        a = await db.assets.find_one(
            {"org_id": org_id, "smartfill_key_code": key_code}, {"id": 1},
        )
        if a:
            await _ensure_fuel_card_doc(
                org_id, card_number, description, registration
            )
            return a["id"], None, "matched", pending

    # 2. card_number
    if card_number:
        a = await db.assets.find_one(
            {"org_id": org_id, "smartfill_card_number": card_number}, {"id": 1},
        )
        if a:
            await _ensure_fuel_card_doc(
                org_id, card_number, description, registration
            )
            return a["id"], None, "matched", pending

    # 3. registration
    if registration:
        a = await db.assets.find_one(
            {"org_id": org_id, "rego_serial": registration.strip().upper()}, {"id": 1},
        )
        if a:
            await _ensure_fuel_card_doc(
                org_id, card_number, description, registration
            )
            return a["id"], None, "matched", pending

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
                    await _ensure_fuel_card_doc(
                        org_id, card_number, description, registration
                    )
                    return a["id"], None, "matched", pending

    # No asset resolved — but still ensure a fuel_cards doc exists so
    # the admin UI surfaces this new card for manual attribution.
    await _ensure_fuel_card_doc(org_id, card_number, description, registration)
    return None, None, "unmatched", pending


async def _ensure_fuel_card_doc(
    org_id: str, card_number: str, description: str, registration: str,
) -> None:
    """v58.13.132w — Auto-create an `unassigned` `fuel_cards` row for
    any brand-new card_number seen at ingest. Idempotent — the unique
    index on (org_id, card_number) plus a find-first guard prevents
    duplicates. Existing docs are NOT mutated (admin's manual
    assignment wins)."""
    if not card_number:
        return
    existing = await db.fuel_cards.find_one(
        {"org_id": org_id, "card_number": card_number}, {"id": 1},
    )
    if existing:
        return
    now = now_iso()
    await db.fuel_cards.insert_one({
        "id": new_id(),
        "org_id": org_id,
        "card_number": card_number,
        "attribution_kind": "unassigned",
        "asset_id": None,
        "worker_id": None,
        "smartfill_description": description or None,
        "smartfill_registration": registration or None,
        "notes": "Seen at ingest — awaiting attribution.",
        "fill_count": 1,
        "first_seen_at": None,
        "last_seen_at": None,
        "source": "auto",
        "assigned_by": "ingest:v58.13.132w",
        "assigned_at": now,
        "created_at": now,
        "updated_at": now,
    })


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

    v58.13.132au — Canonicalise `timestamp` to minute precision
    before hashing. Historical bug: the SmartFill CSV export encoded
    seconds (`06:28:07`) while the SmartFill Transactions:Read API
    only exposes minute precision (`6:28am` → `06:28:00`). The old
    second-precision hash therefore failed to dedupe API rows
    against pre-existing CSV rows for the same fill, producing 542
    duplicate rows (~10 % of the DB, XT02AX Sep 1-8 inflated 42.7%).
    Rounding to the minute keeps the same primary-key strength for
    every real-world fill (SmartFill never emits two fills on the
    same card in the same minute) while making the two ingest paths
    agree. Backfill (`scripts/backfill_dedupe_v58_13_132au.py`)
    normalises stored hashes on all live rows.

    Returns None only if all three identifier fields are blank AND
    there's therefore nothing meaningful to hash — the row will have
    already been rejected upstream in that case.
    """
    import hashlib
    key = (card_number or "").strip() or (key_code or "").strip() or (registration or "").strip().upper()
    if not key:
        return None
    # Canonicalise timestamp: keep everything up to and including the
    # minute, zero the seconds. ISO shapes we handle:
    #   2026-09-04T06:28:07+00:00 → 2026-09-04T06:28:00+00:00
    #   2026-09-04T06:28:07.123+00:00 → 2026-09-04T06:28:00+00:00
    #   2026-09-04T06:28    (no seconds) → 2026-09-04T06:28:00
    canon = timestamp or ""
    try:
        # Split off the timezone / offset first so we only reshape
        # the wall-clock portion.
        tz = ""
        body = canon
        for marker in ("+", "-"):
            # Skip the leading "-" in the date (YYYY-MM-DD).
            idx = body.rfind(marker)
            if idx > 10:  # past the date's own dashes
                tz = body[idx:]
                body = body[:idx]
                break
        if body.endswith("Z"):
            tz = "Z"
            body = body[:-1]
        # Drop fractional seconds.
        if "." in body:
            body = body.split(".", 1)[0]
        # Ensure HH:MM:SS shape then force seconds to 00.
        if "T" in body:
            date_part, time_part = body.split("T", 1)
            parts = time_part.split(":")
            if len(parts) >= 2:
                hh = parts[0]
                mm = parts[1]
                body = f"{date_part}T{hh}:{mm}:00"
        canon = f"{body}{tz}"
    except Exception:
        # Fallback: hash the raw string unchanged rather than
        # crashing the ingest.
        canon = timestamp or ""
    payload = f"{key}|{canon}|{litres:.3f}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


async def _fleet_tracks_odometers(org_id: str) -> bool:
    """v58.13.131g — Deprecated stub. Original .131g brief called
    for an org-scoped toggle; the amendment replaced that with per-
    row Navixy enrichment (shipping in .131h). Kept as a stub so
    existing callers/tests don't crash; always returns True (i.e.
    fleet DOES track odometers, just not via the SmartFill CSV).
    """
    return True


# ── v58.13.131o — SmartFill card→worker resolution ──────────────
# Fuel CSV rows carry a `Card Number` (e.g. 21318) but no human
# name. Admins link cards to workers via
# `POST /api/workers/{worker_id}/smartfill-cards`. At import (both
# CSV path and SmartFill API sync via `.131m`), we compute
# `resolved_driver_name` off the linkage — used by the per-employee
# fuel report to show "Stephen Guy" instead of "Card 21318".
#
# Historical re-assignment is supported: a card entry with
# `assigned_to` set is a closed assignment; the resolver picks the
# worker whose assignment window includes the transaction's
# `date_iso`. Active assignments (`assigned_to: null`) match dates
# on or after `assigned_from` (or always if `assigned_from` is null).

async def _load_card_worker_index(org_id: str) -> dict:
    """Load a card_number → list[{worker_id, worker_name,
    assigned_from, assigned_to}] index for the org. Multiple entries
    per card_number happen when a card is historically reassigned
    between workers.

    v58.13.131o hardening: unit-test mocks (`_FakeDB`) don't expose a
    `workers` collection, so we tolerate `AttributeError` and return
    an empty index — the caller then behaves as if no card links exist.
    """
    index: dict[str, list[dict]] = {}
    try:
        cursor = db.workers.find(
            {
                "org_id": org_id, "deleted_at": None,
                "smartfill_card_numbers": {"$exists": True, "$ne": []},
            },
            {"_id": 0, "id": 1, "first_name": 1, "last_name": 1,
             "smartfill_card_numbers": 1},
        )
    except AttributeError:
        return index
    async for w in cursor:
        worker_name = f"{w.get('first_name') or ''} {w.get('last_name') or ''}".strip() or "(unnamed)"
        for c in (w.get("smartfill_card_numbers") or []):
            cn = (c.get("card_number") or "").strip()
            if not cn:
                continue
            index.setdefault(cn, []).append({
                "worker_id": w["id"],
                "worker_name": worker_name,
                "assigned_from": c.get("assigned_from"),
                "assigned_to": c.get("assigned_to"),
            })
    return index


def resolve_driver_by_card(
    *, card_number: Optional[str], date_iso: Optional[str], index: dict,
) -> Optional[dict]:
    """Given a card_number + the transaction date, return the
    matching worker entry from the pre-built `index` or None.

    Match rule:
      · date_iso within [assigned_from, assigned_to] window
        (either bound null = unbounded on that side).
      · If multiple entries match, prefer the one with the tighter
        window (both bounds set) over an open-ended active one.
    """
    if not card_number:
        return None
    entries = index.get(card_number.strip())
    if not entries:
        return None
    candidates: list[tuple[int, dict]] = []
    for e in entries:
        af = e.get("assigned_from")
        at = e.get("assigned_to")
        if af and date_iso and date_iso < af:
            continue
        if at and date_iso and date_iso > at:
            continue
        # Score: closed windows (both bounds set) → tightest match.
        # Open-ended active → looser. Fully unbounded → loosest.
        score = (1 if af else 0) + (1 if at else 0)
        candidates.append((score, e))
    if not candidates:
        return None
    candidates.sort(key=lambda t: -t[0])
    return candidates[0][1]


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
    # v58.13.131n — Upsert path counters. `rows_upserted` counts rows
    # that MATCHED an existing doc AND had at least one previously-null
    # column filled. `rows_unchanged` counts rows that MATCHED but had
    # nothing to add (either the incoming payload was a subset of the
    # existing one, or every non-null field conflicted — see
    # `upsert_conflicts_count` for the latter).
    rows_upserted: int = 0
    rows_unchanged: int = 0
    upsert_conflicts_count: int = 0
    unmatched_regos: list[str]
    header_warnings: list[str]
    errors: list[dict]


async def _import_csv(
    *, content: bytes, filename: str, org_id: str,
    workspace_id: Optional[str], user_id: str,
    local_tz: str = _DEFAULT_TZ,
    source: str = "smartfill_csv",
    triggered_by: str = "manual",
) -> ImportResult:
    text = content.decode("utf-8-sig", errors="replace")
    delimiter = _sniff_dialect(text)
    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
    fieldnames = reader.fieldnames or []
    mapping, ignored = _map_headers(fieldnames)

    # v58.13.132dx — Load the org's price setting ONCE per import
    # batch so every row imported in the same batch stamps with the
    # same price + toggle snapshot. Later admin changes never touch
    # these rows again.
    from fuel_price_settings import freeze_price_snapshot as _freeze
    _batch_provisional, _batch_override = await get_org_price_state(org_id)
    _batch_price_setting = await db.fuel_price_settings.find_one(
        {"org_id": org_id}, {"_id": 1},
    )
    _batch_price_setting_id = (str(_batch_price_setting["_id"])
                                if _batch_price_setting else None)

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
    # v58.13.131n — upsert counters (see ImportResult docstring).
    upserted = unchanged = upsert_conflicts = 0
    upsert_events: list[dict] = []  # last-N audit trail for the batch doc
    unmatched_set: set[str] = set()
    errors: list[dict] = []
    preview_sample: list[dict] = []

    # v58.13.131o — Preload SmartFill card→worker index once so each
    # row's driver resolution is O(1) against the in-memory dict.
    _card_index = await _load_card_worker_index(org_id)

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
            # v58.13.131n — Two new columns from the SmartFill full-year re-export.
            unit_price = _parse_float(raw_row.get(mapping.get("unit_price", ""), ""))
            job = (raw_row.get(mapping.get("job", ""), "") or "").strip() or None
            job_code = (raw_row.get(mapping.get("job_code", ""), "") or "").strip() or None
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
                    projection={"_id": 0} if _FUEL_UPSERT_ENABLED else {"id": 1},
                )
            if not dup and dedupe_hash:
                dup = await db.fuel_transactions.find_one(
                    {"org_id": org_id, "dedupe_hash": dedupe_hash, "deleted_at": None},
                    projection={"_id": 0} if _FUEL_UPSERT_ENABLED else {"id": 1},
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
                        projection={"_id": 0} if _FUEL_UPSERT_ENABLED else {"id": 1},
                    )
            if dup:
                # v58.13.131n — Upsert-on-duplicate path.
                #   Feature-flag: FUEL_IMPORT_UPSERT_ENABLED (default true).
                #   When off: keep pre-.131n behaviour (reject-as-duplicate).
                #   When on:  merge new columns onto the existing doc.
                #             Never overwrite non-null values (audit
                #             integrity + safety). Conflicts logged
                #             but do NOT cause overwrite.
                if not _FUEL_UPSERT_ENABLED:
                    duplicate += 1
                    continue
                # Incoming candidate values keyed by fuel_transactions
                # field name. Blank strings are pre-normalised to None
                # so the "already present" check is `current is not
                # None` — clean semantics for `existing == "" is not
                # None`.
                incoming = {
                    "transaction_id": transaction_id,
                    "key_code": key_code or None,
                    "card_number": card_number or None,
                    "registration": registration or None,
                    "description": description or None,
                    "driver": driver,
                    "from_site": location or None,
                    "fuel_type": fuel_type or None,
                    "pump": pump,
                    "total_price": total_price,
                    "unit_price": unit_price,
                    "odometer_km": odometer_km,
                    "engine_hours": engine_hours,
                    "job": job,
                    "job_code": job_code,
                }
                columns_added: list[str] = []
                conflicts: list[dict] = []
                updates: dict = {}
                for field_name in _UPSERT_FILL_FIELDS:
                    val = incoming.get(field_name)
                    if val is None or (isinstance(val, str) and not val.strip()):
                        continue
                    current = dup.get(field_name)
                    # `""` counts as missing for string fields.
                    is_missing = current is None or (
                        isinstance(current, str) and not current.strip()
                    )
                    if is_missing:
                        updates[field_name] = val
                        columns_added.append(field_name)
                    elif current != val:
                        conflicts.append({
                            "field": field_name,
                            "existing": current,
                            "incoming": val,
                        })
                if not columns_added:
                    unchanged += 1
                    if conflicts:
                        upsert_conflicts += 1
                        # Persist the conflict audit trail on the
                        # existing doc even when we don't fill any
                        # new columns — otherwise the conflict is
                        # visible only in the batch summary and lost
                        # from the row-level provenance.
                        prior_conflicts = list(dup.get("_upsert_conflicts") or [])
                        await db.fuel_transactions.update_one(
                            {"id": dup["id"], "org_id": org_id},
                            {"$set": {
                                "_upsert_conflicts": prior_conflicts + conflicts,
                                "_upsert_last_conflict_batch_id": batch_id,
                                "_upsert_last_conflict_at": now_iso(),
                                "updated_at": now_iso(),
                            }},
                        )
                        log.info(
                            "fuel upsert unchanged batch=%s row=%s dup=%s conflicts=%d",
                            batch_id, row_num, dup.get("id"), len(conflicts),
                        )
                    continue
                # ── At least one previously-null field is being filled.
                # v58.13.131o — If card_number was among the fills OR
                # the existing doc has a card_number but no resolved
                # name, re-run the card→worker resolver against the
                # merged doc so `resolved_driver_name` populates.
                merged_card = (
                    incoming.get("card_number") or dup.get("card_number")
                )
                if merged_card and not dup.get("resolved_driver_name"):
                    match = resolve_driver_by_card(
                        card_number=merged_card,
                        date_iso=dup.get("date_iso"),
                        index=_card_index,
                    )
                    if match:
                        updates["resolved_driver_name"] = match["worker_name"]
                        updates["resolved_driver_worker_id"] = match["worker_id"]
                        if "resolved_driver_name" not in columns_added:
                            columns_added.append("resolved_driver_name")
                # Re-evaluate per-row anomalies if a metrics-relevant
                # field was among the fills (Total Price / Odometer /
                # Engine Hours). Preserve any resolved/dismissed flags
                # so a manual reviewer's decision survives.
                new_anomaly_flags: Optional[list[dict]] = None
                if _UPSERT_ANOMALY_TRIGGER_FIELDS.intersection(columns_added):
                    merged = {**dup, **updates}
                    fresh_flags = await _evaluate_anomalies(
                        org_id=org_id, asset_id=merged.get("asset_id"),
                        litres=merged.get("litres"),
                        filled_at_utc=merged.get("timestamp"),
                        local_tz=local_tz,
                        odometer_km=merged.get("odometer_km"),
                        engine_hours=merged.get("engine_hours"),
                        enabled_rules=enabled_rules,
                        odometer_source=merged.get("odometer_source"),
                    )
                    existing_flags = list(dup.get("anomaly_flags") or [])
                    # Keep flags that a human has explicitly resolved
                    # or dismissed — never re-raise them.
                    keep = [
                        f for f in existing_flags
                        if f.get("resolved_at") or f.get("dismissed_at")
                    ]
                    kept_rules = {f.get("rule") for f in keep}
                    for nf in fresh_flags:
                        if nf.get("rule") not in kept_rules:
                            keep.append(nf)
                    new_anomaly_flags = keep
                # Compose the update payload with audit metadata.
                now = now_iso()
                prior_added = list(dup.get("_upsert_columns_added") or [])
                prior_conflicts = list(dup.get("_upsert_conflicts") or [])
                # v58.13.131o (post-ship amendment) — refresh
                # `computed_price_per_litre` whenever the upsert filled
                # `total_price` (or when the doc has total_price but
                # never computed the price/L, e.g. pre-.131o rows).
                merged_total = updates.get("total_price", dup.get("total_price"))
                merged_litres = dup.get("litres")
                new_cpl = _compute_price_per_litre(merged_total, merged_litres)
                if new_cpl is not None and dup.get("computed_price_per_litre") != new_cpl:
                    updates["computed_price_per_litre"] = new_cpl
                    if "computed_price_per_litre" not in columns_added:
                        columns_added.append("computed_price_per_litre")
                # v58.13.132t — When a real total_price arrives on an
                # upsert (i.e. it is present in `updates` OR the merged
                # value is genuinely populated), any provisional-price
                # marker on the existing doc becomes stale and must be
                # cleared. The upsert path is the canonical replacement
                # channel for the `backfill_provisional_price_v58_13_132t`
                # placeholder.
                incoming_tp = updates.get("total_price")
                had_provisional = dup.get("price_source") in ("provisional_static_3.00", "provisional_static_2.25")
                if had_provisional and incoming_tp is not None:
                    updates["price_source"] = None
                    updates["price_provisional_at"] = None
                    if "price_source_cleared" not in columns_added:
                        columns_added.append("price_source_cleared")
                updates.update({
                    "_upserted_at": now,
                    "_upsert_columns_added": prior_added + columns_added,
                    "_upsert_source_batch_id": batch_id,
                    "updated_at": now,
                })
                if conflicts:
                    updates["_upsert_conflicts"] = prior_conflicts + conflicts
                    upsert_conflicts += 1
                if new_anomaly_flags is not None:
                    updates["anomaly_flags"] = new_anomaly_flags
                    if new_anomaly_flags:
                        anomalous += 1
                await db.fuel_transactions.update_one(
                    {"id": dup["id"], "org_id": org_id},
                    {"$set": updates},
                )
                upserted += 1
                if len(upsert_events) < 25:
                    upsert_events.append({
                        "row": row_num,
                        "matched_id": dup["id"],
                        "columns_added": columns_added,
                        "conflicts": conflicts[:5],
                    })
                continue

            asset_id, worker_id, match_status, attribution_pending = await _resolve_asset(
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
                "source": source,
                # v58.13.132w — attribution surfaced from fuel_cards
                # lookup (or fallback resolution). `worker_id` is null
                # unless the card is worker-attributed. `attribution_pending`
                # is True when the card has no fuel_cards row yet OR
                # its row is unassigned — signals admin UI to review.
                "worker_id": worker_id,
                "attribution_pending": attribution_pending,
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
                # v58.13.131n — new columns from SmartFill full-year re-export.
                "unit_price": unit_price,
                # v58.13.131o — Trust total_price ÷ litres, NOT the
                # stale unit_price column. See _compute_price_per_litre.
                "computed_price_per_litre": _compute_price_per_litre(total_price, litres),
                # v58.13.132ar — Tag real-priced SmartFill rows so the
                # Fuel Report can distinguish them from the legacy
                # `provisional_static_3.00` back-fill. Any non-null,
                # positive Total Price coming from SmartFill counts as
                # a real price; the row-level `$/L` cell then renders
                # clean (no italic amber asterisk).
                "price_source": (
                    "smartfill_actual"
                    if (total_price is not None and total_price > 0)
                    else None
                ),
                "job": job,
                "job_code": job_code,
                # v58.13.131o — Card→worker resolution at insert time.
                # Computed from the pre-loaded `_card_index` so no DB
                # hit per row. Null when the card isn't linked to a
                # worker OR when no card_number is present on the row.
                "resolved_driver_name": (
                    (resolve_driver_by_card(
                        card_number=card_number, date_iso=date_iso,
                        index=_card_index,
                    ) or {}).get("worker_name")
                ),
                "resolved_driver_worker_id": (
                    (resolve_driver_by_card(
                        card_number=card_number, date_iso=date_iso,
                        index=_card_index,
                    ) or {}).get("worker_id")
                ),
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
            # v58.13.132dx — Stamp frozen snapshot ONE-WAY at write time.
            # Later admin toggle/price changes never touch these fields.
            doc.update(_freeze(doc, _batch_provisional,
                               _batch_override,
                               _batch_price_setting_id))
            await db.fuel_transactions.insert_one(doc)
            inserted += 1
        except Exception as e:  # pylint: disable=broad-except
            rejected += 1
            errors.append({"row": row_num, "error": str(e)[:200]})
            log.warning("fuel import row=%s error=%s", row_num, str(e)[:200])

    total = inserted + duplicate + rejected + upserted + unchanged
    await db.fuel_import_batches.insert_one({
        "id": batch_id, "org_id": org_id, "workspace_id": workspace_id,
        "filename": filename, "uploaded_by": user_id,
        "uploaded_at": now_iso(),
        "rows_total": total, "rows_inserted": inserted,
        "rows_duplicate": duplicate, "rows_unmatched": unmatched,
        "rows_anomalous": anomalous, "rows_rejected": rejected,
        # v58.13.131n — upsert-on-duplicate counters + sample audit.
        "rows_upserted": upserted, "rows_unchanged": unchanged,
        "upsert_conflicts_count": upsert_conflicts,
        "upsert_events": upsert_events,
        "upsert_flag_active": _FUEL_UPSERT_ENABLED,
        "unmatched_regos": sorted(unmatched_set),
        "header_warnings": header_warnings,
        "preview_sample": preview_sample,
        "status": "complete", "error_summary": errors[:20],
        # v58.13.131m — Batch provenance.
        "source": source,
        "triggered_by": triggered_by,
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
        rows_upserted=upserted, rows_unchanged=unchanged,
        upsert_conflicts_count=upsert_conflicts,
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
            "computed_price_per_litre": 1,
            "timestamp": 1, "anomaly_flags": 1},
    )]

    # Compute $/L and rank.
    # v58.13.131o (post-ship amendment) — Prefer the stored
    # `computed_price_per_litre` (total_price / litres) over the
    # ad-hoc `price / litres` compute below. Semantics identical for
    # rows imported .131o and later; the fallback covers pre-.131o
    # rows that haven't been backfilled yet.
    ranked = []
    for r in rows:
        litres = float(r.get("litres") or 0)
        price = float(r.get("total_price") or 0)
        if litres <= 0 or price <= 0:
            continue
        dpl = r.get("computed_price_per_litre")
        if dpl is None:
            dpl = price / litres
        else:
            dpl = float(dpl)
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
        source="smartfill_csv", triggered_by="manual",
    )


# ── v58.13.131m — SmartFill auto-sync (JSON-RPC Transactions:Read) ──
# Reuses the CSV import pipeline by serialising the SmartFill columnar
# response into an in-memory CSV bytes buffer and piping it through
# `_import_csv` with `source="smartfill_api"`. Zero code duplication on
# dedupe / Navixy enrichment / anomaly rules.

_SMARTFILL_CSV_COLUMNS = [
    "Date", "Time", "Card Number", "Description", "Registration",
    "From", "Litres", "Fuel Type", "Odometer", "Total Price",
    "Transaction Id", "Driver Authorisation", "Unit Price",
]


def _smartfill_rows_to_csv_bytes(rows: list[dict]) -> bytes:
    """Serialise a list of SmartFill columnar-flattened dicts into
    CSV bytes with the canonical 13-column header. Missing keys emit
    empty cells; extra keys are dropped (they won't affect
    `_map_headers` which is alias-based)."""
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(_SMARTFILL_CSV_COLUMNS)
    for row in rows:
        writer.writerow(["" if row.get(c) is None else str(row.get(c)) for c in _SMARTFILL_CSV_COLUMNS])
    return buf.getvalue().encode("utf-8")


class SmartFillSyncRequest(BaseModel):
    from_date: Optional[str] = None  # `YYYY-MM-DD HH:MM:SS` (local tz)
    to_date: Optional[str] = None


class SmartFillStatus(BaseModel):
    last_synced_at: Optional[str]
    last_batch_summary: Optional[dict]
    rate_limit_state: dict
    auto_sync_enabled: bool
    cron_registered: bool


class SmartFillAutoSyncToggle(BaseModel):
    enabled: bool


async def sync_from_smartfill(
    *, org_id: str, workspace_id: Optional[str], user_id: str,
    from_iso: Optional[str] = None, to_iso: Optional[str] = None,
    local_tz: str = _DEFAULT_TZ,
    triggered_by: str = "manual",
) -> ImportResult:
    """Pull `Transactions:Read` for [from_iso, to_iso), pipe through
    the CSV import pipeline as `source="smartfill_api"`.

    Also records `org_settings.fuel_smartfill_last_synced_at` so the
    next default `from_iso` is a resume-cursor.
    """
    from integrations_smartfill import smartfill_fetch_transactions
    # Resume cursor — if caller didn't supply `from_iso`, resume from
    # the last synced timestamp for this org.
    if from_iso is None:
        settings = await db.org_settings.find_one({"org_id": org_id}, {"_id": 0}) or {}
        from_iso = settings.get("fuel_smartfill_last_synced_at")
    rows = await smartfill_fetch_transactions(from_iso=from_iso, to_iso=to_iso)
    log.info("smartfill sync org=%s pulled=%d rows from=%s to=%s trigger=%s",
             org_id, len(rows), from_iso, to_iso, triggered_by)
    content = _smartfill_rows_to_csv_bytes(rows)
    now = now_iso()
    filename = f"smartfill-api-{now}.csv"
    result = await _import_csv(
        content=content, filename=filename,
        org_id=org_id, workspace_id=workspace_id, user_id=user_id,
        local_tz=local_tz,
        source="smartfill_api", triggered_by=triggered_by,
    )
    # Persist the resume cursor to the max(Timestamp) actually seen +
    # a last-synced marker.
    await db.org_settings.update_one(
        {"org_id": org_id},
        {"$set": {"fuel_smartfill_last_synced_at": to_iso or now,
                  "fuel_smartfill_last_batch_id": result.batch_id,
                  "fuel_smartfill_last_synced_row_count": len(rows)}},
        upsert=True,
    )
    return result


@router.post("/sync-smartfill", response_model=ImportResult)
async def sync_smartfill_ep(
    payload: SmartFillSyncRequest,
    _flag: None = Depends(require_fleet_register_enabled),
    user: dict = Depends(require_permission("assets", "edit")),
):
    """Manual SmartFill sync trigger. Rate-limited by the same bucket
    as the cron so 6/min ceiling is honoured regardless of caller.
    """
    _require_admin(user)
    try:
        return await sync_from_smartfill(
            org_id=user["org_id"],
            workspace_id=user.get("workspace_id"),
            user_id=user["id"],
            from_iso=payload.from_date,
            to_iso=payload.to_date,
            triggered_by="manual",
        )
    except Exception as e:  # noqa: BLE001
        from integrations_smartfill import (
            SmartFillConfigError, SmartFillAPIError, SmartFillRateLimitError,
        )
        if isinstance(e, SmartFillRateLimitError):
            raise HTTPException(status_code=429, detail={
                "message": str(e), "retry_after_s": e.retry_after_s,
                "scope": e.scope,
            })
        if isinstance(e, SmartFillConfigError):
            raise HTTPException(status_code=503, detail=str(e))
        if isinstance(e, SmartFillAPIError):
            raise HTTPException(status_code=502, detail={
                "message": str(e), "code": e.code, "method": e.method,
            })
        raise


@router.get("/smartfill-status", response_model=SmartFillStatus)
async def smartfill_status_ep(
    _flag: None = Depends(require_fleet_register_enabled),
    user: dict = Depends(require_permission("assets", "view")),
):
    """SmartFill sync-status card feed. Non-admin viewers get the
    rate-limit + last-run summary but not the toggle mutation."""
    from integrations_smartfill import get_rate_limit_state
    settings = await db.org_settings.find_one({"org_id": user["org_id"]}, {"_id": 0}) or {}
    last_batch_id = settings.get("fuel_smartfill_last_batch_id")
    last_batch_summary = None
    if last_batch_id:
        b = await db.fuel_import_batches.find_one(
            {"id": last_batch_id, "org_id": user["org_id"]},
            {"_id": 0, "id": 1, "uploaded_at": 1, "rows_total": 1,
             "rows_inserted": 1, "rows_duplicate": 1, "rows_anomalous": 1,
             "rows_rejected": 1, "source": 1, "triggered_by": 1},
        )
        if b:
            last_batch_summary = b
    return SmartFillStatus(
        last_synced_at=settings.get("fuel_smartfill_last_synced_at"),
        last_batch_summary=last_batch_summary,
        rate_limit_state=get_rate_limit_state(),
        auto_sync_enabled=bool(settings.get("fuel_smartfill_auto_sync_enabled")),
        cron_registered=(os.environ.get("SMARTFILL_AUTO_SYNC_CRON") == "1"),
    )


@router.post("/smartfill-auto-sync")
async def smartfill_auto_sync_toggle_ep(
    payload: SmartFillAutoSyncToggle,
    _flag: None = Depends(require_fleet_register_enabled),
    user: dict = Depends(require_permission("assets", "edit")),
):
    """Admin-only toggle for the per-org daily cron. Off by default."""
    _require_admin(user)
    await db.org_settings.update_one(
        {"org_id": user["org_id"]},
        {"$set": {"fuel_smartfill_auto_sync_enabled": bool(payload.enabled),
                  "fuel_smartfill_auto_sync_updated_at": now_iso(),
                  "fuel_smartfill_auto_sync_updated_by": user["id"]}},
        upsert=True,
    )
    return {"ok": True, "enabled": bool(payload.enabled)}


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
    items = [d async for d in cursor]
    # v58.13.132dh — Reprice `total_price` + `computed_price_per_litre`
    # at read time so the Per-Fill Transactions table follows the
    # currently effective toggle. Stored values in Mongo are never
    # mutated — this is a pure display overlay. Under
    # `provisional_all`, EVERY row (including real SmartFill) shows
    # provisional $/L. Under `smartfill_with_fallback`, only
    # provisional-tagged / imputed rows are rewritten (matches the
    # aggregations in `_aggregate` + `asset_fuel_summary`).
    provisional_price, override_smartfill = await get_org_price_state(user["org_id"])
    for it in items:
        # v58.13.132dx — Prefer frozen fields (stamped at import).
        # Fall back to on-the-fly `effective_total_price` for legacy
        # rows that migration hasn't yet touched (defensive; the
        # migration script covers all real rows).
        if it.get("frozen_at"):
            new_total = it.get("frozen_total_price") or 0
            it["total_price"] = new_total
            it["computed_price_per_litre"] = it.get("frozen_price_per_litre")
            it["price_source_snapshot"] = it.get("frozen_price_source")
        else:
            new_total = effective_total_price(it, provisional_price, override_smartfill)
            it["total_price"] = new_total
            try:
                litres = float(it.get("litres") or 0)
            except (TypeError, ValueError):
                litres = 0.0
            if litres > 0:
                it["computed_price_per_litre"] = round(new_total / litres, 4)
    return {"items": items, "total": total, "page": page, "size": size,
            # v58.13.132dh — Surface the effective settings so the FE
            # can render the "Provisional override active" badge
            # without a second round-trip.
            "price_state": {
                "provisional_price_per_litre": provisional_price,
                "override_smartfill_real": override_smartfill,
                "override_mode": ("provisional_all"
                                  if override_smartfill
                                  else "smartfill_with_fallback")}}


@router.get("/anomalies")
async def list_anomalies(
    rule: Optional[str] = Query(None),
    resolved: Optional[bool] = Query(None),
    count_only: bool = Query(False),
    include_deleted: bool = Query(False),
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
    _flag: None = Depends(require_fleet_register_enabled),
    user: dict = Depends(require_permission("assets", "view")),
):
    q: dict = {"org_id": user["org_id"], "deleted_at": None,
               "anomaly_flags": {"$ne": []}}
    # v58.13.132ds — Individual anomaly_flag entries carry per-flag
    # `deleted_at`/`deleted_by` for admin-driven soft-delete of
    # dismissals. Default view hides deleted flags; the FE Show-
    # deleted toggle passes `include_deleted=true` to bring them back.
    flag_match: dict = {}
    if not include_deleted:
        flag_match["deleted_at"] = None
    if resolved is True:
        flag_match["resolved_at"] = {"$ne": None}
        if rule:
            flag_match["rule"] = rule
        q["anomaly_flags"] = {"$elemMatch": flag_match}
    elif resolved is False:
        flag_match["resolved_at"] = None
        if rule:
            flag_match["rule"] = rule
        q["anomaly_flags"] = {"$elemMatch": flag_match}
    elif rule:
        flag_match["rule"] = rule
        q["anomaly_flags"] = {"$elemMatch": flag_match}
    elif not include_deleted:
        # No rule/status filter, but still hide fully-deleted-flag txns
        q["anomaly_flags"] = {"$elemMatch": {"deleted_at": None}}
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


# v58.13.132bw — Return the flat txn_id list for the current
# filter set, up to a hard cap. Powers the "Select all N matching"
# affordance on the Fuel Anomaly Inbox bulk bar so admins can act
# on the full result set (not just the visible page) in one shot.
@router.get("/anomalies/matching-ids")
async def anomalies_matching_ids(
    rule: Optional[str] = Query(None),
    resolved: Optional[bool] = Query(None),
    search: Optional[str] = Query(None),
    limit: int = Query(2000, ge=1, le=2000),
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
    if search and search.strip():
        needle = search.strip()
        rx = {"$regex": re.escape(needle), "$options": "i"}
        q["$or"] = [
            {"registration": rx}, {"driver": rx},
            {"resolved_driver_name": rx}, {"card_number": rx},
            {"from_site": rx}, {"transaction_id": rx},
            {"description": rx},
        ]
    total = await db.fuel_transactions.count_documents(q)
    cursor = (db.fuel_transactions.find(q, {"_id": 0, "id": 1})
              .sort("timestamp", -1)
              .limit(limit))
    ids = [d["id"] async for d in cursor]
    return {"ids": ids, "total_matches": total, "capped": total > limit,
            "limit": limit}




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


# v58.13.132bp — Reopen an accidentally-resolved anomaly flag.
# Powers the Undo action on the Fuel Anomaly Inbox Sonner toast.
class AnomalyReopenIn(BaseModel):
    rule: str


@router.post("/anomalies/{txn_id}/reopen")
async def reopen_anomaly(
    txn_id: str, payload: AnomalyReopenIn,
    _flag: None = Depends(require_fleet_register_enabled),
    user: dict = Depends(require_permission("assets", "edit")),
):
    """Clear `resolved_at` (and adjacent resolution metadata) on the
    matching flag. Used by the Undo toast on the Anomaly Inbox after
    a Resolve/Dismiss. 400 if the rule isn't present or isn't already
    resolved. 404 if the transaction doesn't exist."""
    tx = await db.fuel_transactions.find_one(
        {"id": txn_id, "org_id": user["org_id"]}, {"anomaly_flags": 1},
    )
    if not tx:
        raise HTTPException(status_code=404, detail="tx not found")
    flags = tx.get("anomaly_flags") or []
    reopened = 0
    rule_seen = False
    for f in flags:
        if f.get("rule") != payload.rule:
            continue
        rule_seen = True
        if not f.get("resolved_at"):
            continue
        # Clear every resolution-metadata field this codebase has ever
        # written to the flag (defensive over historical field drift).
        for k in ("resolved_at", "resolved_by", "resolved_action",
                  "resolved_note", "resolution_reason", "resolution_kind",
                  "dismissed_at"):
            if k in f:
                f[k] = None
        reopened += 1
    if not rule_seen:
        raise HTTPException(status_code=400, detail="rule not present on this transaction")
    if reopened == 0:
        raise HTTPException(status_code=400, detail="rule is already open")
    await db.fuel_transactions.update_one(
        {"id": txn_id, "org_id": user["org_id"]},
        {"$set": {"anomaly_flags": flags, "updated_at": now_iso()}},
    )
    return {"txn_id": txn_id, "rule": payload.rule, "reopened": reopened}


# ── v58.13.132ds — Soft-delete on anomaly-flag dismissals ─────────
# A "dismissal" is an `anomaly_flags[]` entry with `resolved_action
# == "dismissed"` (or `dismissed_at != None`). Admins can soft-delete
# these dismissal records from the Fuel Anomaly Inbox Resolved tab
# so they no longer clutter the default view. Stamps
# `deleted_at`/`deleted_by` on the flag; the txn row + GridFS blobs
# are untouched. Undelete flips the flag back on. Admin-only.
class AnomalyDeleteIn(BaseModel):
    rule: str


def _require_admin_role(user: dict) -> None:
    role = (user.get("role") or user.get("role_id") or "").lower()
    if role != "admin":
        raise HTTPException(403, "Admin role required")


@router.post("/anomalies/{txn_id}/delete-dismissal")
async def delete_anomaly_dismissal(
    txn_id: str, payload: AnomalyDeleteIn,
    _flag: None = Depends(require_fleet_register_enabled),
    user: dict = Depends(require_permission("assets", "edit")),
):
    """v58.13.132ds — Soft-delete a dismissed anomaly flag. Admin-only.
    Stamps `deleted_at`/`deleted_by` on the matching flag; leaves
    `resolved_at`/`dismissed_at` intact for audit reconstruction.
    404 for unknown txn; 400 if the rule isn't found or isn't in a
    dismissed state."""
    _require_admin_role(user)
    tx = await db.fuel_transactions.find_one(
        {"id": txn_id, "org_id": user["org_id"]}, {"anomaly_flags": 1},
    )
    if not tx:
        raise HTTPException(status_code=404, detail="tx not found")
    flags = tx.get("anomaly_flags") or []
    hit = next((f for f in flags if f.get("rule") == payload.rule), None)
    if not hit:
        raise HTTPException(400, "rule not present on this transaction")
    if not (hit.get("resolved_action") == "dismissed" or hit.get("dismissed_at")):
        raise HTTPException(400, "rule is not in a dismissed state")
    if hit.get("deleted_at"):
        return {"ok": True, "already_deleted": True}
    hit["deleted_at"] = now_iso()
    hit["deleted_by"] = user.get("id")
    await db.fuel_transactions.update_one(
        {"id": txn_id, "org_id": user["org_id"]},
        {"$set": {"anomaly_flags": flags, "updated_at": now_iso()}},
    )
    return {"ok": True, "txn_id": txn_id, "rule": payload.rule,
            "deleted_at": hit["deleted_at"]}


@router.post("/anomalies/{txn_id}/undelete-dismissal")
async def undelete_anomaly_dismissal(
    txn_id: str, payload: AnomalyDeleteIn,
    _flag: None = Depends(require_fleet_register_enabled),
    user: dict = Depends(require_permission("assets", "edit")),
):
    """v58.13.132ds — Restore a soft-deleted dismissal so it re-appears
    in the default Resolved-tab view. Admin-only."""
    _require_admin_role(user)
    tx = await db.fuel_transactions.find_one(
        {"id": txn_id, "org_id": user["org_id"]}, {"anomaly_flags": 1},
    )
    if not tx:
        raise HTTPException(status_code=404, detail="tx not found")
    flags = tx.get("anomaly_flags") or []
    hit = next((f for f in flags if f.get("rule") == payload.rule), None)
    if not hit:
        raise HTTPException(400, "rule not present on this transaction")
    hit.pop("deleted_at", None)
    hit.pop("deleted_by", None)
    await db.fuel_transactions.update_one(
        {"id": txn_id, "org_id": user["org_id"]},
        {"$set": {"anomaly_flags": flags, "updated_at": now_iso()}},
    )
    return {"ok": True, "txn_id": txn_id, "rule": payload.rule}


# ── v58.13.132bs — bulk anomaly actions ────────────────────────
# Powers the multi-select toolbar on the Fuel Anomaly Inbox. Each
# endpoint caps at MAX_BULK txn_ids to keep round-trip latency
# bounded + prevent a runaway request.
# v58.13.132bw — Raised the cap from 500 → 2000 so admins can blast
# through a full-filter sweep in a single call.
MAX_BULK = 2000


class BulkAnomalyIn(BaseModel):
    txn_ids: list[str]


class BulkAttributeIn(BaseModel):
    txn_ids: list[str]
    vehicle_id: str


def _validate_bulk_ids(ids: list[str]) -> None:
    if not ids:
        raise HTTPException(400, "txn_ids required")
    if len(ids) > MAX_BULK:
        raise HTTPException(400, f"batch too large — max {MAX_BULK} txn_ids per call")


async def _bulk_flip(org_id: str, user_id: str, txn_ids: list[str],
                      action: str) -> dict:
    """Resolve or dismiss EVERY currently-open flag on EVERY listed
    txn. Returns per-txn counts + a `failed` list for unknown/empty
    rows.

    v58.13.132bv — For `action == "dismissed"`, also stamp
    `dismissed_at` alongside `resolved_at` so downstream analytics
    can distinguish user-triggered dismissal from a genuine
    resolution. The list filter (`resolved=false`) continues to key
    off `resolved_at IS NULL` (single-source-of-truth for "open")."""
    now = now_iso()
    updated_txns = 0
    updated_flags = 0
    failed: list[dict] = []
    async for tx in db.fuel_transactions.find(
        {"id": {"$in": txn_ids}, "org_id": org_id},
        {"id": 1, "anomaly_flags": 1},
    ):
        flags = tx.get("anomaly_flags") or []
        touched = 0
        for f in flags:
            if not f.get("rule") or f.get("resolved_at"):
                continue
            f["resolved_at"] = now
            f["resolved_by"] = user_id
            f["resolved_action"] = action
            if action == "dismissed":
                f["dismissed_at"] = now
            touched += 1
        if touched == 0:
            failed.append({"txn_id": tx["id"], "reason": "no open flags"})
            continue
        await db.fuel_transactions.update_one(
            {"id": tx["id"], "org_id": org_id},
            {"$set": {"anomaly_flags": flags, "updated_at": now}},
        )
        updated_txns += 1
        updated_flags += touched
    # Rows in the request that didn't come back from the query at all.
    seen_ids = {tx["id"] async for tx in db.fuel_transactions.find(
        {"id": {"$in": txn_ids}, "org_id": org_id}, {"id": 1},
    )}
    for tid in txn_ids:
        if tid not in seen_ids:
            failed.append({"txn_id": tid, "reason": "not found"})
    return {"updated_txns": updated_txns, "updated_flags": updated_flags,
            "failed": failed}


@router.post("/anomalies/bulk-resolve")
async def bulk_resolve_anomalies(
    body: BulkAnomalyIn,
    _flag: None = Depends(require_fleet_register_enabled),
    user: dict = Depends(require_permission("assets", "edit")),
):
    _validate_bulk_ids(body.txn_ids)
    res = await _bulk_flip(user["org_id"], user["id"], body.txn_ids, "resolved")
    return {"resolved": res["updated_txns"], "flags_resolved": res["updated_flags"],
            "failed": res["failed"]}


@router.post("/anomalies/bulk-dismiss")
async def bulk_dismiss_anomalies(
    body: BulkAnomalyIn,
    _flag: None = Depends(require_fleet_register_enabled),
    user: dict = Depends(require_permission("assets", "edit")),
):
    _validate_bulk_ids(body.txn_ids)
    res = await _bulk_flip(user["org_id"], user["id"], body.txn_ids, "dismissed")
    return {"dismissed": res["updated_txns"], "flags_dismissed": res["updated_flags"],
            "failed": res["failed"]}


@router.post("/anomalies/bulk-attribute")
async def bulk_attribute_anomalies(
    body: BulkAttributeIn,
    _flag: None = Depends(require_fleet_register_enabled),
    user: dict = Depends(require_permission("assets", "edit")),
):
    """Attribute every listed txn to the given vehicle. Idempotent per
    txn — a txn already pointing at the requested vehicle is counted
    as `no_change`, not attributed again."""
    _validate_bulk_ids(body.txn_ids)
    veh_id = (body.vehicle_id or "").strip()
    if not veh_id:
        raise HTTPException(400, "vehicle_id required")
    veh = await db.assets.find_one(
        {"org_id": user["org_id"], "id": veh_id, "deleted_at": None},
        {"_id": 0, "id": 1, "rego_serial": 1, "name": 1},
    )
    if not veh:
        raise HTTPException(404, "vehicle not found")
    now = now_iso()
    attributed = 0
    no_change = 0
    failed: list[dict] = []
    async for tx in db.fuel_transactions.find(
        {"id": {"$in": body.txn_ids}, "org_id": user["org_id"]},
        {"id": 1, "asset_id": 1},
    ):
        prior = tx.get("asset_id")
        if prior == veh_id:
            no_change += 1
            continue
        await db.fuel_transactions.update_one(
            {"id": tx["id"], "org_id": user["org_id"]},
            {"$set": {"asset_id": veh_id,
                      "match_status": "manual",
                      "matched_by": user["id"],
                      "matched_at": now,
                      "prior_asset_id_pre_bulk_attribute": prior,
                      "updated_at": now}},
        )
        attributed += 1
    seen_ids = {tx["id"] async for tx in db.fuel_transactions.find(
        {"id": {"$in": body.txn_ids}, "org_id": user["org_id"]}, {"id": 1},
    )}
    for tid in body.txn_ids:
        if tid not in seen_ids:
            failed.append({"txn_id": tid, "reason": "not found"})
    return {
        "attributed": attributed,
        "no_change": no_change,
        "failed": failed,
        "vehicle_id": veh_id,
        "vehicle_rego": veh.get("rego_serial") or veh.get("name"),
    }


@router.post("/anomalies/bulk-reopen")
async def bulk_reopen_anomalies(
    body: BulkAnomalyIn,
    _flag: None = Depends(require_fleet_register_enabled),
    user: dict = Depends(require_permission("assets", "edit")),
):
    """Undo endpoint for bulk resolve + dismiss. Clears
    `resolved_at`/`dismissed_at` (and adjacent metadata) on EVERY
    flag of EVERY listed txn."""
    _validate_bulk_ids(body.txn_ids)
    now = now_iso()
    reopened_txns = 0
    reopened_flags = 0
    failed: list[dict] = []
    async for tx in db.fuel_transactions.find(
        {"id": {"$in": body.txn_ids}, "org_id": user["org_id"]},
        {"id": 1, "anomaly_flags": 1},
    ):
        flags = tx.get("anomaly_flags") or []
        touched = 0
        for f in flags:
            if f.get("resolved_at") or f.get("dismissed_at"):
                for k in ("resolved_at", "resolved_by", "resolved_action",
                          "resolved_note", "resolution_reason",
                          "resolution_kind", "dismissed_at"):
                    if k in f:
                        f[k] = None
                touched += 1
        if touched == 0:
            failed.append({"txn_id": tx["id"], "reason": "no resolved flags"})
            continue
        await db.fuel_transactions.update_one(
            {"id": tx["id"], "org_id": user["org_id"]},
            {"$set": {"anomaly_flags": flags, "updated_at": now}},
        )
        reopened_txns += 1
        reopened_flags += touched
    return {"reopened": reopened_txns, "flags_reopened": reopened_flags,
            "failed": failed}


class MatchIn(BaseModel):
    asset_id: str


@router.get("/transactions/{txn_id}")
async def get_transaction(
    txn_id: str,
    _flag: None = Depends(require_fleet_register_enabled),
    user: dict = Depends(require_permission("assets", "view")),
):
    """v58.13.132ax — Single-transaction fetch for the reusable
    `FuelTransactionDetailModal`. Returns the full doc (same shape
    as `/transactions` list rows) so the modal can render every
    field including `raw_row`, anomaly_flags, odometer_source
    provenance, resolved_driver_name, etc.

    Filtered by `id` + `org_id` (multi-tenant guard). 404 when the
    row is soft-deleted or belongs to another org. Same
    `assets.view` gate as the list endpoint.
    """
    doc = await db.fuel_transactions.find_one(
        {"id": txn_id, "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0},
    )
    if not doc:
        raise HTTPException(status_code=404, detail="tx not found")
    # v58.13.132dj — Preserve the raw SmartFill values as audit
    # references, then reprice at read time to match the list
    # endpoint + aggregations. Under `provisional_all`, EVERY row's
    # displayed total + $/L is `litres × provisional_price`.
    # Stored values in Mongo are never mutated.
    raw_total = doc.get("total_price")
    raw_dpl   = doc.get("computed_price_per_litre")
    provisional_price, override_smartfill = await get_org_price_state(user["org_id"])
    # v58.13.132dx — Prefer frozen snapshot when present. Fall back to
    # `effective_total_price` for legacy rows (defensive).
    if doc.get("frozen_at"):
        new_total = doc.get("frozen_total_price") or 0
        doc["total_price"] = new_total
        doc["computed_price_per_litre"] = doc.get("frozen_price_per_litre")
    else:
        new_total = effective_total_price(doc, provisional_price, override_smartfill)
        doc["total_price"] = new_total
        try:
            litres = float(doc.get("litres") or 0)
        except (TypeError, ValueError):
            litres = 0.0
        if litres > 0:
            doc["computed_price_per_litre"] = round(new_total / litres, 4)
    # Audit references — always populated so the FE can display
    # the raw SmartFill numbers alongside the effective ones when
    # override is active.
    doc["raw_total_price"] = raw_total
    doc["raw_computed_price_per_litre"] = raw_dpl
    doc["price_state"] = {
        "provisional_price_per_litre": provisional_price,
        "override_smartfill_real": override_smartfill,
        "override_mode": ("provisional_all"
                          if override_smartfill
                          else "smartfill_with_fallback"),
    }
    return doc


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


# ── v58.13.132bi — Fuel & SmartFill panel summary ─────────────
#
# Aggregation is scan-heavy on high-volume orgs (a hot vehicle can
# carry 500+ fills), so we keep an in-process TTL cache. The endpoint
# is read-only; anomaly-flag mutations bust the cache via a version
# tick.
_FUEL_SUMMARY_CACHE: dict[tuple, tuple[float, dict]] = {}
_FUEL_SUMMARY_TTL_SECONDS = 60


def _bust_fuel_summary_cache(org_id: str, asset_id: str) -> None:
    _FUEL_SUMMARY_CACHE.pop((org_id, asset_id), None)


def _match_confidence(asset: dict, latest_tx: Optional[dict]) -> str:
    """Return one of `matched_key` / `matched_card` / `matched_other`
    / `not_matched` based on the most-recent transaction attributed to
    this asset. `matched_other` covers rego / fuzzy / manual-match
    resolutions. `not_matched` means zero transactions matched.
    """
    if not latest_tx:
        return "not_matched"
    tx_key = (latest_tx.get("key_code") or "").strip().upper()
    tx_card = (latest_tx.get("card_number") or "").strip()
    asset_key = (asset.get("smartfill_key_code") or "").strip().upper()
    asset_card = (asset.get("smartfill_card_number") or "").strip()
    if tx_key and asset_key and tx_key == asset_key:
        return "matched_key"
    if tx_card and asset_card and tx_card == asset_card:
        return "matched_card"
    # matched_via_fuel_card (attribution_kind=vehicle) implies the
    # fuel_cards mapping resolved the card to this asset — still a
    # card match from the operator's PoV.
    if latest_tx.get("match_status") in ("matched_via_fuel_card",):
        return "matched_card"
    return "matched_other"


@asset_router.get("/{asset_id}/fuel-summary")
async def asset_fuel_summary(
    asset_id: str,
    _flag: None = Depends(require_fleet_register_enabled),
    user: dict = Depends(require_permission("assets", "view")),
):
    """Computed fuel + SmartFill metrics for the vehicle-detail drawer
    panel. Cached for 60s per (org, asset). See panel spec in
    `.132bi` memo for shape."""
    import time
    org_id = user["org_id"]
    cache_key = (org_id, asset_id)
    now_epoch = time.time()
    cached = _FUEL_SUMMARY_CACHE.get(cache_key)
    if cached and (now_epoch - cached[0]) < _FUEL_SUMMARY_TTL_SECONDS:
        return cached[1]

    asset = await db.assets.find_one(
        {"org_id": org_id, "id": asset_id, "deleted_at": None},
        {"_id": 0},
    )
    if not asset:
        raise HTTPException(404, "Asset not found")

    now = datetime.now(timezone.utc)
    ytd_start = datetime(now.year, 1, 1, tzinfo=timezone.utc).isoformat()
    d30_start = (now - _timedelta_days(30)).isoformat()
    d90_start = (now - _timedelta_days(90)).isoformat()

    base_q = {"org_id": org_id, "asset_id": asset_id, "deleted_at": None}

    # v58.13.132df — Read-time re-pricing pipeline stage. Splits each
    # window's price sum into two buckets so we can apply the current
    # provisional rate at read time:
    #   · `real_total_price`     — sum of `total_price` on rows with
    #                              a real SmartFill price
    #                              (`price_source` NOT in the
    #                              provisional set AND total_price>0).
    #   · `provisional_litres`   — sum of `litres` on rows that are
    #                              provisional-tagged OR missing a
    #                              real price. These are priced in
    #                              Python via `litres * current_price`.
    _prov_price_sources = list(PROVISIONAL_PRICE_SOURCES)
    _is_provisional_expr = {
        "$or": [
            {"$in": [{"$ifNull": ["$price_source", ""]}, _prov_price_sources]},
            {"$and": [
                {"$gt": [{"$ifNull": ["$litres", 0]}, 0]},
                {"$lte": [{"$ifNull": ["$total_price", 0]}, 0]},
            ]},
        ],
    }
    _group_split = {
        "_id": None,
        "total_litres": {"$sum": {"$ifNull": ["$litres", 0]}},
        "real_total_price": {
            "$sum": {
                "$cond": [
                    _is_provisional_expr,
                    0,
                    {"$ifNull": ["$total_price", 0]},
                ],
            },
        },
        "provisional_litres": {
            "$sum": {
                "$cond": [
                    _is_provisional_expr,
                    {"$ifNull": ["$litres", 0]},
                    0,
                ],
            },
        },
        "count": {"$sum": 1},
    }
    # v58.13.132dg — Fetch price + override in a single round-trip.
    # When override_smartfill=True, the split above still runs but
    # we ignore `real_total_price` in the Python payload — every
    # litre is repriced at provisional × current price.
    provisional_price, override_smartfill = await get_org_price_state(org_id)

    # 1. Latest transaction (drives last_fill + match_confidence).
    latest = await db.fuel_transactions.find_one(
        base_q, {"_id": 0}, sort=[("timestamp", -1)],
    )

    # 2. YTD totals — split real vs provisional.
    ytd_agg = await db.fuel_transactions.aggregate([
        {"$match": {**base_q, "timestamp": {"$gte": ytd_start}}},
        {"$group": _group_split},
    ]).to_list(1)

    # 3. Rolling 30d — split + odometer/hours range for consumption.
    d30_agg = await db.fuel_transactions.aggregate([
        {"$match": {**base_q, "timestamp": {"$gte": d30_start}}},
        {"$group": {
            **_group_split,
            "min_odo":   {"$min": "$odometer_km"},
            "max_odo":   {"$max": "$odometer_km"},
            "min_hours": {"$min": "$engine_hours"},
            "max_hours": {"$max": "$engine_hours"},
        }},
    ]).to_list(1)

    # 4. Anomalies 90d.
    anom_count = await db.fuel_transactions.count_documents({
        **base_q, "timestamp": {"$gte": d90_start},
        "anomaly_flags": {"$ne": []},
    })

    # 5. Top driver 90d — group by non-empty driver, pick single max.
    driver_agg = await db.fuel_transactions.aggregate([
        {"$match": {**base_q, "timestamp": {"$gte": d90_start},
                    "driver": {"$nin": [None, ""]}}},
        {"$group": {"_id": "$driver", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 2},
    ]).to_list(2)

    # 6. Org-wide last SmartFill sync (per-vehicle isn't tracked; the
    # org-settings stamp is the closest proxy). Falls back to the
    # asset's most recent `imported_at` when the org stamp is missing.
    org_settings = await db.org_settings.find_one({"org_id": org_id}, {"_id": 0}) or {}
    last_sync = org_settings.get("fuel_smartfill_last_synced_at")
    if not last_sync and latest:
        last_sync = latest.get("imported_at")

    # ── Build payload ─────────────────────────────────────────
    ytd = ytd_agg[0] if ytd_agg else {}
    d30 = d30_agg[0] if d30_agg else {}
    ytd_litres = float(ytd.get("total_litres") or 0)
    # v58.13.132df / .132dg — Reprice at read-time: real portion is
    # stored, provisional portion is `litres * current_provisional_price`.
    # When override_smartfill=True, ALL litres get repriced (real
    # portion is folded into provisional).
    if override_smartfill:
        ytd_price = ytd_litres * provisional_price
    else:
        ytd_price = (
            float(ytd.get("real_total_price") or 0)
            + float(ytd.get("provisional_litres") or 0) * provisional_price
        )
    d30_litres = float(d30.get("total_litres") or 0)
    if override_smartfill:
        d30_price = d30_litres * provisional_price
    else:
        d30_price = (
            float(d30.get("real_total_price") or 0)
            + float(d30.get("provisional_litres") or 0) * provisional_price
        )
    d30_count = int(d30.get("count") or 0)

    # Consumption: prefer odometer basis when both min & max are
    # non-None and max > min; else engine hours; else null.
    consumption = {"basis": None, "l_per_100km": None, "l_per_hour": None}
    if (d30.get("min_odo") is not None and d30.get("max_odo") is not None
            and d30["max_odo"] > d30["min_odo"] and d30_litres > 0):
        km = d30["max_odo"] - d30["min_odo"]
        consumption = {
            "basis": "odometer",
            "l_per_100km": round((d30_litres / km) * 100, 2),
            "l_per_hour": None,
        }
    elif (d30.get("min_hours") is not None and d30.get("max_hours") is not None
            and d30["max_hours"] > d30["min_hours"] and d30_litres > 0):
        hrs = d30["max_hours"] - d30["min_hours"]
        consumption = {
            "basis": "engine_hours",
            "l_per_100km": None,
            "l_per_hour": round(d30_litres / hrs, 2),
        }

    # Top driver: only surface when there's a single dominant driver
    # (>=2 fills AND ≥30% of the vehicle's 90d attributions AND not
    # tied with the runner-up).
    top_driver = None
    if driver_agg and driver_agg[0]["count"] >= 2:
        first = driver_agg[0]
        second = driver_agg[1] if len(driver_agg) > 1 else None
        total_90 = await db.fuel_transactions.count_documents({
            **base_q, "timestamp": {"$gte": d90_start},
        })
        dominant = total_90 > 0 and (first["count"] / total_90) >= 0.30
        not_tied = second is None or first["count"] > second["count"]
        if dominant and not_tied:
            top_driver = {"name": first["_id"], "attribution_count": first["count"]}

    payload = {
        "asset_id": asset_id,
        "generated_at": now.isoformat(),
        "match_confidence": _match_confidence(asset, latest),
        "last_fill": {
            "date": latest.get("date_iso") if latest else None,
            "time_local": (latest.get("time_local") or "")[:5] if latest else None,
            "litres": latest.get("litres") if latest else None,
            # v58.13.132df / .132dg — Reprice at read-time; passes
            # the override flag through so real prices are folded
            # into provisional when the toggle is on.
            "total_price": (
                effective_total_price(latest, provisional_price,
                                      override_smartfill)
                if latest else None
            ),
            "station": latest.get("from_site") if latest else None,
            "driver": latest.get("driver") if latest else None,
        } if latest else None,
        "ytd": {
            "total_price": round(ytd_price, 2),
            "total_litres": round(ytd_litres, 2),
            "fill_count": int(ytd.get("count") or 0),
        },
        "rolling_30d": {
            "avg_litres_per_day": round(d30_litres / 30.0, 2) if d30_count else 0,
            "avg_price_per_litre": round(d30_price / d30_litres, 3) if d30_litres > 0 else None,
            "total_litres": round(d30_litres, 2),
            "total_price": round(d30_price, 2),
            "fill_count": d30_count,
        },
        "consumption": consumption,
        "top_driver_90d": top_driver,
        "anomaly_count_90d": anom_count,
        "last_smartfill_sync_at": last_sync,
        "has_any_transactions": latest is not None,
    }
    _FUEL_SUMMARY_CACHE[cache_key] = (now_epoch, payload)
    return payload


def _timedelta_days(n: int):
    from datetime import timedelta
    return timedelta(days=n)


# ── v58.13.132bo — SmartFill card drill-down endpoints ─────────
#
# Powers the Fuel dashboard's Top 10 leaderboards → click-through
# drawer. Three routes, all read-heavy:
#   · GET  /fleet/fuel/cards/{card_number}/summary
#   · GET  /fleet/fuel/cards/{card_number}/transactions
#   · POST /fleet/fuel/cards/{card_number}/assign
_CARD_SUMMARY_CACHE: dict[tuple, tuple[float, dict]] = {}
_CARD_SUMMARY_TTL = 60


def _bust_card_summary_cache(org_id: str, card_number: str) -> None:
    _CARD_SUMMARY_CACHE.pop((org_id, card_number), None)


@router.get("/cards/{card_number}/summary")
async def card_summary(
    card_number: str,
    _flag: None = Depends(require_fleet_register_enabled),
    user: dict = Depends(require_permission("assets", "view")),
):
    """SmartFill-card summary (all-time + YTD + 30d + last 90d
    anomalies). 60s TTL cache per (org, card_number)."""
    import time
    org_id = user["org_id"]
    ck = (org_id, card_number)
    cached = _CARD_SUMMARY_CACHE.get(ck)
    if cached and (time.time() - cached[0]) < _CARD_SUMMARY_TTL:
        return cached[1]

    now = datetime.now(timezone.utc)
    ytd = datetime(now.year, 1, 1, tzinfo=timezone.utc).isoformat()
    d30 = (now - _timedelta_days(30)).isoformat()
    d90 = (now - _timedelta_days(90)).isoformat()

    base = {"org_id": org_id, "card_number": card_number, "deleted_at": None}

    # v58.13.132df — Read-time re-pricing pipeline stage (same shape
    # as `asset_fuel_summary`). Real SmartFill prices flow through
    # unchanged; provisional-tagged or price-less rows get priced at
    # `litres * current_provisional_price` in Python below.
    _prov_price_sources = list(PROVISIONAL_PRICE_SOURCES)
    _is_provisional_expr = {
        "$or": [
            {"$in": [{"$ifNull": ["$price_source", ""]}, _prov_price_sources]},
            {"$and": [
                {"$gt": [{"$ifNull": ["$litres", 0]}, 0]},
                {"$lte": [{"$ifNull": ["$total_price", 0]}, 0]},
            ]},
        ],
    }
    _split_sums = {
        "real_total_price": {
            "$sum": {"$cond": [_is_provisional_expr, 0,
                               {"$ifNull": ["$total_price", 0]}]},
        },
        "provisional_litres": {
            "$sum": {"$cond": [_is_provisional_expr,
                               {"$ifNull": ["$litres", 0]}, 0]},
        },
    }
    # v58.13.132dg — Price + override toggle in one round-trip.
    provisional_price, override_smartfill = await get_org_price_state(org_id)

    all_agg = await db.fuel_transactions.aggregate([
        {"$match": base},
        {"$group": {"_id": None,
                    **_split_sums,
                    "total_litres": {"$sum": {"$ifNull": ["$litres", 0]}},
                    "count": {"$sum": 1},
                    "first_ts": {"$min": "$timestamp"},
                    "last_ts":  {"$max": "$timestamp"}}},
    ]).to_list(1)
    ytd_agg = await db.fuel_transactions.aggregate([
        {"$match": {**base, "timestamp": {"$gte": ytd}}},
        {"$group": {"_id": None,
                    **_split_sums,
                    "total_litres": {"$sum": {"$ifNull": ["$litres", 0]}},
                    "count": {"$sum": 1}}},
    ]).to_list(1)
    count_30d = await db.fuel_transactions.count_documents({**base, "timestamp": {"$gte": d30}})
    anom_90 = await db.fuel_transactions.count_documents({
        **base, "timestamp": {"$gte": d90}, "anomaly_flags": {"$ne": []},
    })

    # Linked vehicle: look at the most-recent transaction's asset_id (or
    # any vehicle row that carries this card as smartfill_card_number).
    linked = await db.assets.find_one(
        {"org_id": org_id, "smartfill_card_number": card_number, "deleted_at": None},
        {"_id": 0, "id": 1, "name": 1, "rego_serial": 1},
    )

    # Top driver 90d (same dominance rule as `.132bi`).
    driver_agg = await db.fuel_transactions.aggregate([
        {"$match": {**base, "timestamp": {"$gte": d90},
                    "driver": {"$nin": [None, ""]}}},
        {"$group": {"_id": "$driver", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}}, {"$limit": 2},
    ]).to_list(2)
    top_driver = None
    if driver_agg and driver_agg[0]["count"] >= 2:
        first = driver_agg[0]
        second = driver_agg[1] if len(driver_agg) > 1 else None
        total_90 = await db.fuel_transactions.count_documents({**base, "timestamp": {"$gte": d90}})
        dominant = total_90 > 0 and (first["count"] / total_90) >= 0.30
        not_tied = second is None or first["count"] > second["count"]
        if dominant and not_tied:
            top_driver = {"name": first["_id"], "attribution_count": first["count"]}

    all0 = all_agg[0] if all_agg else {}
    ytd0 = ytd_agg[0] if ytd_agg else {}
    all_litres = float(all0.get("total_litres") or 0)
    # v58.13.132df / .132dg — Reprice at read-time. Override=True
    # folds real prices into the provisional bucket.
    if override_smartfill:
        all_price = all_litres * provisional_price
        ytd_price = float(ytd0.get("total_litres") or 0) * provisional_price
    else:
        all_price = (
            float(all0.get("real_total_price") or 0)
            + float(all0.get("provisional_litres") or 0) * provisional_price
        )
        ytd_price = (
            float(ytd0.get("real_total_price") or 0)
            + float(ytd0.get("provisional_litres") or 0) * provisional_price
        )
    payload = {
        "card_number": card_number,
        "generated_at": now.isoformat(),
        "linked_vehicle": (
            {"id": linked["id"], "name": linked.get("name"),
             "rego_serial": linked.get("rego_serial")}
            if linked else None
        ),
        "all_time": {
            "total_price": round(all_price, 2),
            "total_litres": round(all_litres, 2),
            "fill_count": int(all0.get("count") or 0),
            "avg_price_per_litre": round(all_price / all_litres, 3) if all_litres > 0 else None,
            "first_seen": all0.get("first_ts"),
            "last_seen": all0.get("last_ts"),
        },
        "ytd": {
            "total_price": round(ytd_price, 2),
            "total_litres": round(float(ytd0.get("total_litres") or 0), 2),
            "fill_count": int(ytd0.get("count") or 0),
        },
        "fills_30d": count_30d,
        "anomaly_count_90d": anom_90,
        "top_driver_90d": top_driver,
    }

    # v58.13.132bu — When the card is not formally linked to a vehicle
    # (`assets.smartfill_card_number` unset), compute an inferred rego
    # from the majority `asset_id` across the last 90 days. Surfaces
    # the fact that the SmartFill importer's per-txn matcher already
    # figured out the vehicle even before an admin sets the formal
    # link.
    payload["inferred_rego"] = None
    if not linked:
        agg = await db.fuel_transactions.aggregate([
            {"$match": {**base, "timestamp": {"$gte": d90},
                        "asset_id": {"$nin": [None, ""]}}},
            {"$group": {"_id": "$asset_id", "count": {"$sum": 1}}},
            {"$sort": {"count": -1}}, {"$limit": 1},
        ]).to_list(1)
        if agg:
            best_asset_id = agg[0]["_id"]
            a = await db.assets.find_one(
                {"org_id": org_id, "id": best_asset_id, "deleted_at": None},
                {"_id": 0, "id": 1, "rego_serial": 1, "name": 1},
            )
            if a:
                payload["inferred_rego"] = a.get("rego_serial") or a.get("name") or None
                payload["inferred_asset_id"] = a.get("id")
                payload["inferred_fill_count_90d"] = agg[0]["count"]
    _CARD_SUMMARY_CACHE[ck] = (time.time(), payload)
    return payload


@router.get("/cards/{card_number}/transactions")
async def card_transactions(
    card_number: str,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    flagged_only: bool = Query(False),
    _flag: None = Depends(require_fleet_register_enabled),
    user: dict = Depends(require_permission("assets", "view")),
):
    q: dict = {"org_id": user["org_id"], "card_number": card_number, "deleted_at": None}
    if flagged_only:
        q["anomaly_flags"] = {"$ne": []}
    total = await db.fuel_transactions.count_documents(q)
    rows = [d async for d in db.fuel_transactions
            .find(q, {"_id": 0}).sort("timestamp", -1)
            .skip(offset).limit(limit)]
    # Enrich each row with its vehicle rego (single asset lookup batch).
    asset_ids = list({r.get("asset_id") for r in rows if r.get("asset_id")})
    regos: dict = {}
    if asset_ids:
        async for a in db.assets.find(
            {"org_id": user["org_id"], "id": {"$in": asset_ids}},
            {"_id": 0, "id": 1, "rego_serial": 1, "name": 1},
        ):
            regos[a["id"]] = a.get("rego_serial") or a.get("name")
    for r in rows:
        r["vehicle_rego"] = regos.get(r.get("asset_id"))
    return {"card_number": card_number, "total": total,
            "offset": offset, "limit": limit, "rows": rows}


class CardAssignBody(BaseModel):
    vehicle_id: str


@router.post("/cards/{card_number}/assign")
async def card_assign(
    card_number: str, body: CardAssignBody,
    _flag: None = Depends(require_fleet_register_enabled),
    user: dict = Depends(require_permission("assets", "edit")),
):
    """Link an unlinked SmartFill card to a vehicle by writing the
    card number onto the vehicle's `smartfill_card_number` field.
    Idempotent — re-assigning the same card to the same vehicle
    returns 200 with `no_change=True`."""
    if not card_number or not (body.vehicle_id or "").strip():
        raise HTTPException(400, "card_number and vehicle_id required")
    veh = await db.assets.find_one(
        {"org_id": user["org_id"], "id": body.vehicle_id, "deleted_at": None},
        {"_id": 0, "id": 1, "smartfill_card_number": 1, "name": 1, "rego_serial": 1},
    )
    if not veh:
        raise HTTPException(404, "Vehicle not found")
    if (veh.get("smartfill_card_number") or "").strip() == card_number.strip():
        return {"card_number": card_number, "vehicle_id": veh["id"],
                "vehicle_rego": veh.get("rego_serial"), "no_change": True}
    # Refuse if another vehicle already claims this card — force manual
    # unlink to avoid silent overwrites.
    conflict = await db.assets.find_one(
        {"org_id": user["org_id"],
         "smartfill_card_number": card_number,
         "id": {"$ne": body.vehicle_id}, "deleted_at": None},
        {"_id": 0, "id": 1, "name": 1, "rego_serial": 1},
    )
    if conflict:
        raise HTTPException(409, f"Card already linked to '{conflict.get('rego_serial') or conflict.get('name')}'")
    await db.assets.update_one(
        {"id": body.vehicle_id},
        {"$set": {"smartfill_card_number": card_number.strip(),
                  "updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    _bust_card_summary_cache(user["org_id"], card_number)
    return {"card_number": card_number, "vehicle_id": veh["id"],
            "vehicle_rego": veh.get("rego_serial"), "no_change": False}


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


# ── v58.13.132x — Fuel-card attribution admin endpoints ────────
class _FuelCardUpdate(BaseModel):
    attribution_kind: str  # vehicle | worker | shared | unassigned
    asset_id: Optional[str] = None
    worker_id: Optional[str] = None
    notes: Optional[str] = None


@router.get("/cards")
async def list_fuel_cards(
    only_unassigned: bool = Query(False, alias="unassigned_only"),
    q_text: Optional[str] = Query(None, alias="q"),
    _flag: None = Depends(require_fleet_register_enabled),
    user: dict = Depends(require_permission("assets", "view")),
):
    """List every `fuel_cards` row for the current org, with a
    denormalised asset/worker label for the admin table. Sort
    unassigned rows first, then by last_seen_at desc."""
    org_id = user["org_id"]
    q: dict = {"org_id": org_id}
    if only_unassigned:
        q["attribution_kind"] = {"$in": ["unassigned", "shared"]}
    if q_text:
        rex = {"$regex": q_text, "$options": "i"}
        q["$or"] = [
            {"card_number": rex}, {"smartfill_description": rex},
            {"smartfill_registration": rex}, {"notes": rex},
        ]
    rows = [d async for d in db.fuel_cards.find(q, {"_id": 0})]
    # Enrich labels
    asset_ids = list({r["asset_id"] for r in rows if r.get("asset_id")})
    worker_ids = list({r["worker_id"] for r in rows if r.get("worker_id")})
    a_by_id = {a["id"]: a async for a in db.assets.find(
        {"id": {"$in": asset_ids}}, {"id": 1, "name": 1, "rego_serial": 1},
    )}
    w_by_id = {w["id"]: w async for w in db.workers.find(
        {"id": {"$in": worker_ids}}, {"id": 1, "first_name": 1, "last_name": 1},
    )}
    for r in rows:
        a = a_by_id.get(r.get("asset_id") or "")
        w = w_by_id.get(r.get("worker_id") or "")
        r["asset_label"] = (
            f"{a['name']} · {a.get('rego_serial') or ''}".strip(" ·")
            if a else None
        )
        r["worker_label"] = (
            f"{w.get('first_name','')} {w.get('last_name','')}".strip()
            if w else None
        )
    kind_rank = {"unassigned": 0, "shared": 1, "worker": 2, "vehicle": 3}
    rows.sort(key=lambda r: (
        kind_rank.get(r.get("attribution_kind"), 9),
        -(len(r.get("last_seen_at") or "")),
        r.get("last_seen_at") or "",
    ), reverse=False)
    return {"rows": rows, "total": len(rows)}


@router.patch("/cards/{card_number}")
async def update_fuel_card(
    card_number: str,
    body: _FuelCardUpdate,
    _flag: None = Depends(require_fleet_register_enabled),
    user: dict = Depends(require_permission("assets", "edit")),
):
    """Update the attribution of a fuel card. Admin only."""
    if body.attribution_kind not in ("vehicle", "worker", "shared", "unassigned"):
        raise HTTPException(status_code=400, detail="invalid attribution_kind")
    if body.attribution_kind == "vehicle" and not body.asset_id:
        raise HTTPException(status_code=400, detail="asset_id required when kind=vehicle")
    if body.attribution_kind == "worker" and not body.worker_id:
        raise HTTPException(status_code=400, detail="worker_id required when kind=worker")
    org_id = user["org_id"]
    existing = await db.fuel_cards.find_one(
        {"org_id": org_id, "card_number": card_number}
    )
    if not existing:
        raise HTTPException(status_code=404, detail="fuel card not found")
    now = now_iso()
    set_fields = {
        "attribution_kind": body.attribution_kind,
        "asset_id": body.asset_id if body.attribution_kind == "vehicle" else None,
        "worker_id": body.worker_id if body.attribution_kind == "worker" else None,
        "notes": body.notes if body.notes is not None else existing.get("notes"),
        "source": "manual",
        "assigned_by": user.get("id") or user.get("email") or "admin",
        "assigned_at": now,
        "updated_at": now,
    }
    await db.fuel_cards.update_one(
        {"org_id": org_id, "card_number": card_number},
        {"$set": set_fields},
    )
    return {"ok": True, "card_number": card_number, **set_fields}

"""v58.13.109b — Legacy site-signin → site_visitors migration.

RECORD COUNT (ship day): 1 live row in
`db.form_submissions` where
`template_id == 'e8873f7e-6fd4-44c9-961a-d68e6ffecd8d'`. Well below
the 1000-row threshold that would have deferred this migration to
v58.14.x with a proper mapping spec.

STRATEGY: one-shot, idempotent, MANUAL invocation (no startup wiring).
Every row already in `site_visitors` that carries the
`legacy_form_submission_id` field pointing at a source
`form_submissions.id` is skipped, so re-running the script is safe.

FIELD MAPPING (form_submissions.fields[] → site_visitors)
    site.value.id            → site_id
    site.value.name          → (recorded in migration audit)
    visitor_name.value.name  → name  (falls back to submitted_by_name
                                       when the picker was empty)
    visitor_company.value    → company
    visitor_phone.value      → phone
    vehicle_rego.value       → vehicle_rego
    purpose.value            → purpose
    host_name.value          → visiting_person
    ppe_briefed.value=="Yes" → induction_acknowledged
    time_in.value + date     → signed_in_at (composed from
                                submitted_at date + HH:MM in
                                time_in.value; falls back to
                                submitted_at wholesale on parse
                                failure).
    submitted_at             → created_at + signed_in_at fallback
    submitted_by             → source_user_id (audit only)

LOSSY FIELDS (deliberately dropped — flag for user review if needed)
    signature (base64 PNG)   — no `site_visitors` field carries it
                                today; the .106 flow captures its own
                                signature on the receipt view.
    emergency_contact_name   — not part of the .106 schema.
    emergency_contact_phone  — not part of the .106 schema.
    id_sighted               — not part of the .106 schema (implicit
                                in the sighted-by-supervisor workflow).
    photo (visitor photo)    — not part of the .106 schema.
    gps.value                → mapped to gps_lat / gps_lng if the
                                submission carried a fix; otherwise
                                null (which matches the .106 anon
                                flow's behaviour when the browser
                                denies geolocation).
    vehicle_type             — not part of the .106 schema (rego
                                already recorded).

USAGE (from repo root):
    python -m backend.scripts.migrate_legacy_signins_v58_13_109b

Prints before/after counts. Safe to rerun.
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from dotenv import load_dotenv


LEGACY_TEMPLATE_ID = "e8873f7e-6fd4-44c9-961a-d68e6ffecd8d"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _field(fields: list[dict], field_id: str) -> Any:
    for f in fields or []:
        if f.get("id") == field_id:
            return f.get("value")
    return None


def _picker_name(val: Any) -> Optional[str]:
    if isinstance(val, dict):
        return val.get("name")
    if isinstance(val, str):
        return val
    return None


def _picker_id(val: Any) -> Optional[str]:
    if isinstance(val, dict):
        return val.get("id")
    return None


def _text(val: Any) -> Optional[str]:
    if isinstance(val, str):
        v = val.strip()
        return v or None
    return None


def _compose_signed_in(submitted_at: Optional[str], time_in_hhmm: Optional[str]) -> str:
    """Compose ISO datetime from `submitted_at` date + `time_in` HH:MM.
    Falls back to `submitted_at` on any parse failure so a bad row
    never blocks the migration."""
    if not submitted_at:
        return _now_iso()
    try:
        base = datetime.fromisoformat(submitted_at.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return submitted_at
    if not time_in_hhmm or not isinstance(time_in_hhmm, str):
        return submitted_at
    try:
        hh, mm = time_in_hhmm.split(":", 1)
        composed = base.replace(hour=int(hh), minute=int(mm), second=0, microsecond=0)
        return composed.isoformat()
    except (ValueError, TypeError):
        return submitted_at


def _map_row(sub: dict) -> dict:
    """Transform a single form_submissions doc into a site_visitors doc."""
    fields = sub.get("fields") or []
    site_val = _field(fields, "site")
    name_val = _field(fields, "visitor_name")
    company_val = _field(fields, "visitor_company")
    phone_val = _field(fields, "visitor_phone")
    rego_val = _field(fields, "vehicle_rego")
    purpose_val = _field(fields, "purpose")
    host_val = _field(fields, "host_name")
    ppe_val = _field(fields, "ppe_briefed")
    time_in_val = _field(fields, "time_in")
    gps_val = _field(fields, "f_location_7b61ee")

    signed_in_at = _compose_signed_in(sub.get("submitted_at"), _text(time_in_val))
    now = _now_iso()

    gps_lat = None
    gps_lng = None
    if isinstance(gps_val, dict):
        gps_lat = gps_val.get("lat")
        gps_lng = gps_val.get("lng")

    return {
        "id": str(uuid.uuid4()),
        "org_id": sub.get("org_id"),
        "site_id": _picker_id(site_val),
        "site_scan_token": None,  # legacy form didn't carry a scan token
        "name": _picker_name(name_val) or sub.get("submitted_by_name") or "(unknown)",
        "company": _text(company_val),
        "phone": _text(phone_val),
        "purpose": _text(purpose_val),
        "visiting_person": _text(host_val),
        "vehicle_rego": _text(rego_val),
        "induction_acknowledged": (_text(ppe_val) or "").lower() == "yes",
        "signed_in_at": signed_in_at,
        "signed_out_at": None,
        "signed_out_by": None,
        "signed_out_reason": None,
        "source_ip": None,
        "source_user_agent": "legacy-form-template-migration-v58.13.109b",
        "gps_lat": gps_lat,
        "gps_lng": gps_lng,
        "created_at": sub.get("submitted_at") or now,
        "updated_at": now,
        # Provenance — lets the pytest + a rerun skip already-migrated rows.
        "legacy_form_submission_id": sub.get("id"),
        "legacy_form_submitted_by": sub.get("submitted_by"),
        "source": "legacy_signin_migration",
    }


async def _migrate(db) -> dict:
    stats = {"scanned": 0, "already_migrated": 0, "inserted": 0}
    async for sub in db.form_submissions.find(
        {"template_id": LEGACY_TEMPLATE_ID,
         "$or": [{"deleted_at": None}, {"deleted_at": {"$exists": False}}]},
        {"_id": 0},
    ):
        stats["scanned"] += 1
        existing = await db.site_visitors.find_one(
            {"legacy_form_submission_id": sub.get("id")},
            {"_id": 0, "id": 1},
        )
        if existing:
            stats["already_migrated"] += 1
            continue
        doc = _map_row(sub)
        await db.site_visitors.insert_one(dict(doc))
        stats["inserted"] += 1
    return stats


async def main():
    load_dotenv("/app/backend/.env")
    import sys
    sys.path.insert(0, "/app/backend")
    from db import db

    print("─" * 78)
    print("v58.13.109b · migrate_legacy_signins")
    print("─" * 78)

    before = await db.site_visitors.count_documents(
        {"source": "legacy_signin_migration"}
    )
    print(f"BEFORE: site_visitors with source=legacy_signin_migration: {before}")

    stats = await _migrate(db)
    print(f"scanned={stats['scanned']}  "
          f"already_migrated={stats['already_migrated']}  "
          f"inserted={stats['inserted']}")

    after = await db.site_visitors.count_documents(
        {"source": "legacy_signin_migration"}
    )
    print(f"AFTER:  site_visitors with source=legacy_signin_migration: {after}")
    print("─" * 78)


if __name__ == "__main__":
    asyncio.run(main())

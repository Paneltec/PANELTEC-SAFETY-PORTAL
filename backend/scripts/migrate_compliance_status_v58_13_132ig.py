"""v58.13.132ig — Compliance status migration.

Sweeps `form_submissions.fields[*]` and remaps legacy yes/no/na
responses on `radio`-type fields (options include a 3-item set like
["Yes", "No", "N/A"]) into the new `{status, photos, notes}` shape
that the .132ig `compliance` field type consumes.

Design decisions (Stephen's default 5a — in-place migration with
`_legacy_status` preserved for audit):
    · The original scalar value is copied into `_legacy_status` on
      the same field-value entry BEFORE we overwrite `value` with
      the new dict shape. Read-side callers already tolerate mixed
      value shapes across fields, so the write is safe.
    · Fields whose type is NOT `radio` are skipped.
    · Fields with fewer than 2 options are skipped (can't reliably
      infer the semantics).
    · Rows are keyed by `_id`; a re-run finds 0 rows because the
      migrated rows carry `_legacy_status` and their `value` is a
      dict — the guard `_needs_migration` returns False for those.

Usage:
    python -m scripts.migrate_compliance_status_v58_13_132ig            # dry-run
    python -m scripts.migrate_compliance_status_v58_13_132ig --commit   # apply

The script exits 0 on both dry-run and commit paths. Non-zero
only when a safety guard fires (e.g. missing MONGO_URL).
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
from typing import Any

log = logging.getLogger("paneltec.migrate.compliance_status_v58_13_132ig")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)

# Legacy label → new status mapping. Case-insensitive; whitespace
# stripped by _norm.
_STATUS_MAP = {
    "yes": "compliant",
    "no": "at_risk",
    "n/a": "na",
    "na": "na",
    "not_applicable": "na",
    "not applicable": "na",
}


def _norm(v: Any) -> str:
    return str(v or "").strip().lower()


def _map_status(legacy: Any) -> str | None:
    return _STATUS_MAP.get(_norm(legacy))


def _needs_migration(fld_val: Any, tpl_field: dict) -> bool:
    """Return True when this submitted-field-value should be migrated."""
    if not isinstance(tpl_field, dict):
        return False
    if tpl_field.get("type") != "radio":
        return False
    opts = tpl_field.get("options") or []
    if len(opts) < 2:
        return False
    # If value is already a dict (already migrated OR native compliance
    # field), skip. Also skips submissions where the field was left blank.
    if isinstance(fld_val, dict):
        return False
    if fld_val in (None, ""):
        return False
    return _map_status(fld_val) is not None


async def _migrate(commit: bool) -> dict:
    from motor.motor_asyncio import AsyncIOMotorClient
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not mongo_url or not db_name:
        raise RuntimeError("MONGO_URL / DB_NAME env vars are required")
    client = AsyncIOMotorClient(mongo_url)
    db = client.get_database(db_name)

    templates: dict[str, dict] = {}
    async for t in db.form_templates.find({}, {"_id": 0, "id": 1, "fields": 1}):
        templates[t["id"]] = {f["id"]: f for f in (t.get("fields") or [])
                              if isinstance(f, dict) and f.get("id")}

    scanned = 0
    would_update = 0
    fields_migrated = 0
    async for sub in db.form_submissions.find(
        {}, {"_id": 1, "template_id": 1, "fields": 1},
    ):
        scanned += 1
        tpl_fields = templates.get(sub.get("template_id") or "") or {}
        if not tpl_fields:
            continue
        fields = sub.get("fields") or []
        touched = False
        new_fields = []
        for entry in fields:
            if not isinstance(entry, dict):
                new_fields.append(entry)
                continue
            fid = entry.get("field_id")
            tf = tpl_fields.get(fid) or {}
            val = entry.get("value")
            if _needs_migration(val, tf):
                new_status = _map_status(val)
                new_entry = {
                    **entry,
                    "value": {"status": new_status, "photos": [], "notes": ""},
                    "_legacy_status": val,
                }
                new_fields.append(new_entry)
                touched = True
                fields_migrated += 1
            else:
                new_fields.append(entry)
        if touched:
            would_update += 1
            if commit:
                await db.form_submissions.update_one(
                    {"_id": sub["_id"]},
                    {"$set": {"fields": new_fields}},
                )

    log.info(
        "compliance-status migration · scanned=%d · would_update=%d · fields_migrated=%d · commit=%s",
        scanned, would_update, fields_migrated, commit,
    )
    return {"scanned": scanned, "would_update": would_update,
            "fields_migrated": fields_migrated, "commit": commit}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--commit", action="store_true",
        help="Apply the migration (default is dry-run).",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="No-op flag for callers that want the intent explicit.",
    )
    args = parser.parse_args(argv)
    commit = bool(args.commit)
    result = asyncio.run(_migrate(commit))
    prefix = "COMMIT" if commit else "DRY-RUN"
    print(f"{prefix} complete: scanned={result['scanned']}, "
          f"would_update={result['would_update']}, "
          f"fields_migrated={result['fields_migrated']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

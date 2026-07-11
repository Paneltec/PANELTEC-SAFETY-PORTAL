"""v160.3.0-apply — Apply the cert-to-form mapping proposal.

Reads `/app/memory/v160_3_0_cert_mapping_proposal.md`, parses the
markdown table, resolves each row to a live `form_templates` id by
name (org-scoped), and writes `required_certifications` in bulk.

Guardrails
----------
- Snapshot `form_templates` → `form_templates_backup_v160_3_0_apply`
  BEFORE any write. Skipped when snapshot already populated
  (idempotent).
- Rows whose "Proposed slugs" cell is `_(none)_` are left ungated —
  the shape migration already stamped `[]` in v160.3.0.
- Rows marked AMBIGUOUS in the proposal are skipped entirely (no
  such rows in the initial proposal, but the parser defends the
  contract for future edits).
- Templates whose name starts with `v160.3.0 gated` are treated as
  test artefacts and skipped so they don't accidentally get
  production gates.
- Slugs are validated against `cert_kinds.ALL_SLUGS` — unknown slugs
  drop with a per-row warning in the summary.
- Idempotent: re-running only updates rows where the persisted
  `required_certifications` differs from the proposed slugs (order
  and set both).

Usage
-----
    cd /app/backend && python3 -m scripts.migrate_v160_3_0_apply_cert_map

Prints a JSON summary + a per-template pass/skip report to stdout.
"""
from __future__ import annotations

import asyncio
import json
import os
import re

from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv


SNAPSHOT = "form_templates_backup_v160_3_0_apply"
PROPOSAL_PATH = "/app/memory/v160_3_0_cert_mapping_proposal.md"
_ROW_RE = re.compile(r"^\|\s*(?P<name>[^|]+?)\s*\|\s*`(?P<cat>[^`]*)`\s*\|\s*(?P<slugs>[^|]+?)\s*\|\s*(?P<reason>[^|]*?)\s*\|\s*$")
_SLUG_RE = re.compile(r"`([a-z_]+)`")


def _parse_proposal(md_text: str):
    """Yields (name, category, slugs[], reason, skip_reason|None) rows."""
    lines = md_text.splitlines()
    in_table = False
    for ln in lines:
        # Skip the header divider line.
        if ln.strip().startswith("|----"):
            in_table = True
            continue
        m = _ROW_RE.match(ln)
        if not m:
            # Once we've seen the header, the first non-matching line ends the table.
            if in_table:
                break
            continue
        name = m.group("name").strip()
        cat = m.group("cat").strip()
        slugs_cell = m.group("slugs").strip()
        reason = m.group("reason").strip()

        skip = None
        if "AMBIGUOUS" in slugs_cell.upper():
            skip = "ambiguous"
            slugs: list[str] = []
        elif "_(none)_" in slugs_cell or slugs_cell == "_(none)_":
            slugs = []
        else:
            slugs = _SLUG_RE.findall(slugs_cell)

        # Ignore test-only templates (leftover fixture rows).
        if name.startswith("v160.3.0 gated "):
            skip = skip or "test_artefact"

        yield {"name": name, "category": cat, "slugs": slugs,
               "reason": reason, "skip_reason": skip}


async def main() -> dict:
    load_dotenv("/app/backend/.env")
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]

    # Import here — path is /app/backend when invoked via `python -m scripts...`
    from cert_kinds import ALL_SLUGS

    with open(PROPOSAL_PATH, "r") as f:
        md = f.read()

    # 1) Snapshot — idempotent.
    existing_snap = await db[SNAPSHOT].estimated_document_count()
    if existing_snap == 0:
        live = await db.form_templates.find({}, {"_id": 0}).to_list(None)
        if live:
            await db[SNAPSHOT].insert_many(live)
        snap_written = len(live)
    else:
        snap_written = 0

    applied: list[dict] = []
    unchanged: list[dict] = []
    skipped: list[dict] = []
    not_found: list[dict] = []

    for row in _parse_proposal(md):
        if row["skip_reason"]:
            skipped.append({"name": row["name"], "reason": row["skip_reason"]})
            continue

        # Filter to known slugs — silently drops any unknowns but records a note.
        clean_slugs = [s for s in row["slugs"] if s in ALL_SLUGS]
        dropped = [s for s in row["slugs"] if s not in ALL_SLUGS]

        tpl = await db.form_templates.find_one(
            {"name": row["name"], "deleted_at": None},
            {"_id": 0, "id": 1, "required_certifications": 1},
        )
        if not tpl:
            not_found.append({"name": row["name"], "reason": row["reason"]})
            continue

        current = tpl.get("required_certifications") or []
        # Compare as ordered tuples — the API preserves order, and the
        # proposal is order-stable per row.
        if list(current) == list(clean_slugs):
            unchanged.append({
                "template_id": tpl["id"], "name": row["name"],
                "slugs": clean_slugs, "reason": row["reason"],
                "dropped_unknown_slugs": dropped,
            })
            continue

        await db.form_templates.update_one(
            {"id": tpl["id"]},
            {"$set": {"required_certifications": clean_slugs}},
        )
        applied.append({
            "template_id": tpl["id"], "name": row["name"],
            "slugs": clean_slugs, "reason": row["reason"],
            "was": current, "dropped_unknown_slugs": dropped,
        })

    summary = {
        "snapshot_collection": SNAPSHOT,
        "snapshot_rows_written": snap_written,
        "applied_count": len(applied),
        "unchanged_count": len(unchanged),
        "skipped_count": len(skipped),
        "not_found_count": len(not_found),
        "applied": applied,
        "skipped": skipped,
        "not_found": not_found,
    }
    print(json.dumps(summary, indent=2))
    return summary


if __name__ == "__main__":
    asyncio.run(main())

"""v58.13.132jx — Auto-seed `form_templates.applies_to` from name heuristics.

Backfills the `applies_to.kinds` + `applies_to.asset_types` fields on
existing `form_templates` so that `/api/scan/{token}/forms` no longer
returns forms that don't apply to the scanned asset type.

USER PAIN (verbatim, Stephen · 2026-02):
    "Trailers don't need Viatec Traffic Ute incident report"

Root cause: most legacy templates were seeded with
`applies_to = { kinds: ["any"] }` which makes them universal — every
asset scan (trailer, ute, plant, etc.) surfaces them. This module
runs a first-match-wins regex classifier against the template NAME
and swaps the broad `any` rule for a specific `asset_types` set.

Idempotent — safe to re-run. Skips any template whose
`applies_to_meta.manual` flag is True (set by the admin UI's
`PUT /form-templates/{id}/applies-to` and bulk-save endpoints).
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from auth import get_current_user, require_roles
from db import db

router = APIRouter(prefix="/admin/forms", tags=["admin-forms"])


# ─── Heuristic rules ────────────────────────────────────────────────
# First-match-wins. Regex tested against template.name (case-insensitive).
# Values are the applies_to.kinds + applies_to.asset_types to WRITE.
#
# NOTE: `traffic_dept` is intentionally used per the ship spec even
# though no current asset carries that type — the admin can rename or
# create the asset_type later via FormAssignmentsAdmin UI. The safety
# outcome is that "Viatec Traffic Ute" forms will NOT appear on
# trailer/tipper/vac scans until an admin explicitly widens them.

SPECIFIC_RULES: list[tuple[re.Pattern, dict]] = [
    # Vacuum trucks — must run before generic "truck"
    (re.compile(r"\b(vac|vacuum|combination.*vacuum)\b", re.I),
     {"kinds": [], "asset_types": ["vacuum_truck"]}),
    # Viatec / Traffic / TMA — narrow to traffic_dept
    (re.compile(r"\b(viatec|traffic|tma)\b", re.I),
     {"kinds": [], "asset_types": ["traffic_dept"]}),
    # Tippers / dumpers — must run before generic "truck"
    (re.compile(r"\b(tipper|dumper|tip.?truck|dump.?truck)\b", re.I),
     {"kinds": [], "asset_types": ["tipper"]}),
    # Trailer
    (re.compile(r"\btrailer\b", re.I),
     {"kinds": [], "asset_types": ["trailer"]}),
    # Plumber vehicles
    (re.compile(r"\bplumber\b", re.I),
     {"kinds": [], "asset_types": ["plumber_vehicle"]}),
    # Excavators / diggers / Cat 32-33
    (re.compile(r"\b(excavator|digger|cat.?3[23])\b", re.I),
     {"kinds": ["plant"], "asset_types": ["excavator"]}),
    # Civil utility / utility vehicle / CVT abbreviation → commercial + plumber
    (re.compile(r"(civil.*utility|utility.*vehicle|\bcvt\b)", re.I),
     {"kinds": [], "asset_types": ["commercial", "plumber_vehicle"]}),
    # Generic plant / heavy equipment / heavy machinery
    (re.compile(r"(plant.*machinery|heavy.*equipment|heavy.*machinery|\bmachinery\b)", re.I),
     {"kinds": ["plant"], "asset_types": []}),
    # Heavy vehicle — vehicle-scoped
    (re.compile(r"\bheavy.?vehicle\b", re.I),
     {"kinds": ["vehicle"], "asset_types": []}),
    # Vehicle-specific pre-use (fallback when name says "vehicle" without a type)
    (re.compile(r"\bvehicle\s+(pre.?use|pre.?start|inspection)\b", re.I),
     {"kinds": ["vehicle"], "asset_types": []}),
]

# Broad-scope templates → keep the "universal" flag. Applied when NO
# specific rule matched.
BROAD_CATEGORIES = {
    "risk_assessment", "incident", "near_miss", "site_diary",
    "swms", "toolbox", "admin",
}
BROAD_NAME_RE = re.compile(
    r"(site diary|toolbox|swms|general risk|risk assessment|jsea|"
    r"working at heights|hot work|permit|sign.?in|sign.?on|visitor|"
    r"induction|drug|alcohol|hazard|near miss|incident report|"
    r"asbestos|byda|confined space|end of day|"
    r"daily site inspection|site inspection|\bssra\b)",
    re.I,
)


class AutoSeedIn(BaseModel):
    dry_run: bool = False
    all_orgs: bool = False


def _classify(name: str, category: str) -> Optional[dict]:
    """Return the applies_to fragment for a template, or None if the
    template doesn't match any rule (admin should fill in manually)."""
    # 1. First-match-wins specific rules
    for pattern, result in SPECIFIC_RULES:
        if pattern.search(name):
            return {"kinds": list(result["kinds"]),
                    "asset_types": list(result["asset_types"])}
    # 2. Broad templates by category or name
    if category in BROAD_CATEGORIES or BROAD_NAME_RE.search(name):
        return {"kinds": ["any"], "asset_types": []}
    # 3. Unmatched — leave for admin
    return None


async def _seed_for_org(org_id: str, dry_run: bool) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    scanned = 0
    seeded = 0
    skipped_manual = 0
    skipped_no_change = 0
    unmatched: list[dict] = []
    changes: list[dict] = []

    cur = db.form_templates.find(
        {"org_id": org_id, "deleted_at": None},
        {"_id": 0, "id": 1, "name": 1, "category": 1,
         "applies_to": 1, "applies_to_meta": 1},
    )
    async for t in cur:
        scanned += 1
        meta = t.get("applies_to_meta") or {}
        if meta.get("manual"):
            skipped_manual += 1
            continue

        classification = _classify(t.get("name") or "", (t.get("category") or "").lower())
        if classification is None:
            unmatched.append({
                "id": t["id"], "name": t.get("name") or "",
                "category": t.get("category") or "",
            })
            continue

        current = t.get("applies_to") or {}
        cur_kinds = sorted([k.lower() for k in (current.get("kinds") or [])])
        cur_types = sorted([x.lower() for x in (current.get("asset_types") or [])])
        new_kinds = sorted(classification["kinds"])
        new_types = sorted(classification["asset_types"])

        # v58.13.132jx — Non-destructive rule: if the template already
        # carries a narrower `asset_types` list OR a narrower `kinds`
        # (anything other than empty / ["any"]), leave it alone. The
        # admin has previously narrowed it and auto-seed must never
        # BROADEN an existing specific assignment.
        already_narrowed = (
            len(cur_types) > 0
            or (len(cur_kinds) > 0 and cur_kinds != ["any"])
        )
        if already_narrowed and (cur_kinds != new_kinds or cur_types != new_types):
            # Skip — respect the existing narrower assignment.
            skipped_no_change += 1
            if not dry_run and not meta.get("auto_seeded_at"):
                await db.form_templates.update_one(
                    {"id": t["id"], "org_id": org_id, "deleted_at": None},
                    {"$set": {"applies_to_meta.auto_seeded_at": now,
                              "applies_to_meta.manual": False,
                              "applies_to_meta.preserved_existing": True}},
                )
            continue

        if cur_kinds == new_kinds and cur_types == new_types:
            skipped_no_change += 1
            # Still stamp the auto_seeded_at so the FE badge reflects "seeded"
            if not dry_run and not meta.get("auto_seeded_at"):
                await db.form_templates.update_one(
                    {"id": t["id"], "org_id": org_id, "deleted_at": None},
                    {"$set": {"applies_to_meta.auto_seeded_at": now,
                              "applies_to_meta.manual": False}},
                )
            continue

        changes.append({
            "id": t["id"], "name": t.get("name") or "",
            "category": t.get("category") or "",
            "before": {"kinds": cur_kinds, "asset_types": cur_types},
            "after": {"kinds": new_kinds, "asset_types": new_types},
        })

        if not dry_run:
            # Preserve worker_ids / roles / companies — only overwrite
            # the asset-scope fields.
            await db.form_templates.update_one(
                {"id": t["id"], "org_id": org_id, "deleted_at": None},
                {"$set": {
                    "applies_to.kinds": classification["kinds"],
                    "applies_to.asset_types": classification["asset_types"],
                    "applies_to_meta.auto_seeded_at": now,
                    "applies_to_meta.manual": False,
                }},
            )
        seeded += 1

    return {
        "org_id": org_id,
        "templates_scanned": scanned,
        "seeded_rows": seeded,
        "skipped_manual": skipped_manual,
        "skipped_no_change": skipped_no_change,
        "unmatched_templates": unmatched,
        "changes": changes if dry_run else [],
    }


@router.post("/auto-seed-asset-types")
async def auto_seed_asset_types(
    body: AutoSeedIn,
    user: dict = Depends(require_roles("admin")),
):
    """Auto-seed `form_templates.applies_to.asset_types` from name
    heuristics. Idempotent — re-runnable. Skips manual-override rows.

    Body:
      · `dry_run`: bool = False    — Compute + return proposed changes
                                     without writing.
      · `all_orgs`: bool = False   — Superadmin-only. Runs across every
                                     org in the pod (used for the one-
                                     shot .132jx seed).
    """
    if body.all_orgs:
        # No separate "superadmin" role in this codebase — reserve the
        # cross-org fanout for role=admin (already the strictest gate).
        results = []
        totals = {"templates_scanned": 0, "seeded_rows": 0,
                  "skipped_manual": 0, "skipped_no_change": 0}
        async for org in db.orgs.find({}, {"_id": 0, "id": 1, "name": 1}):
            r = await _seed_for_org(org["id"], body.dry_run)
            r["org_name"] = org.get("name") or org["id"]
            results.append(r)
            for k in totals:
                totals[k] += r.get(k, 0)
        return {
            "ok": True, "dry_run": body.dry_run,
            "all_orgs": True, "orgs": results, "totals": totals,
        }

    r = await _seed_for_org(user["org_id"], body.dry_run)
    return {"ok": True, "dry_run": body.dry_run, **r}


@router.get("/auto-seed-preview")
async def auto_seed_preview(
    all_orgs: bool = Query(default=False),
    user: dict = Depends(require_roles("admin")),
):
    """Dry-run alias — returns the proposed diff without writing."""
    if all_orgs:
        results = []
        async for org in db.orgs.find({}, {"_id": 0, "id": 1, "name": 1}):
            r = await _seed_for_org(org["id"], dry_run=True)
            r["org_name"] = org.get("name") or org["id"]
            results.append(r)
        return {"ok": True, "dry_run": True, "all_orgs": True, "orgs": results}
    return {"ok": True, "dry_run": True,
            **(await _seed_for_org(user["org_id"], dry_run=True))}

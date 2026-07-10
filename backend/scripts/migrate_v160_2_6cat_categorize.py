"""v160.2.6-cat — Form-template categorization correction.

Idempotent. Snapshots to `form_templates_backup_v160_2_6cat` on first
run. Applies title-based category corrections to templates the earlier
v160.0.13 seed mis-categorised. AMBIGUOUS templates are LEFT ALONE —
they need a human decision.

Corrections applied:
  · "Construction Heavy Equipment Pre-Op Checklist" : inspection → pre_start
  · "Daily Plant Inspection"                         : inspection → pre_start
  · "Equipment Pre-Use Checklist"                    : inspection → pre_start
  · "JSEA — Job Safety & Environmental Analysis"     : inspection → general

AMBIGUOUS (reported, not modified):
  · "Asbestos Awareness / Class B Removal"           — could be toolbox
    (induction-style) OR general. Leaving on `general`.
  · "Crane Lift / Rigging Plan"                      — could be
    permit-adjacent (general) OR pre_start (per-lift). Leaving on
    `general`.

Skipped as test/seed:
  BuilderTest renamed, Test AssetScan Template, Test Hot Work Permit,
  site-safety-checklist, v160.0.12 test template.
"""
from __future__ import annotations
import asyncio, os, sys
from pathlib import Path

_BE = Path(__file__).resolve().parent.parent
if str(_BE) not in sys.path:
    sys.path.insert(0, str(_BE))

from dotenv import load_dotenv
load_dotenv(_BE / ".env")

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

BACKUP = "form_templates_backup_v160_2_6cat"

CORRECTIONS: list[tuple[str, str]] = [
    ("Construction Heavy Equipment Pre-Operation Checklist", "pre_start"),
    ("Daily Plant Inspection",                                "pre_start"),
    ("Equipment Pre-Use Checklist",                           "pre_start"),
    ("JSEA — Job Safety & Environmental Analysis",            "general"),
]

AMBIGUOUS = [
    "Asbestos Awareness / Class B Removal",
    "Crane Lift / Rigging Plan",
]

# v160.2.6-cat addendum — Worker-role allowlist tightening.
# The Forms-per-role matrix stores per-role allowlists at
# `db.orgs.role_form_allowlist.{role}`. `None`/missing means "all
# enabled" (backwards-compat default from v160.0.13). This addendum
# seeds the Worker allowlist with the full current template set
# MINUS the templates in `WORKER_EXCLUDED_TITLES` — otherwise
# excluding a form has no effect while the allowlist is blanket-on.
#
# Idempotent: on rerun the script just filters excluded ids out of
# the existing allowlist without re-flipping anything.
WORKER_EXCLUDED_TITLES = [
    "Drug & Alcohol Test Record",
    # User may add more here later (JSEA, permits, Incident Report).
    # Do NOT act until they confirm — leave placeholder empty for now.
]


async def _worker_allowlist_pass(db) -> dict:
    """Ensure every org's Worker allowlist excludes the D&A Test.

    Returns stats: {orgs_touched, seeded, filtered, before, after, diff}.
    """
    stats = {"orgs_touched": 0, "seeded_from_blanket": 0,
             "filtered_existing": 0, "before": 0, "after": 0, "diff": 0}

    # Group templates by org_id so multi-org DBs are handled correctly.
    all_tpls = await db.form_templates.find(
        {"deleted_at": None}, {"_id": 0, "id": 1, "name": 1, "org_id": 1},
    ).to_list(5000)
    by_org: dict[str, list[dict]] = {}
    for t in all_tpls:
        by_org.setdefault(t.get("org_id"), []).append(t)

    for org_id, tpls in by_org.items():
        excluded_ids = {t["id"] for t in tpls if t.get("name") in WORKER_EXCLUDED_TITLES}
        all_ids = [t["id"] for t in tpls]
        if not excluded_ids:
            print(f"  · {org_id[:8]}… no excluded titles present, skip")
            continue

        org = await db.orgs.find_one({"id": org_id}, {"_id": 0, "role_form_allowlist": 1}) or {}
        current = (org.get("role_form_allowlist") or {}).get("worker")

        if current is None or not isinstance(current, list):
            # Blanket-enabled → seed with all - excluded.
            new_list = [x for x in all_ids if x not in excluded_ids]
            before_count = len(all_ids)  # effective
            after_count = len(new_list)
            stats["seeded_from_blanket"] += 1
        else:
            before_count = len(current)
            new_list = [x for x in current if x not in excluded_ids]
            after_count = len(new_list)
            if before_count == after_count:
                print(f"  · {org_id[:8]}… worker allowlist already clean ({before_count}), skip")
                continue
            stats["filtered_existing"] += 1

        await db.orgs.update_one(
            {"id": org_id},
            {"$set": {"role_form_allowlist.worker": new_list}},
        )
        stats["orgs_touched"] += 1
        stats["before"] += before_count
        stats["after"] += after_count
        stats["diff"] += (before_count - after_count)
        print(f"  ✓ {org_id[:8]}… worker allowlist: {before_count} → {after_count} "
              f"(-{before_count - after_count}: {sorted(t['name'] for t in tpls if t['id'] in excluded_ids)})")
    return stats


async def _snapshot(db):
    n = await db[BACKUP].estimated_document_count()
    if n > 0:
        print(f"[snapshot] skip — {BACKUP} has {n} docs")
        return
    rows = await db.form_templates.find({}).to_list(5000)
    if rows:
        await db[BACKUP].insert_many(rows)
        print(f"[snapshot] copied {len(rows)} → {BACKUP}")


async def main():
    url = os.environ.get("MONGO_URL"); dbn = os.environ.get("DB_NAME")
    if not url or not dbn: raise RuntimeError("MONGO_URL / DB_NAME not set")
    db = AsyncIOMotorClient(url)[dbn]
    print(f"[migration v160.2.6-cat] db={dbn}")
    await _snapshot(db)
    changed = unchanged = missing = 0
    for name, new_cat in CORRECTIONS:
        t = await db.form_templates.find_one({"name": name}, {"id": 1, "category": 1})
        if not t:
            print(f"  !! missing template: {name}"); missing += 1; continue
        if t.get("category") == new_cat:
            unchanged += 1; print(f"  ✓ {name} already `{new_cat}`, skip")
            continue
        await db.form_templates.update_one(
            {"id": t["id"]}, {"$set": {"category": new_cat}},
        )
        changed += 1
        print(f"  ✓ {name}: {t.get('category')} → {new_cat}")
    print()
    print("── AMBIGUOUS (unchanged — awaiting user decision) ──")
    for name in AMBIGUOUS:
        t = await db.form_templates.find_one({"name": name}, {"category": 1})
        cur = t.get("category") if t else "MISSING"
        print(f"  ⚠ {name} (currently `{cur}`)")

    print()
    print("── WORKER ALLOWLIST PASS (v160.2.6-cat addendum) ──")
    wa_stats = await _worker_allowlist_pass(db)

    print()
    print("── SUMMARY ──")
    print(f"  changed:                {changed}")
    print(f"  unchanged:              {unchanged}")
    print(f"  ambiguous:              {len(AMBIGUOUS)}")
    print(f"  missing:                {missing}")
    print(f"  worker allowlist orgs:  {wa_stats['orgs_touched']}")
    print(f"    seeded_from_blanket:  {wa_stats['seeded_from_blanket']}")
    print(f"    filtered_existing:    {wa_stats['filtered_existing']}")
    print(f"    total before / after / diff: {wa_stats['before']} / {wa_stats['after']} / -{wa_stats['diff']}")
    print("[migration v160.2.6-cat] done.")


if __name__ == "__main__":
    asyncio.run(main())

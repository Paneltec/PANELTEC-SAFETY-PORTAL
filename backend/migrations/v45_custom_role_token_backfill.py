"""v160.3.9.45 — Idempotent backfill of the 11 empty Simpro `custom_*`
UUID roles + Traffic Controller expansion + Cleaner role insert.

Marker-doc guarded via `bk_migrations.v160_3_9_45_custom_role_token_backfill`.
Runs once at server boot; every subsequent boot is a no-op.
"""
from __future__ import annotations
import logging
import uuid
from datetime import datetime, timezone

log = logging.getLogger("paneltec.migrations.v45")

MARKER_ID = "v160_3_9_45_custom_role_token_backfill"

CLUSTER_A_FIELD_WORKER = sorted([
    "certifications.view",
    "hazards.edit", "hazards.open", "hazards.view",
    "help.open", "help.view",
    "inductions.view",
    "notifications.use", "notifications.view",
    "pre_starts.edit", "pre_starts.open", "pre_starts.view",
    "reference_library.view",
    "site_diary.view",
    "swms.view",
    "workers.view",
])  # 16 tokens

CLUSTER_B_PLUMBER = sorted(list(set(CLUSTER_A_FIELD_WORKER + [
    "assets.view", "vehicles.view",
])))  # 18 tokens

CLUSTER_B_CLEANER = sorted([t for t in CLUSTER_A_FIELD_WORKER
                            if t not in {"swms.view", "inductions.view"}])  # 14 tokens

CLUSTER_C_DIRECTOR = sorted([
    "ai.use",
    "audit_exports.email", "audit_exports.view",
    "certifications.email", "certifications.open",
    "certifications.team_view", "certifications.view",
    "contractors.view",
    "hazards.email", "hazards.open", "hazards.team_view", "hazards.view",
    "incidents.email", "incidents.open", "incidents.team_view", "incidents.view",
    "inductions.email", "inductions.open", "inductions.team_view", "inductions.view",
    "inspections.email", "inspections.open", "inspections.team_view", "inspections.view",
    "notifications.use", "notifications.view",
    "pre_starts.email", "pre_starts.open", "pre_starts.team_view", "pre_starts.view",
    "reference_library.view",
    "renewals.email", "renewals.view",
    "risk_assessments.email", "risk_assessments.team_view", "risk_assessments.view",
    "site_diary.team_view", "site_diary.view",
    "swms.email", "swms.team_view", "swms.view",
    "workers.view",
    "help.view", "help.open",
])  # 44 tokens

CLUSTER_C_OPS_MANAGER = sorted(list(set(CLUSTER_C_DIRECTOR + [
    "hazards.edit", "incidents.edit", "pre_starts.edit",
])))

CLUSTER_C_BD_MANAGER = sorted([
    "ai.use",
    "audit_exports.email", "audit_exports.view",
    "certifications.email", "certifications.view",
    "contractors.view",
    "inductions.email", "inductions.view",
    "notifications.use", "notifications.view",
    "reference_library.view",
    "workers.view",
    "help.view", "help.open",
])

CLUSTER_C_SAFETY_MANAGER = sorted(list(set(CLUSTER_C_DIRECTOR + [
    "hazards.edit", "incidents.edit", "inspections.edit",
    "pre_starts.edit", "risk_assessments.edit", "site_diary.edit",
    "swms.edit", "certifications.edit", "inductions.edit",
])))

CLUSTER_D_ADMIN_SUPPORT = sorted([
    "audit_exports.view",
    "certifications.view", "certifications.email",
    "contractors.view", "contractors.email",
    "documents.view", "documents.open",
    "forms.view",
    "hazards.view",
    "incidents.view",
    "inductions.view",
    "inspections.view",
    "notifications.use", "notifications.view",
    "pre_starts.view",
    "reference_library.view",
    "renewals.view", "renewals.email",
    "risk_assessments.view",
    "site_diary.view",
    "swms.view",
    "workers.view",
    "help.view", "help.open",
])

BACKFILL_MAP = {
    "Construction Worker L1":         CLUSTER_A_FIELD_WORKER,
    "Construction Worker L2":         CLUSTER_A_FIELD_WORKER,
    "Construction Worker L3":         CLUSTER_A_FIELD_WORKER,
    "Construction Worker CW2":        CLUSTER_A_FIELD_WORKER,
    "Machine Operator":               CLUSTER_A_FIELD_WORKER,
    "Plumber":                        CLUSTER_B_PLUMBER,
    "Traffic Controller":             CLUSTER_A_FIELD_WORKER,
    "Director":                       CLUSTER_C_DIRECTOR,
    "Operations Manager":             CLUSTER_C_OPS_MANAGER,
    "Business Development Manager":   CLUSTER_C_BD_MANAGER,
    "Safety and Compliance Manager":  CLUSTER_C_SAFETY_MANAGER,
    "Admin Assistant":                CLUSTER_D_ADMIN_SUPPORT,
    "Administration":                 CLUSTER_D_ADMIN_SUPPORT,
}
CLEANER_TOKENS = CLUSTER_B_CLEANER


async def run_v45_migration(db) -> dict:
    """Idempotent. Returns a dict describing what was applied."""
    marker = await db.bk_migrations.find_one({"id": MARKER_ID})
    if marker and marker.get("completed_at"):
        log.info("[v45] backfill already applied at %s", marker.get("completed_at"))
        return {"skipped": True, "reason": "marker_present"}

    now = datetime.now(timezone.utc).isoformat()
    updates, inserts = [], []

    for role_name, tokens in BACKFILL_MAP.items():
        res = await db.roles.update_one(
            {"name": role_name},
            {"$set": {"permission_tokens": tokens, "updated_at": now}},
        )
        updates.append({"name": role_name, "matched": res.matched_count,
                        "modified": res.modified_count, "token_count": len(tokens)})
        if res.matched_count == 0:
            log.warning("[v45] role '%s' not found in db.roles — skipped", role_name)

    existing_cleaner = await db.roles.find_one({"name": "Cleaner"})
    if existing_cleaner:
        res = await db.roles.update_one(
            {"name": "Cleaner"},
            {"$set": {"permission_tokens": CLEANER_TOKENS, "updated_at": now}},
        )
        inserts.append({"name": "Cleaner", "action": "update-existing",
                        "matched": res.matched_count, "modified": res.modified_count,
                        "token_count": len(CLEANER_TOKENS)})
    else:
        new_cleaner = {"id": str(uuid.uuid4()), "name": "Cleaner",
                       "permission_tokens": CLEANER_TOKENS, "kind": "system",
                       "origin": "v45_backfill", "created_at": now, "updated_at": now}
        await db.roles.insert_one(new_cleaner)
        inserts.append({"name": "Cleaner", "action": "insert",
                        "id": new_cleaner["id"], "token_count": len(CLEANER_TOKENS)})

    await db.bk_migrations.update_one(
        {"id": MARKER_ID},
        {"$set": {"id": MARKER_ID, "completed_at": now,
                  "updates": updates, "inserts": inserts}},
        upsert=True,
    )
    log.info("[v45] backfill applied: %d updates + %d insert(s)",
             len(updates), len(inserts))
    return {"skipped": False, "updates": updates, "inserts": inserts}

"""v58.13.132be — One-time (idempotent) apply of Stephen-approved
STANDARD field-worker permission matrix to `paneltec_civil` AND
`viatec_traffic` roles.

Task (Stephen · 2026-02 · follow-up to `.132bd`):
    "Populate the standard permission matrix for Paneltec Civil AND
    Viatec Traffic — both get the IDENTICAL matrix (one-time copy,
    remain independently editable afterward). Same shape as the
    `.132bc` mirror script."

Matrix (Stephen · brief):
  ✅ Jobs / Assignments (own)    view + create + edit    (no direct
                                                          schema resource
                                                          — omitted)
  ✅ SWMS (own + assigned)       view + ack-only (use)
  ✅ Pre-starts / Toolbox forms  view + create + edit
                                 (interpreted broadly: pre_starts,
                                  site_diary, hazards, incidents,
                                  inspections, forms — all the daily
                                  capture flows a field worker uses)
  ✅ Timesheets (own)            (no `timesheets` resource in schema — omitted)
  ✅ Vehicles (own daily check)  view + create + edit
  ✅ Site scans / QR check-in    view + use
  ❌ Fuel transactions           (no `fuel` resource in schema; also
                                  explicitly denied for field workers)
  ❌ Users & Permissions         DENY ALL
  ❌ Roles/Backup/Health/Comms   DENY ALL (comms_safe_mode is the only
                                          matching schema resource)
  ❌ Simpro/SmartFill/Navixy     DENY ALL (integrations resource)
  ✅ Reports (own only)          (no `reports` resource — surfaced via
                                  `team_view=False` on capture
                                  resources, which per
                                  `resolve_team_scope` constrains
                                  list queries to `created_by == user`)

Also granted (minimum-viable mobile experience — Stephen's brief said
"same shape" as `.132bc` mirror, i.e. cover every schema resource
explicitly so the drawer shows real Allow/Deny values instead of
falling through to the seed defaults):

  view-only:  risk_assessments, assets, inductions, certifications,
              workers, documents, reference_library, notifications,
              help
  view+use:   ai (Ask Intelligence)
  view+edit+use: sites_visitors (worker signs a visitor on)

  denied: users, integrations, comms_safe_mode, audit_exports,
          contractors, renewals, suppliers, hr_employees

Idempotency:
    Re-running with no changes produces the same state (equality check
    on `permission_tokens` set + `permissions` dict before writing).

Independence:
    The `.132bc` mirror script left the two roles pointing at the same
    (empty) shape; this script writes the SAME payload to BOTH but the
    documents remain separate rows in `db.roles` and
    `db.permission_presets` — editing one via the admin drawer does
    not touch the other. Guardrail: `test_v58_13_132be_matrix.py`
    proves independence post-apply.

Usage:
    python scripts/apply_standard_matrix_v58_13_132be.py             # dry-run
    python scripts/apply_standard_matrix_v58_13_132be.py --commit
"""
from __future__ import annotations
import argparse
import asyncio
import sys
from datetime import datetime, timezone
from typing import Dict, List, Set

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")

from db import db  # noqa: E402
from roles_catalogue import PERMISSIONS_SCHEMA, ACTIONS  # noqa: E402

TARGETS: List[str] = ["paneltec_civil", "viatec_traffic"]

# ── Standard field-worker matrix ────────────────────────────────
# Per-resource action list. Empty list = DENY ALL (explicit deny —
# still writes {} into the permissions dict for that resource so the
# drawer shows real Deny cells rather than falling through to seed
# defaults).
STANDARD_MATRIX: Dict[str, List[str]] = {
    # ─── Capture flows (View + Create + Edit, no Delete) ───
    "pre_starts":       ["open", "view", "edit", "use"],
    "site_diary":       ["open", "view", "edit", "use"],
    "hazards":          ["open", "view", "edit", "use"],
    "incidents":        ["open", "view", "edit", "use"],
    "inspections":      ["open", "view", "edit", "use"],
    "forms":            ["open", "view", "edit", "use"],

    # ─── SWMS: view + ack-only (use enables the mobile ack flow) ───
    "swms":             ["open", "view", "use"],
    "risk_assessments": ["open", "view"],

    # ─── Vehicles / Plant (own daily check) ───
    "vehicles":         ["open", "view", "edit", "use"],
    "assets":           ["open", "view"],

    # ─── Sites / QR sign-on ───
    "sites":            ["open", "view", "use"],
    "sites_visitors":   ["open", "view", "edit", "use"],

    # ─── Reference material / self-service ───
    "inductions":       ["open", "view", "use"],
    "certifications":   ["open", "view"],
    "workers":          ["open", "view"],
    "documents":        ["open", "view"],
    "reference_library":["open", "view"],
    "notifications":    ["open", "view"],
    "help":             ["open", "view"],
    "ai":               ["open", "view", "use"],

    # ─── EXPLICITLY DENIED (Stephen's four "❌" buckets) ───
    "users":            [],   # Users & Permissions
    "integrations":     [],   # Simpro sync / SmartFill / Navixy
    "comms_safe_mode":  [],   # Comms Safe Mode toggle
    "audit_exports":    [],   # Reports / exports (admin scope)
    "contractors":      [],   # Admin scope
    "renewals":         [],   # Admin scope
    "suppliers":        [],   # Admin scope
    "hr_employees":     [],   # HR admin scope
}


def _validate_matrix() -> None:
    """Fail-fast: every resource in STANDARD_MATRIX must exist in
    PERMISSIONS_SCHEMA, and every action must be in ACTIONS. Also
    verify no `email` action leaks onto a resource that doesn't
    support it."""
    missing_resources = set(STANDARD_MATRIX) - set(PERMISSIONS_SCHEMA)
    if missing_resources:
        raise SystemExit(f"STANDARD_MATRIX references unknown resources: {missing_resources}")
    for r, actions in STANDARD_MATRIX.items():
        bad = set(actions) - set(ACTIONS)
        if bad:
            raise SystemExit(f"STANDARD_MATRIX[{r}] has unknown actions: {bad}")
        if "email" in actions and not PERMISSIONS_SCHEMA[r].get("email_supported"):
            raise SystemExit(f"STANDARD_MATRIX[{r}] grants `email` but resource does not support it")
        if "delete" in actions and not PERMISSIONS_SCHEMA[r].get("delete_supported"):
            raise SystemExit(f"STANDARD_MATRIX[{r}] grants `delete` but resource does not support it")


def _build_payload() -> tuple[List[str], Dict[str, Dict[str, bool]]]:
    """Compose (permission_tokens[], permissions{}) from STANDARD_MATRIX.

    `permission_tokens[]` is the authoritative field the runtime engine
    reads (`permissions.py::_role_tokens`). `permissions{}` mirrors the
    same information in `{resource: {action: bool}}` shape for the
    admin drawer UI.
    """
    tokens: Set[str] = set()
    perms: Dict[str, Dict[str, bool]] = {}
    # Every schema resource gets a full action dict so the drawer
    # shows real cells (no undefined = fallback-to-seed rendering).
    for resource, meta in PERMISSIONS_SCHEMA.items():
        granted = set(STANDARD_MATRIX.get(resource, []))
        resource_perms: Dict[str, bool] = {}
        for action in ACTIONS:
            # Skip actions that don't apply to this resource.
            if action == "email" and not meta.get("email_supported"):
                continue
            if action == "delete" and not meta.get("delete_supported"):
                continue
            is_granted = action in granted
            resource_perms[action] = is_granted
            if is_granted:
                tokens.add(f"{resource}.{action}")
        perms[resource] = resource_perms
    return sorted(tokens), perms


async def _load_role(role_id: str) -> dict:
    doc = await db.roles.find_one({"role_id": role_id}, {"_id": 0})
    if not doc:
        raise SystemExit(f"roles.{role_id} not found — cannot apply matrix")
    return doc


async def _load_preset(role_id: str) -> dict | None:
    return await db.permission_presets.find_one({"role_id": role_id}, {"_id": 0})


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true")
    args = ap.parse_args()

    _validate_matrix()
    new_tokens, new_permissions = _build_payload()

    print("─" * 60)
    print(f"Standard matrix — {len(new_tokens)} tokens across "
          f"{sum(1 for v in STANDARD_MATRIX.values() if v)} allowed resources.")
    print(f"Target roles: {TARGETS}")
    print("─" * 60)

    plan: Dict[str, Dict[str, tuple]] = {}
    for role_id in TARGETS:
        role = await _load_role(role_id)
        preset = await _load_preset(role_id)
        role_delta: Dict[str, tuple] = {}
        cur_tokens = sorted(set(role.get("permission_tokens") or []))
        cur_perms = role.get("permissions") or {}
        if cur_tokens != new_tokens:
            role_delta["permission_tokens"] = (
                len(cur_tokens), len(new_tokens),
            )
        if cur_perms != new_permissions:
            role_delta["permissions"] = (
                len(cur_perms), len(new_permissions),
            )
        preset_delta: Dict[str, tuple] = {}
        if preset:
            cur_preset_perms = preset.get("permissions") or {}
            if cur_preset_perms != new_permissions:
                preset_delta["permissions"] = (
                    len(cur_preset_perms), len(new_permissions),
                )
        plan[role_id] = {"role": role_delta, "preset": preset_delta}
        print(f"  {role_id}:")
        for scope in ("role", "preset"):
            for f, (before, after) in plan[role_id][scope].items():
                print(f"    {scope}.{f}: {before} → {after}")
        if not (role_delta or preset_delta):
            print(f"    (no-op — already matches standard matrix)")

    if not args.commit:
        print("\n(dry-run — no writes) run with --commit to apply")
        return

    now_iso = datetime.now(timezone.utc).isoformat()
    for role_id, deltas in plan.items():
        if deltas["role"]:
            await db.roles.update_one(
                {"role_id": role_id},
                {"$set": {
                    "permission_tokens": new_tokens,
                    "permissions": new_permissions,
                    "updated_at": now_iso,
                    "_standard_matrix_applied_at": now_iso,
                    "_standard_matrix_version": "v58.13.132be",
                }},
            )
            print(f"WROTE roles.{role_id}: permission_tokens + permissions")
        if deltas["preset"]:
            await db.permission_presets.update_one(
                {"role_id": role_id},
                {"$set": {
                    "permissions": new_permissions,
                    "updated_at": now_iso,
                    "_standard_matrix_applied_at": now_iso,
                    "_standard_matrix_version": "v58.13.132be",
                }},
            )
            print(f"WROTE permission_presets.{role_id}: permissions")

    # Note: `permissions.py::_ROLE_TOKENS_CACHE` is per-process, so
    # calling `_bust_role_cache` from this CLI script would only clear
    # our own (about-to-exit) process. The live FastAPI worker still
    # holds the stale entry. Caller must `sudo supervisorctl restart
    # backend` (or POST /api/admin/roles/{role_id} to invalidate via
    # `_bust_role_cache` in the request handler) after `--commit`.
    print("\nComplete. Restart the backend supervisor to invalidate the "
          "in-memory role-tokens cache:")
    print("    sudo supervisorctl restart backend")
    print("Roles remain independently editable — no ongoing hard mirror.")


if __name__ == "__main__":
    asyncio.run(main())

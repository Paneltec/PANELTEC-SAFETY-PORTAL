"""v58.13.132be — Guardrail: standard field-worker matrix applied to
`paneltec_civil` AND `viatec_traffic` roles + presets, and the two
roles remain structurally independent (editing one doesn't touch the
other).
"""
from __future__ import annotations
import os
import pytest
from pymongo import MongoClient
from dotenv import load_dotenv

pytestmark = pytest.mark.live_db_writes

TARGET_ROLES = ["paneltec_civil", "viatec_traffic"]

# Positive tokens — every one of these MUST be present on both roles.
KEY_TOKENS_PRESENT = {
    # Capture flows: view + create + edit
    "pre_starts.view", "pre_starts.edit",
    "site_diary.view", "site_diary.edit",
    "hazards.view", "hazards.edit",
    "incidents.view", "incidents.edit",
    "inspections.view", "inspections.edit",
    "forms.view", "forms.edit",
    # SWMS: view + use (ack), no edit
    "swms.view", "swms.use",
    # Vehicles daily check
    "vehicles.view", "vehicles.edit",
    # Site QR sign-on
    "sites.view", "sites.use",
    # Reference material
    "inductions.view", "certifications.view", "documents.view",
    "notifications.view", "help.view", "ai.view", "ai.use",
    "workers.view",
}

# Negative tokens — every one of these MUST be absent on both roles.
KEY_TOKENS_ABSENT = {
    # Admin surface: Users & Permissions
    "users.view", "users.edit", "users.delete",
    # Integrations (Simpro / SmartFill / Navixy admin)
    "integrations.view", "integrations.edit", "integrations.delete",
    # Comms safe mode toggle
    "comms_safe_mode.view", "comms_safe_mode.edit",
    # Admin scope
    "contractors.view", "contractors.edit",
    "renewals.view", "renewals.edit",
    "suppliers.view", "suppliers.edit",
    "audit_exports.view", "audit_exports.edit",
    "hr_employees.view", "hr_employees.edit",
    # SWMS edit / delete — workers can only view/ack
    "swms.edit", "swms.delete",
    # No delete of any capture form (own or otherwise)
    "pre_starts.delete", "hazards.delete", "incidents.delete",
    "inspections.delete", "site_diary.delete", "forms.delete",
    "vehicles.delete",
    # No team_view — workers are constrained to own records
    "pre_starts.team_view", "hazards.team_view", "incidents.team_view",
    # No approve/reveal_pii on any resource
    "swms.approve", "hazards.approve", "incidents.approve",
    "workers.reveal_pii",
}


@pytest.fixture(scope="module")
def db_sync():
    load_dotenv("/app/backend/.env")
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


@pytest.mark.parametrize("role_id", TARGET_ROLES)
def test_role_has_non_empty_permission_tokens(db_sync, role_id):
    """Both target roles carry a populated `permission_tokens` list."""
    doc = db_sync.roles.find_one({"role_id": role_id}, {"_id": 0, "permission_tokens": 1})
    assert doc, f"roles.{role_id} missing"
    tokens = doc.get("permission_tokens") or []
    assert tokens, f"roles.{role_id}.permission_tokens is empty — matrix not applied"
    assert len(tokens) >= 50, f"roles.{role_id} has only {len(tokens)} tokens (expected ≥50)"


@pytest.mark.parametrize("role_id", TARGET_ROLES)
def test_role_has_populated_permissions_dict(db_sync, role_id):
    """Both target roles carry a populated `permissions` dict (mirror
    of tokens in the {resource: {action: bool}} shape the admin
    drawer renders)."""
    doc = db_sync.roles.find_one({"role_id": role_id}, {"_id": 0, "permissions": 1})
    perms = doc.get("permissions") or {}
    assert perms, f"roles.{role_id}.permissions is empty"
    assert len(perms) >= 28, (
        f"roles.{role_id}.permissions covers only {len(perms)} resources "
        f"(expected the full 28 for real Allow/Deny cells in the drawer)"
    )
    # Every value must be a dict of action → bool.
    for resource, actions in perms.items():
        assert isinstance(actions, dict), f"{resource} is not a dict"
        for action, val in actions.items():
            assert isinstance(val, bool), (
                f"roles.{role_id}.permissions[{resource}][{action}] "
                f"is {type(val).__name__}, expected bool"
            )


@pytest.mark.parametrize("role_id", TARGET_ROLES)
def test_role_grants_all_key_positive_tokens(db_sync, role_id):
    doc = db_sync.roles.find_one({"role_id": role_id}, {"_id": 0, "permission_tokens": 1})
    tokens = set(doc.get("permission_tokens") or [])
    missing = KEY_TOKENS_PRESENT - tokens
    assert not missing, f"roles.{role_id} missing required tokens: {sorted(missing)}"


@pytest.mark.parametrize("role_id", TARGET_ROLES)
def test_role_denies_all_key_negative_tokens(db_sync, role_id):
    doc = db_sync.roles.find_one({"role_id": role_id}, {"_id": 0, "permission_tokens": 1})
    tokens = set(doc.get("permission_tokens") or [])
    leaked = KEY_TOKENS_ABSENT & tokens
    assert not leaked, f"roles.{role_id} leaks forbidden tokens: {sorted(leaked)}"


def test_both_roles_have_identical_matrix_at_ship_time(db_sync):
    """The one-time copy applied `.132be` writes the SAME payload to
    both roles. This test verifies parity at ship time; subsequent
    independent edits are expected to drift the two apart and are
    allowed (see `test_matrix_edits_are_independent`)."""
    a = db_sync.roles.find_one({"role_id": "paneltec_civil"},
                               {"_id": 0, "permission_tokens": 1, "permissions": 1})
    b = db_sync.roles.find_one({"role_id": "viatec_traffic"},
                               {"_id": 0, "permission_tokens": 1, "permissions": 1})
    assert sorted(a.get("permission_tokens") or []) == sorted(b.get("permission_tokens") or []), \
        "paneltec_civil and viatec_traffic diverged before an independent edit"
    assert (a.get("permissions") or {}) == (b.get("permissions") or {}), \
        "paneltec_civil and viatec_traffic permissions dicts diverged"


def test_matrix_edits_are_independent(db_sync):
    """Guardrail (same shape as `.132bc` test): the two documents live
    in separate rows keyed by `role_id`. Mutating one via a
    single-document update does NOT touch the other.
    """
    from datetime import datetime, timezone
    marker = datetime.now(timezone.utc).isoformat()
    # Tag paneltec_civil with a throw-away breadcrumb.
    db_sync.roles.update_one(
        {"role_id": "paneltec_civil"},
        {"$set": {"_independence_probe_at": marker}},
    )
    try:
        pc = db_sync.roles.find_one({"role_id": "paneltec_civil"},
                                    {"_id": 0, "_independence_probe_at": 1})
        vt = db_sync.roles.find_one({"role_id": "viatec_traffic"},
                                    {"_id": 0, "_independence_probe_at": 1})
        assert pc.get("_independence_probe_at") == marker
        assert vt.get("_independence_probe_at") != marker, (
            "Editing paneltec_civil leaked into viatec_traffic — "
            "roles are NOT independent"
        )
    finally:
        db_sync.roles.update_one(
            {"role_id": "paneltec_civil"},
            {"$unset": {"_independence_probe_at": ""}},
        )


def test_permission_presets_mirror_role_permissions(db_sync):
    """`permission_presets.{role_id}.permissions` should equal
    `roles.{role_id}.permissions` post-`.132be` so the admin drawer's
    "Apply preset" button surfaces the same matrix that the role
    grants at runtime."""
    for role_id in TARGET_ROLES:
        role = db_sync.roles.find_one({"role_id": role_id},
                                      {"_id": 0, "permissions": 1})
        preset = db_sync.permission_presets.find_one(
            {"role_id": role_id}, {"_id": 0, "permissions": 1},
        )
        assert preset, f"permission_presets.{role_id} missing"
        assert (preset.get("permissions") or {}) == (role.get("permissions") or {}), (
            f"permission_presets.{role_id} out of sync with roles.{role_id}"
        )


def test_migration_is_idempotent():
    """Re-running the script produces zero planned writes when the DB
    is already at the standard matrix state."""
    import subprocess, sys
    p = subprocess.run(
        [sys.executable,
         "/app/backend/scripts/apply_standard_matrix_v58_13_132be.py"],
        capture_output=True, text=True, timeout=30,
    )
    assert p.returncode == 0, p.stderr
    # Every target line should be "(no-op — already matches standard matrix)".
    for role_id in TARGET_ROLES:
        assert f"{role_id}:" in p.stdout, p.stdout
    assert p.stdout.count("(no-op — already matches standard matrix)") == len(TARGET_ROLES), \
        f"Idempotency broken:\n{p.stdout}"

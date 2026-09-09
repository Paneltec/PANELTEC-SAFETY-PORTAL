"""v58.13.132bc — Guardrail for the Paneltec Civil → Viatec Traffic
Solutions permission mirror.

Locks in three properties:
  1. **Preset copy is complete** — every permission key that exists
     on `roles.paneltec_civil` also exists on `roles.viatec_traffic`
     with an identical value AFTER the mirror runs.
  2. **Independence** — editing one role's permission matrix does
     NOT mutate the other's (no persistent hard mirror).
  3. **Idempotency** — running the script twice yields the same
     end-state as running it once.
"""
from __future__ import annotations
import asyncio
import copy
import os
import pytest
from pymongo import MongoClient
from dotenv import load_dotenv

pytestmark = pytest.mark.live_db_writes


@pytest.fixture(scope="module")
def db_sync():
    load_dotenv("/app/backend/.env")
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


@pytest.fixture(scope="module", autouse=True)
def restore_matrix_after_module(db_sync):
    """v58.13.132bk — This module's tests DELIBERATELY overwrite
    `roles.paneltec_civil.permission_tokens` + `.permissions` with
    tiny seed matrices to exercise the mirror script's semantics.
    Historically that leaked state, wiping the `.132be` standard
    matrix on every run and breaking every subsequent guardrail
    that reads either role.

    Re-apply the standard matrix once the module finishes so the
    post-test DB matches its pre-test invariant.
    """
    yield
    import subprocess, sys
    p = subprocess.run(
        [sys.executable,
         "/app/backend/scripts/apply_standard_matrix_v58_13_132be.py",
         "--commit"],
        capture_output=True, text=True, timeout=30,
    )
    assert p.returncode == 0, (
        "matrix restore failed after .132bc suite:\n"
        f"stdout={p.stdout}\nstderr={p.stderr}"
    )


@pytest.fixture
def mirror_run():
    """Run the mirror script as a subprocess so each invocation gets
    a fresh asyncio loop (motor's client caches its own loop). We
    can't share `asyncio.run` across tests without hitting
    `RuntimeError: Event loop is closed` on the second call."""
    import subprocess, sys

    def _run():
        p = subprocess.run(
            [sys.executable,
             "/app/backend/scripts/mirror_paneltec_to_viatec_v58_13_132bc.py",
             "--commit"],
            capture_output=True, text=True, timeout=30,
        )
        assert p.returncode == 0, (
            f"mirror exit {p.returncode}\nstdout={p.stdout}\nstderr={p.stderr}"
        )
        return p.stdout
    return _run


def test_mirror_makes_targets_identical_on_copied_fields(db_sync, mirror_run):
    """v58.13.132bc — Every copied field on the target matches the
    source AFTER the migration runs, using whatever the source
    currently holds (empty at ship time, non-empty in the future)."""
    # Seed the source with a non-trivial permission matrix so this
    # test is meaningful even when the shipped DB has both roles empty.
    seed_perms = {
        "swms": {"open": True, "view": True, "edit": True, "delete": False,
                 "email": True, "team_view": True, "approve": False},
        "pre_starts": {"open": True, "view": True, "edit": True, "delete": False,
                       "email": False, "team_view": True, "approve": False},
    }
    seed_tokens = ["swms.read", "swms.write", "pre_starts.read"]
    db_sync.roles.update_one(
        {"role_id": "paneltec_civil"},
        {"$set": {"permissions": seed_perms,
                  "permission_tokens": seed_tokens,
                  "supersedes_role_id": "general_user"}},
    )
    db_sync.permission_presets.update_one(
        {"role_id": "paneltec_civil"},
        {"$set": {"permissions": seed_perms}},
    )

    # Poison the target so we can prove the copy fires.
    db_sync.roles.update_one(
        {"role_id": "viatec_traffic"},
        {"$set": {"permissions": {"contractors": {"open": True}},
                  "permission_tokens": ["contractors.read"]}},
    )

    mirror_run() if False else mirror_run()

    src = db_sync.roles.find_one({"role_id": "paneltec_civil"})
    dst = db_sync.roles.find_one({"role_id": "viatec_traffic"})
    assert dst["permissions"] == src["permissions"]
    assert (dst.get("permission_tokens") or []) == (src.get("permission_tokens") or [])
    assert dst.get("supersedes_role_id") == src.get("supersedes_role_id")

    src_preset = db_sync.permission_presets.find_one({"role_id": "paneltec_civil"})
    dst_preset = db_sync.permission_presets.find_one({"role_id": "viatec_traffic"})
    assert dst_preset["permissions"] == src_preset["permissions"]

    # Provenance breadcrumbs written.
    assert dst.get("_mirrored_from") == "paneltec_civil"
    assert dst_preset.get("_mirrored_from") == "paneltec_civil"


def test_editing_one_role_does_not_touch_the_other(db_sync, mirror_run):
    """v58.13.132bc — After the mirror runs, editing either role
    must not mutate the other. Simulates the admin drawer's edit
    path with a direct update."""
    # Establish shared baseline first.
    mirror_run()

    baseline_src = copy.deepcopy(
        db_sync.roles.find_one({"role_id": "paneltec_civil"})["permissions"]
    )
    baseline_dst = copy.deepcopy(
        db_sync.roles.find_one({"role_id": "viatec_traffic"})["permissions"]
    )
    assert baseline_src == baseline_dst

    # Admin edits Paneltec Civil — Viatec must not follow.
    edited = copy.deepcopy(baseline_src)
    edited.setdefault("audit_exports", {})["approve"] = True
    db_sync.roles.update_one(
        {"role_id": "paneltec_civil"},
        {"$set": {"permissions": edited}},
    )
    dst_after = db_sync.roles.find_one({"role_id": "viatec_traffic"})["permissions"]
    assert dst_after == baseline_dst, "Viatec drifted when Paneltec was edited"

    # Admin edits Viatec — Paneltec must not follow.
    v_edited = copy.deepcopy(baseline_dst)
    v_edited.setdefault("hazards", {})["delete"] = True
    db_sync.roles.update_one(
        {"role_id": "viatec_traffic"},
        {"$set": {"permissions": v_edited}},
    )
    src_after = db_sync.roles.find_one({"role_id": "paneltec_civil"})["permissions"]
    assert src_after == edited, "Paneltec drifted when Viatec was edited"


def test_idempotent_double_run(db_sync, mirror_run):
    """v58.13.132bc — Running the mirror twice back-to-back produces
    the same final state (no double-apply, no accidental corruption)."""
    # Restore source to a known matrix.
    seed = {
        "incidents": {"open": True, "view": True, "edit": True, "delete": False,
                      "email": True, "team_view": True, "approve": False},
    }
    db_sync.roles.update_one(
        {"role_id": "paneltec_civil"},
        {"$set": {"permissions": seed, "permission_tokens": ["incidents.read"]}},
    )
    db_sync.permission_presets.update_one(
        {"role_id": "paneltec_civil"},
        {"$set": {"permissions": seed}},
    )

    mirror_run()
    once = db_sync.roles.find_one({"role_id": "viatec_traffic"})
    once_preset = db_sync.permission_presets.find_one({"role_id": "viatec_traffic"})

    mirror_run()
    twice = db_sync.roles.find_one({"role_id": "viatec_traffic"})
    twice_preset = db_sync.permission_presets.find_one({"role_id": "viatec_traffic"})

    assert once["permissions"] == twice["permissions"]
    assert (once.get("permission_tokens") or []) == (twice.get("permission_tokens") or [])
    assert once_preset["permissions"] == twice_preset["permissions"]

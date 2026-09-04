"""v58.13.118 (REVISED) — Rollback vacuum + retire matched/unmatched UI.

Supersedes the aborted .118 rename ship. This file locks the
FINAL .118 contract:

Frontend (matched/unmatched concept eliminated):
  · `PlantMaintenanceTab.jsx` no longer renders the second "Match
    state" chip row (In asset register / Missing asset link).
  · Category chip row is untouched — that's the mental model users
    apply.
  · `PlantMaintenanceDrawer.jsx` no longer renders the amber
    "Missing asset link" pill in the header, no longer renders the
    "Reconcile — coming in v58.13.118a" amber banner, and no longer
    imports the `ExternalLink` / `Info` icons that fed either. Rows
    with a null `plant_id` show `—` next to "Linked asset id" and
    "Linked asset" in the printable card.

Backend rollback script (`scripts/rollback_vacuum_orphan_v58_13_118.py`):
  · Deletes every `assets` doc with `source="orphan_backfill"`.
  · Nulls `plant_id` + `registration_matched` on every
    `plant_maintenance` row previously linked to those assets, and
    stamps `rollback_v58_13_118=True` + `rollback_v58_13_118_at`
    for audit.
  · Enumerates target set BEFORE the writes, prints BEFORE / AFTER
    counts, and asserts every deletion target's `created_at` falls
    in the 2026-09-04 accidental-run window.
  · Idempotent — a second run finds nothing to do, exits 0.

Vacuum argparse safety (already shipped in the aborted .118 pass,
retested here so the guard can never regress):
  · `--commit` required to write; default is dry-run.
  · `--dry-run` accepted (no-op) for back-compat.

Version-sync forward-safe pin >= .118.
"""
from __future__ import annotations
import asyncio  # noqa: F401
import os
import re
import subprocess
import uuid
from pathlib import Path
import sys

import pytest

sys.path.insert(0, "/app/backend")

PMT = Path("/app/frontend/src/pages/PlantMaintenanceTab.jsx").read_text()
DRAWER = Path("/app/frontend/src/components/vehicles/PlantMaintenanceDrawer.jsx").read_text()
VACUUM = Path("/app/backend/scripts/vacuum_orphan_maintenance_v58_13_109.py").read_text()
ROLLBACK_PATH = Path("/app/backend/scripts/rollback_vacuum_orphan_v58_13_118.py")
ROLLBACK = ROLLBACK_PATH.read_text()


# ── Frontend: matched/unmatched UI eliminated ──────────────────────
def test_pm_tab_match_state_chip_row_removed():
    # The second chip row's container testid is gone entirely.
    assert 'pm-match-chip-row' not in PMT
    assert 'pm-plant-toggle' not in PMT
    assert 'pm-filter-matched' not in PMT
    assert 'pm-filter-unmatched' not in PMT
    # The renamed labels from the aborted .118 pass are gone too.
    assert 'In asset register:' not in PMT
    assert 'Missing asset link:' not in PMT


def test_pm_tab_category_chip_row_intact():
    # We deliberately keep the category chip row + all-button.
    assert 'pm-category-chip-row' in PMT
    assert 'data-testid="pm-cat-all"' in PMT
    assert 'setCategoryFilter' in PMT


def test_pm_drawer_missing_asset_link_pill_removed():
    # Header amber pill is gone.
    assert 'Missing asset link' not in DRAWER
    # Its tooltip copy is gone.
    assert 'not appear in the asset register' not in DRAWER
    # Icons that fed the pill + banner are no longer imported.
    assert 'ExternalLink' not in DRAWER
    # Info icon (was on the pill) is no longer imported.
    assert re.search(r"from 'lucide-react'.*Info", DRAWER) is None


def test_pm_drawer_reconcile_banner_removed():
    assert 'Reconcile — coming in v58.13.118a' not in DRAWER
    assert 'pm-drawer-reconcile' not in DRAWER
    # Retired-context comment is present so a future grep for the
    # concept lands on the ship note explaining the removal.
    assert 'matched/unmatched concept' in DRAWER


def test_pm_drawer_null_plant_id_renders_dash():
    # Printable card: null plant_id → em-dash.
    assert '<li><strong>Linked asset:</strong> —</li>' in DRAWER
    # Drawer body field: null plant_id → em-dash via `row.plant_id || '—'`.
    assert "row.plant_id || '—'" in DRAWER
    # The old "Not linked" copy is gone.
    assert "Not linked" not in DRAWER


# ── Rollback script: shape ─────────────────────────────────────────
def test_rollback_script_exists_and_importable():
    assert ROLLBACK_PATH.exists()
    # Module-loadable as a script (no import-time side effects apart
    # from load_dotenv, which is fine).
    import ast
    ast.parse(ROLLBACK)


def test_rollback_script_targets_orphan_backfill_source():
    assert '"source": "orphan_backfill"' in ROLLBACK
    assert 'delete_many({"source": "orphan_backfill"})' in ROLLBACK
    # And nulls plant_id + registration_matched on the linked rows.
    assert '"plant_id": None' in ROLLBACK
    assert '"registration_matched": None' in ROLLBACK


def test_rollback_script_has_time_window_guard():
    # Belt-and-braces window described in the ship brief.
    assert 'WINDOW_START' in ROLLBACK
    assert 'WINDOW_END' in ROLLBACK
    assert '2026-09-04' in ROLLBACK
    # Aborts loudly when a target row falls outside the window.
    assert 'ABORT' in ROLLBACK
    assert 'return 2' in ROLLBACK


def test_rollback_script_enumerates_before_writing():
    # Enumeration step prints BEFORE the writes fire — user directive.
    step1 = ROLLBACK.index("STEP 1 · ENUMERATE")
    step2 = ROLLBACK.index("STEP 2 · EXECUTE")
    write_call = ROLLBACK.index("update_many")
    assert step1 < step2 < write_call
    # And there's a BEFORE / AFTER snapshot pair for audit visibility.
    assert 'BEFORE:' in ROLLBACK and 'AFTER:' in ROLLBACK


def test_rollback_script_stamps_audit_marker():
    # `rollback_v58_13_118` + `_at` fields land on every nulled row.
    assert '"rollback_v58_13_118": True' in ROLLBACK
    assert '"rollback_v58_13_118_at"' in ROLLBACK


# ── Rollback script: behavioural (seed → run → assert clean) ───────
@pytest.mark.asyncio
async def test_rollback_script_end_to_end_and_idempotent():
    os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
    os.environ.setdefault("DB_NAME", "test_database")
    from motor.motor_asyncio import AsyncIOMotorClient
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    d = client[os.environ["DB_NAME"]]
    tag = uuid.uuid4().hex[:6].upper()
    regos = [f"RB-{tag}A", f"RB-{tag}B", f"RB-{tag}C"]
    asset_ids: list[str] = []
    maint_ids: list[str] = []
    try:
        # Seed the phantom-asset shape the vacuum would have produced:
        # 3 assets with source=orphan_backfill within the safety window,
        # 3 plant_maintenance rows linked to them + registration_matched=True.
        now_iso = "2026-09-04T12:00:00+00:00"
        for r in regos:
            aid = str(uuid.uuid4())
            asset_ids.append(aid)
            await d.assets.insert_one({
                "id": aid, "kind": "vehicle", "rego_serial": r,
                "source": "orphan_backfill",
                "orphan_backfill_run_id": "orphan-vac-20260904Ttest",
                "scan_token": uuid.uuid4().hex,  # scan_token_1 unique index
                "created_at": now_iso, "updated_at": now_iso,
                "deleted_at": None,
            })
            mid = str(uuid.uuid4())
            maint_ids.append(mid)
            await d.plant_maintenance.insert_one({
                "id": mid, "maintenance_id": f"t118rb-{r}",
                "org_id": "org-x", "registration_no": r,
                "plant_id": aid, "registration_matched": True,
                "description": f"rollback seed for {r}",
                "date_completed": "2026-09-04",
                "maintenance_type": "Repairs & Maintenance",
            })

        # Pre-conditions.
        assert await d.assets.count_documents({"id": {"$in": asset_ids}}) == 3
        assert await d.plant_maintenance.count_documents(
            {"id": {"$in": maint_ids}, "plant_id": {"$ne": None}}) == 3

        # Execute rollback.
        r1 = subprocess.run(
            ["python3", "/app/backend/scripts/rollback_vacuum_orphan_v58_13_118.py"],
            env={**os.environ, "DB_NAME": "test_database"},
            capture_output=True, text=True, timeout=60,
        )
        assert r1.returncode == 0, f"stderr: {r1.stderr[-400:]}"

        # Post: our 3 seed assets are gone.
        assert await d.assets.count_documents({"id": {"$in": asset_ids}}) == 0
        # Post: our 3 seed maintenance rows had plant_id nulled + audit marker.
        for mid in maint_ids:
            row = await d.plant_maintenance.find_one({"id": mid})
            assert row is not None, "rollback deleted a maintenance row (should have nulled it)"
            assert row.get("plant_id") is None
            assert row.get("registration_matched") is None
            assert row.get("rollback_v58_13_118") is True
            assert row.get("rollback_v58_13_118_at")

        # Idempotent — a second run is a no-op.
        r2 = subprocess.run(
            ["python3", "/app/backend/scripts/rollback_vacuum_orphan_v58_13_118.py"],
            env={**os.environ, "DB_NAME": "test_database"},
            capture_output=True, text=True, timeout=60,
        )
        assert r2.returncode == 0
        assert "Nothing to do" in r2.stdout
    finally:
        await d.plant_maintenance.delete_many({"id": {"$in": maint_ids}})
        await d.assets.delete_many({"id": {"$in": asset_ids}})
        client.close()


# ── Rollback script: time-window abort ─────────────────────────────
@pytest.mark.asyncio
async def test_rollback_aborts_when_asset_outside_window():
    os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
    os.environ.setdefault("DB_NAME", "test_database")
    from motor.motor_asyncio import AsyncIOMotorClient
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    d = client[os.environ["DB_NAME"]]
    aid = str(uuid.uuid4())
    try:
        # Seed a phantom asset OUTSIDE the safety window.
        await d.assets.insert_one({
            "id": aid, "kind": "vehicle", "rego_serial": "OUT-OF-WINDOW",
            "source": "orphan_backfill",
            "orphan_backfill_run_id": "orphan-vac-19990101Ttest",
            "scan_token": uuid.uuid4().hex,
            "created_at": "1999-01-01T00:00:00+00:00",
        })
        r = subprocess.run(
            ["python3", "/app/backend/scripts/rollback_vacuum_orphan_v58_13_118.py"],
            env={**os.environ, "DB_NAME": "test_database"},
            capture_output=True, text=True, timeout=60,
        )
        # Exit code 2 = window guard tripped.
        assert r.returncode == 2, f"expected 2, got {r.returncode}. stdout tail:\n{r.stdout[-400:]}"
        assert "ABORT" in r.stdout
        assert "OUTSIDE the safety window" in r.stdout
        # And the asset survives — no deletion happened.
        assert await d.assets.count_documents({"id": aid}) == 1
    finally:
        await d.assets.delete_many({"id": aid})
        client.close()


# ── Vacuum script argparse safety (regression pin) ─────────────────
def test_vacuum_script_has_argparse():
    assert "import argparse" in VACUUM
    assert 'p.add_argument("--commit"' in VACUUM
    assert 'p.add_argument("--dry-run"' in VACUUM
    # Default MUST be dry-run.
    assert 'dry_run=not args.commit' in VACUUM


def test_vacuum_script_default_is_dry_run():
    r = subprocess.run(
        ["python3", "-m", "backend.scripts.vacuum_orphan_maintenance_v58_13_109"],
        cwd="/app",
        env={**os.environ, "DB_NAME": "test_database"},
        capture_output=True, text=True, timeout=30,
    )
    assert r.returncode == 0, f"stderr: {r.stderr[-400:]}"
    assert "DRY-RUN complete" in r.stdout
    assert "no rows written" in r.stdout


# ── Version sync forward-safe pin ──────────────────────────────────
_VERSION_TAIL_RE = re.compile(r"paneltec-v[\d.]+\.58\.13\.(\d+)([a-z]?)")


def test_version_bumps_meet_118():
    for label, path in (
        ("frontend/version.js", "/app/frontend/src/lib/version.js"),
        ("service-worker.js", "/app/frontend/public/service-worker.js"),
        ("mobile/version.ts", "/app/mobile/src/lib/version.ts"),
    ):
        blob = Path(path).read_text()
        tails = [(int(m.group(1)), m.group(2))
                 for m in _VERSION_TAIL_RE.finditer(blob)]
        assert tails, f"{label} has no version tail"
        highest = max(tails)
        assert highest >= (118, ""), f"{label} latest tail={highest} < (118, '')"

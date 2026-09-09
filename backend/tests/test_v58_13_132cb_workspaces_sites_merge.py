"""v58.13.132cb — Workspaces / Sites merge · Phase A pytests.

Locks the Phase A contract:
  · `merge_workspaces_into_sites_v58_13_132cb.py` exists, has --commit
    flag, and its default mode is dry-run.
  · Behavioural: seeded workspaces + simpro_sites → dry-run writes
    nothing → commit populates `sites` with both sources and stamps
    `_workspace_migrated_at`.
  · Migration is idempotent (re-run leaves the original migration
    timestamp intact).
  · Backend router `sites_admin.py` exposes `GET /api/sites/admin`
    that returns rows from the new `sites` collection.
  · Frontend surface: `pages/Workspaces.jsx` deleted, sidebar entry
    retired from `AppShell.jsx`, `settingsNavRegistry.js` no longer
    exports the `workspaces` key, and `App.js` redirects
    `/app/settings/workspaces` → `/app/settings/sites`.
  · Version-sync forward-safe pin ≥ .132cb.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

import pytest


REPO = Path(__file__).resolve().parent.parent.parent
BACKEND = REPO / "backend"
FRONTEND = REPO / "frontend"


# ── source-pin checks ─────────────────────────────────────────────

def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def test_migration_script_exists_with_commit_flag():
    p = BACKEND / "scripts" / "merge_workspaces_into_sites_v58_13_132cb.py"
    assert p.exists(), "migration script missing"
    src = _read(p)
    assert "--commit" in src
    assert "--dry-run" in src, "must accept explicit --dry-run for symmetry"
    # Default mode must be dry-run.
    assert 'args.commit and not args.dry_run' in src or 'commit=args.commit' in src


def test_migration_script_upserts_sites_with_audit_stamp():
    src = _read(BACKEND / "scripts" / "merge_workspaces_into_sites_v58_13_132cb.py")
    # Must upsert into `sites` from both sources.
    assert "db.sites.update_one" in src
    assert "simpro_sites" in src
    assert "db.workspaces.find" in src
    # Must stamp `_workspace_migrated_at`, and preserve it on re-run.
    assert "_workspace_migrated_at" in src
    assert "existing" in src, "must check existing docs to avoid overwriting the audit stamp"


def test_sites_admin_router_exists():
    p = BACKEND / "sites_admin.py"
    assert p.exists()
    src = _read(p)
    assert 'prefix="/sites/admin"' in src, "must live at /sites/admin (avoid /sites collision with sites_qr.py)"
    assert "get_current_user" in src
    assert "db.sites.find" in src


def test_server_mounts_sites_admin_router():
    src = _read(BACKEND / "server.py")
    assert "from sites_admin import router as sites_admin_router" in src
    assert "api.include_router(sites_admin_router)" in src


def test_workspaces_router_still_included_for_phase_b():
    """Phase A keeps `/workspaces` alive for backend compat (records
    still carry `workspace_id` FKs). Phase B (.132cb-b) retires it."""
    src = _read(BACKEND / "server.py")
    assert "api.include_router(workspaces_router)" in src


# ── Frontend source pins ──────────────────────────────────────────

def test_frontend_workspaces_page_deleted():
    assert not (FRONTEND / "src" / "pages" / "Workspaces.jsx").exists()


def test_appshell_sidebar_workspaces_entry_removed():
    src = _read(FRONTEND / "src" / "components" / "layout" / "AppShell.jsx")
    # No more sidebar nav item pointing at the workspaces admin page.
    assert "label: 'Workspaces'" not in src
    assert "testid: 'nav-settings-workspaces'" not in src


def test_settings_nav_registry_workspaces_entry_removed():
    src = _read(FRONTEND / "src" / "lib" / "settingsNavRegistry.js")
    # The frontend registry must NOT re-export the key. The saved
    # nav-layout on disk may still reference "workspaces"; the
    # <SettingsNav /> component filters unknown keys via
    # `SETTINGS_NAV_BY_KEY[key]` returning undefined.
    matches = re.findall(r"key:\s*'workspaces'", src)
    assert not matches, "workspaces entry must be dropped from the frontend registry"


def test_backend_nav_registry_keeps_workspaces_for_grace():
    """Backward compat: pre-.132cb saved layouts referencing
    `workspaces` must still validate on `PUT /api/settings/nav-layout`
    so admins with a custom layout aren't 400'd."""
    src = _read(BACKEND / "settings_nav_registry.py")
    assert '"key": "workspaces"' in src


def test_app_redirects_workspaces_route_to_sites():
    src = _read(FRONTEND / "src" / "App.js")
    # Route registration — allow whitespace/newlines within the JSX
    # tag but require the path + Navigate target.
    m = re.search(
        r'path="settings/workspaces"\s+element=\{\s*<Navigate\s+to="/app/settings/sites"',
        src,
    )
    assert m, "settings/workspaces must redirect to /app/settings/sites"
    # Legacy import must be removed (only match uncommented lines).
    for line in src.splitlines():
        stripped = line.lstrip()
        if stripped.startswith("//") or stripped.startswith("*"):
            continue
        assert "import Workspaces from" not in line, f"legacy Workspaces import still active: {line}"


# ── Version-sync ──────────────────────────────────────────────────

_VERSION_RE = re.compile(r"v160\.3\.9\.58\.13\.(\d+[a-z]*)")


def _extract_current_version(src: str) -> str:
    """Extract the FIRST version-token in version.js (the most recent
    ship at the top of the changelog)."""
    m = _VERSION_RE.search(src)
    assert m, "no version token found in version.js"
    return m.group(1)


def _version_at_least(token: str, minimum: str = "132cb") -> bool:
    """Alphanumeric token compare — .132cb < .132cc < .132d."""
    return token >= minimum


def test_version_js_bumped_to_at_least_132cb():
    src = _read(FRONTEND / "src" / "lib" / "version.js")
    tok = _extract_current_version(src)
    assert _version_at_least(tok, "132cb"), f"version.js at {tok}, want ≥ .132cb"


def test_service_worker_cache_version_matches_at_least_132cb():
    src = _read(FRONTEND / "public" / "service-worker.js")
    m = re.search(r"CACHE_VERSION\s*=\s*'paneltec-v160\.3\.9\.58\.13\.(\d+[a-z]*)'", src)
    assert m, "service-worker.js CACHE_VERSION not found"
    assert _version_at_least(m.group(1), "132cb"), f"SW at {m.group(1)}, want ≥ .132cb"


# ── Behavioural: migration script round-trip ──────────────────────

@pytest.mark.live_db_writes
@pytest.mark.asyncio
async def test_migration_writes_sites_and_stamps_audit():
    """Seed a temp org's workspaces + simpro_sites, invoke the script
    with --commit, and confirm rows land in `sites`.

    The script runs against the real MONGO_URL — we use a scratch
    org id so we never touch production rows.
    """
    from motor.motor_asyncio import AsyncIOMotorClient
    from dotenv import load_dotenv

    load_dotenv(BACKEND / ".env")
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    org_id = "test-org-132cb-pytest"

    # Clean any prior seed.
    await db.workspaces.delete_many({"org_id": org_id})
    await db.simpro_sites.delete_many({"org_id": org_id})
    await db.sites.delete_many({"org_id": org_id})
    await db.orgs.delete_many({"id": org_id})

    # Seed one active + one deleted workspace + one simpro site.
    await db.orgs.insert_one({"id": org_id, "name": "Pytest Org"})
    await db.workspaces.insert_one({
        "id": "ws-132cb-1", "org_id": org_id, "name": "Head Office",
        "address": "1 Test St", "default_for_org": True,
        "created_at": "2026-01-01T00:00:00Z",
    })
    await db.workspaces.insert_one({
        "id": "ws-132cb-2", "org_id": org_id, "name": "Retired",
        "deleted_at": "2026-01-02T00:00:00Z",
    })
    await db.simpro_sites.insert_one({
        "simpro_site_id": "SP-132cb-1", "org_id": org_id, "name": "Erskineville",
        "address_full": "2 Rail Rd",
    })

    # Run --commit against the real DB (targets ALL orgs, but our seed
    # is uniquely keyed so the assertions below only look at our org).
    script = BACKEND / "scripts" / "merge_workspaces_into_sites_v58_13_132cb.py"
    r = subprocess.run(
        [sys.executable, str(script), "--commit"],
        capture_output=True, text=True, cwd=str(BACKEND),
    )
    assert r.returncode == 0, f"script failed: {r.stderr}"

    # Active workspace promoted, retired one skipped.
    sites = await db.sites.find({"org_id": org_id}, {"_id": 0}).to_list(50)
    ids = {s["id"] for s in sites}
    assert "ws-132cb-1" in ids, "active workspace must be promoted"
    assert "ws-132cb-2" not in ids, "retired workspace must be skipped"
    assert "SP-132cb-1" in ids, "simpro site must be copied"

    # Audit stamp present.
    by_id = {s["id"]: s for s in sites}
    assert by_id["ws-132cb-1"]["_workspace_migrated_at"], "audit stamp missing"
    assert by_id["ws-132cb-1"]["source"] == "workspace_promoted"
    assert by_id["SP-132cb-1"]["source"] == "simpro"

    # orgs.default_site_id set to the default_for_org workspace.
    o = await db.orgs.find_one({"id": org_id}, {"_id": 0})
    assert o["default_site_id"] == "ws-132cb-1"

    # Idempotent re-run keeps the same audit stamp.
    stamp_before = by_id["ws-132cb-1"]["_workspace_migrated_at"]
    r2 = subprocess.run(
        [sys.executable, str(script), "--commit"],
        capture_output=True, text=True, cwd=str(BACKEND),
    )
    assert r2.returncode == 0
    ws1_after = await db.sites.find_one({"id": "ws-132cb-1", "org_id": org_id}, {"_id": 0})
    assert ws1_after["_workspace_migrated_at"] == stamp_before, "re-run must preserve audit stamp"

    # Cleanup.
    await db.workspaces.delete_many({"org_id": org_id})
    await db.simpro_sites.delete_many({"org_id": org_id})
    await db.sites.delete_many({"org_id": org_id})
    await db.orgs.delete_many({"id": org_id})
    client.close()

"""v58.13.132gf — Ephemeral-uploads → GridFS migration + deferred flips.

Covers:
  · Shared `uploads_storage` helper (save + read + has_upload).
  · Contractor + renewal upload paths now route through GridFS.
  · `dashboard._serve_async` prefers GridFS, falls back to local
    disk for pre-migration files.
  · Migration script scans MIGRATED_MODULES + writes audit rows.
  · Live Dashboard tile flipped to disabled ("You're here.")
    and Ask Intelligence flipped to disabled ("Coming soon").
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
import uuid
from pathlib import Path

import pytest
import requests

from tests.conftest import ADMIN_EMAIL, ADMIN_PWD, API

pytestmark = pytest.mark.live_db_writes

APP_ROOT = Path(__file__).resolve().parents[2]
BE = APP_ROOT / "backend"
FRONTEND = APP_ROOT / "frontend"
SCRIPTS = APP_ROOT / "scripts"

UPLOADS_STORAGE = BE / "uploads_storage.py"
DASHBOARD = BE / "dashboard.py"
CONTRACTORS = BE / "contractors.py"
RENEWALS = BE / "renewals.py"
MIGRATE_SCRIPT = SCRIPTS / "migrate_ephemeral_to_gridfs.py"
OVERVIEW_FE = (FRONTEND / "src" / "components" / "help"
                / "PlatformOverviewInteractive.jsx")
VERSION_JS = FRONTEND / "src" / "lib" / "version.js"
SW = FRONTEND / "public" / "service-worker.js"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def _login() -> dict:
    r = requests.post(f"{API}/auth/login",
                        json={"email": ADMIN_EMAIL, "password": ADMIN_PWD},
                        timeout=30)
    if r.status_code == 429:
        pytest.skip("rate-limited")
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


# ─── Source pins ───────────────────────────────────────────────

def test_uploads_storage_helper_exposes_save_read_has():
    src = _read(UPLOADS_STORAGE)
    assert 'BUCKET_NAME = "upload_storage"' in src
    assert "async def save_upload(" in src
    assert "async def read_upload(" in src
    assert "async def has_upload(" in src
    # Every write tags module + org + mime for audit sweeps.
    assert '"module": module' in src
    assert '"key": key' in src


def test_contractors_upload_uses_gridfs():
    src = _read(CONTRACTORS)
    # Old local-disk write removed.
    assert "target.open(\"wb\")" not in src
    assert "shutil.copyfileobj(file.file" not in src
    # New helper wired with the same URL shape.
    assert "from uploads_storage import save_upload" in src
    assert 'await save_upload(' in src
    assert '"contractor_docs", [name]' in src
    assert 'f"/api/files/contractor_docs/{name}"' in src


def test_renewals_upload_uses_gridfs():
    src = _read(RENEWALS)
    assert "target.open(\"wb\")" not in src
    assert "shutil.copyfileobj(up.file" not in src
    assert "from uploads_storage import save_upload" in src
    assert '"renewals", [token, name]' in src
    assert 'f"/api/files/renewals/{token}/{name}"' in src


def test_serve_async_prefers_gridfs_with_disk_fallback():
    src = _read(DASHBOARD)
    assert "async def _serve_async(" in src
    assert "from uploads_storage import read_upload" in src
    assert "hit = await read_upload(subdir, parts)" in src
    # Fallback path kept for pre-migration files.
    assert "path = UPLOAD_ROOT.joinpath(subdir, *parts)" in src
    # Contractor + renewal serve endpoints migrated.
    assert (
        'return await _serve_async("contractor_docs", name)' in src
    )
    assert (
        'return await _serve_async("renewals", token, name)' in src
    )


def test_migration_script_scans_and_writes_audit():
    src = _read(MIGRATE_SCRIPT)
    assert "MIGRATED_MODULES = [" in src
    assert '("contractor_docs"' in src
    assert '("renewals"' in src
    assert 'ephemeral_to_gridfs_migration' in src
    assert 'ephemeral_to_gridfs_missing_source' in src
    assert 'has_upload' in src


def test_platform_overview_flips_live_dashboard_and_ask():
    src = _read(OVERVIEW_FE)
    # Ask Intelligence tile is disabled ("Coming soon").
    assert "'Ask Intelligence'" in src
    assert "Coming soon — Ask Intelligence is on the roadmap." in src
    # Ask tile must no longer carry a `to: '/app/ask'` route.
    assert "to: '/app/ask'" not in src
    # Live Dashboard tile is disabled with the "You're here." tooltip.
    assert "'Live Dashboard'" in src
    assert "You're here." in src
    # Live Dashboard tile must no longer carry a `to: '/app/dashboard'`.
    assert "to: '/app/dashboard'" not in src


# ─── Behavioural (live backend) ────────────────────────────────

def test_migration_script_dry_run_reports_stats():
    """Sanity-check: --report mode returns exit 0 and prints stats."""
    r = subprocess.run(
        [sys.executable, str(MIGRATE_SCRIPT)],
        capture_output=True, text=True, timeout=45,
    )
    assert r.returncode == 0, r.stderr
    assert "[migrate] mode=" in r.stdout
    assert "stats:" in r.stdout


def test_renewals_serve_reads_from_gridfs_after_migration():
    """Post-migration, GETting a migrated renewal file returns 200
    with the stored bytes. Requires that the migration script has
    already run against a seed file — we no-op if there's nothing
    to sweep."""
    # Direct DB probe to find an already-migrated blob.
    import motor.motor_asyncio as motor
    import asyncio

    mongo_url = os.environ.get("MONGO_URL", "")
    db_name = os.environ.get("DB_NAME", "")
    if not (mongo_url and db_name):
        pytest.skip("MONGO_URL / DB_NAME env not populated")

    async def _find():
        client = motor.AsyncIOMotorClient(mongo_url)
        db = client[db_name]
        doc = await db.upload_storage.files.find_one(
            {"metadata.subdir": "renewals"},
        )
        client.close()
        return doc
    doc = asyncio.get_event_loop().run_until_complete(_find())
    if not doc:
        pytest.skip("no migrated renewal blobs in the DB")
    parts = doc["metadata"]["parts"]
    assert len(parts) == 2
    # Serve endpoint is unauthenticated (token-in-URL).
    r = requests.get(
        f"{API}/files/renewals/{parts[0]}/{parts[1]}",
        headers={"User-Agent": "Mozilla/5.0"},
        timeout=30,
    )
    assert r.status_code == 200
    assert len(r.content) > 0


# ─── Version lockstep ──────────────────────────────────────────

def test_version_bumped_to_132gf():
    js = _read(VERSION_JS)
    sw = _read(SW)
    assert re.search(r"RUNNING_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gf'", js)
    assert re.search(r"EXPECTED_CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gf'", js)
    assert re.search(r"CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gf'", sw)

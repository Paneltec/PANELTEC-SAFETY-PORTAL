"""v58.13.132gj — Object-storage migration wave 5 (reimport + reference-image).

Ten admin-triggered reimport endpoints (list_forms, companies,
list_roles, master_risks, cs_incident, incident_root_causes,
hr_employees, completed_training, plant_maintenance) plus the
help-reference-image slot store are all migrated off ephemeral pod
disk. Reimport endpoints now use the shared
`reimport_staging.staged_reimport_xlsx` async context manager, which
persists an audit copy to GridFS (`reimport_archive` subdir) and
hands the parser a short-lived `NamedTemporaryFile` that self-unlinks
on exit. Reference-image writes go straight to GridFS with a
disk-fallback reader for legacy slots.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest
import requests

from tests.conftest import ADMIN_EMAIL, ADMIN_PWD, API

pytestmark = pytest.mark.live_db_writes

APP_ROOT = Path(__file__).resolve().parents[2]
BE = APP_ROOT / "backend"
FRONTEND = APP_ROOT / "frontend"

REIMPORT_MODULES = (
    "list_forms", "companies", "list_roles", "master_risks",
    "cs_incident", "incident_root_causes", "hr_employees",
    "completed_training", "plant_maintenance",
)
HELP = BE / "help_reference_images.py"
STAGING = BE / "reimport_staging.py"
MIGRATE = APP_ROOT / "scripts" / "migrate_ephemeral_to_gridfs.py"
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


def test_reimport_staging_helper_exists():
    assert STAGING.exists(), "reimport_staging.py must exist"
    src = _read(STAGING)
    assert "async def staged_reimport_xlsx" in src
    assert "NamedTemporaryFile" in src
    assert "REIMPORT_ARCHIVE_SUBDIR" in src
    assert "unlink(missing_ok=True)" in src


@pytest.mark.parametrize("module", REIMPORT_MODULES)
def test_all_nine_reimport_endpoints_use_staging_helper(module):
    src = _read(BE / f"{module}.py")
    # Old pattern must be gone.
    assert 'dest.write_bytes(' not in src, (
        f"{module}: old dest.write_bytes disk write must be gone")
    assert 'dest.parent.mkdir(' not in src, (
        f"{module}: old dest.parent.mkdir line must be gone")
    # New pattern must be present.
    assert 'from reimport_staging import staged_reimport_xlsx' in src, (
        f"{module}: must import staged_reimport_xlsx")
    assert f'module="{module}"' in src, (
        f"{module}: must pass module=\"{module}\" to the staging helper")


def test_help_reference_images_migrated_to_gridfs():
    src = _read(HELP)
    # Old disk write on upload must be gone.
    assert "disk_path.write_bytes(data)" not in src, (
        "help_reference_images upload disk write must be removed")
    # New GridFS save + GridFS-preferring reader present.
    assert '"help_reference_images", [disk_path.name], data' in src
    assert 'from uploads_storage import read_upload' in src
    assert 'for ext in ("png", "jpg", "webp")' in src
    # Disk fallback for pre-migration slots retained.
    assert '_find_slot_file(slot)' in src


def test_migration_script_covers_reimport_and_help_reference():
    src = _read(MIGRATE)
    # EXTRA_MODULES block handles content/reference_images (outside
    # backend/uploads/).
    assert "EXTRA_MODULES" in src
    assert '"help_reference_images"' in src


# ─── Behavioural: reference image round-trip ───────────────────


def test_help_reference_image_serves_from_gridfs_for_migrated_slot():
    """Post-migration, the public /api/help/reference-images/{slot} endpoint
    must resolve via GridFS — check that at least one migrated slot
    responds with 200 image bytes."""
    r = requests.get(f"{API}/help/reference-images", timeout=15)
    if r.status_code != 200:
        pytest.skip(f"listing not available ({r.status_code})")
    items = r.json().get("items") or []
    if not items:
        pytest.skip("no reference-image slots populated on this pod")
    slot = items[0]["slot"]
    got = requests.get(f"{API}/help/reference-images/{slot}", timeout=15)
    assert got.status_code == 200, got.text
    assert got.headers.get("content-type", "").startswith("image/")
    assert len(got.content) > 0


# ─── Version lockstep ─────────────────────────────────────────


def test_version_bumped_to_132gj():
    js = _read(VERSION_JS)
    sw = _read(SW)
    assert re.search(r"RUNNING_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gj'", js)
    assert re.search(r"EXPECTED_CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gj'", js)
    assert re.search(r"CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gj'", sw)

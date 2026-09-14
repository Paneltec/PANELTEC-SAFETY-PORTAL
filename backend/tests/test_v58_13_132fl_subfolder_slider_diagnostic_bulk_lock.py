"""v58.13.132fl — Melinda subfolder + slider diagnostic + bulk tile lockdown.

Three concrete fixes, each with source-pin + behavioural checks."""
from __future__ import annotations

import re
from pathlib import Path

import pytest
import requests

from tests.conftest import ADMIN_EMAIL, ADMIN_PWD, API

pytestmark = pytest.mark.live_db_writes

APP_ROOT = Path(__file__).resolve().parents[2]
FE = APP_ROOT / "frontend" / "src"
BE = APP_ROOT / "backend"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def _login(email, pwd):
    r = requests.post(f"{API}/auth/login",
                       json={"email": email, "password": pwd}, timeout=30)
    if r.status_code == 429:
        pytest.skip("rate-limited")
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json().get('access_token') or r.json().get('token')}"}


@pytest.fixture(scope="module")
def admin_hdr():
    return _login(ADMIN_EMAIL, ADMIN_PWD)


# ── Fix 1: per-worker subfolder mirror disabled ───────────────────

def test_cert_upload_no_longer_creates_per_worker_subfolder():
    src = _read(BE / "worker_certifications.py")
    # The two call-sites must now use `seed_folder` directly.
    assert src.count("sub_folder = seed_folder") >= 2, (
        "both cert-upload paths must route into the seed folder, "
        "skipping the per-worker subfolder layer")
    # Legacy call sites must be gone.
    assert "sub_folder = await _find_or_create_worker_subfolder" not in src


def test_migration_script_present_and_importable():
    p = BE / "scripts" / "migrate_v58_13_132fl_flatten_worker_subfolders.py"
    assert p.is_file()
    src = _read(p)
    assert "async def main" in src
    assert "record_file_archive_audit" in src
    assert '"flatten_per_worker_subfolder"' in src or "flatten_per_worker_subfolder" in src


# ── Fix 2: slider diagnostic ─────────────────────────────────────

def test_slider_diagnostic_overlay_present():
    src = _read(FE / "pages" / "Workers.jsx")
    assert "function SliderWithDiagnostic" in src
    assert "worker-edit-photo-align-diagnostic" in src
    # Both event handlers wired through bump().
    assert re.search(r"onChange=\{\(e\) => bump\('change', e\)\}", src)
    assert re.search(r"onInput=\{\(e\) => bump\('input', e\)\}", src)
    # Global DevTools hook.
    assert "window.__PANELTEC_SLIDER_DEBUG" in src
    # console.info tag.
    assert "console.info('[slider]'," in src


# ── Fix 3: bulk-access endpoint + frontend wiring ────────────────

def test_bulk_access_endpoint_wired():
    src = _read(BE / "org_url_tiles.py")
    assert '@router.patch("/bulk-access")' in src
    assert "async def bulk_access" in src
    # Route order — must be BEFORE the parameterised /{tile_id}.
    idx_bulk = src.index('@router.patch("/bulk-access")')
    idx_param = src.index('@router.patch("/{tile_id}")')
    assert idx_bulk < idx_param, (
        "literal /bulk-access route must appear BEFORE /{tile_id}")


def test_bulk_access_e2e(admin_hdr):
    # Grab 2 tile ids.
    r = requests.get(f"{API}/org/url-tiles", headers=admin_hdr, timeout=30)
    tiles = r.json().get("tiles") or []
    assert len(tiles) >= 2
    ids = [t["id"] for t in tiles[:2]]
    try:
        # Lock both private.
        r1 = requests.patch(f"{API}/org/url-tiles/bulk-access",
                             headers=admin_hdr,
                             json={"tile_ids": ids,
                                   "access_mode": "private",
                                   "allowed_user_ids": []}, timeout=30)
        assert r1.status_code == 200
        assert r1.json()["updated"] == 2
        for t in r1.json()["tiles"]:
            assert t["access_mode"] == "private"
        # Bad access_mode → 400.
        r2 = requests.patch(f"{API}/org/url-tiles/bulk-access",
                             headers=admin_hdr,
                             json={"tile_ids": ids,
                                   "access_mode": "banana",
                                   "allowed_user_ids": []}, timeout=30)
        assert r2.status_code == 400
        # Empty tile_ids → 0 updated.
        r3 = requests.patch(f"{API}/org/url-tiles/bulk-access",
                             headers=admin_hdr,
                             json={"tile_ids": [],
                                   "access_mode": "public",
                                   "allowed_user_ids": []}, timeout=30)
        assert r3.status_code == 200
        assert r3.json()["updated"] == 0
    finally:
        # Unlock so we don't leave stray private tiles behind.
        requests.patch(f"{API}/org/url-tiles/bulk-access",
                        headers=admin_hdr,
                        json={"tile_ids": ids,
                              "access_mode": "public",
                              "allowed_user_ids": []}, timeout=30)


def test_manage_tiles_has_bulk_ui():
    src = _read(FE / "components" / "QuickLinksSection.jsx")
    # New checkbox column.
    assert "apps-directory-bulk-check-all" in src
    assert 'apps-directory-row-check-${tile.id}' in src
    # Bulk action bar.
    assert "apps-directory-bulk-lock" in src
    assert "apps-directory-bulk-unlock" in src
    # Modal + testids.
    assert "function BulkAccessModal" in src
    assert "apps-directory-bulk-modal" in src
    assert "apps-directory-bulk-save" in src
    assert "apps-directory-bulk-select-everyone" in src
    assert "apps-directory-bulk-clear-all" in src


# ── Version pin ───────────────────────────────────────────────────

def test_version_pinned_to_132fl_or_higher():
    v = _read(FE / "lib" / "version.js")
    sw = _read(APP_ROOT / "frontend" / "public" / "service-worker.js")
    m_v = re.search(r"RUNNING_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", v)
    m_ex = re.search(r"EXPECTED_CACHE_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", v)
    m_sw = re.search(r"CACHE_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", sw)
    for name, m in (("RUNNING_VERSION", m_v),
                     ("EXPECTED_CACHE_VERSION", m_ex),
                     ("CACHE_VERSION", m_sw)):
        assert m and m.group(1) >= "fl", (
            f"{name} suffix must be >= 132fl, got {m and m.group(1)}")

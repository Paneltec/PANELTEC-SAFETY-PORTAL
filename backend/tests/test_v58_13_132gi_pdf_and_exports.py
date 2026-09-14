"""v58.13.132gi — Object-storage migration wave 4 (PDF renderer + exports).

Persists PDF renderer output + audit-pack artefacts to the shared
`uploads_storage` GridFS bucket. Reads prefer GridFS via
`_serve_async`, fall back to disk for pre-migration files.
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

PDF_R = BE / "pdf_renderer.py"
EXP = BE / "exports.py"
DASH = BE / "dashboard.py"
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


def test_persist_pdf_writes_to_gridfs_and_is_async():
    src = _read(PDF_R)
    assert "path.write_bytes(data)" not in src, (
        "old PDFS_DIR disk write must be gone")
    assert "async def persist_pdf(" in src
    assert '"pdfs", [filename], data' in src
    assert 'module="pdf_renderer"' in src


def test_exports_all_three_sites_use_gridfs():
    src = _read(EXP)
    assert "path.write_bytes(payload)" not in src, (
        "primary artefact disk write must be gone")
    assert "(UPLOAD_DIR / pdf_filename).write_bytes" not in src, (
        "sibling / on-demand PDF disk writes must be gone")
    # Three save_upload sites: primary artefact + auto-sibling +
    # on-demand render_pdf_sibling.
    hits = re.findall(r'_save_export\(\s*"exports"', src)
    assert len(hits) == 3, (
        f"expected 3 save_upload sites in exports.py, found {len(hits)}")
    assert 'module="exports"' in src


def test_dashboard_serves_pdfs_and_exports_via_gridfs():
    src = _read(DASH)
    for subdir in ("pdfs", "exports"):
        assert re.search(rf'await _serve_async\("{subdir}"', src), (
            f"dashboard serve for {subdir} must use _serve_async")


def test_migration_script_covers_pdfs_and_exports():
    src = _read(MIGRATE)
    for subdir in ("pdfs", "exports"):
        assert f'"{subdir}"' in src, (
            f"migration script missing {subdir}")


# ─── Behavioural: audit-pack round-trip ───────────────────────


def test_audit_export_and_sibling_land_in_gridfs():
    h = _login()
    body = {
        "date_from": "2026-08-01", "date_to": "2026-09-14",
        "format": "json", "title": "gi-pytest-smoke",
        "include": ["swms"],
    }
    r = requests.post(f"{API}/audit-exports", json=body, headers=h, timeout=30)
    assert r.status_code == 201, r.text
    payload = r.json()
    assert payload.get("file_url", "").startswith("/api/files/exports/")
    sibling = payload.get("pdf_sibling") or {}
    assert sibling.get("file_url", "").startswith("/api/files/exports/")

    # Both artefacts must serve 200 via the GridFS-preferring reader.
    for url in (payload["file_url"], sibling["file_url"]):
        got = requests.get(f"{API}{url.removeprefix('/api')}",
                           headers=h, timeout=30)
        assert got.status_code == 200, f"{url} → {got.status_code} {got.text[:120]}"
        assert got.content, "empty body"


# ─── Version lockstep ─────────────────────────────────────────


def test_version_bumped_to_132gi():
    js = _read(VERSION_JS)
    sw = _read(SW)
    assert re.search(r"RUNNING_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gi'", js)
    assert re.search(r"EXPECTED_CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gi'", js)
    assert re.search(r"CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gi'", sw)

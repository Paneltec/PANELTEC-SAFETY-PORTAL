"""v58.13.132gt — Phase 2 SDS module (Document Library files):
rename + expiry_date + sort/filter.

Existing delete_file already soft-deletes; that half of Phase 2 is
locked by test_v58_13_132fj_delete_audit.py — this file only pins
the NEW rename + expiry contract and the FE sort/filter/tint UX.
"""
from __future__ import annotations

import re
import uuid as _uuid
from pathlib import Path

import pytest
import requests

from tests.conftest import ADMIN_EMAIL, ADMIN_PWD, API

pytestmark = pytest.mark.live_db_writes

APP_ROOT = Path(__file__).resolve().parents[2]
BE = APP_ROOT / "backend"
FRONTEND = APP_ROOT / "frontend"
MOD = BE / "document_library.py"
PAGE = FRONTEND / "src" / "pages" / "DocumentLibrary.jsx"
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


def _upload_test_file(h: dict) -> tuple[str, str]:
    """Create a scratch folder + upload a tiny PDF into it; return
    (folder_id, file_id). Caller is responsible for cleaning up the
    folder afterwards. Falls back to the first non-system folder if
    creating a scratch folder is 403 for the admin user (which
    shouldn't happen in practice)."""
    folders = requests.get(f"{API}/document-library/folders",
                            headers=h, timeout=15)
    assert folders.status_code == 200, folders.text
    target = next((f for f in folders.json()
                   if f.get("name", "").startswith("SDS")), None)
    if not target:
        target = folders.json()[0]
    fid = target["id"]

    files = {"files": (f"pytest-132gt-{_uuid.uuid4().hex[:6]}.pdf",
                       b"%PDF-1.4\ntest\n%%EOF", "application/pdf")}
    up = requests.post(
        f"{API}/document-library/folders/{fid}/files",
        headers=h, files=files, timeout=30,
    )
    assert up.status_code == 201, up.text
    file_id = up.json()["saved"][0]["id"]
    return fid, file_id


# ─── Source pins (backend) ─────────────────────────────────────

def test_backend_file_patch_endpoint_exists():
    src = _read(MOD)
    assert "class FilePatch(BaseModel):" in src
    assert '@router.patch("/files/{file_id}")' in src
    assert "async def rename_or_update_file" in src
    # Must reject extension change.
    assert "Cannot change file extension" in src
    # Must validate ISO-8601 expiry.
    assert "expiry_date must be ISO-8601" in src


def test_serialise_file_exposes_expiry():
    src = _read(MOD)
    assert '"expiry_date": doc.get("expiry_date"),' in src
    assert '"updated_at": doc.get("updated_at"),' in src


# ─── Source pins (frontend) ────────────────────────────────────

def test_frontend_helpers_exist():
    src = _read(PAGE)
    for pin in (
        "function docDaysUntil",
        "function docExpiryTint",
        "const DOC_SORT_OPTIONS",
        "const DOC_EXPIRY_FILTERS",
        "function applyDocSortFilter",
        "function FileEditModal",
    ):
        assert pin in src, f"missing helper: {pin!r}"


def test_frontend_testids_present():
    src = _read(PAGE)
    for tid in (
        "folder-sort-filter-toolbar",
        "folder-sort-select",
        "folder-expiry-filter-select",
        "file-edit-modal",
        "file-edit-name-input",
        "file-edit-expiry-input",
        "file-edit-clear-expiry",
        "file-edit-save",
        "file-edit-cancel",
    ):
        assert f'"{tid}"' in src, f"missing testid: {tid}"
    # Row-level dynamic testids (regex — check the format string).
    for pattern in (
        "`file-edit-${f.id}`",
        "`file-expiry-cell-${f.id}`",
        "`file-expiry-chip-${f.id}`",
    ):
        assert pattern in src, f"missing dynamic testid template: {pattern}"


def test_frontend_wires_sort_filter_into_list():
    src = _read(PAGE)
    # sort/filter must feed groupFilesForDisplay (or the search
    # branch) — pin the exact call site.
    assert "applyDocSortFilter(files, { sortKey, expiryFilter })" in src


def test_frontend_row_tint_overrides_group_palette():
    src = _read(PAGE)
    # The row's borderLeft must consult `borderColor` (which flips
    # to rose/amber on expiring rows) rather than the palette hex
    # directly.
    assert "border-left" not in src.lower() or "borderColor" in src
    assert "borderLeft: `4px solid ${borderColor}`" in src


def test_frontend_calls_patch_endpoint():
    src = _read(PAGE)
    assert "api.patch(`/document-library/files/${file.id}`" in src


# ─── Version lockstep ─────────────────────────────────────────

def test_version_bumped_to_132gt():
    js = _read(VERSION_JS)
    sw = _read(SW)
    assert re.search(r"RUNNING_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gt'", js)
    assert re.search(r"EXPECTED_CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gt'", js)
    assert re.search(r"CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gt'", sw)


# ─── Behavioural — rename + expiry PATCH ───────────────────────

def test_rename_and_expiry_round_trip():
    h = _login()
    folder_id, file_id = _upload_test_file(h)
    try:
        # Rename (same extension).
        r = requests.patch(
            f"{API}/document-library/files/{file_id}",
            headers=h, timeout=15,
            json={"filename": "renamed-132gt.pdf"},
        )
        assert r.status_code == 200, r.text
        assert r.json()["filename"] == "renamed-132gt.pdf"

        # Set expiry.
        r2 = requests.patch(
            f"{API}/document-library/files/{file_id}",
            headers=h, timeout=15,
            json={"expiry_date": "2099-12-31"},
        )
        assert r2.status_code == 200
        assert r2.json()["expiry_date"] == "2099-12-31"

        # Clear expiry.
        r3 = requests.patch(
            f"{API}/document-library/files/{file_id}",
            headers=h, timeout=15,
            json={"clear_expiry": True},
        )
        assert r3.status_code == 200
        assert r3.json()["expiry_date"] is None

        # Bad expiry.
        r4 = requests.patch(
            f"{API}/document-library/files/{file_id}",
            headers=h, timeout=15,
            json={"expiry_date": "not-a-date"},
        )
        assert r4.status_code == 400

        # Extension change blocked.
        r5 = requests.patch(
            f"{API}/document-library/files/{file_id}",
            headers=h, timeout=15,
            json={"filename": "renamed-132gt.exe"},
        )
        assert r5.status_code == 400

        # Empty patch → 400.
        r6 = requests.patch(
            f"{API}/document-library/files/{file_id}",
            headers=h, timeout=15,
            json={},
        )
        assert r6.status_code == 400

        # Missing file → 404.
        r7 = requests.patch(
            f"{API}/document-library/files/does-not-exist",
            headers=h, timeout=15,
            json={"filename": "x.pdf"},
        )
        assert r7.status_code == 404
    finally:
        requests.delete(f"{API}/document-library/files/{file_id}",
                          headers=h, timeout=15)


def test_patch_requires_auth():
    r = requests.patch(f"{API}/document-library/files/whatever",
                        json={"filename": "x.pdf"}, timeout=15)
    assert r.status_code in (401, 403)

"""v58.13.132gy — Doc Library restructure (backend nest).

Pins:
  · Nested folder support via parent_folder_id already existed
    schema-wise; ensure_tree_structure reparents 51 leaves under
    12 new parents.
  · POST /api/document-library/reorganise dry-run + live-apply.
  · POST /folders accepts parent_folder_id (create-with-parent).
  · PATCH /folders/{id} accepts parent_folder_id with cycle check.
  · GET /folders/all returns flat list for the FE parent picker.
  · Idempotent — repeat calls are no-ops.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest
import requests

from tests.conftest import ADMIN_EMAIL, ADMIN_PWD, API

pytestmark = pytest.mark.live_db_writes

APP_ROOT = Path(__file__).resolve().parents[2]
MOD = APP_ROOT / "backend" / "document_library.py"
PAGE = APP_ROOT / "frontend" / "src" / "pages" / "DocumentLibrary.jsx"
VERSION_JS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


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


# ─── Source pins ──────────────────────────────────────────────

def test_default_tree_and_helpers_present():
    src = _read(MOD)
    for pin in (
        "DEFAULT_FOLDER_TREE",
        "IMS_LEAF_PATTERNS",
        "TREE_PARENT_NAMES",
        "def _flatten_tree_leaves",
        "async def _compute_reorganise_diff",
        "async def _apply_reorganise",
        "async def _ensure_tree_structure",
        '@router.post("/reorganise")',
        '@router.get("/folders/all")',
    ):
        assert pin in src, f"missing pin: {pin!r}"


def test_folder_models_accept_parent_folder_id():
    src = _read(MOD)
    # Both create + patch schemas must expose parent_folder_id.
    assert re.search(
        r"class FolderIn\(BaseModel\):[\s\S]*?parent_folder_id:", src)
    assert re.search(
        r"class FolderPatch\(BaseModel\):[\s\S]*?parent_folder_id:", src)


def test_patch_has_cycle_check():
    src = _read(MOD)
    assert "would create a cycle" in src
    assert "A folder cannot be its own parent" in src


def test_frontend_create_form_has_parent_select():
    src = _read(PAGE)
    for pin in (
        "folder-create-parent-select",
        "loadAllFolders",
        "allFoldersLoaded",
        "api.get('/document-library/folders/all')",
        # Admin-only render gate.
        "user?.role === 'admin'",
    ):
        assert pin in src, f"missing FE pin: {pin!r}"


# ─── Behavioural — reorganise round-trip ──────────────────────

def test_reorganise_dry_run_and_apply_idempotent():
    h = _login()
    # First dry_run.
    r1 = requests.post(f"{API}/document-library/reorganise?dry_run=true",
                        headers=h, timeout=30)
    assert r1.status_code == 200, r1.text
    body1 = r1.json()
    for key in ("parents_to_create", "reparents", "skipped", "counts"):
        assert key in body1, f"dry-run missing key {key}"

    # Apply.
    r2 = requests.post(f"{API}/document-library/reorganise?dry_run=false",
                        headers=h, timeout=30)
    assert r2.status_code == 200, r2.text
    body2 = r2.json()
    for key in ("parents_created", "reparented", "skipped"):
        assert key in body2, f"apply missing key {key}"

    # Second dry_run — must be idempotent.
    r3 = requests.post(f"{API}/document-library/reorganise?dry_run=true",
                        headers=h, timeout=30)
    assert r3.status_code == 200
    body3 = r3.json()
    assert body3["counts"]["parents_to_create"] == 0
    assert body3["counts"]["reparents"] == 0


def test_tree_parents_present_at_root_after_reorganise():
    h = _login()
    # Trigger auto-apply.
    r = requests.get(f"{API}/document-library/folders", headers=h, timeout=30)
    assert r.status_code == 200
    root_names = {f["name"] for f in r.json()}
    # All 7 top-level tree parents must be at root.
    expected_at_root = {
        "Compliance & Safety", "Training & Competency", "Administration",
        "Equipment & Assets", "IMS (Integrated Management System)",
        "Archives", "Work",
    }
    missing = expected_at_root - root_names
    assert not missing, f"missing tree parents at root: {missing}"


def test_ssra_style_leaf_not_at_root_after_reorganise():
    """Regression pin: after the reorganise, historic leaves like
    "Working at Heights" / "Confined Space" MUST NOT appear at root
    anymore — they should sit under Compliance & Safety / Risk &
    Hazard."""
    h = _login()
    r = requests.get(f"{API}/document-library/folders", headers=h, timeout=30)
    assert r.status_code == 200
    root_names = {f["name"] for f in r.json()}
    for leaf in ("Working at Heights", "Confined Space", "SWMS",
                    "Traffic Management", "Inductions",
                    "Licences & Tickets"):
        assert leaf not in root_names, (
            f"leaf {leaf!r} must not sit at root after reorganise"
        )


def test_folders_all_endpoint_returns_flat_list_with_paths():
    h = _login()
    r = requests.get(f"{API}/document-library/folders/all",
                      headers=h, timeout=30)
    assert r.status_code == 200, r.text
    rows = r.json()
    assert isinstance(rows, list)
    # Every row exposes the fields the FE picker needs.
    for row in rows[:5]:
        assert set(row.keys()) >= {"id", "name", "parent_folder_id",
                                     "is_system"}


def test_create_folder_with_parent_folder_id():
    """Create a scratch folder under Compliance & Safety, verify
    it lands with the correct parent_folder_id, then delete it."""
    h = _login()
    # Find Compliance & Safety id.
    r = requests.get(f"{API}/document-library/folders/all",
                      headers=h, timeout=30)
    all_folders = r.json()
    parent = next(
        (f for f in all_folders if f["name"] == "Compliance & Safety"),
        None,
    )
    assert parent, "Compliance & Safety missing — tree not seeded"

    import uuid as _uuid
    name = f"pytest-scratch-{_uuid.uuid4().hex[:6]}"
    c = requests.post(
        f"{API}/document-library/folders",
        json={"name": name, "parent_folder_id": parent["id"]},
        headers=h, timeout=15,
    )
    assert c.status_code == 201, c.text
    fid = c.json()["id"]

    try:
        # Verify parent_folder_id landed.
        got = requests.get(f"{API}/document-library/folders/all",
                            headers=h, timeout=15).json()
        row = next((f for f in got if f["id"] == fid), None)
        assert row, "scratch folder not in flat list"
        assert row["parent_folder_id"] == parent["id"]
    finally:
        requests.delete(f"{API}/document-library/folders/{fid}",
                          headers=h, timeout=15)


def test_patch_reparent_and_cycle_block():
    """Reparent a scratch folder, then try to reparent its parent
    under it — that must 400 with the cycle message."""
    h = _login()
    r = requests.get(f"{API}/document-library/folders/all",
                      headers=h, timeout=30)
    all_folders = r.json()
    root_parent = next(
        (f for f in all_folders if f["name"] == "Training & Competency"),
        None,
    )
    assert root_parent

    import uuid as _uuid
    n1 = f"pytest-p-{_uuid.uuid4().hex[:6]}"
    n2 = f"pytest-c-{_uuid.uuid4().hex[:6]}"
    p = requests.post(
        f"{API}/document-library/folders",
        json={"name": n1, "parent_folder_id": root_parent["id"]},
        headers=h, timeout=15,
    ).json()
    c = requests.post(
        f"{API}/document-library/folders",
        json={"name": n2, "parent_folder_id": p["id"]},
        headers=h, timeout=15,
    ).json()

    try:
        # Try to reparent `p` under `c` — must 400.
        bad = requests.patch(
            f"{API}/document-library/folders/{p['id']}",
            json={"parent_folder_id": c["id"]},
            headers=h, timeout=15,
        )
        assert bad.status_code == 400, bad.text
        assert "cycle" in bad.text.lower()

        # Self-reparent also blocked.
        bad2 = requests.patch(
            f"{API}/document-library/folders/{p['id']}",
            json={"parent_folder_id": p["id"]},
            headers=h, timeout=15,
        )
        assert bad2.status_code == 400
        assert "own parent" in bad2.text.lower()

        # Legit reparent (detach to root via "-" sentinel).
        detach = requests.patch(
            f"{API}/document-library/folders/{p['id']}",
            json={"parent_folder_id": "-"},
            headers=h, timeout=15,
        )
        assert detach.status_code == 200, detach.text
    finally:
        requests.delete(f"{API}/document-library/folders/{c['id']}",
                          headers=h, timeout=15)
        requests.delete(f"{API}/document-library/folders/{p['id']}",
                          headers=h, timeout=15)


def test_reorganise_requires_admin():
    """Anonymous → 401/403. Non-admin authenticated write attempts
    should ALSO be blocked (admin-only). We verify anon here; the
    non-admin branch is enforced by _require({'admin'})."""
    r = requests.post(f"{API}/document-library/reorganise?dry_run=true",
                        timeout=15)
    assert r.status_code in (401, 403)


# ─── Version pins ─────────────────────────────────────────────

def test_version_bumped_to_132gy():
    js = _read(VERSION_JS)
    sw = _read(SW)
    assert re.search(r"RUNNING_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gy'", js)
    assert re.search(r"EXPECTED_CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gy'", js)
    assert re.search(r"CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gy'", sw)

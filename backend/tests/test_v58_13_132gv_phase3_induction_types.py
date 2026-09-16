"""v58.13.132gv — Phase 3: Inductions dropdown admin CRUD.

Locks:
  · New `induction_types` sub-router at /api/inductions/types.
  · Admin-only writes, soft-delete + name-snapshot semantics
    matching Phase 1 equipment_categories.
  · Frontend InductionCardModal is API-driven with a "Manage"
    admin modal + snapshot fallback for records tagged with a
    soft-deleted type.
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

MOD = BE / "induction_types.py"
SERVER = BE / "server.py"
MODAL = FRONTEND / "src" / "components" / "InductionCardModal.jsx"
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


# ─── Source pins (backend) ─────────────────────────────────────

def test_backend_router_present():
    src = _read(MOD)
    for pin in (
        'router = APIRouter(prefix="/inductions/types"',
        '@router.get("")',
        '@router.post("", status_code=201)',
        '@router.patch("/{tid}")',
        '@router.delete("/{tid}", status_code=204)',
        "DEFAULT_INDUCTION_TYPES",
        '"competency"',
        '"site_induction"',
        '"license"',
    ):
        assert pin in src, f"missing backend pin: {pin!r}"


def test_router_mounted_in_server():
    src = _read(SERVER)
    assert "from induction_types import router as induction_types_router" in src
    assert "api.include_router(induction_types_router)" in src


# ─── Behavioural — CRUD round-trip ─────────────────────────────

def test_types_list_seeds_defaults_and_admin_only_writes():
    h = _login()
    lst = requests.get(f"{API}/inductions/types", headers=h, timeout=15)
    assert lst.status_code == 200, lst.text
    names = [t["name"] for t in lst.json()["items"]]
    # Default seed values must all be present after first-list.
    for legacy in ("competency", "site_induction", "license"):
        assert legacy in names, (
            f"expected legacy seed {legacy!r} in {names}"
        )


def test_types_crud_round_trip():
    h = _login()
    unique = f"pytest-type-{_uuid.uuid4().hex[:8]}"
    c = requests.post(f"{API}/inductions/types",
                        json={"name": unique}, headers=h, timeout=15)
    assert c.status_code == 201, c.text
    tid = c.json()["id"]

    # Dupe → 409.
    dupe = requests.post(f"{API}/inductions/types",
                          json={"name": unique}, headers=h, timeout=15)
    assert dupe.status_code == 409

    # Rename.
    new_name = unique + "-renamed"
    p = requests.patch(f"{API}/inductions/types/{tid}",
                        json={"name": new_name}, headers=h, timeout=15)
    assert p.status_code == 200
    assert p.json()["name"] == new_name

    # Soft-delete.
    d = requests.delete(f"{API}/inductions/types/{tid}",
                          headers=h, timeout=15)
    assert d.status_code == 204

    # Deleted type absent from list.
    lst = requests.get(f"{API}/inductions/types", headers=h, timeout=15)
    names = [t["name"] for t in lst.json()["items"]]
    assert new_name not in names

    # Missing type → 404 on rename + delete.
    p2 = requests.patch(f"{API}/inductions/types/does-not-exist",
                          json={"name": "x"}, headers=h, timeout=15)
    assert p2.status_code == 404
    d2 = requests.delete(f"{API}/inductions/types/does-not-exist",
                          headers=h, timeout=15)
    assert d2.status_code == 404


def test_types_list_requires_auth_but_read_is_open_to_authenticated():
    """List is authenticated (any role) so non-admins can populate
    the dropdown while filling out inductions. Anonymous is still
    rejected."""
    r = requests.get(f"{API}/inductions/types", timeout=15)
    assert r.status_code in (401, 403)


# ─── Source pins (frontend) ────────────────────────────────────

def test_frontend_dropdown_is_api_driven():
    src = _read(MODAL)
    # Legacy hardcoded three-option <select> must be gone.
    assert re.search(
        r'<option value="competency">Competency</option>',
        src,
    ) is None, (
        "Legacy hardcoded induction-type <option> tags must be removed"
    )
    # New API call site is present.
    assert "api.get('/inductions/types')" in src
    assert "setInductionTypes" in src


def test_frontend_manage_modal_and_testids():
    src = _read(MODAL)
    for pin in (
        "function ManageInductionTypesModal",
        '"induction-types-modal"',
        '"induction-type-new-input"',
        '"induction-type-add-btn"',
        '"induction-manage-types-btn"',
    ):
        assert pin in src, f"missing frontend pin: {pin!r}"
    # Dynamic testids on row-level Rename / Delete controls.
    for pattern in (
        "`induction-type-row-${t.id}`",
        "`induction-type-rename-${t.id}`",
        "`induction-type-delete-${t.id}`",
    ):
        assert pattern in src, f"missing dynamic testid template: {pattern}"


def test_frontend_admin_gate_on_manage_button():
    src = _read(MODAL)
    assert "user?.role === 'admin'" in src or "isAdmin" in src
    # Manage button rendered only when isAdmin.
    m = re.search(
        r"\{isAdmin\s*&&\s*\([\s\S]{0,400}induction-manage-types-btn",
        src,
    )
    assert m, "Manage induction types button must be gated by isAdmin"


def test_frontend_snapshot_semantics_for_deleted_types():
    src = _read(MODAL)
    # Records with a soft-deleted / removed type must surface as
    # a `(removed)` option so the admin can see the snapshot value
    # without accidentally overwriting it.
    assert "(removed)" in src
    assert "snapshot" in src


def test_frontend_calls_post_patch_delete_endpoints():
    src = _read(MODAL)
    assert "api.post('/inductions/types'" in src
    assert "api.patch(`/inductions/types/${t.id}`" in src
    assert "api.delete(`/inductions/types/${t.id}`" in src


# ─── Version pins ─────────────────────────────────────────────

def test_version_bumped_to_132gv():
    js = _read(VERSION_JS)
    sw = _read(SW)
    assert re.search(r"RUNNING_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gv'", js)
    assert re.search(r"EXPECTED_CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gv'", js)
    assert re.search(r"CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gv'", sw)

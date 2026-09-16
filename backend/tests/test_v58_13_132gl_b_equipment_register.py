"""v58.13.132gl-b — Equipment Register CRUD tests."""
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

MOD = BE / "equipment_register.py"
PAGE = FRONTEND / "src" / "pages" / "EquipmentRegister.jsx"
APP_JS = FRONTEND / "src" / "App.js"
APPSHELL = FRONTEND / "src" / "components" / "layout" / "AppShell.jsx"
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


def test_backend_router_exists_with_expected_endpoints():
    src = _read(MOD)
    for pin in (
        'router = APIRouter(prefix="/equipment"',
        '@router.get("")',
        '@router.get("/summary")',
        '@router.post("", status_code=201)',
        '@router.get("/{eid}")',
        '@router.patch("/{eid}")',
        '@router.delete("/{eid}", status_code=204)',
        '@router.post("/{eid}/certs", status_code=201)',
        '@router.get("/{eid}/certs/{cert_id}")',
        '@router.delete("/{eid}/certs/{cert_id}", status_code=204)',
    ):
        assert pin in src, f"missing endpoint pin: {pin!r}"


def test_router_registered_in_server():
    src = _read(BE / "server.py")
    # .132gs Phase 1 broadened the import to also pull in
    # categories_router; either the pre-.132gs single-import shape
    # or the new multi-import shape is acceptable.
    assert (
        "from equipment_register import router as equipment_register_router" in src
        or "from equipment_register import (" in src
    )
    assert "equipment_register_router" in src
    assert "api.include_router(equipment_register_router)" in src


def test_frontend_page_renders_expected_data_testids():
    src = _read(PAGE)
    for tid in (
        "equipment-register-page", "equipment-total-count",
        "equipment-expired-count", "equipment-expiring-count",
        "equipment-add-btn", "equipment-modal",
        "equipment-save-btn", "equipment-table",
    ):
        assert f'"{tid}"' in src, f"missing data-testid: {tid}"


def test_route_and_sidebar_wired():
    app_js = _read(APP_JS)
    assert 'import EquipmentRegister from' in app_js
    assert 'path="equipment"' in app_js
    shell = _read(APPSHELL)
    assert "'/app/equipment'" in shell
    assert "'nav-equipment'" in shell


# ─── Behavioural CRUD ──────────────────────────────────────────


def test_equipment_full_crud_round_trip():
    h = _login()
    # Create
    body = {"name": "pytest-eq", "category": "Test gauge",
            "serial_number": "SN-PY-01",
            "expiry_date": "2025-01-01"}
    r = requests.post(f"{API}/equipment", json=body, headers=h, timeout=15)
    assert r.status_code == 201, r.text
    eid = r.json()["id"]
    assert r.json().get("days_until_expiry") is not None
    assert r.json()["days_until_expiry"] < 0  # past date

    # List includes it.
    lst = requests.get(f"{API}/equipment", headers=h, timeout=15)
    assert lst.status_code == 200
    assert any(row["id"] == eid for row in lst.json()["items"])

    # Summary reflects the expired row.
    summary = requests.get(f"{API}/equipment/summary", headers=h, timeout=15)
    assert summary.status_code == 200
    assert summary.json()["expired"] >= 1

    # Patch.
    p = requests.patch(f"{API}/equipment/{eid}",
                         json={"notes": "pytest-patched"},
                         headers=h, timeout=15)
    assert p.status_code == 200
    assert p.json()["notes"] == "pytest-patched"

    # Cert upload.
    up = requests.post(
        f"{API}/equipment/{eid}/certs", headers=h, timeout=15,
        files={"file": ("py.pdf", b"%PDF-1.4\npytest\n%%EOF", "application/pdf")},
    )
    assert up.status_code == 201, up.text
    cid = up.json()["id"]

    # Cert download.
    dl = requests.get(f"{API}/equipment/{eid}/certs/{cid}",
                        headers=h, timeout=15)
    assert dl.status_code == 200
    assert b"%PDF" in dl.content

    # Cert delete.
    d = requests.delete(f"{API}/equipment/{eid}/certs/{cid}",
                          headers=h, timeout=15)
    assert d.status_code == 204

    # Equipment delete.
    d = requests.delete(f"{API}/equipment/{eid}", headers=h, timeout=15)
    assert d.status_code == 204


def test_equipment_list_is_admin_only():
    r = requests.get(f"{API}/equipment", timeout=15)
    assert r.status_code in (401, 403)


# ─── Version lockstep ─────────────────────────────────────────


def test_version_bumped_to_132gl_b():
    js = _read(VERSION_JS)
    sw = _read(SW)
    assert re.search(r"RUNNING_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gl-b'", js)
    assert re.search(r"EXPECTED_CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gl-b'", js)
    assert re.search(r"CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gl-b'", sw)

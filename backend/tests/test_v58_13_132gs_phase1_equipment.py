"""v58.13.132gs — Phase 1 Equipment Register extensions.

Locks the three .132gs additions:
  · Multi-docs (generic `documents` array via GridFS).
  · Model Number field.
  · Editable Category CRUD (admin-only, soft-delete, snapshot).
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

MOD = BE / "equipment_register.py"
SERVER = BE / "server.py"
PAGE = FRONTEND / "src" / "pages" / "EquipmentRegister.jsx"
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

def test_backend_router_pins_new_endpoints():
    src = _read(MOD)
    for pin in (
        'categories_router = APIRouter(prefix="/equipment/categories"',
        '@categories_router.get("")',
        '@categories_router.post("", status_code=201)',
        '@categories_router.patch("/{cid}")',
        '@categories_router.delete("/{cid}", status_code=204)',
        '@router.post("/{eid}/documents", status_code=201)',
        '@router.get("/{eid}/documents/{doc_id}")',
        '@router.delete("/{eid}/documents/{doc_id}", status_code=204)',
    ):
        assert pin in src, f"missing endpoint pin: {pin!r}"
    assert '@router.post("/{eid}/certs", status_code=201)' in src


def test_backend_pydantic_carries_model_number():
    src = _read(MOD)
    assert re.search(r"class EquipmentIn\(BaseModel\):[\s\S]*?model_number:", src)
    assert re.search(r"class EquipmentPatch\(BaseModel\):[\s\S]*?model_number:", src)


def test_categories_router_mounted_before_eid_catchall():
    src = _read(SERVER)
    assert "categories_router as equipment_categories_router" in src
    idx_cats = src.index("api.include_router(equipment_categories_router)")
    idx_main = src.index("api.include_router(equipment_register_router)")
    assert idx_cats < idx_main


# ─── Source pins (frontend) ────────────────────────────────────

def test_frontend_page_carries_new_testids():
    src = _read(PAGE)
    for tid in (
        "equipment-manage-categories-btn",
        "equipment-categories-modal",
        "equipment-category-new-input",
        "equipment-category-add-btn",
        "equipment-model-input",
        "equipment-documents-section",
        "equipment-doc-upload-btn",
        "equipment-doc-file-input",
    ):
        assert f'"{tid}"' in src, f"missing data-testid: {tid}"


def test_frontend_calls_new_endpoints():
    src = _read(PAGE)
    assert "/equipment/categories" in src
    assert "/documents" in src
    assert "model_number" in src


def test_frontend_admin_gate_on_manage_categories():
    src = _read(PAGE)
    assert "isAdmin" in src
    m = re.search(r"\{isAdmin\s*&&\s*\([\s\S]{0,400}equipment-manage-categories-btn", src)
    assert m, "Manage categories button must be gated by isAdmin"


# ─── Version lockstep ─────────────────────────────────────────

def test_version_bumped_to_132gs():
    js = _read(VERSION_JS)
    sw = _read(SW)
    assert re.search(r"RUNNING_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gs'", js)
    assert re.search(r"EXPECTED_CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gs'", js)
    assert re.search(r"CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gs'", sw)


# ─── Behavioural — Categories CRUD ─────────────────────────────

def test_category_crud_round_trip():
    h = _login()
    lst = requests.get(f"{API}/equipment/categories", headers=h, timeout=15)
    assert lst.status_code == 200, lst.text
    assert isinstance(lst.json()["items"], list)

    import uuid as _uuid
    unique_name = f"pytest-cat-{_uuid.uuid4().hex[:8]}"
    c = requests.post(f"{API}/equipment/categories",
                        json={"name": unique_name}, headers=h, timeout=15)
    assert c.status_code == 201, c.text
    cid = c.json()["id"]

    dupe = requests.post(f"{API}/equipment/categories",
                          json={"name": unique_name}, headers=h, timeout=15)
    assert dupe.status_code == 409

    new_name = unique_name + "-x"
    p = requests.patch(f"{API}/equipment/categories/{cid}",
                        json={"name": new_name}, headers=h, timeout=15)
    assert p.status_code == 200
    assert p.json()["name"] == new_name

    d = requests.delete(f"{API}/equipment/categories/{cid}",
                          headers=h, timeout=15)
    assert d.status_code == 204

    lst2 = requests.get(f"{API}/equipment/categories", headers=h, timeout=15)
    assert lst2.status_code == 200
    names = [c["name"] for c in lst2.json()["items"]]
    assert new_name not in names


def test_categories_admin_only():
    r = requests.get(f"{API}/equipment/categories", timeout=15)
    assert r.status_code in (401, 403)


# ─── Behavioural — Model Number + Documents ────────────────────

def test_equipment_carries_model_number_and_documents():
    h = _login()
    body = {
        "name": "pytest-eq-132gs",
        "category": "Test gauge",
        "model_number": "MDL-132GS-01",
        "serial_number": "SN-132GS-01",
    }
    r = requests.post(f"{API}/equipment", json=body, headers=h, timeout=15)
    assert r.status_code == 201, r.text
    row = r.json()
    eid = row["id"]
    assert row.get("model_number") == "MDL-132GS-01"
    assert row.get("documents") == []

    try:
        p = requests.patch(f"{API}/equipment/{eid}",
                             json={"model_number": "MDL-132GS-02"},
                             headers=h, timeout=15)
        assert p.status_code == 200
        assert p.json()["model_number"] == "MDL-132GS-02"

        up = requests.post(
            f"{API}/equipment/{eid}/documents", headers=h, timeout=15,
            files={"file": ("spec.pdf", b"%PDF-1.4\nspec\n%%EOF",
                            "application/pdf")},
            data={"label": "spec sheet"},
        )
        assert up.status_code == 201, up.text
        doc_id = up.json()["id"]
        assert up.json()["label"] == "spec sheet"

        det = requests.get(f"{API}/equipment/{eid}", headers=h, timeout=15)
        assert det.status_code == 200
        docs = [d for d in det.json().get("documents") or []
                if d.get("id") == doc_id]
        assert len(docs) == 1

        dl = requests.get(f"{API}/equipment/{eid}/documents/{doc_id}",
                            headers=h, timeout=15)
        assert dl.status_code == 200
        assert b"%PDF" in dl.content

        rm = requests.delete(
            f"{API}/equipment/{eid}/documents/{doc_id}",
            headers=h, timeout=15,
        )
        assert rm.status_code == 204

        dl2 = requests.get(
            f"{API}/equipment/{eid}/documents/{doc_id}",
            headers=h, timeout=15,
        )
        assert dl2.status_code == 404
    finally:
        requests.delete(f"{API}/equipment/{eid}", headers=h, timeout=15)


def test_document_and_cert_are_separate_storage_subdirs():
    src = _read(MOD)
    assert '"equipment_certs"' in src
    assert '"equipment_documents"' in src

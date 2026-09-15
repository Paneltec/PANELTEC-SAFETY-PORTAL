"""v58.13.132go — Custom Roles list must exclude soft-deleted rows."""
from __future__ import annotations
import re, uuid
from pathlib import Path
import pytest, requests
from tests.conftest import ADMIN_EMAIL, ADMIN_PWD, API

pytestmark = pytest.mark.live_db_writes

APP_ROOT = Path(__file__).resolve().parents[2]
CAT = APP_ROOT / "backend" / "roles_catalogue.py"
VJS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


def _login():
    r = requests.post(f"{API}/auth/login",
                        json={"email": ADMIN_EMAIL, "password": ADMIN_PWD},
                        timeout=30)
    if r.status_code == 429: pytest.skip("rate-limited")
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_list_roles_filters_soft_deleted_rows():
    src = CAT.read_text(encoding="utf-8")
    # New filter present; old un-filtered call gone.
    assert 'db.roles.find(\n        {"$or": [{"deleted_at": None}, {"deleted_at": {"$exists": False}}]}' in src
    assert 'db.roles.find({}, {"_id": 0}).sort("role_id"' not in src


def test_end_to_end_create_delete_disappears_from_list():
    h = _login()
    stamp = uuid.uuid4().hex[:6]
    name = f"go-py-{stamp}"
    r = requests.post(f"{API}/admin/roles",
                        json={"name": name, "description": "pytest"},
                        headers=h, timeout=15)
    assert r.status_code in (200, 201), r.text
    rid = r.json()["role_id"]

    # Present before delete.
    lst_before = requests.get(f"{API}/admin/roles", headers=h, timeout=15).json()
    assert any(row["role_id"] == rid for row in lst_before["roles"])
    before_count = lst_before["count"]

    # Delete.
    d = requests.delete(f"{API}/admin/roles/{rid}", headers=h, timeout=15)
    assert d.status_code in (200, 204), d.text
    assert d.json().get("deleted") is True

    # Gone from list AND count decremented.
    lst_after = requests.get(f"{API}/admin/roles", headers=h, timeout=15).json()
    assert not any(row["role_id"] == rid for row in lst_after["roles"])
    assert lst_after["count"] == before_count - 1


def test_version_bumped_to_132go():
    js, sw = VJS.read_text(encoding="utf-8"), SW.read_text(encoding="utf-8")
    assert re.search(r"RUNNING_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132go'", js)
    assert re.search(r"EXPECTED_CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132go'", js)
    assert re.search(r"CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132go'", sw)

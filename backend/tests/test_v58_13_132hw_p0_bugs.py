"""v58.13.132hw — P0 bug fixes bundled."""
from __future__ import annotations

import re
import uuid
from pathlib import Path

import pytest
import requests

pytestmark = pytest.mark.live_db_writes

VJS = Path("/app/frontend/src/lib/version.js")
SW = Path("/app/frontend/public/service-worker.js")
VISITOR_JSX = Path("/app/frontend/src/pages/VisitorSignIn.jsx")
INCIDENTS_JSX = Path("/app/frontend/src/pages/Incidents.jsx")
FORMS_PY = Path("/app/backend/forms.py")


def _api(_mongo) -> str:
    from tests.conftest import API as _api_url
    return _api_url


def _read(p: Path) -> str:
    return p.read_text()


def test_scan_site_token_returns_anonymously(_mongo, ephemeral_admin, ephemeral_org_id):
    api = _api(_mongo)
    tok_val = f"pytest-hw-{uuid.uuid4().hex[:10]}"
    _mongo.simpro_sites.insert_one({
        "id": "pytest-hw-site", "org_id": ephemeral_org_id,
        "simpro_site_id": 999999, "name": "Pytest HW Site",
        "scan_token": tok_val, "deleted_at": None,
        "signon_questions": [],
    })
    try:
        r = requests.get(f"{api}/scan/site/{tok_val}", timeout=10)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["site"]["name"] == "Pytest HW Site"
        assert "visitor_signon_url" in body
    finally:
        _mongo.simpro_sites.delete_one({"id": "pytest-hw-site"})


def test_visitor_signin_page_uses_scan_endpoint():
    src = _read(VISITOR_JSX)
    assert "/public/site/${token}/form" not in src
    assert "api.get(`/scan/site/${token}`)" in src


def test_incidents_page_keeps_toolbar_mounted_on_subsequent_loads():
    src = _read(INCIDENTS_JSX)
    assert "loading && items.length === 0" in src


def test_forms_py_has_local_fleet_fallback():
    src = _read(FORMS_PY)
    assert "async def _local_fleet_fallback(" in src
    assert "db.assets.find(" in src
    assert '"status": "local_fleet_fallback"' in src
    assert "return await _local_fleet_fallback(" in src


def test_version_pin_v132hw():
    js = _read(VJS)
    sw = _read(SW)
    assert re.search(r"RUNNING_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132h[w-z]", js)
    assert re.search(r"EXPECTED_CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132h[w-z]", js)
    assert re.search(r"CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132h[w-z]", sw)

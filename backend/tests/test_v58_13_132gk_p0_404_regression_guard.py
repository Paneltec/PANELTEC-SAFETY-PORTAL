"""v58.13.132gk — Regression guard for the "P0 404 storm" report.

Stephen reported four 404 sources after the `.132gj` cache-version
bump landed:

  1. Fleet vehicle click → 404.
  2. Fleet Retired/Sold tab → 404.
  3. Login post-logout → 404.
  4. Session history empty for Mel.

Backend curl diagnosis (see the `.132gk` ship memo) showed **all
four endpoints returning 2xx** on the pod. The failure was a stale
service worker on Stephen's browser (cache-version churn across
`.132gh → gi → gj`), which the `.132gk` bump forces to refresh.

These tests exist so a future ship never silently breaks the four
routes that were suspected — any regression here trips CI before
Stephen sees a toast.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest
import requests

from tests.conftest import ADMIN_EMAIL, ADMIN_PWD, API

pytestmark = pytest.mark.live_db_writes

APP_ROOT = Path(__file__).resolve().parents[2]
FRONTEND = APP_ROOT / "frontend"
VERSION_JS = FRONTEND / "src" / "lib" / "version.js"
SW = FRONTEND / "public" / "service-worker.js"


def _login() -> tuple[dict, dict]:
    r = requests.post(
        f"{API}/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PWD},
        timeout=30,
    )
    if r.status_code == 429:
        pytest.skip("rate-limited")
    r.raise_for_status()
    body = r.json()
    return ({"Authorization": f"Bearer {body['access_token']}"},
            body["user"])


def test_login_endpoint_returns_200():
    """The exact URL the Cover page posts to must never regress to 404."""
    r = requests.post(
        f"{API}/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PWD},
        timeout=15,
    )
    if r.status_code == 429:
        pytest.skip("rate-limited")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("access_token")
    assert body.get("user", {}).get("email") == ADMIN_EMAIL


def test_fleet_register_list_returns_200():
    h, _ = _login()
    r = requests.get(f"{API}/fleet/register?limit=3", headers=h, timeout=15)
    assert r.status_code == 200, r.text
    assert "items" in r.json()


def test_fleet_register_retired_only_returns_200():
    """The Retired/Sold tab flips `retired_only=true` — must resolve."""
    h, _ = _login()
    r = requests.get(
        f"{API}/fleet/register?retired_only=true&limit=3",
        headers=h, timeout=15,
    )
    assert r.status_code == 200, r.text


def test_fleet_categories_carries_retired_summary():
    """`retiredData` in the FE is fed by `/api/fleet/categories.retired`.
    A regression here silently empties the Retired chip."""
    h, _ = _login()
    r = requests.get(f"{API}/fleet/categories", headers=h, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "retired" in body, "categories payload must expose `retired` summary"
    assert "total" in body["retired"]


def test_asset_detail_returns_200_for_first_row():
    """The Fleet row click resolves to `/api/assets/{id}`. This was
    the "vehicle click 404" Stephen reported; test guards the actual
    endpoint the FE calls (NOT `/api/fleet/assets/{id}`, which is a
    different sibling handler)."""
    h, _ = _login()
    lst = requests.get(f"{API}/fleet/register?limit=1", headers=h, timeout=15)
    assert lst.status_code == 200, lst.text
    items = lst.json().get("items") or []
    if not items:
        pytest.skip("no fleet items on this pod")
    fid = items[0]["id"]
    got = requests.get(f"{API}/assets/{fid}", headers=h, timeout=15)
    assert got.status_code == 200, got.text
    assert got.json().get("id") == fid


def test_admin_session_history_returns_200_for_self():
    """Session-history endpoint is `/api/admin/users/{uid}/session-history`.
    Mel's empty rendering was a data condition (no session end recorded
    yet), not a 404 — this test proves the endpoint responds and returns
    the expected shape for a user WITH history."""
    h, user = _login()
    uid = user["id"]
    r = requests.get(
        f"{API}/admin/users/{uid}/session-history?limit=5",
        headers=h, timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["user"]["id"] == uid
    assert isinstance(body.get("history"), list)
    assert isinstance(body.get("count"), int)


def test_version_bumped_to_132gk():
    js = VERSION_JS.read_text(encoding="utf-8")
    sw = SW.read_text(encoding="utf-8")
    assert re.search(r"RUNNING_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gk'", js)
    assert re.search(r"EXPECTED_CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gk'", js)
    assert re.search(r"CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gk'", sw)

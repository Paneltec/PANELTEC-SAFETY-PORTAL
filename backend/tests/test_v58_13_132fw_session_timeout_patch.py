"""v58.13.132fw — Session-timeout per-user PATCH endpoint."""
from __future__ import annotations

from pathlib import Path

import pytest
import requests

from tests.conftest import ADMIN_EMAIL, ADMIN_PWD, API

pytestmark = pytest.mark.live_db_writes

APP_ROOT = Path(__file__).resolve().parents[2]
SESSION_TO = APP_ROOT / "backend" / "session_timeout.py"
VERSION_JS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


def _read(p): return p.read_text(encoding="utf-8")


def _login():
    r = requests.post(f"{API}/auth/login",
                       json={"email": ADMIN_EMAIL, "password": ADMIN_PWD}, timeout=30)
    if r.status_code == 429:
        pytest.skip("rate-limited")
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_patch_route_exists():
    src = _read(SESSION_TO)
    assert '@router.patch("/session-timeout/me")' in src, (
        "PATCH /settings/session-timeout/me must be registered in .132fw")
    assert "class UserTimeoutIn" in src


def test_effective_for_user_honours_per_user_override():
    src = _read(SESSION_TO)
    assert "session_timeout_minutes_override" in src, (
        "effective_for_user must read session_timeout_minutes_override "
        "off the user document so a saved preset actually takes effect")


def test_live_round_trip():
    """Save → read → confirm the value stuck. Restore at the end."""
    h = _login()
    # Read baseline so we can restore.
    r = requests.get(f"{API}/settings/session-timeout/me", headers=h, timeout=30)
    assert r.status_code == 200, r.text
    original = r.json().get("effective_minutes") or r.json().get("idle_minutes") or 30

    r = requests.patch(f"{API}/settings/session-timeout/me",
                       headers={**h, "Content-Type": "application/json"},
                       json={"minutes": 240}, timeout=30)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j.get("idle_minutes") == 240 and j.get("effective_minutes") == 240

    r = requests.get(f"{API}/settings/session-timeout/me", headers=h, timeout=30)
    assert r.status_code == 200
    assert r.json().get("effective_minutes") == 240

    # Restore.
    requests.patch(f"{API}/settings/session-timeout/me",
                   headers={**h, "Content-Type": "application/json"},
                   json={"minutes": int(original)}, timeout=30)


def test_version_bumped_to_132fw():
    assert "paneltec-v160.3.9.58.13.132fw" in _read(VERSION_JS)
    assert "paneltec-v160.3.9.58.13.132fw" in _read(SW)

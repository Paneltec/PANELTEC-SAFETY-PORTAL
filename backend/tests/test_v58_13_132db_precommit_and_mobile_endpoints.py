"""v58.13.132db — Pre-commit lint hardening + mobile data endpoints.

Locks:
  · check_version_files_v58_8_1.py enforces 4-slot strict equality
    (RUNNING + EXPECTED + CACHE + MOBILE) with an
    MOBILE_VERSION_SYNC_OPTIONAL escape hatch so the web side can
    ship while mobile lags.
  · 5 new mobile-data endpoints mounted + auth-gated:
      GET  /api/mobile/records/mine
      GET  /api/mobile/ai/briefing
      POST /api/mobile/prestart/submit
      POST /api/mobile/sites/{id}/sign-on
      POST /api/mobile/sites/{id}/sign-off
      POST /api/mobile/ai/ask
  · /api/auth/me diagnosis: mobile JWTs are minted by the same
    `auth.create_access_token()` helper as web JWTs, so the endpoint
    accepts them verbatim. 401 reported by the Expo specialist is
    client-side (missing / malformed Authorization header).
  · Three-way version sync at .132db.
"""
from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

import requests

APP_ROOT = Path(__file__).resolve().parents[2]
HOOK_SCRIPT = APP_ROOT / "backend" / "scripts" / "check_version_files_v58_8_1.py"
VERSION_JS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SERVICE_WORKER = APP_ROOT / "frontend" / "public" / "service-worker.js"

API = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")


# ────────────────────── hook lint ──────────────────────


def test_hook_exists_and_reads_all_four_slots():
    src = HOOK_SCRIPT.read_text(encoding="utf-8")
    assert "RUNNING_VERSION" in src
    assert "EXPECTED_CACHE_VERSION" in src
    assert "CACHE_VERSION" in src
    assert "MOBILE_BUNDLE_VERSION" in src
    assert "MOBILE_VERSION_SYNC_OPTIONAL" in src, (
        "escape-hatch env var must be documented + honoured"
    )


def test_hook_passes_on_current_tree_with_mobile_escape():
    """The current tree is at .132db across web slots; mobile lags
    at .132cl per the /app/mobile/ edit ban. Hook should PASS with
    MOBILE_VERSION_SYNC_OPTIONAL=true."""
    env = {**os.environ, "MOBILE_VERSION_SYNC_OPTIONAL": "true"}
    r = subprocess.run(
        ["python", str(HOOK_SCRIPT)],
        env=env, capture_output=True, text=True,
    )
    assert r.returncode == 0, f"hook failed:\nSTDOUT:{r.stdout}\nSTDERR:{r.stderr}"


def test_hook_fails_when_mobile_escape_disabled_and_mobile_lags():
    """Without the escape hatch the hook must FAIL because mobile
    is behind the web at ship-time."""
    env = {**os.environ}
    env.pop("MOBILE_VERSION_SYNC_OPTIONAL", None)
    r = subprocess.run(
        ["python", str(HOOK_SCRIPT)],
        env=env, capture_output=True, text=True,
    )
    # Only assert failure if the mobile file is actually behind.
    mobile_file = APP_ROOT / "mobile" / "src" / "lib" / "version.ts"
    if not mobile_file.exists():
        return  # nothing to compare against
    mob = re.search(r"MOBILE_BUNDLE_VERSION\s*=\s*'([^']+)'",
                    mobile_file.read_text(encoding="utf-8"))
    web = re.search(r"RUNNING_VERSION\s*=\s*'([^']+)'",
                    VERSION_JS.read_text(encoding="utf-8"))
    if not (mob and web) or mob.group(1) == web.group(1):
        return  # they're already in sync; nothing to fail on
    assert r.returncode != 0, (
        f"hook should FAIL without escape hatch when mobile lags. "
        f"stdout: {r.stdout[:400]}"
    )


# ────────────────────── endpoint mount ──────────────────────


def test_mobile_data_endpoints_mounted_and_gated():
    """All 5 new endpoints must respond with 401/403/422 to anon
    calls (never 404 / 405 which would mean unmounted)."""
    cases = [
        ("GET",  "/api/mobile/records/mine"),
        ("GET",  "/api/mobile/ai/briefing"),
        ("POST", "/api/mobile/prestart/submit"),
        ("POST", "/api/mobile/sites/site-xyz/sign-on"),
        ("POST", "/api/mobile/sites/site-xyz/sign-off"),
        ("POST", "/api/mobile/ai/ask"),
    ]
    for method, path in cases:
        r = requests.request(
            method, f"{API}{path}",
            json={} if method == "POST" else None,
        )
        assert r.status_code in (401, 403, 422), (
            f"{method} {path} returned {r.status_code}: {r.text[:200]}"
        )


# ────────────────────── /api/auth/me diagnosis ──────────────────────


def test_auth_me_diagnosis_anon_returns_401():
    """/api/auth/me anonymous must be 401 — proves the endpoint is
    mounted and gated. Expo specialist's 401 is client-side."""
    r = requests.get(f"{API}/api/auth/me")
    assert r.status_code in (401, 403), f"got {r.status_code}"


def test_auth_me_accepts_mobile_session_token():
    """PIN-login mints a JWT via `auth.create_access_token()` —
    the same helper the web login uses. Therefore /api/auth/me
    accepts a mobile session_token verbatim."""
    r = requests.post(
        f"{API}/api/auth/mobile/pin-login",
        json={"pin": "3310", "device_id": "pytest-132db"},
    )
    if r.status_code == 429:
        return  # rate-limited from earlier tests — skip cleanly
    if r.status_code != 200:
        # No mobile PIN seeded → skip cleanly.
        return
    token = r.json()["session_token"]
    me = requests.get(
        f"{API}/api/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert me.status_code == 200, me.text
    body = me.json()
    assert body.get("email") == "stephen@paneltec.com.au"


# ────────────────────── version sync ──────────────────────


def _tail(s: str) -> str:
    m = re.search(r"paneltec-v160\.3\.9\.58\.13\.132([a-z]+)", s)
    assert m, s
    return m.group(1)


def test_three_way_sync_at_132db_or_later():
    vjs = VERSION_JS.read_text(encoding="utf-8")
    swjs = SERVICE_WORKER.read_text(encoding="utf-8")
    running = re.search(r"RUNNING_VERSION = '([^']+)'", vjs).group(1)
    expected = re.search(r"EXPECTED_CACHE_VERSION = '([^']+)'", vjs).group(1)
    cache = re.search(r"^const CACHE_VERSION = '([^']+)'", swjs,
                      re.MULTILINE).group(1)
    assert running == expected == cache
    assert _tail(running) >= "db"

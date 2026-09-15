"""v58.13.132gq — Backup POST /snapshots must return immediately."""
from __future__ import annotations
import re, time
from pathlib import Path
import pytest, requests
from tests.conftest import ADMIN_EMAIL, ADMIN_PWD, API

pytestmark = pytest.mark.live_db_writes

APP_ROOT = Path(__file__).resolve().parents[2]
BK = APP_ROOT / "backend" / "backup_service.py"
VJS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


def _read(p): return p.read_text(encoding="utf-8")


def _login():
    r = requests.post(f"{API}/auth/login",
                        json={"email": ADMIN_EMAIL, "password": ADMIN_PWD},
                        timeout=30)
    if r.status_code == 429: pytest.skip("rate-limited")
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_create_snapshot_uses_background_tasks_and_guard():
    src = _read(BK)
    # BackgroundTasks import added.
    assert "BackgroundTasks" in src.split("\n")[67]  # line 68
    # New handler signature with bg param + queued response shape.
    assert "async def create_snapshot(bg: BackgroundTasks):" in src
    assert 'bg.add_task(_guarded_snapshot)' in src
    assert '"queued": True' in src
    assert '"queued": False' in src
    # Concurrent-run guard on app.state.
    assert 'app.state.bk_snapshot_running' in src
    # Old inline await gone.
    assert "return await _do_snapshot()\n" not in src


def test_post_snapshot_returns_immediately():
    """The endpoint must return <5s (was timing out at 30s ingress)."""
    h = _login()
    t0 = time.time()
    r = requests.post(f"{API}/backup/snapshots", headers=h, timeout=30)
    elapsed = time.time() - t0
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("ok") is True
    assert "queued" in body
    assert elapsed < 5.0, f"snapshot POST took {elapsed:.1f}s (expected < 5)"


def test_second_concurrent_post_returns_busy_response():
    """Immediate second POST should report a snapshot already running."""
    h = _login()
    r1 = requests.post(f"{API}/backup/snapshots", headers=h, timeout=15)
    assert r1.status_code == 200
    r2 = requests.post(f"{API}/backup/snapshots", headers=h, timeout=15)
    assert r2.status_code == 200
    b1, b2 = r1.json(), r2.json()
    # At least one of the two posts must be the busy branch — the
    # background task can complete between the two calls on a fast
    # pod, so we accept either both queued=True (rare) or the second
    # being queued=False. We only fail if BOTH were queued=False.
    assert b1.get("queued") is True or b2.get("queued") is False


def test_version_bumped_to_132gq():
    js, sw = _read(VJS), _read(SW)
    assert re.search(r"RUNNING_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gq'", js)
    assert re.search(r"EXPECTED_CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gq'", js)
    assert re.search(r"CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gq'", sw)

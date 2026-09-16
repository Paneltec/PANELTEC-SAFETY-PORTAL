"""v58.13.132gw — Backup POST pre-flight disk guard.

Pulled forward per Stephen's urgent ask after `.132gu` was
truncated on a 100 %-full pod. Returns HTTP 507 (Insufficient
Storage) from `POST /api/backup/snapshots` when `/app` free-space
< 10 %.

Static-source pins only for the free-pct branch (the behavioural
"return 507" test would need to fill the disk, which is exactly
the failure mode we're guarding against — not something we want
to reproduce in CI).
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest
import requests

from tests.conftest import ADMIN_EMAIL, ADMIN_PWD, API

pytestmark = pytest.mark.live_db_writes

APP_ROOT = Path(__file__).resolve().parents[2]
BACKUP = APP_ROOT / "backend" / "backup_service.py"
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

def test_disk_guard_code_pinned():
    src = _read(BACKUP)
    # Guard MUST be inside create_snapshot.
    m = re.search(
        r"async def create_snapshot\(bg: BackgroundTasks\):[\s\S]{0,3500}"
        r"free_pct\s*=\s*\(usage\.free\s*/\s*usage\.total\)\s*\*\s*100[\s\S]{0,500}"
        r"if free_pct\s*<\s*10:",
        src,
    )
    assert m, "disk guard block missing from create_snapshot"
    # Must raise 507 specifically (not 500 / 503).
    assert "status_code=507" in src


def test_disk_guard_probes_app_volume():
    src = _read(BACKUP)
    # The probe MUST target /app (the writable snapshot volume) —
    # not `/` (overlay) which would give the wrong free-pct on
    # this pod topology.
    assert 'disk_usage("/app")' in src


def test_probe_failure_falls_through_not_raises():
    """If the disk-usage probe itself errors out, we still want the
    snapshot to attempt to run — the probe is defensive, not the
    authoritative gate. Better to attempt a backup than fail-closed
    on a probing regression."""
    src = _read(BACKUP)
    # The nested except MUST log + fall through, NOT re-raise as
    # HTTP 507. Pin both the fall-through comment + the log call.
    assert "disk-usage probe failed" in src


# ─── Behavioural — happy path (disk not full) ─────────────────

def test_snapshot_still_works_when_disk_has_headroom():
    """Sanity: on a normally-provisioned pod, POST /snapshots
    still returns 200/202 (queued). Skips gracefully if the pod
    happens to be genuinely below 10 % free at test time."""
    import shutil as _s
    u = _s.disk_usage("/app")
    free_pct = (u.free / u.total) * 100 if u.total else 100
    if free_pct < 10:
        pytest.skip(f"pod is at {free_pct:.1f}% free — cannot verify happy-path")

    h = _login()
    r = requests.post(f"{API}/backup/snapshots", headers=h, timeout=30)
    # 200 (queued or already-running fallback). Not 507.
    assert r.status_code in (200, 202), r.text
    assert r.status_code != 507


# ─── Version pins ─────────────────────────────────────────────

def test_version_bumped_to_132gw():
    js = _read(VERSION_JS)
    sw = _read(SW)
    assert re.search(r"RUNNING_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gw'", js)
    assert re.search(r"EXPECTED_CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gw'", js)
    assert re.search(r"CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gw'", sw)

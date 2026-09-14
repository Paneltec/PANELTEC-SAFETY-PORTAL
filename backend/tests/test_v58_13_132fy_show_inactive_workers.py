"""v58.13.132fy — Show inactive workers + Restore endpoint.

Locks in:
  · Backend `GET /api/workers?include_inactive=true` (admin-only clamp)
    now returns soft-deleted / deactivated rows alongside active ones.
  · Backend `POST /api/workers/{worker_id}/restore` clears
    deleted_at / deactivated_at / soft_deleted, writes an
    `archive_audit` row (action="restore"), and is idempotent when
    the worker is already active.
  · Frontend Workers.jsx pins: `showInactive` state, restore()
    handler, "Show inactive" toggle in the toolbar, restore button
    per inactive row.
  · Version bump lockstep.
"""
from __future__ import annotations

import time
from pathlib import Path

import pytest
import requests

from tests.conftest import ADMIN_EMAIL, ADMIN_PWD, API

pytestmark = pytest.mark.live_db_writes

APP_ROOT = Path(__file__).resolve().parents[2]
WORKERS_PY = APP_ROOT / "backend" / "workers.py"
WORKERS_JSX = APP_ROOT / "frontend" / "src" / "pages" / "Workers.jsx"
VERSION_JS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def _login() -> dict:
    r = requests.post(
        f"{API}/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PWD},
        timeout=30,
    )
    if r.status_code == 429:
        pytest.skip("rate-limited")
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


# ─── Source pins ───────────────────────────────────────────────

def test_list_workers_accepts_include_inactive_param():
    src = _read(WORKERS_PY)
    assert "include_inactive: bool = False" in src, (
        "list_workers must accept `include_inactive: bool = False` "
        "so the Show-inactive toggle can add ?include_inactive=true")
    # Admin-clamp: non-admin roles must NOT get archived rows even
    # if they hand-craft the query param.
    assert "include_inactive and admin_privileged" in src, (
        "include_inactive must be admin-privileged clamped")


def test_restore_endpoint_registered():
    src = _read(WORKERS_PY)
    assert '@router.post("/{worker_id}/restore")' in src
    assert "async def restore_worker(" in src
    # Admin-only: mirrors soft-delete permission but tightens further.
    assert 'user.get("role") != "admin"' in src
    # Clears all three tombstone flags + writes audit.
    for needle in (
        '"deleted_at": None',
        '"deactivated_at": None',
        '"soft_deleted": False',
        'db.archive_audit.insert_one',
        '"action": "restore"',
        '"module": "workers"',
    ):
        assert needle in src, f"restore_worker missing: {needle}"


def test_frontend_show_inactive_toggle_pins():
    src = _read(WORKERS_JSX)
    assert "const [showInactive, setShowInactive] = useState(false)" in src
    assert 'data-testid="show-inactive-toggle"' in src
    assert 'data-testid="show-inactive-checkbox"' in src
    # The list call must pipe include_inactive through.
    assert "include_inactive: true" in src
    # Restore handler + per-row button.
    assert "const restore = async (w) =>" in src
    assert "await api.post(`/workers/${w.id}/restore`)" in src
    assert "`restore-${w.id}`" in src
    # Refetch when the toggle flips.
    assert "useEffect(() => { load(); }, [showInactive])" in src


def test_frontend_inactive_row_dimming_and_badge():
    src = _read(WORKERS_JSX)
    # Row-level inactive marker + visual dim class combo.
    assert "data-inactive={isInactive ? 'true' : 'false'}" in src
    assert "'bg-slate-50/60 opacity-60" in src
    # "Archived" badge on inactive rows.
    assert "`worker-archived-${w.id}`" in src


# ─── Behavioural round-trip ────────────────────────────────────

def _find_soft_deletable_worker(h: dict) -> str | None:
    """Grab any active Simpro-sourced worker id we can soft-delete
    then restore, so the round-trip has real data to poke."""
    r = requests.get(f"{API}/workers", headers=h, timeout=30)
    if r.status_code != 200:
        return None
    rows = r.json() or []
    # Pick one that isn't already inactive.
    for row in rows:
        if row.get("active") and not row.get("deleted_at"):
            return row.get("id")
    return None


def test_include_inactive_behavioural():
    h = _login()
    wid = _find_soft_deletable_worker(h)
    if not wid:
        pytest.skip("no restorable worker in the live directory")

    # Baseline: worker appears in default list.
    r = requests.get(f"{API}/workers", headers=h, timeout=30)
    assert r.status_code == 200
    baseline_ids = {w["id"] for w in r.json()}
    assert wid in baseline_ids

    # Soft-delete it.
    r = requests.delete(f"{API}/workers/{wid}", headers=h, timeout=30)
    assert r.status_code in (200, 204), r.text

    # Default list no longer includes it.
    r = requests.get(f"{API}/workers", headers=h, timeout=30)
    assert r.status_code == 200
    assert wid not in {w["id"] for w in r.json()}

    # include_inactive=true DOES include it, and carries `deleted_at`.
    r = requests.get(
        f"{API}/workers", headers=h, timeout=30,
        params={"include_inactive": "true"},
    )
    assert r.status_code == 200
    match = next((w for w in r.json() if w["id"] == wid), None)
    assert match is not None, "include_inactive=true must surface soft-deleted rows"
    assert match.get("deleted_at"), "surfaced tombstone must carry deleted_at"

    # Restore it.
    r = requests.post(f"{API}/workers/{wid}/restore", headers=h, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("already_active") is False
    assert body.get("worker_id") == wid

    # Default list contains it again.
    r = requests.get(f"{API}/workers", headers=h, timeout=30)
    assert r.status_code == 200
    assert wid in {w["id"] for w in r.json()}, "restored worker must return to default list"

    # Idempotent second call.
    r = requests.post(f"{API}/workers/{wid}/restore", headers=h, timeout=30)
    assert r.status_code == 200
    assert r.json().get("already_active") is True


def test_restore_404_on_unknown_worker():
    h = _login()
    r = requests.post(
        f"{API}/workers/no-such-worker-{int(time.time())}/restore",
        headers=h, timeout=30,
    )
    assert r.status_code == 404, r.text


# ─── Version lockstep ──────────────────────────────────────────

def test_version_bumped_to_132fy():
    assert "paneltec-v160.3.9.58.13.132fy" in _read(VERSION_JS)
    assert "paneltec-v160.3.9.58.13.132fy" in _read(SW)

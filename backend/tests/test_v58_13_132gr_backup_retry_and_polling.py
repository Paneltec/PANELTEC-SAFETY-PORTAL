"""v58.13.132gr — Backup queued-placeholder + retry + sha256 guard."""
from __future__ import annotations
import re
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[2]
BK = APP_ROOT / "backend" / "backup_service.py"
BT = APP_ROOT / "frontend" / "src" / "pages" / "settings" / "BackupTab.jsx"
VJS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


def _read(p): return p.read_text(encoding="utf-8")


def test_backend_inserts_queued_placeholder_and_returns_id():
    src = _read(BK)
    assert '"status": "queued"' in src
    assert '"queued_id": placeholder_id' in src
    assert '"queued_at": now' in src
    assert "existing_queued_id" in src


def test_guarded_snapshot_retries_transient_errors_and_flips_status():
    src = _read(BK)
    assert "for attempt in range(3):" in src
    assert "await _asyncio.sleep(5)" in src
    assert 'db.bk_snapshots.delete_one({"id": placeholder_id})' in src
    assert '"status": "failed"' in src
    assert '"error": str(last_err)[:500]' in src


def test_download_endpoint_guards_legacy_sha256_field():
    src = _read(BK)
    assert 'snap.get("sha256") or ""' in src
    assert 'snap.get("size") or 0' in src
    assert 'snap["sha256"]' not in src


def test_frontend_polls_queued_id_until_placeholder_disappears():
    src = _read(BT)
    assert "watchId" in src
    assert "queued_id" in src and "existing_queued_id" in src
    assert "3 * 60 * 1000" in src
    assert "setTimeout(res, 5000)" in src
    assert 'watched.status === "failed"' in src


def test_version_bumped_to_132gr():
    js, sw = _read(VJS), _read(SW)
    assert re.search(r"RUNNING_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gr'", js)
    assert re.search(r"EXPECTED_CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gr'", js)
    assert re.search(r"CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gr'", sw)

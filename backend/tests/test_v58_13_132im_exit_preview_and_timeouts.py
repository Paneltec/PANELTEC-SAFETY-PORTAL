"""v58.13.132im — Exit-preview chip + backend timeout hardening on
sibling mobile endpoints.

Verifies:
  · `records/mine` and `daily-jobs/today` both wrap their Mongo work
    in `asyncio.wait_for(..., timeout=6.0)` and return a graceful
    degraded shape on timeout (empty groups / no_job) with a warning
    log — never let a slow query hang the mobile Home tab.
  · MobileModulesSection.jsx renders an Exit-preview chip that clears
    `paneltec_preview_user` + `paneltec_preview_jwt` sessionStorage
    keys and re-points the iframe at a token-less URL. Muted copy
    above the bezel explains preview mode.
  · Version pin lockstep.
  · Behavioural: monkey-patch the underlying Mongo helpers to hang and
    prove `records/mine` still returns within the 6 s ceiling.
"""
from __future__ import annotations

from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend"
BACKEND = ROOT / "backend"


def _r(p: Path) -> str:
    return p.read_text(encoding="utf-8")


# ── Backend source pins ─────────────────────────────────────────────

def test_records_mine_has_wait_for_wrap():
    src = _r(BACKEND / "mobile_data.py")
    # Load helper wrapped in wait_for.
    assert "async def _load():" in src
    assert 'await asyncio.wait_for(_load(), timeout=6.0)' in src
    # Timeout branch: warning log + empty groups + degraded flag.
    assert "except asyncio.TimeoutError:" in src
    assert 'log.warning("records/mine hit 6s wait_for' in src
    assert 'return {"groups": [], "degraded": True}' in src


def test_daily_jobs_today_has_wait_for_wrap():
    src = _r(BACKEND / "mobile_daily_jobs.py")
    assert "import asyncio" in src
    assert "import logging" in src
    assert 'log = logging.getLogger("paneltec.mobile.daily_jobs")' in src
    assert "async def _load()" in src
    assert 'await asyncio.wait_for(_load(), timeout=6.0)' in src
    assert "except asyncio.TimeoutError:" in src
    assert 'daily-jobs/today hit 6s wait_for' in src
    assert 'return {"assignment": None, "status": "no_job", "degraded": True}' in src


# ── Frontend source pins ────────────────────────────────────────────

def test_mobile_modules_section_has_exit_preview_chip():
    src = _r(FRONTEND / "src" / "components" / "settings" / "MobileModulesSection.jsx")
    # onExitPreview handler defined + clears both preview sessionStorage keys.
    assert "const onExitPreview" in src
    assert "sessionStorage.removeItem('paneltec_preview_user')" in src
    assert "sessionStorage.removeItem('paneltec_preview_jwt')" in src
    # Chip renders with a distinct testid and calls onExitPreview.
    assert 'data-testid="mobile-preview-exit"' in src
    assert "onClick={onExitPreview}" in src
    # Muted copy immediately above the bezel.
    assert 'data-testid="mobile-preview-help"' in src
    assert "Read-only preview." in src
    assert "Tab navigation works" in src


# ── Version lockstep ────────────────────────────────────────────────

def test_version_pin_v132im():
    import re as _re
    v = _r(FRONTEND / "src" / "lib" / "version.js")
    sw = _r(FRONTEND / "public" / "service-worker.js")
    pat = r"paneltec-v160\.3\.9\.58\.13\.132[i-z][m-z]?"
    assert _re.search(rf"RUNNING_VERSION = '{pat}'", v)
    assert _re.search(rf"EXPECTED_CACHE_VERSION = '{pat}'", v)
    assert _re.search(rf"CACHE_VERSION = '{pat}'", sw)


# ── Behavioural — records/mine returns fast even when Mongo hangs ──

@pytest.mark.asyncio
async def test_records_mine_falls_back_when_mongo_hangs(monkeypatch):
    """Monkey-patch db.form_templates.find to return a cursor whose
    __aiter__ sleeps for 30 s. Call records_mine directly. The wrap
    must kick in by 6 s and return the empty-groups degraded shape."""
    import asyncio as _asyncio
    import mobile_data

    class _HangingCursor:
        def __aiter__(self):
            return self

        async def __anext__(self):
            await _asyncio.sleep(30.0)
            raise StopAsyncIteration

    class _FakeColl:
        def find(self, *_args, **_kwargs):
            return _HangingCursor()

    monkeypatch.setattr(mobile_data.db, "form_templates", _FakeColl())
    monkeypatch.setattr(mobile_data.db, "form_submissions", _FakeColl())

    fake_user = {"id": "u", "org_id": "o", "role": "worker"}
    start = _asyncio.get_event_loop().time()
    resp = await _asyncio.wait_for(
        mobile_data.records_mine(user=fake_user),   # type: ignore[arg-type]
        timeout=9.0,
    )
    elapsed = _asyncio.get_event_loop().time() - start
    assert elapsed < 8.0, f"records_mine took {elapsed:.1f}s — wait_for not applied"
    assert resp == {"groups": [], "degraded": True}


@pytest.mark.asyncio
async def test_daily_jobs_today_falls_back_when_mongo_hangs(monkeypatch):
    """Same principle as records/mine but for daily-jobs/today."""
    import asyncio as _asyncio
    import mobile_daily_jobs

    async def _hang(*_args, **_kwargs):
        await _asyncio.sleep(30.0)
        return None

    class _FakeColl:
        async def find_one(self, *_args, **_kwargs):
            return await _hang()

    monkeypatch.setattr(mobile_daily_jobs.db, "daily_job_assignments", _FakeColl())
    monkeypatch.setattr(mobile_daily_jobs.db, "workers", _FakeColl())

    fake_user = {"id": "u", "org_id": "o", "email": "t@t.local"}
    start = _asyncio.get_event_loop().time()
    resp = await _asyncio.wait_for(
        mobile_daily_jobs.get_today_daily_job(user=fake_user),   # type: ignore[arg-type]
        timeout=9.0,
    )
    elapsed = _asyncio.get_event_loop().time() - start
    assert elapsed < 8.0, f"daily-jobs/today took {elapsed:.1f}s — wait_for not applied"
    assert resp == {"assignment": None, "status": "no_job", "degraded": True}

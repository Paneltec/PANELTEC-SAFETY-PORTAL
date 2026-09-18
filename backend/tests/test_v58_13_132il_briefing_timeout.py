"""v58.13.132il — Deployment cache-bust + Intelligence Briefing timeout.

Two fixes in one ship:

  1. Mobile `/api/mobile/ai/briefing` was hanging when Claude was
     slow/unresponsive because there was no timeout on the
     `_claude_json` call. The mobile home screen showed an infinite
     spinner. Wrap in `asyncio.wait_for(..., timeout=8.0)` so the
     endpoint always falls back to the hand-crafted string within
     ~8 s.

  2. Web `/api/ask/briefing` (dashboard Intelligence Briefing card)
     had the same lurking risk. Wrap in
     `asyncio.wait_for(..., timeout=10.0)`; on timeout, fall through
     to the same "temporarily unavailable" copy that HTTPException
     already triggers.

  3. Version bump to `.132il` so the CacheBusterBanner naturally
     re-fires for users still stuck on `.132ie` or earlier — each new
     ship gets its own version-scoped dismiss key, so bumping is the
     right lever to force a cache refresh without new UX.
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

def test_mobile_briefing_has_wait_for_timeout():
    src = _r(BACKEND / "mobile_data.py")
    # asyncio + logging imports present.
    assert "import asyncio" in src
    assert "import logging" in src
    assert 'log = logging.getLogger("paneltec.mobile.data")' in src
    # Timeout wrap applied to the LLM upgrade call.
    assert "await asyncio.wait_for(" in src
    assert "timeout=8.0" in src
    # asyncio.TimeoutError branch present with a warning log.
    assert "except asyncio.TimeoutError:" in src
    assert "LLM upgrade timed out" in src


def test_web_briefing_has_wait_for_timeout():
    src = _r(BACKEND / "ask.py")
    assert "import asyncio" in src
    assert "await asyncio.wait_for(" in src
    assert "timeout=10.0" in src
    # Same fallback path handles both HTTPException and TimeoutError.
    assert "except (HTTPException, asyncio.TimeoutError):" in src
    # Fallback still emits the copy the FE renders.
    assert "Briefing temporarily unavailable" in src


# ── Version lockstep ────────────────────────────────────────────────

def test_version_pin_v132il():
    import re as _re
    v = _r(FRONTEND / "src" / "lib" / "version.js")
    sw = _r(FRONTEND / "public" / "service-worker.js")
    pat = r"paneltec-v160\.3\.9\.58\.13\.132[i-z][l-z]?"
    assert _re.search(rf"RUNNING_VERSION = '{pat}'", v)
    assert _re.search(rf"EXPECTED_CACHE_VERSION = '{pat}'", v)
    assert _re.search(rf"CACHE_VERSION = '{pat}'", sw)


# ── Behavioural — briefing endpoint returns fast even when LLM hangs
# We monkey-patch `_claude_json` to sleep forever; the endpoint must
# still return within the timeout budget.

@pytest.mark.asyncio
async def test_mobile_briefing_falls_back_when_llm_hangs(monkeypatch):
    """Simulate a hung Claude call — endpoint must timeout out to the
    hand-crafted fallback within ~8s, not hang the caller."""
    import asyncio as _asyncio
    import mobile_data

    async def _slow(system, user_text):
        await _asyncio.sleep(30.0)
        return {"briefing": "should never reach here"}

    # Force the LLM branch to run + swap in the slow function.
    monkeypatch.setenv("EMERGENT_LLM_KEY", "test-key-forces-branch")
    import ai
    monkeypatch.setattr(ai, "_claude_json", _slow)
    # Clear cache so we hit the LLM branch.
    mobile_data._BRIEFING_CACHE.clear()

    fake_user = {
        "id": "test-user-v132il", "org_id": "test-org-v132il",
        "name": "Test User", "role": "worker",
    }

    async def _fake_count(query):
        return 0

    class _FakeColl:
        async def count_documents(self, q):
            return await _fake_count(q)
    monkeypatch.setattr(mobile_data.db, "form_submissions", _FakeColl())

    # Race the endpoint against a 12 s ceiling — if it doesn't return
    # in time, the fix hasn't shipped.
    start = _asyncio.get_event_loop().time()
    resp = await _asyncio.wait_for(
        mobile_data.ai_briefing(user=fake_user),   # type: ignore[arg-type]
        timeout=12.0,
    )
    elapsed = _asyncio.get_event_loop().time() - start
    assert elapsed < 11.0, f"endpoint took {elapsed:.1f}s — timeout not applied"
    assert resp["briefing"], "fallback briefing must be non-empty"
    # Not the LLM's reply — the hand-crafted string.
    assert "should never reach here" not in resp["briefing"]
    assert resp["severity"] in ("info", "warn")

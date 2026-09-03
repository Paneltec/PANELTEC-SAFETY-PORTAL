"""v58.13.93 — Blocked-outbox count badge on the Safe Mode pill.

Backend source-scan + live status probe + frontend source-scan +
version pins.
"""
from __future__ import annotations
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
MOBILE = ROOT / "mobile"

sys.path.insert(0, str(BACKEND))

COMMS_PY = (BACKEND / "comms_safe_mode.py").read_text(encoding="utf-8")
APPSHELL_JSX = (FRONTEND / "src" / "components" / "layout" / "AppShell.jsx").read_text(encoding="utf-8")
SAFE_MODE_JSX = (FRONTEND / "src" / "pages" / "CommsSafeMode.jsx").read_text(encoding="utf-8")
VERSION_JS = (FRONTEND / "src" / "lib" / "version.js").read_text(encoding="utf-8")
SW_JS = (FRONTEND / "public" / "service-worker.js").read_text(encoding="utf-8")
MOBILE_TS = (MOBILE / "src" / "lib" / "version.ts").read_text(encoding="utf-8")


# ── Backend schema + endpoint ──

def test_status_model_has_blocked_count_field():
    """SafeModeStatus Pydantic model gains `blocked_count: int = 0`."""
    m = re.search(
        r"class SafeModeStatus\(BaseModel\):[\s\S]+?blocked_count:\s*int\s*=\s*0",
        COMMS_PY,
    )
    assert m, "SafeModeStatus does not declare `blocked_count: int = 0`"


def test_status_endpoint_counts_scoped_by_org():
    """`get_safe_mode_status` MUST org-scope the count query, otherwise
    an admin in org A sees the blocked count from every other org
    (multi-tenant leak). Also verifies the endpoint handles a probe
    failure gracefully so a missing collection doesn't 500 the top
    bar."""
    m = re.search(
        r"async def get_safe_mode_status\([\s\S]+?"
        r"db\.comms_outbox_blocked\.count_documents\(\s*"
        r"\{\s*\"org_id\":\s*user\[\"org_id\"\]\s*\}\s*\)",
        COMMS_PY,
    )
    assert m, "blocked_count query is not scoped by `org_id`"
    # try/except so a collection-missing failure returns 0, not 500.
    assert re.search(
        r"try:\s*\n\s*blocked = await db\.comms_outbox_blocked\.count_documents"
        r"[\s\S]+?except Exception[\s\S]+?blocked = 0",
        COMMS_PY,
    ), "count_documents is not wrapped in a try/except → 0 fallback"


@pytest.mark.asyncio
async def test_live_status_endpoint_returns_blocked_count():
    """Fire the endpoint against the running preview backend."""
    import httpx
    async with httpx.AsyncClient(base_url="http://localhost:8001") as c:
        # Log in first (Stephen — active admin).
        r = await c.post("/api/auth/login", json={
            "email": "stephen@paneltec.com.au",
            "password": "Mcgstephen50#",
        })
        if r.status_code == 429:
            pytest.skip("login rate-limited by the .88 slowapi bucket — retry after 60s")
        assert r.status_code == 200, r.text
        token = r.json()["access_token"]
        r = await c.get(
            "/api/admin/comms-safe-mode/status",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 200
        body = r.json()
        assert "blocked_count" in body
        assert isinstance(body["blocked_count"], int)
        assert body["blocked_count"] >= 0


# ── Frontend pill ──

def test_pill_reads_blocked_count_from_status():
    """AppShell IIFE reads `safeMode.blocked_count`, coerces to
    number, and gates the badge on `isOn && n > 0`."""
    assert "safeMode.blocked_count" in APPSHELL_JSX
    assert re.search(r"const n\s*=\s*Number\(safeMode\.blocked_count\s*\|\|\s*0\)", APPSHELL_JSX)
    assert "const showBadge = isOn && n > 0" in APPSHELL_JSX


def test_pill_badge_dom_contract():
    """Badge testid + numeric class + `data-blocked-count` attribute."""
    assert 'data-testid="comms-safe-mode-chip-count"' in APPSHELL_JSX
    # `data-blocked-count={String(n)}` on the outer Link.
    assert 'data-blocked-count={String(n)}' in APPSHELL_JSX
    # Badge visual: amber-500 background + white text tabular-nums.
    m = re.search(
        r'data-testid="comms-safe-mode-chip-count"[\s\S]{0,400}?bg-amber-500[\s\S]{0,400}?text-white',
        APPSHELL_JSX,
    )
    assert m, "badge visual class hints (bg-amber-500 + text-white) not found"
    # Nested only when `showBadge` is true.
    assert re.search(r"\{showBadge\s*&&\s*\(\s*<span", APPSHELL_JSX)


def test_pill_tooltip_switches_to_count_variant_when_n_gt_0():
    """When ON and count > 0, the tooltip must include the count and
    the pluralised copy. Verbatim substring checks so wording drift
    fails CI."""
    # Non-env-locked ON+N>0
    assert "outbound comm${n === 1 ? '' : 's'} blocked" in APPSHELL_JSX
    # Env-locked ON+N>0 variant
    assert "Comms Safe Mode is ON (env-locked) — ${n} outbound comm" in APPSHELL_JSX
    # OFF unchanged
    assert "Comms Safe Mode is OFF — comms live. Click to manage." in APPSHELL_JSX
    # ON+N=0 unchanged
    assert "Comms Safe Mode is ON — outbound comms blocked. Click to manage." in APPSHELL_JSX


def test_off_branch_never_renders_badge():
    """Even a paranoid future edit must NOT render the badge when
    Safe Mode is OFF. Verifying the guard is the compound `isOn &&
    n > 0` — not just `n > 0`."""
    # No `showBadge = n > 0` (missing the isOn factor)
    assert re.search(r"const showBadge\s*=\s*n\s*>\s*0(?!\s*&&)", APPSHELL_JSX) is None


# ── Admin page dispatches the event on clear ──

def test_clear_blocked_dispatches_change_event():
    """When user clicks "Clear" on the blocked-outbox row, the pill
    count must drop instantly via the .92 event bus — reuse, not a
    new channel."""
    m = re.search(
        r'data-testid="blocked-clear-btn"[\s\S]+?'
        r"api\.delete\([\s\S]+?"
        r"window\.dispatchEvent\(\s*new CustomEvent\(\s*"
        r"'paneltec:comms-safe-mode-changed'",
        SAFE_MODE_JSX,
    )
    assert m, (
        "Clear button no longer dispatches `paneltec:comms-safe-mode-"
        "changed` after the DELETE — the pill's count badge will lag."
    )


# ── Version-sync forward-safe pin >= 93 ─────────────────────────

def _tail(text: str, name: str) -> int:
    m = re.search(rf"{name}\s*=\s*['\"]paneltec-v[\d.]+\.(\d+)['\"]", text)
    assert m, f"{name} not found"
    return int(m.group(1))


def test_running_version_gte_93():
    assert _tail(VERSION_JS, "RUNNING_VERSION") >= 93


def test_cache_version_gte_93():
    assert _tail(SW_JS, "CACHE_VERSION") >= 93


def test_mobile_bundle_version_gte_93():
    assert _tail(MOBILE_TS, "MOBILE_BUNDLE_VERSION") >= 93

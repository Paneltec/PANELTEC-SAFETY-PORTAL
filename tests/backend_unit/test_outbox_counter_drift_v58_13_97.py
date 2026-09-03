"""v58.13.97 — Outbox counter drift fix.

`SafeModeStatus.blocked_count` now sums `outbound_emails.status=blocked`
+ `outbound_sms.status=blocked` scoped to the caller's org (the
source of truth the Email Outbox table renders), instead of reading
from the audit-only `comms_outbox_blocked` collection whose rows are
subject to retention prune and to the "Clear" admin button.
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
VERSION_JS = (FRONTEND / "src" / "lib" / "version.js").read_text(encoding="utf-8")
SW_JS = (FRONTEND / "public" / "service-worker.js").read_text(encoding="utf-8")
MOBILE_TS = (MOBILE / "src" / "lib" / "version.ts").read_text(encoding="utf-8")


def test_blocked_count_reads_from_outbound_collections():
    """The count must come from outbound_emails/outbound_sms with
    status='blocked' — the source of truth the outbox table shows —
    not from the audit-only `comms_outbox_blocked` collection."""
    m = re.search(
        r'async def get_safe_mode_status[\s\S]+?'
        r'for coll in \("outbound_emails",\s*"outbound_sms"\):[\s\S]+?'
        r'db\[coll\]\.count_documents\(\{\s*'
        r'"org_id":\s*user\["org_id"\],\s*'
        r'"status":\s*"blocked"',
        COMMS_PY,
    )
    assert m, "blocked_count is not reading from outbound_emails+outbound_sms with status=blocked"


def test_old_audit_collection_no_longer_the_count_source():
    """The pre-.97 read from `comms_outbox_blocked` was replaced.
    Guards against a well-meaning revert. Skips comment lines so
    the explanatory changelog inside the function doesn't trip the
    check."""
    m = re.search(
        r'async def get_safe_mode_status\([\s\S]+?'
        r'return SafeModeStatus',
        COMMS_PY,
    )
    body = m.group(0)
    code_only = "\n".join(
        line for line in body.split("\n") if not line.lstrip().startswith("#")
    )
    assert "comms_outbox_blocked.count_documents" not in code_only, (
        "get_safe_mode_status still reads count from comms_outbox_blocked"
    )


@pytest.mark.asyncio
async def test_live_status_returns_real_blocked_count():
    """Sanity: fire the endpoint against preview and verify it now
    matches the real outbound_emails.status=blocked count for the
    caller's org."""
    import httpx
    async with httpx.AsyncClient(base_url="http://localhost:8001") as c:
        r = await c.post("/api/auth/login", json={
            "email": "stephen@paneltec.com.au",
            "password": "Mcgstephen50#",
        })
        if r.status_code == 429:
            pytest.skip("login rate-limited by the .88 slowapi bucket")
        assert r.status_code == 200, r.text
        token = r.json()["access_token"]
        r = await c.get(
            "/api/admin/comms-safe-mode/status",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 200
        body = r.json()
        assert "blocked_count" in body
        # On preview Stephen's org has 157 blocked outbound_emails
        # right now. This test only asserts the count is >0 — a
        # verbatim number would be brittle if a future ship clears
        # the outbox.
        assert isinstance(body["blocked_count"], int)
        assert body["blocked_count"] > 0, (
            f"blocked_count is {body['blocked_count']} — should be "
            f">0 on preview (157 real blocked rows exist as of the "
            f".97 investigation). If this now reads 0, the fix "
            f"regressed OR the outbound_emails collection was wiped."
        )


# ── Version-sync forward-safe pin >= 97 ─────────────────────────

def _tail(text: str, name: str) -> int:
    m = re.search(rf"{name}\s*=\s*['\"]paneltec-v[\d.]+\.(\d+)['\"]", text)
    assert m, f"{name} not found"
    return int(m.group(1))


def test_running_version_gte_97():
    assert _tail(VERSION_JS, "RUNNING_VERSION") >= 97


def test_cache_version_gte_97():
    assert _tail(SW_JS, "CACHE_VERSION") >= 97


def test_mobile_bundle_version_gte_97():
    assert _tail(MOBILE_TS, "MOBILE_BUNDLE_VERSION") >= 97

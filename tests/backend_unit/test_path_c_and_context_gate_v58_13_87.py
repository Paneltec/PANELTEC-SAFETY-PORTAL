"""v58.13.87 — Path C fix + belt-and-braces contextvar gate.

1. m365_test flush loop deleted (Path C).
2. queued outbound_emails purged (verified in ship; test asserts steady-state 0).
3. Falsely-labelled sent rows corrected (data-only, tested via DB probe).
4. retry_outbox routes through graph_send_mail — no more optimistic status=sent lie.
5. Contextvar gate: `send_context.py` refuses sends outside HTTP request context.
6. Grep guards: no queued-drain loops exist outside `email_outbox.py`.
"""
from __future__ import annotations

import asyncio
import re
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
MOBILE = ROOT / "mobile"

M365_PY = (BACKEND / "integrations_m365.py").read_text(encoding="utf-8")
TM_PY = (BACKEND / "integrations_textmagic.py").read_text(encoding="utf-8")
EMAIL_OUTBOX_PY = (BACKEND / "email_outbox.py").read_text(encoding="utf-8")
AUTH_PY = (BACKEND / "auth.py").read_text(encoding="utf-8")
SEND_CTX_PY = (BACKEND / "send_context.py").read_text(encoding="utf-8")

VERSION_JS = (FRONTEND / "src" / "lib" / "version.js").read_text(encoding="utf-8")
SW_JS = (FRONTEND / "public" / "service-worker.js").read_text(encoding="utf-8")
MOBILE_TS = (MOBILE / "src" / "lib" / "version.ts").read_text(encoding="utf-8")


# ── Item 1 — Path C (m365_test flush loop) deleted ───────────

def test_m365_test_no_longer_flushes_queue():
    # The old flush loop lived between the config `status=connected`
    # update and the final `return {"ok": True, "sent_to": ...}`. It
    # is now a comment-only block and should NOT contain the
    # `graph_send_mail(user["org_id"], to=em.get(...` pattern.
    m = re.search(r"m365_test[\s\S]+?flushed_from_queue", M365_PY)
    assert m, "m365_test / flushed_from_queue marker missing"
    body = m.group(0)
    assert 'em.get("to"' not in body, "flush loop resurrection detected"
    assert 'to_list(200)' not in body, "queued fetch resurrection detected"
    assert "Path C DELETED" in body, "intent comment must remain"


def test_no_queued_drain_loops_outside_email_outbox():
    # Grep the whole backend for any `find({"status": "queued"})`
    # pattern touching outbound_emails. Only allowed inside
    # `email_outbox.py` (the retry / cancel / delete admin routes).
    import glob
    for py in glob.glob(str(BACKEND / "*.py")):
        if py.endswith("email_outbox.py"):
            continue
        text = Path(py).read_text(encoding="utf-8")
        # Match any pattern that fetches queued outbound_emails and
        # is followed by a loop.
        assert not re.search(
            r'outbound_emails\.find\([^)]*status["\']?\s*[:=]\s*["\']queued',
            text,
        ), f"{py} contains a queued-drain loop — Path C resurrection risk"


# ── Item 4 — retry_outbox no longer lies about status ───────────

def test_retry_outbox_calls_graph_send_mail():
    m = re.search(r"async def retry_outbox\([\s\S]+?(?=\n\n@router|\nasync def cancel_outbox)", EMAIL_OUTBOX_PY)
    assert m, "retry_outbox body not found"
    body = m.group(0)
    assert "from integrations_m365 import graph_send_mail" in body
    assert "await graph_send_mail(" in body


def test_retry_outbox_handles_blocked_response():
    m = re.search(r"async def retry_outbox\([\s\S]+?(?=\n\n@router|\nasync def cancel_outbox)", EMAIL_OUTBOX_PY)
    body = m.group(0)
    assert 'if res.get("blocked"):' in body
    assert '"status": "blocked"' in body


def test_retry_outbox_no_optimistic_sent_write():
    m = re.search(r"async def retry_outbox\([\s\S]+?(?=\n\n@router|\nasync def cancel_outbox)", EMAIL_OUTBOX_PY)
    body = m.group(0)
    graph_idx = body.find("await graph_send_mail")
    sent_idx = body.find('"status": "sent"')
    assert graph_idx != -1
    assert sent_idx != -1
    assert graph_idx < sent_idx, (
        "status=sent must only be written after graph_send_mail actually returns ok"
    )


# ── Item 5 — Contextvar gate ────────────────────────────────────

def test_send_context_module_exists():
    assert (BACKEND / "send_context.py").exists()
    for symbol in ("set_send_context", "has_request_context",
                   "refuse_if_no_request_context"):
        assert f"def {symbol}(" in SEND_CTX_PY


def test_auth_populates_send_context():
    assert "from send_context import set_send_context" in AUTH_PY
    assert "set_send_context(user)" in AUTH_PY


def test_graph_send_mail_gated_by_send_context():
    m = re.search(
        r"async def graph_send_mail\([\s\S]+?is_blocked, record_blocked",
        M365_PY,
    )
    body = m.group(0)
    assert "refuse_if_no_request_context" in body
    # The refusal call must come BEFORE the Safe Mode import — so
    # nothing (not even Safe Mode) is consulted without a request
    # context.
    refusal_idx = body.find("refuse_if_no_request_context")
    safe_mode_idx = body.find("from comms_safe_mode import")
    assert refusal_idx < safe_mode_idx, "refusal check must run before Safe Mode"


def test_safe_send_sms_gated_by_send_context():
    m = re.search(
        r"async def safe_send_sms\([\s\S]+?from comms_safe_mode import",
        TM_PY,
    )
    body = m.group(0)
    assert "refuse_if_no_request_context" in body
    refusal_idx = body.find("refuse_if_no_request_context")
    env_gate_idx = body.find('_os.environ.get("IS_PROD"')
    assert refusal_idx < env_gate_idx, "refusal check must run before env gate"


# ── Runtime behaviour — refusal path ─────────────────────────────

@pytest.mark.asyncio
async def test_graph_send_mail_refuses_without_request_context(caplog):
    """Simulate a background task with no HTTP request on the stack —
    the send must be refused and a CRITICAL log line must be emitted."""
    import sys
    sys.path.insert(0, str(BACKEND))
    from send_context import set_send_context
    # Ensure no context is set in THIS task.
    set_send_context(None)

    async def run_from_background():
        # In a NEW task there's no ambient user context (unless
        # explicitly copied), so this simulates a startup / worker /
        # cron caller.
        set_send_context(None)  # explicit belt-and-braces
        from integrations_m365 import graph_send_mail
        with caplog.at_level("CRITICAL", logger="paneltec.send_context"):
            return await graph_send_mail(
                "test-org-id",
                to=["victim@example.com"], cc=[], subject="test",
                body_html="<p>should never send</p>", attachments=[],
            )

    task = asyncio.create_task(run_from_background())
    res = await task
    assert res == {
        "ok": False, "blocked": True,
        "error": "no_request_context",
        "provider": "microsoft365_graph_send_mail",
    }
    # CRITICAL log line was written.
    assert any(
        "SEND REFUSED" in rec.message and "no request context" in rec.message
        for rec in caplog.records
    ), f"expected CRITICAL log line, got {[r.message for r in caplog.records]}"


@pytest.mark.asyncio
async def test_safe_send_sms_refuses_without_request_context(caplog):
    import sys
    sys.path.insert(0, str(BACKEND))
    from send_context import set_send_context
    set_send_context(None)

    async def run_from_background():
        set_send_context(None)
        from integrations_textmagic import safe_send_sms
        with caplog.at_level("CRITICAL", logger="paneltec.send_context"):
            return await safe_send_sms(
                "test-org-id",
                mobiles=["+61400000000"], text="should never send",
                triggered_by_endpoint="pytest_background",
            )

    task = asyncio.create_task(run_from_background())
    res = await task
    assert res["blocked"] is True
    assert res["error"] == "no_request_context"


@pytest.mark.asyncio
async def test_graph_send_mail_proceeds_when_request_context_present():
    """Simulate a live HTTP request — the send must proceed past the
    contextvar gate. Mock Graph so we don't actually hit the network."""
    import sys
    sys.path.insert(0, str(BACKEND))
    from send_context import set_send_context

    # Set the contextvar as if get_current_user just populated it.
    set_send_context({"id": "test-user", "org_id": "test-org", "role": "admin"})
    # Mock is_blocked → False so we don't stop on Safe Mode.
    async def _mock_is_blocked(*_a, **_kw):
        return False

    with patch("comms_safe_mode.is_blocked", new=AsyncMock(side_effect=_mock_is_blocked)):
        # And mock the network call so we don't actually reach Graph.
        with patch("integrations_m365.get_app_only_access_token",
                   new=AsyncMock(return_value="fake-token")):
            with patch("integrations_m365._cfg",
                       new=AsyncMock(return_value={"sender_email": "test@paneltec.com.au"})):
                with patch("httpx.AsyncClient") as MockClient:
                    inst = MockClient.return_value.__aenter__.return_value
                    inst.post = AsyncMock(return_value=type("R", (), {
                        "status_code": 202, "text": "",
                    })())
                    from integrations_m365 import graph_send_mail
                    res = await graph_send_mail(
                        "test-org",
                        to=["ok@example.com"], cc=[], subject="ctx-set",
                        body_html="<p>ok</p>", attachments=[],
                    )
    assert res.get("ok") is True
    assert res.get("blocked") is not True


# ── Version-sync forward-safe pin >= 87 ─────────────────────────

def _tail(text: str, name: str) -> int:
    m = re.search(rf"{name}\s*=\s*['\"]paneltec-v[\d.]+\.(\d+)[a-z]*['\"]", text)
    assert m, f"{name} not found"
    return int(m.group(1))


def test_running_version_gte_87():
    assert _tail(VERSION_JS, "RUNNING_VERSION") >= 87


def test_cache_version_gte_87():
    assert _tail(SW_JS, "CACHE_VERSION") >= 87


def test_mobile_bundle_version_gte_87():
    assert _tail(MOBILE_TS, "MOBILE_BUNDLE_VERSION") >= 87

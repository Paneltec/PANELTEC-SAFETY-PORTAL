"""v58.13.108 — Regression-lock guard for the v58.13.88 fix that pointed
`auth_invite._send_invite_sms` at `integrations_textmagic.safe_send_sms`
after the historical `integrations.send_sms` rename left it silently
returning False.

Guards enforced:
  · Source pin: `auth_invite.py` imports `safe_send_sms` from
    `integrations_textmagic` (NOT from `integrations`) inside
    `_send_invite_sms`. Any regression to `from integrations import
    send_sms` fails the pin.
  · No stray reference to the historical broken import anywhere in
    the codebase (except the inline comment noting the rename).
  · Import-resolves smoke test: `from integrations_textmagic import
    safe_send_sms` succeeds at test time.
  · Mock-based behavioural test: `_send_invite_sms` calls
    `safe_send_sms` with the caller's org_id, mobile list, an invite
    body containing the link + kind prefix, and a
    `triggered_by_endpoint` string that ties audit rows back to
    `auth_invite`. Skips outright when phone is missing.
  · Version-sync forward-safe pins ≥ .108 across the three canonical
    version strings.

Pattern mirrors .100 / .103 / .105 / .106 / .106a / .107 source-pin
tests.
"""
from __future__ import annotations
import asyncio
import importlib
import re
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"

AUTH_INVITE_PY = (BACKEND / "auth_invite.py").read_text(encoding="utf-8")
VERSION_JS = (FRONTEND / "src" / "lib" / "version.js").read_text(encoding="utf-8")
SW_JS = (FRONTEND / "public" / "service-worker.js").read_text(encoding="utf-8")
MOBILE_VERSION_TS = (ROOT / "mobile" / "src" / "lib" / "version.ts").read_text(encoding="utf-8")


# ── Source pins ──────────────────────────────────────────────────

def test_send_invite_sms_imports_safe_send_sms_from_textmagic_module():
    """`auth_invite._send_invite_sms` must import `safe_send_sms` from
    `integrations_textmagic`. The historical bug was a stray
    `from integrations import send_sms` — a module path that doesn't
    exist — which made the function silently `return False`."""
    assert re.search(
        r"from\s+integrations_textmagic\s+import\s+safe_send_sms",
        AUTH_INVITE_PY,
    ), (
        "auth_invite.py must contain "
        "`from integrations_textmagic import safe_send_sms` — the .88 "
        "fix for the silent-False SMS invite regression."
    )


def test_no_stale_integrations_send_sms_import_anywhere():
    """Belt-and-braces sweep across the backend. Rejects any live import
    of the historical `integrations.send_sms` symbol. The only permitted
    occurrence is inside a comment that documents the historical rename."""
    for py in BACKEND.rglob("*.py"):
        src = py.read_text(encoding="utf-8")
        for lineno, line in enumerate(src.splitlines(), 1):
            stripped = line.lstrip()
            if stripped.startswith("#"):
                continue  # comments are documentation, not live imports
            # `from integrations import send_sms` OR
            # `integrations.send_sms(` OR
            # `import send_sms from integrations` are all fingerprints
            # of the historical broken import.
            if re.search(r"from\s+integrations\s+import\s+send_sms", line):
                raise AssertionError(
                    f"{py}:{lineno} — historical broken import restored: {line!r}"
                )
            if re.search(r"\bintegrations\.send_sms\b", line):
                raise AssertionError(
                    f"{py}:{lineno} — historical broken symbol reference restored: {line!r}"
                )


# ── Import resolves at test time ─────────────────────────────────

def test_safe_send_sms_symbol_resolves():
    """The wrapper `_send_invite_sms` targets must be importable when
    the module loads. If the symbol goes away, this fails immediately
    instead of hiding behind `except Exception: return False`."""
    sys.path.insert(0, str(BACKEND))
    mod = importlib.import_module("integrations_textmagic")
    assert hasattr(mod, "safe_send_sms"), (
        "integrations_textmagic must export `safe_send_sms`"
    )
    assert callable(mod.safe_send_sms), "safe_send_sms must be callable"


# ── Behavioural pin (mock-based) ─────────────────────────────────

def _run(coro):
    return asyncio.get_event_loop_policy().new_event_loop().run_until_complete(coro) \
        if not asyncio.get_event_loop_policy().get_event_loop().is_running() else None


def test_send_invite_sms_forwards_expected_kwargs_to_safe_send_sms():
    """The wrapper must call `safe_send_sms` with:
        · positional org_id from the target user
        · mobiles=[user.phone or user.mobile]
        · text containing the link + the kind-appropriate prefix
        · triggered_by_endpoint stamping `auth_invite._send_invite_sms:{kind}`
        · actor_user_id=user.id (so safe_send_sms treats it as
          user-initiated comms — not a system source subject to the
          non-prod env-gate).
    """
    sys.path.insert(0, str(BACKEND))
    ai = importlib.import_module("auth_invite")

    fake_res = {"ok": True, "message_id": "msg-abc-123"}
    mock_send = AsyncMock(return_value=fake_res)

    user = {"id": "user-42", "org_id": "org-999",
            "phone": "+61400000000", "email": "invitee@example.com"}
    link = "https://preview.paneltec/set-password?token=xyz"
    kind = "invite"

    with patch("integrations_textmagic.safe_send_sms", mock_send):
        loop = asyncio.new_event_loop()
        try:
            ok = loop.run_until_complete(ai._send_invite_sms(user, link, kind))
        finally:
            loop.close()

    assert ok is True, f"expected True on {fake_res!r} but got {ok!r}"
    assert mock_send.await_count == 1, (
        f"safe_send_sms should be awaited exactly once; saw {mock_send.await_count}"
    )
    args, kwargs = mock_send.await_args
    # org_id passed positionally.
    assert args and args[0] == "org-999", f"expected org_id positional; got args={args!r}"
    # Recipient list.
    assert kwargs.get("mobiles") == ["+61400000000"], kwargs
    # Body: kind prefix + link.
    body = kwargs.get("text") or ""
    assert "Paneltec invite:" in body, f"expected invite prefix in body: {body!r}"
    assert link in body, f"expected link in body: {body!r}"
    # Endpoint tag ties audit rows back to auth_invite.
    tag = kwargs.get("triggered_by_endpoint") or ""
    assert tag == "auth_invite._send_invite_sms:invite", tag
    # Actor id — critical for the non-prod env-gate behaviour.
    assert kwargs.get("actor_user_id") == "user-42", kwargs


def test_send_invite_sms_uses_reset_prefix_for_password_reset_kind():
    """Password-reset SMS body must carry the reset-specific prefix so
    the recipient sees a matching subject line to the accompanying
    email — an audit-trail invariant."""
    sys.path.insert(0, str(BACKEND))
    ai = importlib.import_module("auth_invite")

    mock_send = AsyncMock(return_value={"ok": True})
    user = {"id": "u1", "org_id": "org-1", "mobile": "+61400111222"}
    link = "https://preview.paneltec/reset?token=abc"

    with patch("integrations_textmagic.safe_send_sms", mock_send):
        loop = asyncio.new_event_loop()
        try:
            loop.run_until_complete(ai._send_invite_sms(user, link, "reset"))
        finally:
            loop.close()

    body = mock_send.await_args.kwargs.get("text") or ""
    assert "Paneltec password reset:" in body, body
    tag = mock_send.await_args.kwargs.get("triggered_by_endpoint") or ""
    assert tag == "auth_invite._send_invite_sms:reset", tag


def test_send_invite_sms_returns_false_when_phone_missing():
    """No phone → skip the SMS entirely (no wrapper call). Caller reads
    the False to fall back to email-only invite."""
    sys.path.insert(0, str(BACKEND))
    ai = importlib.import_module("auth_invite")

    mock_send = AsyncMock(return_value={"ok": True})
    with patch("integrations_textmagic.safe_send_sms", mock_send):
        loop = asyncio.new_event_loop()
        try:
            ok = loop.run_until_complete(
                ai._send_invite_sms({"id": "u", "org_id": "o"}, "https://x", "invite")
            )
        finally:
            loop.close()

    assert ok is False
    assert mock_send.await_count == 0, (
        "safe_send_sms must NOT be called when the user has no phone/mobile"
    )


def test_send_invite_sms_treats_blocked_result_as_success_audit():
    """When Comms Safe Mode blocks the SMS, `safe_send_sms` returns
    `{ok:True, blocked:True}`. The wrapper must treat that as True
    (an audit row was written) so the outer send-invite endpoint
    doesn't spuriously report failure to the admin."""
    sys.path.insert(0, str(BACKEND))
    ai = importlib.import_module("auth_invite")

    mock_send = AsyncMock(return_value={"ok": True, "blocked": True, "provider": "safe_mode"})
    user = {"id": "u", "org_id": "o", "phone": "+61400333444"}

    with patch("integrations_textmagic.safe_send_sms", mock_send):
        loop = asyncio.new_event_loop()
        try:
            ok = loop.run_until_complete(ai._send_invite_sms(user, "https://x", "invite"))
        finally:
            loop.close()

    assert ok is True, "Safe-Mode `blocked:True` result must surface as True (audit-only)"


# ── ContextVar HTTP-gate compliance ──────────────────────────────

def test_safe_send_sms_refuses_when_no_request_context():
    """The auth_invite path must inherit the ContextVar HTTP gate. Any
    call to `safe_send_sms` outside a live HTTP request context (cron,
    startup, worker) returns a `refused` result WITHOUT reaching
    TextMagic. Pinned via `refuse_if_no_request_context` presence in
    the module — the .87 gate."""
    sys.path.insert(0, str(BACKEND))
    tm = importlib.import_module("integrations_textmagic")
    src = Path(tm.__file__).read_text(encoding="utf-8")
    assert "refuse_if_no_request_context" in src, (
        "integrations_textmagic.safe_send_sms must call "
        "`refuse_if_no_request_context` (v58.13.87 ContextVar gate)"
    )


# ── Version-sync forward-safe pins ───────────────────────────────

def _ge_108(version: str) -> bool:
    m = re.search(r"58\.13\.(\d+)([a-z]*)", version)
    if not m:
        return False
    return int(m.group(1)) >= 108


def test_running_version_ge_108():
    m = re.search(r"RUNNING_VERSION\s*=\s*'([^']+)'", VERSION_JS)
    assert m, "RUNNING_VERSION not found"
    assert _ge_108(m.group(1)), f"RUNNING_VERSION {m.group(1)!r} must be >= .108"


def test_mobile_bundle_version_ge_108():
    m = re.search(r"MOBILE_BUNDLE_VERSION\s*=\s*'([^']+)'", MOBILE_VERSION_TS)
    assert m, "MOBILE_BUNDLE_VERSION not found"
    assert _ge_108(m.group(1)), f"MOBILE_BUNDLE_VERSION {m.group(1)!r} must be >= .108"


def test_service_worker_cache_version_ge_108():
    m = re.search(r"CACHE_VERSION\s*=\s*'([^']+)'", SW_JS)
    assert m, "CACHE_VERSION not found"
    assert _ge_108(m.group(1)), f"SW CACHE_VERSION {m.group(1)!r} must be >= .108"

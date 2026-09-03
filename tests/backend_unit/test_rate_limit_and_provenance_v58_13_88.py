"""v58.13.88 — Rate limiting + provenance tagging + Safe Mode UX
+ env posture + _send_invite_sms fix + openapi test fix.
"""
from __future__ import annotations
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
MOBILE = ROOT / "mobile"

SERVER_PY = (BACKEND / "server.py").read_text(encoding="utf-8")
AUTH_PY = (BACKEND / "auth.py").read_text(encoding="utf-8")
AUTH_INVITE_PY = (BACKEND / "auth_invite.py").read_text(encoding="utf-8")
BULK_IMPORT_PY = (BACKEND / "bulk_import_prestarts.py").read_text(encoding="utf-8")
EMAIL_OUTBOX_PY = (BACKEND / "email_outbox.py").read_text(encoding="utf-8")
ENV_EXAMPLE = (BACKEND / ".env.example").read_text(encoding="utf-8")
RATE_LIMIT_PY = (BACKEND / "rate_limit.py").read_text(encoding="utf-8")
SAFE_MODE_JSX = (FRONTEND / "src" / "pages" / "CommsSafeMode.jsx").read_text(encoding="utf-8")
API_JS = (FRONTEND / "src" / "lib" / "api.js").read_text(encoding="utf-8")

VERSION_JS = (FRONTEND / "src" / "lib" / "version.js").read_text(encoding="utf-8")
SW_JS = (FRONTEND / "public" / "service-worker.js").read_text(encoding="utf-8")
MOBILE_TS = (MOBILE / "src" / "lib" / "version.ts").read_text(encoding="utf-8")


# ── Rate limiting ────────────────────────────────────────────────

def test_rate_limit_module_present():
    for symbol in ("_ip_key", "_user_or_ip_key", "limiter", "user_limiter", "_429_response"):
        assert symbol in RATE_LIMIT_PY


def test_server_wires_limiter_and_handler():
    assert "from rate_limit import limiter, user_limiter, _429_response" in SERVER_PY
    assert "app.state.limiter = limiter" in SERVER_PY
    assert "app.state.user_limiter = user_limiter" in SERVER_PY
    assert "app.add_exception_handler(RateLimitExceeded, _429_response)" in SERVER_PY


def test_login_endpoint_has_5_per_minute():
    assert re.search(r'@router\.post\("/login"[\s\S]+?limiter\.limit\("5/minute"\)', AUTH_PY)


def test_reset_request_has_3_per_minute():
    assert re.search(
        r'@router\.post\("/users/\{user_id\}/reset-password"\)[\s\S]+?limiter\.limit\("3/minute"\)',
        AUTH_INVITE_PY,
    )


def test_reset_redeem_has_10_per_hour():
    assert re.search(
        r'@router\.post\("/auth/reset/redeem"\)[\s\S]+?limiter\.limit\("10/hour"\)',
        AUTH_INVITE_PY,
    )


def test_bulk_import_has_5_per_hour_per_user():
    assert re.search(
        r'@router\.post\("/init"[\s\S]+?user_limiter\.limit\("5/hour"\)',
        BULK_IMPORT_PY,
    )


# ── Provenance tagging ───────────────────────────────────────────

def test_queue_email_doc_tags_actor_from_context():
    # v58.13.88 provenance block sits inside queue_email_doc, after the
    # Safe Mode check. Assert on file-scope substrings rather than a
    # brittle regex window.
    assert "from send_context import get_send_context" in EMAIL_OUTBOX_PY
    assert 'doc["actor_user_id"] = _ctx_user.get("id")' in EMAIL_OUTBOX_PY
    assert 'doc["actor_source"] = "user_action"' in EMAIL_OUTBOX_PY
    assert 'doc["actor_source"] = "system"' in EMAIL_OUTBOX_PY


def test_send_invite_sms_uses_safe_send_sms():
    m = re.search(
        r"async def _send_invite_sms[\s\S]+?(?=\n\nasync def|\Z)",
        AUTH_INVITE_PY,
    )
    body = m.group(0)
    assert "from integrations_textmagic import safe_send_sms" in body
    # Old broken import gone.
    assert "from integrations import send_sms" not in body


# ── env posture ──────────────────────────────────────────────────

def test_env_example_downgrades_safe_mode_to_fire_alarm():
    # New default is UNSET; the previous `COMMS_SAFE_MODE=on` line is
    # commented out with a fire-alarm-glass explainer.
    assert "# COMMS_SAFE_MODE=on" in ENV_EXAMPLE
    assert "FIRE-ALARM-GLASS" in ENV_EXAMPLE
    assert "NORMAL OPERATION" in ENV_EXAMPLE
    # And no active `COMMS_SAFE_MODE=on` line.
    active = [ln for ln in ENV_EXAMPLE.splitlines()
              if ln.startswith("COMMS_SAFE_MODE=")]
    assert active == [], f"env.example still has active COMMS_SAFE_MODE: {active}"


# ── Frontend UX ──────────────────────────────────────────────────

def test_safe_mode_jsx_has_confirmation_modal_on_off():
    assert "Turn Safe Mode OFF?" in SAFE_MODE_JSX
    assert "real emails and SMS" in SAFE_MODE_JSX
    # Toggle-ON has no confirmation (safe direction).
    assert "onClick={() => toggle('on')}" in SAFE_MODE_JSX


def test_safe_mode_jsx_has_plain_english_panel():
    assert "What Safe Mode affects" in SAFE_MODE_JSX
    assert "Does NOT block" in SAFE_MODE_JSX
    assert "Keep it ON" in SAFE_MODE_JSX
    assert "Turn it OFF" in SAFE_MODE_JSX


def test_safe_mode_jsx_has_open_outbox_cta():
    assert 'data-testid="open-outbox-cta"' in SAFE_MODE_JSX
    assert "Open Outbox" in SAFE_MODE_JSX
    # v58.13.88 — Old confusing wording ("Looking for the live outbox?")
    # must not appear in any user-visible JSX text. It IS still
    # referenced in legacy `// …` comments at the top of the file
    # documenting the wording change — strip both `{/* … */}` block
    # comments and `// …` line comments before asserting.
    stripped = re.sub(r"\{/\*[\s\S]*?\*/\}", "", SAFE_MODE_JSX)
    stripped = re.sub(r"//[^\n]*\n", "\n", stripped)
    assert "Looking for the live outbox?" not in stripped


def test_api_js_surfaces_429_message():
    assert "e?.response?.status === 429" in API_JS
    assert "rate_limit_exceeded" in API_JS or "retry_after_seconds" in API_JS


# ── Version-sync forward-safe pin >= 88 ─────────────────────────

def _tail(text: str, name: str) -> int:
    m = re.search(rf"{name}\s*=\s*['\"]paneltec-v[\d.]+\.(\d+)['\"]", text)
    assert m, f"{name} not found"
    return int(m.group(1))


def test_running_version_gte_88():
    assert _tail(VERSION_JS, "RUNNING_VERSION") >= 88


def test_cache_version_gte_88():
    assert _tail(SW_JS, "CACHE_VERSION") >= 88


def test_mobile_bundle_version_gte_88():
    assert _tail(MOBILE_TS, "MOBILE_BUNDLE_VERSION") >= 88

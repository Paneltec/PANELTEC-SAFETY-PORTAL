"""v58.13.85 — Integration wiring audit fixes.

1. TextMagic: whitespace stripped on save + defensive strip on read.
2. M365 test-connection: friendly `ErrorInvalidUser` message.
3. Comms Safe Mode: NO SMS bypass sites remain — every direct
   `rest.textmagic.com/api/v2/messages` httpx caller has been replaced
   by `safe_send_sms(...)` which honours `is_blocked(org_id)`.
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
MOBILE = ROOT / "mobile"

INTEGRATIONS_PY = (BACKEND / "integrations.py").read_text(encoding="utf-8")
TM_PY = (BACKEND / "integrations_textmagic.py").read_text(encoding="utf-8")
M365_PY = (BACKEND / "integrations_m365.py").read_text(encoding="utf-8")
ASSET_SERVICE_PY = (BACKEND / "asset_service.py").read_text(encoding="utf-8")
WORKER_CERTS_PY = (BACKEND / "worker_certifications.py").read_text(encoding="utf-8")
FORM_NOTIFIER_PY = (BACKEND / "form_assignment_notifier.py").read_text(encoding="utf-8")

VERSION_JS = (FRONTEND / "src" / "lib" / "version.js").read_text(encoding="utf-8")
SW_JS = (FRONTEND / "public" / "service-worker.js").read_text(encoding="utf-8")
MOBILE_TS = (MOBILE / "src" / "lib" / "version.ts").read_text(encoding="utf-8")


# ── TextMagic whitespace strip ─────────────────────────────────

def test_config_save_strips_whitespace_on_all_string_fields():
    # The rewritten `_encrypt_secrets_for_storage` must iterate and
    # strip every string value before storage.
    m = re.search(
        r"def _encrypt_secrets_for_storage[\s\S]+?return out",
        INTEGRATIONS_PY,
    )
    assert m, "helper not found"
    body = m.group(0)
    assert "v.strip()" in body
    # And the docstring calls out v58.13.85.
    assert "v58.13.85" in body


def test_textmagic_auth_headers_strip_defensively():
    assert '(cfg.get("username") or "").strip()' in TM_PY
    assert '(cfg.get("api_key") or "").strip()' in TM_PY


# ── M365 friendly ErrorInvalidUser message ─────────────────────

def test_m365_error_invalid_user_gets_actionable_message():
    assert "ErrorInvalidUser" in M365_PY
    assert "does not exist in" in M365_PY
    assert "Send-from mailbox" in M365_PY


# ── Comms Safe Mode: NO SMS bypass sites ───────────────────────

def test_no_direct_textmagic_httpx_calls_outside_integrations_textmagic():
    # Every raw `rest.textmagic.com/api/v2/messages` caller MUST now
    # go through `safe_send_sms`. The endpoint URL string may only
    # appear in `integrations_textmagic.py` (the centralised boundary).
    for path, text in (
        ("asset_service.py", ASSET_SERVICE_PY),
        ("worker_certifications.py", WORKER_CERTS_PY),
        ("form_assignment_notifier.py", FORM_NOTIFIER_PY),
    ):
        assert "rest.textmagic.com/api/v2/messages" not in text, (
            f"{path} still contains a direct TextMagic httpx call — must "
            "route through `safe_send_sms` in integrations_textmagic.py"
        )


def test_safe_send_sms_helper_defined():
    assert re.search(r"async def safe_send_sms\(", TM_PY)
    # Must check is_blocked BEFORE any httpx call.
    m = re.search(r"async def safe_send_sms\([\s\S]+?(?=\nasync def|\Z)", TM_PY)
    body = m.group(0)
    # is_blocked check comes before the httpx.AsyncClient() call.
    is_blocked_idx = body.find("is_blocked")
    httpx_idx = body.find("httpx.AsyncClient")
    assert is_blocked_idx != -1
    assert httpx_idx != -1
    assert is_blocked_idx < httpx_idx, "is_blocked check must precede the httpx call"
    # And on-block, record_blocked is called.
    assert "record_blocked" in body


def test_safe_send_sms_returns_blocked_shape_matching_graph_send_mail():
    m = re.search(r"async def safe_send_sms\([\s\S]+?(?=\nasync def|\Z)", TM_PY)
    body = m.group(0)
    # Same {ok:True, blocked:True} shape as graph_send_mail.
    assert '"ok": True, "blocked": True' in body
    assert '"provider": "safe_mode"' in body


def test_wired_call_sites_import_safe_send_sms():
    for path, text in (
        ("asset_service.py", ASSET_SERVICE_PY),
        ("worker_certifications.py", WORKER_CERTS_PY),
        ("form_assignment_notifier.py", FORM_NOTIFIER_PY),
    ):
        assert "safe_send_sms" in text, (
            f"{path} does not import safe_send_sms — SMS path may bypass "
            "Comms Safe Mode"
        )


# ── Version-sync (forward-safe pin >= 85) ──────────────────────

def _tail(text: str, name: str) -> int:
    m = re.search(rf"{name}\s*=\s*['\"]paneltec-v[\d.]+\.(\d+)['\"]", text)
    assert m, f"{name} not found"
    return int(m.group(1))


def test_running_version_gte_85():
    assert _tail(VERSION_JS, "RUNNING_VERSION") >= 85


def test_cache_version_gte_85():
    assert _tail(SW_JS, "CACHE_VERSION") >= 85


def test_mobile_bundle_version_gte_85():
    assert _tail(MOBILE_TS, "MOBILE_BUNDLE_VERSION") >= 85

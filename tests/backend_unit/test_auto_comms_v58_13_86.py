"""v58.13.86 — Automated Comms toggle.

Verifies:
1. `auto_comms.py` module exposes the expected shape (env / org / status).
2. `queue_email_doc` and `safe_send_sms` gate on auto-comms BEFORE
   Safe Mode when `source == "system"`.
3. Every user-action call site passes `source="user_action"`.
4. `_send_one_reminder` classifies by `manual_by` flag.
5. Router registered in `server.py`.
6. Version-sync forward-safe pin >= 86.
"""
from __future__ import annotations
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
MOBILE = ROOT / "mobile"

AUTO_COMMS_PY = (BACKEND / "auto_comms.py").read_text(encoding="utf-8")
EMAIL_OUTBOX_PY = (BACKEND / "email_outbox.py").read_text(encoding="utf-8")
TM_PY = (BACKEND / "integrations_textmagic.py").read_text(encoding="utf-8")
SERVER_PY = (BACKEND / "server.py").read_text(encoding="utf-8")
AUTH_INVITE_PY = (BACKEND / "auth_invite.py").read_text(encoding="utf-8")
SUPPLIERS_PY = (BACKEND / "suppliers.py").read_text(encoding="utf-8")
WORKER_CERTS_PY = (BACKEND / "worker_certifications.py").read_text(encoding="utf-8")
COMMS_SAFE_MODE_JSX = (FRONTEND / "src" / "pages" / "CommsSafeMode.jsx").read_text(encoding="utf-8")
APP_SHELL_JSX = (FRONTEND / "src" / "components" / "layout" / "AppShell.jsx").read_text(encoding="utf-8")

VERSION_JS = (FRONTEND / "src" / "lib" / "version.js").read_text(encoding="utf-8")
SW_JS = (FRONTEND / "public" / "service-worker.js").read_text(encoding="utf-8")
MOBILE_TS = (MOBILE / "src" / "lib" / "version.ts").read_text(encoding="utf-8")


# ── auto_comms module ────────────────────────────────────────────

def test_auto_comms_module_shape():
    for symbol in ("env_value", "env_is_locked", "org_setting",
                   "is_enabled", "is_disabled"):
        assert re.search(rf"(async )?def {symbol}\(", AUTO_COMMS_PY), (
            f"auto_comms.{symbol} missing"
        )


def test_auto_comms_default_is_disabled():
    # `org_setting` returns bool(doc.get("auto_comms_enabled") is True)
    # ⇒ any missing / None / False / falsy value = False = disabled.
    assert 'doc.get("auto_comms_enabled") is True' in AUTO_COMMS_PY


def test_auto_comms_status_endpoint_registered():
    assert '@router.get("/auto-comms/status"' in AUTO_COMMS_PY
    assert '@router.patch("/auto-comms")' in AUTO_COMMS_PY


def test_auto_comms_env_lock_returns_423():
    # PATCH must 423 when env-locked (matches Safe Mode behaviour).
    m = re.search(r"async def patch_auto_comms[\s\S]+?(?=\nasync def|\Z)", AUTO_COMMS_PY)
    body = m.group(0)
    assert "423" in body
    assert "env_is_locked" in body


def test_auto_comms_router_wired_in_server():
    assert "from auto_comms import router as auto_comms_router" in SERVER_PY
    assert "api.include_router(auto_comms_router)" in SERVER_PY


# ── Gate ordering in central boundaries ─────────────────────────

def test_email_outbox_gate_order_auto_then_env_then_safe_mode():
    m = re.search(r"async def queue_email_doc[\s\S]+?safe_blocked = ", EMAIL_OUTBOX_PY)
    body = m.group(0)
    auto_idx = body.find("_auto_disabled")
    env_idx = body.find('_os.environ.get("IS_PROD"')
    safe_idx = body.find("_safe_blocked")
    assert auto_idx != -1 and env_idx != -1 and safe_idx != -1
    assert auto_idx < env_idx < safe_idx, (
        "gate order must be: auto_comms → env → safe_mode"
    )


def test_email_outbox_bypasses_auto_gate_for_user_action():
    m = re.search(r"async def queue_email_doc[\s\S]+?safe_blocked = ", EMAIL_OUTBOX_PY)
    body = m.group(0)
    assert 'if source != "user_action":' in body


def test_email_outbox_source_param_added():
    m = re.search(r"async def queue_email_doc\([\s\S]+?\) -> dict:", EMAIL_OUTBOX_PY)
    sig = m.group(0)
    assert 'source: str = "system"' in sig


def test_email_outbox_auto_skip_returns_expected_shape():
    m = re.search(r"async def queue_email_doc[\s\S]+?safe_blocked = ", EMAIL_OUTBOX_PY)
    body = m.group(0)
    assert '"status": "skipped_auto_disabled"' in body
    assert '"provider": "auto_comms_gate"' in body


def test_safe_send_sms_gate_order_auto_then_env_then_safe_mode():
    m = re.search(r"async def safe_send_sms\([\s\S]+?from comms_safe_mode import is_blocked",
                  TM_PY)
    body = m.group(0)
    auto_idx = body.find("_auto_disabled")
    env_idx = body.find('_os.environ.get("IS_PROD"')
    assert auto_idx != -1 and env_idx != -1
    assert auto_idx < env_idx, "auto_comms gate must precede env gate"


def test_safe_send_sms_bypasses_auto_gate_for_user_action():
    assert re.search(r'async def safe_send_sms\([\s\S]+?if source != "user_action":', TM_PY)


def test_safe_send_sms_source_param_added():
    m = re.search(r"async def safe_send_sms\([\s\S]+?\) -> dict:", TM_PY)
    sig = m.group(0)
    assert 'source: str = "system"' in sig


# ── Call site classification ────────────────────────────────────

def test_auth_invite_uses_user_action_source():
    # _send_invite_email queues auth invites; both admin-triggered
    # (send_invite/send_reset) AND self-serve reset flow use it —
    # all user-action.
    assert re.search(
        r"await queue_email_doc\([\s\S]+?resource_kind=\"auth_invite\",[\s\S]+?"
        r'source="user_action"',
        AUTH_INVITE_PY,
    )


def test_suppliers_send_renewal_uses_user_action_source():
    assert re.search(
        r"await queue_email_doc\([\s\S]+?resource_kind=\"contractors\",[\s\S]+?"
        r'source="user_action"',
        SUPPLIERS_PY,
    )


def test_email_outbox_send_endpoint_uses_user_action_source():
    # POST /email/send — the primary user-composed outbox.
    m = re.search(r"async def send_email\([\s\S]+?return \{\*\*doc", EMAIL_OUTBOX_PY)
    body = m.group(0)
    assert 'source="user_action"' in body


def test_record_scoped_email_endpoints_all_user_action():
    # 10 record-scoped queue_email_doc calls injected in v58.13.86.
    # Match all `resource_kind="XYZ", …, source="user_action",` shapes.
    count = len(re.findall(
        r'resource_kind="[^"]+",\n        source="user_action"',
        EMAIL_OUTBOX_PY,
    ))
    assert count >= 10, f"expected >= 10 record-scoped user_action tags, got {count}"


def test_cert_reminder_classifies_by_manual_by_flag():
    # Both queue_email_doc calls inside _send_one_reminder pass
    # source=_send_source, derived from `manual_by`.
    m = re.search(
        r"async def _send_one_reminder\([\s\S]+?return summary",
        WORKER_CERTS_PY,
    )
    body = m.group(0)
    assert '_send_source = "user_action" if manual_by else "system"' in body
    # Both queue_email_doc calls forward the source.
    assert body.count("source=_send_source") >= 3  # 1 SMS helper + 2 email audiences


def test_cron_asset_service_defaults_to_system():
    # asset_service.scan_reminders doesn't pass `source` — the default
    # `"system"` in queue_email_doc / safe_send_sms is the correct
    # classification (cron reminder).
    asset_py = (BACKEND / "asset_service.py").read_text(encoding="utf-8")
    m = re.search(r"async def scan_reminders[\s\S]+?asset_reminders_sent\.insert_one",
                  asset_py)
    body = m.group(0)
    # No explicit source= in the safe_send_sms / queue_email_doc call
    # for cron paths — defaults are correct.
    assert 'source="user_action"' not in body, (
        "cron scan_reminders must NOT use user_action source"
    )


def test_form_assignment_notifier_defaults_to_system():
    notifier_py = (BACKEND / "form_assignment_notifier.py").read_text(encoding="utf-8")
    assert 'source="user_action"' not in notifier_py, (
        "form-assignment notifier is event-triggered; must default to system"
    )


# ── Frontend admin UI ──────────────────────────────────────────

def test_admin_ui_has_auto_comms_card():
    assert 'data-testid="auto-comms-card"' in COMMS_SAFE_MODE_JSX
    assert 'data-testid="auto-comms-enable"' in COMMS_SAFE_MODE_JSX
    assert 'data-testid="auto-comms-disable"' in COMMS_SAFE_MODE_JSX
    assert "/admin/auto-comms/status" in COMMS_SAFE_MODE_JSX


def test_topbar_has_auto_comms_chip():
    assert 'data-testid="auto-comms-chip"' in APP_SHELL_JSX
    assert "/admin/auto-comms/status" in APP_SHELL_JSX
    # OFF path styled muted (slate), ON styled amber.
    assert "bg-slate-100 text-slate-600" in APP_SHELL_JSX


# ── Version-sync forward-safe pin ──────────────────────────────

def _tail(text: str, name: str) -> int:
    m = re.search(rf"{name}\s*=\s*['\"]paneltec-v[\d.]+\.(\d+)['\"]", text)
    assert m, f"{name} not found"
    return int(m.group(1))


def test_running_version_gte_86():
    assert _tail(VERSION_JS, "RUNNING_VERSION") >= 86


def test_cache_version_gte_86():
    assert _tail(SW_JS, "CACHE_VERSION") >= 86


def test_mobile_bundle_version_gte_86():
    assert _tail(MOBILE_TS, "MOBILE_BUNDLE_VERSION") >= 86

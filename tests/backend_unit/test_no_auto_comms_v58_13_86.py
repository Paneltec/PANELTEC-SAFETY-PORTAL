"""v58.13.86 — Delete Path A + refactor Path B + restore invite + env template.

1. Auto-comms revert: `auto_comms.py` no longer exists; no `AUTO_COMMS_ENABLED`
   references in source; `queue_email_doc` / `safe_send_sms` have no `source=`
   param and no `auto_comms_gate` branch.
2. Path A deleted: `server.py` startup no longer calls `run_reminder_scan`.
3. Path B refactored: `dispatch_diff` no longer auto-fires; new
   `notify_worker_ids` helper + `POST /form-templates/{id}/notify-added-workers`
   endpoint.
4. Send invite endpoint returns 201 (was 410); AccessKebab has an
   `access-kebab-invite-*` button.
5. `.env.example` documents `COMMS_SAFE_MODE=on` for prod.
6. Version-sync forward-safe pin >= 86.
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
MOBILE = ROOT / "mobile"

EMAIL_OUTBOX_PY = (BACKEND / "email_outbox.py").read_text(encoding="utf-8")
TM_PY = (BACKEND / "integrations_textmagic.py").read_text(encoding="utf-8")
SERVER_PY = (BACKEND / "server.py").read_text(encoding="utf-8")
ASSET_SERVICE_PY = (BACKEND / "asset_service.py").read_text(encoding="utf-8")
FORM_NOTIFIER_PY = (BACKEND / "form_assignment_notifier.py").read_text(encoding="utf-8")
WORKER_CERTS_PY = (BACKEND / "worker_certifications.py").read_text(encoding="utf-8")
AUTH_INVITE_PY = (BACKEND / "auth_invite.py").read_text(encoding="utf-8")
ENV_EXAMPLE = (BACKEND / ".env.example").read_text(encoding="utf-8")
ACCESS_KEBAB_JSX = (FRONTEND / "src" / "components" / "auth" / "AccessKebab.jsx").read_text(encoding="utf-8")
COMMS_SAFE_JSX = (FRONTEND / "src" / "pages" / "CommsSafeMode.jsx").read_text(encoding="utf-8")
APPSHELL_JSX = (FRONTEND / "src" / "components" / "layout" / "AppShell.jsx").read_text(encoding="utf-8")
ASSIGN_JSX = (FRONTEND / "src" / "pages" / "FormAssignmentsAdmin.jsx").read_text(encoding="utf-8")

VERSION_JS = (FRONTEND / "src" / "lib" / "version.js").read_text(encoding="utf-8")
SW_JS = (FRONTEND / "public" / "service-worker.js").read_text(encoding="utf-8")
MOBILE_TS = (MOBILE / "src" / "lib" / "version.ts").read_text(encoding="utf-8")


# ── Revert: no auto_comms artefacts anywhere ─────────────────────

def test_auto_comms_module_deleted():
    assert not (BACKEND / "auto_comms.py").exists()


def test_no_auto_comms_imports_in_backend():
    for path, text in (
        ("email_outbox.py", EMAIL_OUTBOX_PY),
        ("integrations_textmagic.py", TM_PY),
        ("server.py", SERVER_PY),
    ):
        assert "from auto_comms import" not in text, f"{path} still imports auto_comms"
        assert "auto_comms_router" not in text, f"{path} still refs auto_comms_router"


def test_no_auto_comms_env_var_or_gate_branch():
    for path, text in (
        ("email_outbox.py", EMAIL_OUTBOX_PY),
        ("integrations_textmagic.py", TM_PY),
    ):
        assert "AUTO_COMMS_ENABLED" not in text, f"{path} still refs AUTO_COMMS_ENABLED"
        assert "auto_comms_gate" not in text, f"{path} still refs auto_comms_gate provider"
        assert "skipped_auto_disabled" not in text, f"{path} still refs auto skip status"


def test_queue_email_doc_source_param_reverted():
    m = re.search(r"async def queue_email_doc\([\s\S]+?\) -> dict:", EMAIL_OUTBOX_PY)
    sig = m.group(0)
    assert 'source: str = "system"' not in sig
    # v58.13.86 intent: no `source="user_action"` / `source="system"`
    # kwargs to `queue_email_doc(...)` (the AUTO_COMMS pattern that was
    # reverted). Substring-only checks were too broad — v58.13.88 added
    # provenance tagging that writes `doc["actor_source"] = "system"`
    # and describes the design in a code comment as `actor_source=
    # "system"`. Both of those legitimately contain the substring
    # `source="system"` but neither is a kwarg to `queue_email_doc`.
    # Tighten to a regex that only matches the kwarg-call form.
    assert re.search(r'queue_email_doc\([^)]*source="user_action"', EMAIL_OUTBOX_PY) is None
    assert re.search(r'queue_email_doc\([^)]*source="system"', EMAIL_OUTBOX_PY) is None


def test_safe_send_sms_source_param_reverted():
    m = re.search(r"async def safe_send_sms\([\s\S]+?\) -> dict:", TM_PY)
    sig = m.group(0)
    assert 'source: str = "system"' not in sig


def test_no_source_kwarg_at_call_sites():
    for path, text in (
        ("email_outbox.py", EMAIL_OUTBOX_PY),
        ("auth_invite.py", AUTH_INVITE_PY),
        ("worker_certifications.py", WORKER_CERTS_PY),
    ):
        assert 'source="user_action"' not in text, f"{path} still tags source=user_action"


def test_comms_safe_mode_page_has_no_auto_comms_card():
    assert 'data-testid="auto-comms-card"' not in COMMS_SAFE_JSX
    assert '/admin/auto-comms/status' not in COMMS_SAFE_JSX
    assert 'toggleAutoComms' not in COMMS_SAFE_JSX


def test_appshell_has_no_auto_comms_chip():
    assert 'data-testid="auto-comms-chip"' not in APPSHELL_JSX
    assert '/admin/auto-comms/status' not in APPSHELL_JSX
    assert 'setAutoComms' not in APPSHELL_JSX


# ── Path A deletion ────────────────────────────────────────────────

def test_startup_does_not_call_run_reminder_scan():
    # No `stats = await run_reminder_scan()` line at startup.
    assert "stats = await run_reminder_scan()" not in SERVER_PY
    # The v58.13.86 comment marker sits where the auto-invocation used
    # to be — this pins that the deletion happened intentionally.
    assert "Path A (startup cert reminder scan) deleted" in SERVER_PY


def test_run_reminder_scan_function_still_exists():
    # The scan is still callable via the admin endpoint — only the
    # startup auto-invocation was removed.
    assert "async def run_reminder_scan" in WORKER_CERTS_PY
    assert 'no auto-invocation' in WORKER_CERTS_PY


# ── Path B refactor ────────────────────────────────────────────────

def test_dispatch_diff_no_longer_auto_fires():
    m = re.search(
        r"async def dispatch_diff\([\s\S]+?(?=\n\nasync def|\Z)",
        FORM_NOTIFIER_PY,
    )
    body = m.group(0)
    # No `asyncio.create_task(_process(...))` inside dispatch_diff.
    assert "asyncio.create_task(_process" not in body
    # `queued` is always False in the response.
    assert '"queued": False' in body


def test_notify_worker_ids_helper_defined():
    assert re.search(r"async def notify_worker_ids\(", FORM_NOTIFIER_PY)


def test_notify_added_workers_endpoint_registered():
    assert re.search(
        r'@assignments_router\.post\("/\{template_id\}/notify-added-workers"\)',
        ASSET_SERVICE_PY,
    )
    assert "async def notify_added_workers" in ASSET_SERVICE_PY
    assert "notify_worker_ids" in ASSET_SERVICE_PY


def test_bulk_save_returns_per_template_diffs():
    m = re.search(
        r"async def bulk_save_assignments[\s\S]+?return \{",
        ASSET_SERVICE_PY,
    )
    body = m.group(0)
    assert '"per_template"' in body
    assert '"newly_added"' in body


def test_frontend_persist_save_calls_notify_endpoint():
    # Frontend must POST to /notify-added-workers per template when
    # the admin picks "Save & notify".
    assert "/notify-added-workers" in ASSIGN_JSX
    assert "per_template" in ASSIGN_JSX


# ── Invite restore ────────────────────────────────────────────────

def test_send_invite_endpoint_returns_201_not_410():
    # The decorator carries the status code.
    assert '@router.post("/users/{user_id}/invite", status_code=201)' in AUTH_INVITE_PY
    # And the raise 410 stub is gone.
    assert 'raise HTTPException(410, "invite disabled' not in AUTH_INVITE_PY


def test_send_invite_still_admin_only():
    m = re.search(r"async def send_invite\([\s\S]+?await _audit", AUTH_INVITE_PY)
    body = m.group(0)
    assert 'caller.get("role") != "admin"' in body


def test_access_kebab_has_invite_button():
    assert 'access-kebab-invite-' in ACCESS_KEBAB_JSX
    assert "fireInvite" in ACCESS_KEBAB_JSX
    # Old "removed" comment should be gone or reworded.
    assert 'fireInvite() removed' not in ACCESS_KEBAB_JSX


# ── .env.example — prod guidance ──────────────────────────────────

def test_env_example_pins_comms_safe_mode_on():
    # v58.13.88 revised .env.example: `COMMS_SAFE_MODE=on` was
    # DOWNGRADED to a commented-out FIRE-ALARM-GLASS override with an
    # explainer, and the old "PROD RECOMMENDATION" block was replaced
    # with a "NORMAL OPERATION" note. See the .88 test
    # `test_env_example_downgrades_safe_mode_to_fire_alarm` which
    # pins the new posture directly. Here we forward-accept either
    # posture so the .86 test continues to guard the sibling knobs
    # (IS_PROD) without failing on the .88-approved wording swap.
    posture_88 = ("FIRE-ALARM-GLASS" in ENV_EXAMPLE
                  and "NORMAL OPERATION" in ENV_EXAMPLE
                  and "# COMMS_SAFE_MODE=on" in ENV_EXAMPLE)
    posture_86 = ("PROD RECOMMENDATION" in ENV_EXAMPLE
                  and re.search(r"^COMMS_SAFE_MODE=on\s*$",
                                ENV_EXAMPLE, re.MULTILINE) is not None)
    assert posture_88 or posture_86, (
        ".env.example must document Comms Safe Mode via either the "
        "v58.13.86 posture (active `COMMS_SAFE_MODE=on` line + PROD "
        "RECOMMENDATION block) or the v58.13.88 posture (commented-out "
        "override + FIRE-ALARM-GLASS explainer)."
    )
    # IS_PROD guidance present (unchanged intent across .86 → .88).
    assert "IS_PROD=" in ENV_EXAMPLE


# ── Version-sync forward-safe pin >= 86 ──────────────────────────

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

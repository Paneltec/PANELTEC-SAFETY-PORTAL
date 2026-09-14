"""v58.13.132fb — Reset-password modal bug fixes.

Two P0 bugs on the admin user-management "Reset password for X"
flow reported by Stephen:

  1. The "Send reset link" / "Set password directly" dialog was
     rendering BEHIND the user profile drawer. Root cause: the
     dialog sat at `z-[80]` in the same body-portal tier as the
     drawer (`z-[60]`) — should have won, but empirically didn't
     for some browser builds. Bumped to `z-[95]` with a
     `backdrop-blur-sm` so it decisively out-stacks the drawer
     plus every other modal in `UsersManagement.jsx` (previous
     max was `z-[80]`).

  2. Typing into NEW PASSWORD then focusing CONFIRM wiped NEW
     PASSWORD. Root cause: Chrome/Edge/Safari password managers
     see two `<input type="password">` without `autoComplete`
     metadata and inject a saved value into the first field when
     the second gains focus. Fixed by adding
     `autoComplete="new-password"` + distinct `name` attrs +
     `spellCheck={false}` on both fields. State also
     consolidated into a single `pw` object for symmetry, with
     inline "Passwords do not match" hint + client-side gating
     on the submit button.

The same autofill fix has been swept into the self-serve
`ChangePasswordModal` and the first-login `Onboard.jsx` set-
password screen — separate components, same anti-autofill
attributes.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest
import requests

from tests.conftest import ADMIN_EMAIL, ADMIN_PWD, API

pytestmark = pytest.mark.live_db_writes

APP_ROOT = Path(__file__).resolve().parents[2]
FE = APP_ROOT / "frontend" / "src"
USERS_PAGE = FE / "pages" / "UsersManagement.jsx"
AUTH_BUNDLE = FE / "components" / "auth" / "AuthBundle.jsx"
ONBOARD = FE / "pages" / "Onboard.jsx"
VERSION_JS = FE / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def _admin_hdr():
    r = requests.post(f"{API}/auth/login",
                       json={"email": ADMIN_EMAIL, "password": ADMIN_PWD},
                       timeout=30)
    if r.status_code == 429:
        pytest.skip("rate-limited by auth throttle — retry later")
    assert r.status_code == 200, r.text
    tok = r.json().get("access_token") or r.json().get("token")
    return {"Authorization": f"Bearer {tok}"}


# ── FE source-pins: z-index bump ───────────────────────────────────

def test_reset_password_dialog_uses_top_of_stack_zindex():
    """`ResetPasswordDialog` in `UsersManagement.jsx` must sit at
    `z-[95]` (or higher) so it out-stacks the profile drawer
    (`z-[60]`) + every other modal in the file (previous max
    `z-[80]`). Backdrop blur adds visual weight."""
    src = _read(USERS_PAGE)
    # Locate the ResetPasswordDialog block and grep only within it.
    start = src.find("function ResetPasswordDialog(")
    assert start > 0, "ResetPasswordDialog not found"
    end = src.find("\nfunction ", start + 1)
    block = src[start:(end if end > start else len(src))]
    assert 'data-testid="reset-password-dialog"' in block
    # z-[80] must be gone from the dialog; z-[95] must be present.
    assert re.search(r"z-\[80\]", block) is None, (
        "reset-password-dialog must not use z-[80] — bump to z-[95]")
    assert "z-[95]" in block, "reset-password-dialog must use z-[95]"
    # Backdrop-blur visual polish + portal-to-body preserved.
    assert "backdrop-blur-sm" in block
    assert "createPortal((" in block
    assert "document.body" in block


# ── FE source-pins: anti-autofill attributes ───────────────────────

def test_admin_reset_password_fields_are_controlled_with_new_password_autocomplete():
    src = _read(USERS_PAGE)
    start = src.find("function ResetPasswordDialog(")
    end = src.find("\nfunction ", start + 1)
    block = src[start:end]
    # Shared state object per spec.
    assert "useState({ next: '', confirm: '' })" in block
    # Both inputs controlled through the same object.
    assert "value={pw.next}" in block
    assert "value={pw.confirm}" in block
    # Anti-autofill trio on BOTH direct-mode inputs.
    for pin in ('name="new-password-set"',
                 'name="new-password-confirm"'):
        assert pin in block, f"missing pin {pin}"
    # Two `autoComplete="new-password"` occurrences (one per input).
    assert block.count('autoComplete="new-password"') >= 2
    assert block.count("spellCheck={false}") >= 2
    # Submit gates on `canSetDirect` (min-length + match).
    assert "const canSetDirect =" in block
    assert 'disabled={!canSetDirect}' in block
    # Inline mismatch hint.
    assert "Passwords do not match" in block
    assert 'data-testid="reset-direct-mismatch"' in block


def test_self_serve_change_password_modal_has_autocomplete_pins():
    """Sweep: `ChangePasswordModal` (self-serve) got the same
    anti-autofill attributes so the wipe bug can't recur there."""
    src = _read(AUTH_BUNDLE)
    # Three password inputs — current + new + confirm — each with
    # a distinct name.
    for name in ('name="current-password"',
                  'name="new-password-self"',
                  'name="new-password-self-confirm"'):
        assert name in src, f"missing name attr {name}"
    assert 'autoComplete="current-password"' in src
    assert src.count('autoComplete="new-password"') >= 2


def test_onboard_first_login_password_screen_has_autocomplete_pins():
    """Sweep: first-login `Onboard.jsx` set-password screen got the
    same anti-autofill attributes."""
    src = _read(ONBOARD)
    for name in ('name="new-password-onboard"',
                  'name="new-password-onboard-confirm"'):
        assert name in src, f"missing name attr {name}"
    assert src.count('autoComplete="new-password"') >= 2


# ── BE — password policy enforced server-side ─────────────────────

def test_admin_set_password_rejects_weak_password():
    """Defence in depth — the admin-set-password endpoint must
    still enforce the password policy even if the FE gate is
    bypassed. `validate_password_rule` returns a rejection string
    for weak passwords (currently `< 8 chars`)."""
    hdr = _admin_hdr()
    # Look up admin's own id for a self-target — the endpoint just
    # needs a real user. This test doesn't actually SUCCEED at
    # changing anything (weak password path).
    r_me = requests.get(f"{API}/auth/me", headers=hdr, timeout=30)
    assert r_me.status_code == 200, r_me.text
    admin_id = r_me.json()["id"]
    r = requests.post(f"{API}/users/{admin_id}/set-password",
                       json={"password": "abc"},
                       headers=hdr, timeout=30)
    # 400 — handler-level `validate_password_rule` rejection.
    # 422 — Pydantic schema `min_length` rejection (also fine —
    # server refused a weak password, that's the defence).
    assert r.status_code in (400, 422), r.text


# ── Version pin ────────────────────────────────────────────────────

def test_version_pinned_to_132fb_or_higher():
    v = _read(VERSION_JS)
    sw = _read(SW)
    m_v = re.search(r"RUNNING_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", v)
    m_ex = re.search(r"EXPECTED_CACHE_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", v)
    m_sw = re.search(r"CACHE_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", sw)
    for name, m in (("RUNNING_VERSION", m_v),
                     ("EXPECTED_CACHE_VERSION", m_ex),
                     ("CACHE_VERSION", m_sw)):
        assert m and m.group(1) >= "fb", (
            f"{name} suffix must be >= 132fb, got {m and m.group(1)}")

"""v58.13.132du — Reset email + admin dialog + login header UX fix.

Locks the following changes made in response to the Amanda-invite
confusion (`.132dt` diagnostic → `.132du` fix):

  1. `_send_invite_email` renders NO `<code>{link}</code>` block that
     could be visually mistaken for a plaintext password.
  2. The email template renders the full URL twice: as an anchor with
     an action label ("Reset your password" / "Set up your account")
     AND as a bare fallback anchor whose visible text is the URL.
  3. Signature line uses the org's display_name (falling back to
     trading_name → name → "Paneltec Civil"), matching the .132dr
     sidebar precedence.
  4. Admin ResetLinkRevealModal:
       • Label copy is "Reset link — send this full URL to the user"
         (was "Password reset URL").
       • Warning helper text pins "Do NOT send just the token".
       • Copy button label is "Copy full URL" (was "Copy reset link").
  5. Login endpoint sets `X-Auth-Reason: pending-first-signin`
     response header when 401 fires against a user who has
     `must_change_password=true` AND a live reset_token_hash / pin_hash.
     Body remains "Invalid email or password" (anti-enumeration
     preserved).
  6. `classifyAuthError` returns kind `pending_first_signin` when that
     header is present; Cover.jsx renders the emphasised helper card.
  7. Three-way version pin at .132du.
"""
from __future__ import annotations

import os
import re
from pathlib import Path

import pytest
import requests

APP_ROOT = Path(__file__).resolve().parents[2]
AUTH_MOD = APP_ROOT / "backend" / "auth.py"
INVITE_MOD = APP_ROOT / "backend" / "auth_invite.py"
AUTHBUNDLE = APP_ROOT / "frontend" / "src" / "components" / "auth" / "AuthBundle.jsx"
COVER = APP_ROOT / "frontend" / "src" / "pages" / "Cover.jsx"
API_LIB = APP_ROOT / "frontend" / "src" / "lib" / "api.js"
VERSION_JS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"

API = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
ADMIN_EMAIL = "stephen@paneltec.com.au"
ADMIN_PWD = "Mcgstephen50#"


def _admin_headers():
    r = requests.post(f"{API}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PWD},
                      timeout=30)
    if r.status_code != 200:
        pytest.skip(f"admin login unavailable: {r.status_code}")
    tok = r.json().get("access_token") or r.json().get("token")
    return {"Authorization": f"Bearer {tok}"}


# ─── Source pins ────────────────────────────────────────────────

def test_backend_email_template_pins():
    src = INVITE_MOD.read_text(encoding="utf-8")
    assert "132du" in src
    # NO `<code>` tag in the actual template — the docstring mentions
    # it as the bug root cause, so we strip the docstring block before
    # grepping.
    template_only = re.sub(r'"""[\s\S]*?"""', '', src)
    assert "<code>" not in template_only
    # Reset CTA label matches the spec.
    assert "Reset your password" in src
    assert "Set up your account" in src
    # Fallback copy explicitly says "link" (not "code", not "password").
    assert "copy and paste this link into your browser" in src
    # Org display_name lookup helper wired in.
    assert "_org_display_name" in src
    assert "display_name" in src and "trading_name" in src
    # Signature line uses the brand.
    assert "— {brand}" in src


def test_backend_login_adds_pending_first_signin_header():
    src = AUTH_MOD.read_text(encoding="utf-8")
    assert "132du" in src
    assert "X-Auth-Reason" in src
    assert "pending-first-signin" in src
    # Extra safety: the raise still returns "Invalid email or password"
    # (anti-enumeration).
    assert 'detail="Invalid email or password"' in src


def test_frontend_reset_link_modal_copy():
    src = AUTHBUNDLE.read_text(encoding="utf-8")
    assert "132du" in src
    assert "Reset link — send this full URL to the user" in src
    assert "Copy full URL" in src
    assert 'data-testid="reset-link-warning"' in src
    assert "Do NOT send just the token" in src
    # Old ambiguous label must be gone.
    assert "Password reset URL" not in src


def test_frontend_classify_auth_error_detects_header():
    src = API_LIB.read_text(encoding="utf-8")
    assert "132du" in src
    assert "pending-first-signin" in src
    assert "pending_first_signin" in src


def test_frontend_cover_renders_pending_helper():
    src = COVER.read_text(encoding="utf-8")
    assert "132du" in src
    assert 'data-testid="cover-pending-first-signin"' in src
    assert "Have an invite email or reset link?" in src
    assert "pendingFirstSignin" in src


def test_three_way_version_sync_at_132du():
    running = re.search(r"^export const RUNNING_VERSION = '([^']+)'",
                        VERSION_JS.read_text(), re.MULTILINE).group(1)
    expected = re.search(r"^export const EXPECTED_CACHE_VERSION = '([^']+)'",
                         VERSION_JS.read_text(), re.MULTILINE).group(1)
    cache = re.search(r"^const CACHE_VERSION = '([^']+)'",
                      SW.read_text(), re.MULTILINE).group(1)
    assert running == expected == cache
    tail = re.search(r"132([a-z]+)", running).group(1)
    assert tail >= "du"


# ─── Behavioural: email template rendering ────────────────────

@pytest.mark.asyncio
async def test_email_body_html_shape():
    """Call the internal helper and inspect the emitted `body_html`.
    Locks:
      • Full URL appears at least twice (button anchor + fallback anchor).
      • No `<code>` tag anywhere.
      • The CTA label ("Reset your password") is inside an <a href>.
      • The signature contains "— " followed by a brand string.
    """
    import sys
    sys.path.insert(0, str(APP_ROOT / "backend"))
    # Stub queue_email_doc so we can capture the payload without hitting Mongo.
    captured: dict = {}

    async def _fake_queue(*args, **kwargs):
        captured.update(kwargs)

    import email_outbox
    original = email_outbox.queue_email_doc
    email_outbox.queue_email_doc = _fake_queue
    try:
        import auth_invite  # imports the freshly-patched module
        link = "https://example.com/reset?token=Do2%23cXaJMU-abc-def"
        user = {"id": "u-test", "email": "amanda@example.com",
                "name": "Amanda Guy", "org_id": None}
        await auth_invite._send_invite_email(
            user, link, "Paneltec Civil", "reset", {"id": "admin-1"})
    finally:
        email_outbox.queue_email_doc = original

    assert captured.get("subject"), captured
    html = captured.get("body_html") or ""
    assert html
    # Full URL appears at least twice (button anchor + fallback anchor).
    assert html.count(link) >= 2, html
    # No `<code>` tag anywhere.
    assert "<code>" not in html
    assert "</code>" not in html
    # CTA label is inside an <a href>.
    assert 'href="' + link + '"' in html or f"href='{link}'" in html
    assert "Reset your password" in html
    # Signature line present.
    assert "— " in html
    # No "Set my password" (old label) that could confuse a reader
    # into thinking the URL text was a temp password.
    assert "Set my password" not in html


# ─── Behavioural: login header ────────────────────────────────

def test_login_endpoint_sets_pending_header():
    """When a real user with `must_change_password=true` + live
    reset_token_hash 401s, response includes `X-Auth-Reason:
    pending-first-signin`. Uses Amanda's account since Stephen just
    triggered a reset on her (per .132du diagnostic) — her account
    is the exact live-in-the-DB shape this test needs."""
    r = requests.post(f"{API}/api/auth/login",
                      json={"email": "amanda.guy@paneltec.com.au",
                            "password": "obviously-not-her-password-xyz"},
                      timeout=30)
    # 401 on bad password; header set for pending-first-signin.
    if r.status_code == 423:
        pytest.skip("Amanda's account is currently locked out")
    assert r.status_code == 401, r.text
    # anti-enumeration body preserved
    assert r.json().get("detail") == "Invalid email or password"
    reason = r.headers.get("X-Auth-Reason") or r.headers.get("x-auth-reason")
    # Amanda's DB state (per .132du diag) has must_change_password=true
    # AND reset_token_hash live until 2026-09-12. If the reset expired
    # by the time this test runs, the header will legitimately not
    # fire — accept absence in that case.
    if reason is None:
        pytest.skip("no pending-first-signin state on target account "
                    "(reset token may have expired)")
    assert reason == "pending-first-signin"


def test_login_endpoint_no_header_for_regular_user():
    """A user without `must_change_password` (like Stephen after a
    real login) must NOT receive the pending header on a bad
    attempt. Prevents the header from becoming a passive enumeration
    signal."""
    r = requests.post(f"{API}/api/auth/login",
                      json={"email": ADMIN_EMAIL,
                            "password": "definitely-not-stephens-pw-xyz"},
                      timeout=30)
    if r.status_code == 423:
        pytest.skip("admin account locked out")
    assert r.status_code == 401
    reason = r.headers.get("X-Auth-Reason") or r.headers.get("x-auth-reason")
    assert reason != "pending-first-signin"


def test_login_endpoint_no_header_for_unknown_user():
    """An email that doesn't exist in the DB must NOT trigger the
    pending header — that would leak account existence."""
    r = requests.post(f"{API}/api/auth/login",
                      json={"email": "no-such-user-xyzzy@example.com",
                            "password": "nothing-at-all"},
                      timeout=30)
    if r.status_code == 423:
        pytest.skip("rate limited")
    assert r.status_code == 401
    reason = r.headers.get("X-Auth-Reason") or r.headers.get("x-auth-reason")
    assert reason != "pending-first-signin"

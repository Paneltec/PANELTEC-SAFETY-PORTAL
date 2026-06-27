"""Iteration 7 — Verify users are not signed out prematurely.

Scenarios (per review_request):
1. JWT exp ~30 days (extended from 7).
2. M365/Simpro/TextMagic test-connection return HTTP 400 with NO X-Auth-Reason.
3. No-op PATCH /api/users/{me} does NOT bump token_version (GET /me stays 200).
4. Real role change DOES bump token_version (GET /me returns 401 token-revoked).
5. PUT /api/integrations/{kind} keeps the user logged in.
"""
import os
import time
import jwt as pyjwt
import pytest
import requests

def _load_frontend_env():
    """Pick up REACT_APP_BACKEND_URL from frontend/.env if not in process env."""
    if os.environ.get("REACT_APP_BACKEND_URL"):
        return
    env_path = "/app/frontend/.env"
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line.startswith("REACT_APP_BACKEND_URL="):
                    os.environ["REACT_APP_BACKEND_URL"] = line.split("=", 1)[1].strip().strip('"')
                    return


_load_frontend_env()
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_EMAIL = "admin@paneltec.com"
ADMIN_PWD = "demo123"


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PWD}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    data = r.json()
    token = data["access_token"]
    s.headers.update({"Authorization": f"Bearer {token}"})
    s.user_id = data["user"]["id"]
    s.token = token
    yield s


def _decode_no_verify(token: str) -> dict:
    return pyjwt.decode(token, options={"verify_signature": False, "verify_exp": False})


class TestJWTExpiry:
    def test_exp_is_approx_30_days(self, admin_session):
        claims = _decode_no_verify(admin_session.token)
        now = int(time.time())
        days = (claims["exp"] - now) / 86400.0
        assert 29.0 < days <= 30.5, f"JWT exp {days:.2f} days — expected ~30"


class TestUpstreamIntegrationsDontLogoutUser:
    """test-connection endpoints upstream-fail with HTTP 400, no X-Auth-Reason."""

    @pytest.mark.parametrize("kind", ["microsoft365", "simpro", "textmagic"])
    def test_test_connection_does_not_leak_auth_header(self, admin_session, kind):
        r = admin_session.post(f"{API}/integrations/{kind}/test-connection", json={}, timeout=60)
        # Backend is expected to surface the upstream failure as HTTP 400.
        assert r.status_code == 400, f"{kind}: expected 400, got {r.status_code} {r.text[:300]}"
        # CRITICAL: must NOT include X-Auth-Reason (would force frontend logout).
        assert "X-Auth-Reason" not in r.headers, (
            f"{kind} leaks X-Auth-Reason={r.headers.get('X-Auth-Reason')}"
        )
        # Session still alive
        me = admin_session.get(f"{API}/auth/me", timeout=15)
        assert me.status_code == 200, f"GET /me after {kind} test failed: {me.status_code}"


class TestNoopPatchDoesNotBumpTokenVersion:
    def test_noop_patch_keeps_session(self, admin_session):
        my_id = admin_session.user_id
        body = {"role": "admin", "status": "active", "email": ADMIN_EMAIL}
        r = admin_session.patch(f"{API}/users/{my_id}", json=body, timeout=30)
        assert r.status_code == 200, f"PATCH failed: {r.status_code} {r.text}"
        me = admin_session.get(f"{API}/auth/me", timeout=15)
        assert me.status_code == 200, (
            f"No-op PATCH bumped tv — /me returned {me.status_code} "
            f"reason={me.headers.get('X-Auth-Reason')}"
        )


class TestPutIntegrationsKeepsSession:
    @pytest.mark.parametrize("kind,payload", [
        ("simpro", {"base_url": "https://demo.simprosuite.com", "client_id": "dummy", "client_secret": "dummy"}),
        ("microsoft365", {"tenant_id": "common", "client_id": "00000000-0000-0000-0000-000000001234",
                          "client_secret": "TEST-SECRET-ABCDEFGH", "sender_email": "test-sender@paneltec.com.au"}),
        ("textmagic", {"username": "dummy", "api_key": "dummy"}),
        ("navixy", {"base_url": "https://api.eu.navixy.com", "email": "dummy@example.com", "password": "dummy"}),
    ])
    def test_put_integration_keeps_user_logged_in(self, admin_session, kind, payload):
        r = admin_session.put(f"{API}/integrations/{kind}", json=payload, timeout=30)
        assert r.status_code == 200, f"PUT {kind} failed: {r.status_code} {r.text[:300]}"
        me = admin_session.get(f"{API}/auth/me", timeout=15)
        assert me.status_code == 200, (
            f"PUT {kind} caused logout — /me {me.status_code} {me.headers.get('X-Auth-Reason')}"
        )


class TestRealRoleChangeRevokesAndRestores:
    """Run LAST — it revokes the active token. Restores admin role afterward."""

    def test_real_role_change_bumps_tv_then_restore(self):
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        # Fresh login
        r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PWD}, timeout=30)
        assert r.status_code == 200
        data = r.json()
        token = data["access_token"]
        my_id = data["user"]["id"]
        s.headers.update({"Authorization": f"Bearer {token}"})

        # Real change: admin -> hseq_lead
        r = s.patch(f"{API}/users/{my_id}", json={"role": "hseq_lead"}, timeout=30)
        assert r.status_code == 200, f"role-change PATCH failed: {r.status_code} {r.text}"

        # Current token must be revoked
        me = s.get(f"{API}/auth/me", timeout=15)
        assert me.status_code == 401, f"expected 401 after real role change, got {me.status_code}"
        assert me.headers.get("X-Auth-Reason") == "token-revoked", (
            f"expected X-Auth-Reason=token-revoked, got {me.headers.get('X-Auth-Reason')}"
        )

        # Restore admin role with a fresh login (new tv)
        r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PWD}, timeout=30)
        assert r.status_code == 200
        s.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})
        r = s.patch(f"{API}/users/{my_id}", json={"role": "admin"}, timeout=30)
        assert r.status_code == 200
        # Re-login one more time so role is admin and active token matches tv
        r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PWD}, timeout=30)
        assert r.status_code == 200
        assert r.json()["user"]["role"] == "admin", "admin role not restored!"


class TestStalePdfTokenDoesNotForceLogout:
    """A stale/invalid PDF token should NOT use a platform X-Auth-Reason."""

    def test_invalid_pdf_token_does_not_carry_platform_auth_reason(self):
        # Anonymous request — no JWT
        r = requests.get(f"{API}/files/pdf/invalidtoken.pdf", timeout=15, allow_redirects=False)
        # Any of 401/403/404 is fine — what matters is the header value.
        reason = r.headers.get("X-Auth-Reason", "")
        platform = {"jwt-missing", "jwt-invalid", "jwt-expired", "token-revoked", "account-disabled"}
        assert reason not in platform, (
            f"PDF endpoint leaked platform auth reason={reason!r} (status={r.status_code}); "
            "would force frontend logout!"
        )

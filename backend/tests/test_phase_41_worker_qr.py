"""Phase 4.1 — Worker Induction QR backend tests.

Covers:
- /api/workers/{id}/qr.png (auth required PNG)
- /api/workers/{id}/id-card.pdf wallet/lanyard/avery (+ garbage 422)
- /api/scan/worker/{token} (public)
- /api/scan/worker/{token}/site-signin (auth, source=worker_qr)
- /api/workers/{id}/nfc-pair POST + DELETE (incl. 409 duplicate)
- /api/scan/{asset_scan_token}/forms regression (no shadowing)
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")

ADMIN_EMAIL = "stephen@paneltec.com.au"
ADMIN_PASSWORD = "Mcgstephen50#"
WORKER_ID = "dbddf739-5803-4a86-925d-ed1aef514fa1"  # Stephen Guy
SCAN_TOKEN = "i4UmjUBzsi"
ASSET_SCAN_TOKEN = "03tuIaQGp5"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                      timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture
def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


# ─────────────── QR PNG ───────────────
class TestWorkerQrPng:
    def test_qr_png_authed_returns_png(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/workers/{WORKER_ID}/qr.png",
                         headers=auth_headers, timeout=20)
        assert r.status_code == 200, r.text
        assert r.headers.get("content-type", "").startswith("image/png")
        assert r.content[:8] == b"\x89PNG\r\n\x1a\n"

    def test_qr_png_unauth_returns_401(self):
        r = requests.get(f"{BASE_URL}/api/workers/{WORKER_ID}/qr.png", timeout=20)
        assert r.status_code == 401


# ─────────────── ID Card PDF ───────────────
class TestIdCardPdf:
    @pytest.mark.parametrize("layout", ["wallet", "lanyard", "avery"])
    def test_pdf_layouts_return_pdf(self, auth_headers, layout):
        r = requests.get(
            f"{BASE_URL}/api/workers/{WORKER_ID}/id-card.pdf",
            params={"layout": layout}, headers=auth_headers, timeout=30)
        assert r.status_code == 200, f"{layout}: {r.status_code} {r.text[:200]}"
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert r.content[:4] == b"%PDF"

    def test_pdf_garbage_layout_returns_422(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/workers/{WORKER_ID}/id-card.pdf",
            params={"layout": "garbage"}, headers=auth_headers, timeout=20)
        assert r.status_code == 422


# ─────────────── Public scan resolver ───────────────
class TestPublicScan:
    def test_scan_worker_public_ok(self):
        r = requests.get(f"{BASE_URL}/api/scan/worker/{SCAN_TOKEN}", timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        expected_keys = {"id", "name", "role", "trade", "company", "scan_token",
                         "certifications", "assigned_swms", "active_site_today"}
        missing = expected_keys - set(body.keys())
        assert not missing, f"missing keys: {missing}"
        assert body["scan_token"] == SCAN_TOKEN
        assert body["name"] and body["name"] != "Worker"
        assert isinstance(body["certifications"], list)
        assert isinstance(body["assigned_swms"], list)

    def test_scan_worker_invalid_token_404(self):
        r = requests.get(f"{BASE_URL}/api/scan/worker/NOPE-doesnotexist",
                         timeout=20)
        assert r.status_code == 404


# ─────────────── Site Sign-In ───────────────
class TestSiteSignIn:
    def test_signin_requires_auth(self):
        r = requests.post(
            f"{BASE_URL}/api/scan/worker/{SCAN_TOKEN}/site-signin",
            json={"site_id": "site-test", "site_name": "Test Site",
                  "gps": {"lat": -33.86, "lng": 151.20}}, timeout=20)
        assert r.status_code == 401

    def test_signin_authed_writes_row(self, auth_headers):
        r = requests.post(
            f"{BASE_URL}/api/scan/worker/{SCAN_TOKEN}/site-signin",
            json={"site_id": "site-test-phase41",
                  "site_name": "Phase 4.1 Test Site",
                  "gps": {"lat": -33.86, "lng": 151.20}},
            headers=auth_headers, timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        row = body["signin"]
        assert row["source"] == "worker_qr"
        assert row["worker_name"] == "Stephen Guy"
        assert row["signed_in_by_user_id"]
        assert "workspace_id" in row  # may be None but key must be present


# ─────────────── NFC pairing ───────────────
class TestNfcPair:
    def test_nfc_pair_ok_then_dup_then_unpair(self, auth_headers):
        # Ensure a baseline UID on Stephen Guy
        uid = "04:A1:B2:C3:D4:E5"
        r = requests.post(
            f"{BASE_URL}/api/workers/{WORKER_ID}/nfc-pair",
            json={"nfc_uid": uid}, headers=auth_headers, timeout=20)
        assert r.status_code == 200, r.text
        assert r.json()["ok"] is True

        # Find another worker to test 409 collision
        wr = requests.get(f"{BASE_URL}/api/workers", headers=auth_headers, timeout=20)
        assert wr.status_code == 200
        items = wr.json()
        if isinstance(items, dict):
            items = items.get("items") or items.get("workers") or []
        other = next((w for w in items if w.get("id") != WORKER_ID), None)
        if other is None:
            pytest.skip("No second worker to test NFC collision")

        dup = requests.post(
            f"{BASE_URL}/api/workers/{other['id']}/nfc-pair",
            json={"nfc_uid": uid}, headers=auth_headers, timeout=20)
        assert dup.status_code == 409, f"expected 409 got {dup.status_code}: {dup.text}"

        # Unpair Stephen Guy
        d = requests.delete(
            f"{BASE_URL}/api/workers/{WORKER_ID}/nfc-pair",
            headers=auth_headers, timeout=20)
        assert d.status_code == 200
        assert d.json()["ok"] is True

        # Re-pair Stephen Guy to restore state for FE tests
        rr = requests.post(
            f"{BASE_URL}/api/workers/{WORKER_ID}/nfc-pair",
            json={"nfc_uid": uid}, headers=auth_headers, timeout=20)
        assert rr.status_code == 200


# ─────────────── Regression: asset scan still resolves ───────────────
class TestAssetScanRegression:
    def test_asset_scan_forms_still_resolves(self, auth_headers):
        # Asset scan forms requires auth; this test ensures the new
        # /scan/worker prefix didn't shadow /scan/{token}/forms.
        r = requests.get(f"{BASE_URL}/api/scan/{ASSET_SCAN_TOKEN}/forms",
                         headers=auth_headers, timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        forms = body.get("forms")
        assert isinstance(forms, list)
        assert len(forms) > 0

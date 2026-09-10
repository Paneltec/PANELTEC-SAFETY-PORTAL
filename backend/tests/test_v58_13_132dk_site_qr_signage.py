"""v58.13.132dk — Site QR Signage PDF endpoint + persistent public
resolver + FE Print QR Signage button (Admin only).
"""
from __future__ import annotations

import os
import re
from pathlib import Path

import pytest
import requests

APP_ROOT = Path(__file__).resolve().parents[2]
MOD = APP_ROOT / "backend" / "sites_qr_v132dk.py"
SITES_JSX = APP_ROOT / "frontend" / "src" / "pages" / "SitesAdmin.jsx"
VERSION_JS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"

API = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")


def _pin_login(pin="3310"):
    r = requests.post(f"{API}/api/auth/mobile/pin-login",
                      json={"pin": pin, "device_id": "pytest-132dk"})
    if r.status_code != 200:
        pytest.skip(f"PIN login unavailable ({r.status_code})")
    return {"Authorization": f"Bearer {r.json()['session_token']}"}


def _first_site_id(hdr):
    r = requests.get(f"{API}/api/sites", headers=hdr).json()
    return (r[0]["simpro_site_id"] if r else None)


# ─── Source guardrails ─────────────────────────────────────────

def test_only_signage_endpoint_exposed():
    src = MOD.read_text(encoding="utf-8")
    # A4 signage endpoint present.
    assert '@sites_router.get("/{site_id}/qr-signage.pdf")' in src
    # Simplified scope — no PNG / plain-PDF ENDPOINTS ship in .132dk
    # (mentions in the module docstring are fine).
    assert '@sites_router.get("/{site_id}/qr.png")' not in src
    assert '@sites_router.get("/{site_id}/qr.pdf")' not in src
    # Public resolver present.
    assert '@public_router.get("/{site_id}")' in src
    assert '/scan/site/' in src
    # Admin-only gate.
    assert "_require_site_admin(user)" in src
    # Never persists to disk.
    assert "StreamingResponse" in src
    assert "open(" not in src or "Reader(io.BytesIO" in src


def test_frontend_single_button_only():
    src = SITES_JSX.read_text(encoding="utf-8")
    # New button testid present.
    assert 'site-detail-print-qr-signage-' in src
    # Admin gate on the button.
    assert "canGenerateQr" in src
    assert "role_id" in src and "admin" in src
    # Hits the correct endpoint.
    assert "/qr-signage.pdf" in src


# ─── End-to-end (live server) ──────────────────────────────────

def test_signage_pdf_admin_200_valid_pdf():
    hdr = _pin_login()
    sid = _first_site_id(hdr)
    if not sid:
        pytest.skip("no sites in Stephen's org")
    r = requests.get(f"{API}/api/sites/{sid}/qr-signage.pdf",
                     headers=hdr)
    assert r.status_code == 200, r.text
    assert r.headers.get("content-type", "").startswith("application/pdf")
    assert r.content.startswith(b"%PDF-"), (
        f"invalid PDF header: {r.content[:8]}"
    )
    # Sensible size (~10 KB minimum for a page with an embedded QR).
    assert len(r.content) > 5_000


def test_signage_pdf_unknown_site_404():
    hdr = _pin_login()
    r = requests.get(f"{API}/api/sites/no-such-site-id/qr-signage.pdf",
                     headers=hdr)
    assert r.status_code == 404


def test_public_resolver_302_to_scan_flow():
    """No auth required; must 302 to /scan/site/<token>."""
    hdr = _pin_login()
    sid = _first_site_id(hdr)
    if not sid:
        pytest.skip("no sites in Stephen's org")
    # No auth header — this endpoint is public.
    r = requests.get(f"{API}/api/sign-on/{sid}", allow_redirects=False)
    assert r.status_code == 302, r.text
    loc = r.headers.get("location", "")
    assert loc.startswith("/scan/site/"), f"unexpected redirect: {loc!r}"


def test_public_resolver_unknown_site_404():
    r = requests.get(f"{API}/api/sign-on/no-such-site-id",
                     allow_redirects=False)
    assert r.status_code == 404


# ─── Version sync ─────────────────────────────────────────────

def test_three_way_sync_at_132dk_or_later():
    running = re.search(r"^export const RUNNING_VERSION = '([^']+)'",
                        VERSION_JS.read_text(), re.MULTILINE).group(1)
    expected = re.search(r"^export const EXPECTED_CACHE_VERSION = '([^']+)'",
                         VERSION_JS.read_text(), re.MULTILINE).group(1)
    cache = re.search(r"^const CACHE_VERSION = '([^']+)'",
                      SW.read_text(), re.MULTILINE).group(1)
    assert running == expected == cache
    tail = re.search(r"132([a-z]+)", running).group(1)
    assert tail >= "dk"

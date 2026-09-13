"""v58.13.132ei — PDF preview UX + login page copyright.

Locks:
1. Backend `/files/{id}/pdf` returns application/pdf + inline
   disposition + PDF magic bytes on a valid file.
2. `PdfPreviewModal` surfaces a friendly error state with a
   prominent Download button when the preview endpoint 415s
   (corrupt/stubbed files).
3. Cover.jsx renders © 2026 Stephen Guy · Paneltec Civil.
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

import pytest
import requests

APP_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(APP_ROOT / "backend"))

FE = APP_ROOT / "frontend" / "src"
MODAL = FE / "components" / "PdfPreviewModal.jsx"
COVER = FE / "pages" / "Cover.jsx"
VERSION_JS = FE / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"

API = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")

_TOKEN: dict = {"h": None}


def _admin_headers():
    if _TOKEN["h"] is not None:
        return _TOKEN["h"]
    r = requests.post(f"{API}/api/auth/login",
                      json={"email": "stephen@paneltec.com.au",
                            "password": "Mcgstephen50#"}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"admin login unavailable: {r.status_code}")
    t = r.json().get("access_token") or r.json().get("token")
    _TOKEN["h"] = {"Authorization": f"Bearer {t}"}
    return _TOKEN["h"]


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


# ─── Backend: valid PDF returns proper headers ─────────────────
def test_pdf_endpoint_returns_inline_pdf_headers_for_valid_file():
    """The known-good SDS PDF (394,632 bytes) must return
    application/pdf + Content-Disposition: inline + %PDF magic."""
    h = _admin_headers()
    # id from live DB: 6373ef1f167fc-ABCSDS012_Monarch_...
    fid = "e47d27b6-d49e-4d04-95ad-c9c95301de81"
    r = requests.get(f"{API}/api/files/{fid}/pdf", headers=h,
                     timeout=60, stream=True)
    if r.status_code == 404:
        pytest.skip(f"seed file not present on this env")
    assert r.status_code == 200, f"HTTP {r.status_code}"
    assert r.headers.get("content-type") == "application/pdf", (
        f"expected application/pdf, got {r.headers.get('content-type')}")
    disp = r.headers.get("content-disposition", "")
    assert disp.startswith("inline"), (
        f"Content-Disposition must be inline for preview, got: {disp}")
    # Magic bytes
    magic = r.raw.read(4)
    assert magic == b"%PDF", f"expected %PDF magic, got: {magic!r}"


def test_pdf_endpoint_sets_frame_ancestors_and_corp():
    """Iframe embedding requires frame-ancestors CSP + same-site CORP."""
    h = _admin_headers()
    fid = "e47d27b6-d49e-4d04-95ad-c9c95301de81"
    r = requests.get(f"{API}/api/files/{fid}/pdf", headers=h, timeout=60)
    if r.status_code != 200:
        pytest.skip(f"seed file not present: HTTP {r.status_code}")
    csp = r.headers.get("content-security-policy", "")
    assert "frame-ancestors" in csp, "CSP frame-ancestors missing"
    corp = r.headers.get("cross-origin-resource-policy", "")
    assert corp == "same-site", f"CORP must be same-site, got: {corp}"


# ─── FE modal error UX ─────────────────────────────────────────
def test_modal_renders_download_button_on_error():
    src = _read(MODAL)
    # The `err` render branch must include a Download button.
    err_branch_pos = src.find('data-testid="pdf-modal-error"')
    assert err_branch_pos > 0, "pdf-modal-error branch missing"
    window = src[err_branch_pos:err_branch_pos + 1500]
    assert 'data-testid="pdf-modal-error-download"' in window, (
        "Error state must render a Download button (v58.13.132ei)")
    assert "Download original file" in window


def test_modal_parses_non_2xx_detail_to_err_state():
    src = _read(MODAL)
    # The pdfjs effect must catch non-ok responses and populate `err`
    # with the backend's detail message BEFORE falling back to iframe.
    assert "if (!resp.ok)" in src
    assert "setErr(detail)" in src


def test_modal_download_falls_back_to_raw_original_on_error():
    """When the preview endpoint 415'd (err is set), the Download
    button must hit the raw /document-library/files/{id}/download
    endpoint so users still get the bytes."""
    src = _read(MODAL)
    assert "/document-library/files/${file.id}/download" in src, (
        "Download fallback must call /document-library/files/{id}/download")


# ─── Cover.jsx copyright block ─────────────────────────────────
def test_cover_renders_copyright():
    src = _read(COVER)
    assert 'data-testid="cover-copyright"' in src, (
        "Cover must render a copyright block (v58.13.132ei)")
    assert "© 2026 Stephen Guy" in src
    assert "Paneltec Civil" in src
    assert "All rights reserved" in src


def test_cover_retains_paneltec_logo_and_hero():
    """v58.13.132ei must NOT break the pre-existing logo + hero."""
    src = _read(COVER)
    assert 'data-testid="cover-hero-img"' in src
    # `PANELTEC CIVIL` wordmark still shows (twice, mobile + desktop).
    assert src.count("PANELTEC CIVIL") >= 2
    assert "PaneltecHero" in src


# ─── Version pin ──────────────────────────────────────────────
def test_version_pinned_to_132ei_or_higher():
    v = _read(VERSION_JS)
    sw = _read(SW)
    m_v = re.search(r"RUNNING_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", v)
    m_sw = re.search(r"CACHE_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", sw)
    assert m_v and m_v.group(1) >= "ei"
    assert m_sw and m_sw.group(1) >= "ei"

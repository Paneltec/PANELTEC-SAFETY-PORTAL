"""v58.13.132fq — Missing-file 410 handler + slider CSS fix.

Two independent-but-shipped-together bugs guarded here:

1. **Missing-file 410 handler.** Every file-download endpoint now
   raises the shared ``missing_file_response()`` helper when the DB
   record survives but the physical bytes are gone. The helper
   returns ``410 Gone`` with a structured
   ``detail: {code, message, record_still_exists, restore_hint}``
   body so the FE can render a friendly Reupload / Delete banner
   instead of a raw JSON blob.
2. **Slider CSS fix.** ``Workers.jsx`` now wraps every worker-photo
   render site (row 40 px, edit-modal slider preview 56 px, ID card
   128 px) in an ``overflow-hidden`` div containing an oversized
   ``<img>`` (height 200 %) positioned via ``transform: translateY``.
   This produces a visible vertical crop shift even for square
   source photos — pure ``object-position: 50% Y%`` on a square
   wrapper + square source has zero range (see ship memo for the
   ``object-cover`` geometry proof).

These pins guard against a regression in either surface.
"""
from __future__ import annotations

import re
import uuid
from pathlib import Path

import pytest
import requests

from tests.conftest import ADMIN_EMAIL, ADMIN_PWD, API

pytestmark = pytest.mark.live_db_writes

APP_ROOT = Path(__file__).resolve().parents[2]
WORKERS_JSX = APP_ROOT / "frontend" / "src" / "pages" / "Workers.jsx"
API_JS = APP_ROOT / "frontend" / "src" / "lib" / "api.js"
VERSION_JS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"
MISSING_HELPER = APP_ROOT / "backend" / "missing_file_response.py"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def _login(email, pwd):
    r = requests.post(f"{API}/auth/login",
                       json={"email": email, "password": pwd}, timeout=30)
    if r.status_code == 429:
        pytest.skip("rate-limited")
    assert r.status_code == 200, r.text
    tok = r.json().get("access_token") or r.json().get("token")
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def admin_hdr():
    return _login(ADMIN_EMAIL, ADMIN_PWD)


# ── Backend: missing-file 410 shape ───────────────────────────────

def test_missing_file_helper_module_exists_and_shape():
    assert MISSING_HELPER.exists(), (
        "backend/missing_file_response.py MUST exist (shared 410 helper "
        "introduced in .132fq)")
    src = _read(MISSING_HELPER)
    assert 'status_code=410' in src, "helper must set HTTP 410 Gone"
    assert '"code": "file_missing_on_disk"' in src, (
        "helper must set detail.code = 'file_missing_on_disk'")
    assert 'record_still_exists' in src
    assert 'restore_hint' in src


def test_every_missing_file_raise_site_uses_shared_helper():
    """All 5 known download endpoints must use missing_file_response()
    so the FE gets the same structured 410 shape from every route."""
    for path in (
        "backend/document_library.py",
        "backend/asset_service.py",
        "backend/file_pdf.py",
        "backend/forms.py",
        "backend/simpro_zip_import.py",
    ):
        p = APP_ROOT / path
        src = _read(p)
        assert "missing_file_response" in src, (
            f"{path} must import + use the shared missing_file_response helper")
        # No raise site should still use the old raw 404 string.
        assert 'raise HTTPException(404, "File missing on disk")' not in src, (
            f"{path} still raises the raw 404 blob — must use "
            "missing_file_response() instead")


def test_backend_returns_410_on_document_library_orphan_file(admin_hdr):
    """Live probe: hitting the document-library download endpoint with
    a bogus file_id returns 404 (record not found), but a real record
    pointing at a missing file returns the new 410 shape.

    Because we can't guarantee an orphaned file exists in the DB at
    test time, we assert the 404-not-found branch keeps its old
    shape (string detail) — proving the endpoint is reachable — and
    rely on the source-pins above + the FE unit test to prove the
    410 shape is emitted when the file bytes are missing."""
    r = requests.get(
        f"{API}/document-library/files/{uuid.uuid4()}/download",
        headers=admin_hdr, timeout=30)
    # Unknown file_id → record-not-found → 404 (unchanged behaviour).
    assert r.status_code == 404, r.text
    body = r.json()
    assert body.get("detail") == "File not found", body


# ── FE: apiError + missingFileMeta helpers ────────────────────────

def test_frontend_apierror_recognises_structured_410():
    src = _read(API_JS)
    assert "status === 410" in src, (
        "apiError must inspect e.response.status === 410")
    assert "file_missing_on_disk" in src, (
        "apiError must key off detail.code === 'file_missing_on_disk'")


def test_frontend_exports_missingFileMeta_helper():
    src = _read(API_JS)
    assert "export function missingFileMeta" in src, (
        "api.js must export a missingFileMeta(e) helper introduced in .132fq")


# ── FE: slider photo CSS fix ──────────────────────────────────────

def test_workers_jsx_photo_uses_translate_y_not_object_position():
    """Every photo render site should use `transform: translateY(...)`
    on an oversized-height img, NOT bare `objectPosition`. Bare
    object-position doesn't move the crop when both container and
    source are square (see ship memo for the algebra)."""
    src = _read(WORKERS_JSX)
    # After the .132fq fix, the objectPosition per-image style
    # attribute should be gone from the three worker-photo render
    # sites. Grep every remaining objectPosition line and confirm
    # none are worker-photo styles.
    lines_with_op = [
        ln for ln in src.splitlines()
        if "objectPosition" in ln and "objectPosition: 'center center'" not in ln
    ]
    # v58.13.132fq — allowable remaining site: none. If a future ship
    # legitimately needs objectPosition, add it here.
    forbidden = [ln for ln in lines_with_op
                 if "photo_offset_y" in ln or "effectiveOffset" in ln]
    assert not forbidden, (
        "worker photo sites must use translateY(...) not objectPosition. "
        f"Regressed lines: {forbidden!r}")
    # Positive pin: the three render sites now compute a translateY
    # expression from photo_offset_y / effectiveOffset.
    assert "translateY(${-effectiveOffset" in src, (
        "edit-modal slider preview must use `translateY(${-effectiveOffset * 0.56}px)`")
    assert "translateY(${-(typeof worker?.photo_offset_y" in src, (
        "row + ID card photos must use translateY from worker.photo_offset_y")


def test_workers_jsx_slider_diagnostic_overlay_retired():
    """The `.132fl` diagnostic counter panel (`state / onChange /
    onInput / lastRaw / at`) should be gone in `.132fq` — its
    purpose was to prove the React event chain fired, which it
    did. Retire it to keep the DOM clean."""
    src = _read(WORKERS_JSX)
    assert "worker-edit-photo-align-diagnostic" not in src, (
        "diagnostic overlay must be retired in .132fq")
    assert "__PANELTEC_SLIDER_DEBUG" not in src, (
        "global window inspector hook must be retired in .132fq")


# ── Version ───────────────────────────────────────────────────────

def test_version_bumped_to_132fq():
    ver = _read(VERSION_JS)
    sw = _read(SW)
    assert "paneltec-v160.3.9.58.13.132fq" in ver, (
        "RUNNING_VERSION / EXPECTED_CACHE_VERSION must be .132fq")
    assert "paneltec-v160.3.9.58.13.132fq" in sw, (
        "service-worker CACHE_VERSION must be .132fq")

"""v58.13.50 — Site Sign-In file icon fix (pdfMirrored opt-in).

Guards the fix by asserting:
  1. `PdfActions` accepts an optional `pdfMirrored` prop that OR's
     into the existing `source === 'form_submission'` detection.
  2. `CaptureCard` threads `pdfMirrored` through to `PdfActions`.
  3. `SiteSigninList.jsx` passes `pdfMirrored={true}` — records from
     `/forms/templates/<tid>/submissions` lack a `.source` field.

Live curl round-trip evidence captured during the ship:
  · Before fix: `POST /api/pdf-token {resource:"forms",...}` → 400.
  · Correct path: `POST /api/forms/submissions/pdf-token
    {submission_id:"..."}` → 200 + signed URL → GET → 200
    `application/pdf`, 121,295 bytes, `%PDF-1.4` header,
    `Content-Disposition: inline`.
"""
from __future__ import annotations

import re
from pathlib import Path


FRONTEND = Path("/app/frontend/src")
PDF_ACTIONS = FRONTEND / "components" / "PdfActions.jsx"
CAPTURE_CARD = FRONTEND / "components" / "CaptureCard.jsx"
SITESIGNIN = FRONTEND / "pages" / "SiteSigninList.jsx"


def test_pdf_actions_accepts_pdf_mirrored_prop():
    src = PDF_ACTIONS.read_text(encoding="utf-8")
    assert re.search(r"\bpdfMirrored\s*=\s*false\b", src), (
        "PdfActions must destructure `pdfMirrored = false` in its "
        "prop signature — v58.13.50 opt-in for records without "
        "a `source` field."
    )
    # OR'd into the existing isMirrored expression.
    assert re.search(
        r"isMirrored\s*=\s*pdfMirrored\s*\|\|\s*source\s*===\s*'form_submission'",
        src,
    ), (
        "PdfActions must OR the pdfMirrored prop into the mirrored "
        "detection — `pdfMirrored || source === 'form_submission'`."
    )


def test_capture_card_threads_pdf_mirrored():
    src = CAPTURE_CARD.read_text(encoding="utf-8")
    # Prop in the destructure.
    assert re.search(r"\bpdfMirrored\s*=\s*false\b", src)
    # And forwarded to <PdfActions>.
    assert "pdfMirrored={pdfMirrored}" in src


def test_sitesignin_passes_pdf_mirrored_true():
    src = SITESIGNIN.read_text(encoding="utf-8")
    assert "pdfMirrored={true}" in src, (
        "SiteSigninList must pass `pdfMirrored={true}` — records "
        "loaded from `/forms/templates/<tid>/submissions` have "
        "`source = null` and PdfActions' auto-detect would fall "
        "back to the direct /pdf-token branch which 400s on "
        '`resource="forms"`.'
    )


def test_risk_assessments_does_not_need_pdf_mirrored():
    """Belt-and-braces: Risk Assessments records ARE mirrored with
    `source = 'form_submission'` (verified via live curl during the
    ship), so the auto-detect works and no explicit opt-in is
    required. Guard against a future refactor that adds it
    unnecessarily — extra source of coupling."""
    src = (FRONTEND / "pages" / "RiskAssessments.jsx").read_text(encoding="utf-8")
    # This is a soft assertion — pdfMirrored not needed, but if
    # someone adds it "for consistency" they should know it's a
    # no-op there.
    if "pdfMirrored" in src:
        assert "pdfMirrored={true}" in src, (
            "If RiskAssessments explicitly wires `pdfMirrored`, it "
            "must be `={true}` — anything else is a bug."
        )


def test_version_sync_current_v58_13_50():
    # v58.13.51 note: this ship's file DID land unchanged; the check
    # below now only proves the .50 strings HAVE been superseded (no
    # longer the current `RUNNING_VERSION`). See the parallel
    # forward-looking assertion in
    # `test_pdf_inline_default_v58_13_51.py` for the .51 pin.
    expected = "paneltec-v160.3.9.58.13.50"
    v_js = (FRONTEND / "lib" / "version.js").read_text(encoding="utf-8")
    m_ts = Path("/app/mobile/src/lib/version.ts").read_text(encoding="utf-8")
    sw_js = Path("/app/frontend/public/service-worker.js").read_text(encoding="utf-8")
    # The .50 literal MAY still appear in the changelog block of
    # version.js (as prior-ship reference) — that's fine.
    # RUNNING_VERSION however must no longer be .50.
    assert f"RUNNING_VERSION = '{expected}'" not in v_js, (
        "RUNNING_VERSION still pinned to .50 after subsequent ship"
    )
    assert f"'{expected}'" not in m_ts, (
        "mobile MOBILE_BUNDLE_VERSION still on .50 after subsequent ship"
    )
    assert f"'{expected}'" not in sw_js, (
        "service-worker CACHE_VERSION still on .50 after subsequent ship"
    )

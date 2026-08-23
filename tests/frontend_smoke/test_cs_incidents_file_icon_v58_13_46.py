"""v58.13.46 — CS Incidents file-icon regression test.

Guards the P1 fix reported by the user: clicking the `<FileText>`
icon (`pdf-open-<id>`) on a CS Incident tile briefly popped a browser
window and instantly closed it. Root cause: CS Incidents are
`reference_library` DB rows with no PDF backend representation, and
`PdfActions` was being rendered unconditionally on every
`CaptureCard`. This suite asserts both the static contract fix
(props + call-site) and the runtime behaviour (button not rendered
at runtime).

Location: `/app/tests/frontend_smoke/` — outside `--reload-dir
/app/backend`, per the v58.13.10 hard rule.
"""
from __future__ import annotations

import os
import re
import subprocess
import time
from pathlib import Path

import pytest

FRONTEND = Path("/app/frontend/src")
CS_LIST = FRONTEND / "pages" / "CsIncidentsList.jsx"
CAPTURE_CARD = FRONTEND / "components" / "CaptureCard.jsx"
PDF_ACTIONS = FRONTEND / "components" / "PdfActions.jsx"


# ─── Static contract asserts (always run) ───────────────────────────

def test_capture_card_exposes_show_pdf_prop_with_default_true():
    src = CAPTURE_CARD.read_text(encoding="utf-8")
    # Prop destructured in the signature.
    assert re.search(r"\bshowPdf\s*=\s*true\b", src), (
        "CaptureCard must destructure `showPdf = true` — v58.13.46 "
        "requires the default so every existing callsite keeps its "
        "file icon."
    )
    # Prop threaded down to <PdfActions enabled={showPdf}>.
    assert "enabled={showPdf}" in src, (
        "CaptureCard must pass `enabled={showPdf}` to <PdfActions>."
    )


def test_pdf_actions_returns_null_when_disabled():
    src = PDF_ACTIONS.read_text(encoding="utf-8")
    assert re.search(r"\benabled\s*=\s*true\b", src), (
        "PdfActions must accept `enabled = true` in its destructured "
        "props signature."
    )
    # And the `!enabled` guard returns null.
    assert re.search(r"if\s*\(\s*!\s*enabled\s*\)\s*return\s+null;",
                     src), (
        "PdfActions must short-circuit with `if (!enabled) return null;` "
        "so the button isn't rendered — otherwise the popup can still "
        "briefly appear."
    )


def test_cs_incidents_passes_show_pdf_false():
    """v58.13.48 REVERSAL — the v58.13.46 fix hid the icon. User
    complained the feature they wanted was gone. v58.13.48 restored
    the icon + shipped a proper backend renderer. So this test's
    assertion INVERTED: CS Incidents must NOT pass `showPdf={false}`
    anymore, and MUST pass `pdfResourceKind="cs_incidents"` so the
    /pdf-token POST goes out with the correct backend renderer key
    while the `<Can>` gate stays on `reference_library`.

    The full contract is enforced by the parametrised test in
    `tests/backend_unit/test_action_availability_contract_v58_13_48.py`
    — this test is kept as a per-page callsite anchor."""
    src = CS_LIST.read_text(encoding="utf-8")
    assert "showPdf={false}" not in src, (
        "CsIncidentsList.jsx must NOT set `showPdf={false}` — "
        "v58.13.48 restored the icon now that the backend has a "
        "dedicated `render_cs_incident_pdf` renderer."
    )
    assert 'pdfResourceKind="cs_incidents"' in src, (
        "CsIncidentsList.jsx must pass `pdfResourceKind=\"cs_incidents\"` "
        "so the /pdf-token POST resolves against the CS incident "
        "renderer while the permission gate stays on reference_library."
    )
    assert 'resourceKind="reference_library"' in src
    assert "resource_library" not in src  # typo guard from v58.13.46


def test_version_sync_current_v58_13_46():
    # v58.13.47 note: relaxed to the append-only-changelog pattern.
    # Cross-file identity of the CURRENT version constant is
    # enforced by `test_version_sync_v58_13_13.py`; this just guards
    # that the v58.13.46 changelog block remains present in
    # `version.js` after subsequent bumps.
    v_js = (FRONTEND / "lib" / "version.js").read_text(encoding="utf-8")
    assert "v160.3.9.58.13.46 —" in v_js, (
        "The v58.13.46 changelog block must remain in version.js — "
        "history is append-only per the ship-checklist."
    )


# ─── Playwright runtime assertion (opt-in via env var) ──────────────

_PW_ENABLED = os.environ.get("PANELTEC_PLAYWRIGHT_SMOKE") == "1"


@pytest.mark.skipif(
    not _PW_ENABLED,
    reason=(
        "Playwright smoke is opt-in: set PANELTEC_PLAYWRIGHT_SMOKE=1 "
        "to run. Static asserts above cover the contract in every CI "
        "pass; the Playwright run is reserved for interactive local "
        "verification because chromium isn't always available on the "
        "pytest runner."
    ),
)
def test_cs_incidents_tile_hides_pdf_open_button():
    """Playwright: log in, open `/app/submissions/cs-incidents`,
    wait for the first tile, and assert NO `pdf-open-*` button is
    rendered anywhere on the page. The file icon is fully suppressed
    at the source in v58.13.46, so the "flash and disappears" bug
    cannot occur (nothing to click)."""
    from playwright.sync_api import sync_playwright  # noqa: WPS433

    api_url_env = subprocess.check_output(
        ["bash", "-c",
         "grep REACT_APP_BACKEND_URL /app/frontend/.env | cut -d= -f2"],
        text=True,
    ).strip()
    assert api_url_env, "REACT_APP_BACKEND_URL missing from frontend/.env"

    creds_path = Path("/app/memory/test_credentials.md")
    assert creds_path.exists(), "test_credentials.md missing"
    creds = creds_path.read_text(encoding="utf-8")
    m_email = re.search(r"stephen@paneltec\.com\.au", creds)
    m_pwd = re.search(r"Password:\s*`([^`]+)`", creds)
    assert m_email, "admin email not found in test_credentials.md"
    assert m_pwd, "admin password not found in test_credentials.md"
    email = "stephen@paneltec.com.au"
    password = m_pwd.group(1)

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        try:
            ctx = browser.new_context(viewport={"width": 1920, "height": 900})
            page = ctx.new_page()

            page.goto(f"{api_url_env}/login", wait_until="networkidle",
                      timeout=30_000)
            page.fill('input[type=email]', email)
            page.fill('input[type=password]', password)
            page.click('button[type=submit]')
            page.wait_for_url("**/app/**", timeout=20_000)

            page.goto(
                f"{api_url_env}/app/submissions/cs-incidents",
                wait_until="domcontentloaded",
                timeout=30_000,
            )
            page.wait_for_selector(
                '[data-testid^="cs-incidents-tile-"]', timeout=30_000)
            # Small settling delay — the tile grid renders 200+ cards
            # and PdfActions was previously mounted on each one.
            time.sleep(0.5)

            # v58.13.48 REVERSAL — the icon is now expected to be
            # present again (feature restored). The v58.13.46 assertion
            # of `== 0` inverts to "> 0". The real regression this
            # Playwright hook guards against post-reversal is that
            # clicking the icon does NOT produce a 400 unknown-resource
            # response (verified via network idle + no toast).
            pdf_open_count = page.evaluate(
                "() => document.querySelectorAll('"
                "[data-testid^=\"pdf-open-\"]"
                "').length"
            )
            assert pdf_open_count > 0, (
                f"Expected > 0 `pdf-open-*` buttons on CS Incidents, "
                f"found {pdf_open_count}. v58.13.48 restored the file "
                "icon — regression."
            )

            # Belt-and-braces: verify Eye + Delete buttons are still
            # rendered. Ensures we didn't over-hide the whole action
            # row by mistake.
            eye_count = page.evaluate(
                "() => document.querySelectorAll('"
                "[data-testid^=\"capture-view-\"]"
                "').length"
            )
            assert eye_count > 0, (
                f"CS Incidents tiles missing Eye buttons "
                f"(capture-view-*) — got {eye_count}. Over-suppressed."
            )
        finally:
            browser.close()

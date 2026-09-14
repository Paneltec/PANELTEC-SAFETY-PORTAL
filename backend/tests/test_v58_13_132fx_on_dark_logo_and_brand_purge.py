"""v58.13.132fx — On-dark logo sweep + Paneltec Civil brand purge."""
from __future__ import annotations

from pathlib import Path

import pytest
import requests

from tests.conftest import ADMIN_EMAIL, ADMIN_PWD, API

pytestmark = pytest.mark.live_db_writes

APP_ROOT = Path(__file__).resolve().parents[2]
PDF_CHROME = APP_ROOT / "backend" / "pdf_chrome.py"
FORMS_PDF = APP_ROOT / "backend" / "forms_pdf.py"
VERSION_JS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"
BRAND_DIR = APP_ROOT / "frontend" / "public" / "brand"

# Every backend file that had a user-facing PANELTEC CIVIL / Paneltec
# Civil string swept in .132fx. Comments / seed data / role labels
# for the actual "Paneltec Civil" business unit are intentionally
# NOT changed — those are internal identifiers, not brand strings.
SWEEPED = (
    "backend/pdf_chrome.py", "backend/pdf_template.py",
    "backend/pdf_renderer.py", "backend/suppliers_qr.py",
    "backend/worker_certifications.py", "backend/form_assignment_notifier.py",
    "backend/pdf_card_template.py", "backend/sites_qr.py",
    "backend/sites_qr_v132dk.py", "backend/email_outbox.py",
    "backend/help_routes.py", "backend/sites_signon_v127.py",
    "backend/mobile_onboarding_cards.py", "backend/assets.py",
    "backend/auth_invite.py", "backend/exports.py",
    "backend/fleet_fuel_reports.py", "backend/fleet_service_sheet_pdf.py",
    "backend/forms_pdf.py", "backend/integrations_m365.py",
)


def _read(p): return (APP_ROOT / p).read_text(encoding="utf-8")


def test_pdf_chrome_uses_on_dark_wordmark_on_navy_header():
    src = _read("backend/pdf_chrome.py")
    assert "logo-wordmark-white-960.png" in src, (
        "PDF chrome banner (navy header) must use the on-dark logo variant")
    assert 'drawString(MARGIN_MM * mm, h - band_h + 3 * mm, "GROUP")' in src, (
        "wordmark fallback text must say GROUP not CIVIL")


def test_white_wordmark_png_exists():
    assert (BRAND_DIR / "logo-wordmark-white-960.png").exists()


def test_no_user_facing_paneltec_civil_strings_remain_in_swept_files():
    # Files whose only remaining hits live in the module docstring
    # (developer prose describing the `layout='civil'` kwarg / the
    # historical origin of the template). Not user-facing.
    docstring_only = {"backend/pdf_renderer.py", "backend/pdf_template.py"}
    for p in SWEEPED:
        if p in docstring_only:
            continue
        src = _read(p)
        for line_no, line in enumerate(src.splitlines(), start=1):
            stripped = line.lstrip()
            if stripped.startswith("#"):
                continue
            for bad in ("PANELTEC CIVIL", "Paneltec Civil", "Panel tec Civil"):
                assert bad not in line, (
                    f"user-facing {bad!r} still present in {p}:{line_no} — {line.strip()!r}")


def test_forms_pdf_footer_reads_the_paneltec_group():
    src = _read("backend/forms_pdf.py")
    assert "· The Paneltec Group" in src, (
        "submission PDF footer must read '· The Paneltec Group'")
    assert "· Paneltec Civil" not in src


def test_live_submission_pdf_carries_new_footer_and_no_civil_string():
    r = requests.post(f"{API}/auth/login",
                       json={"email": ADMIN_EMAIL, "password": ADMIN_PWD}, timeout=30)
    if r.status_code == 429:
        pytest.skip("rate-limited")
    tok = r.json()["access_token"]
    r = requests.get(
        f"{API}/forms/submissions/8e063ac5-e82e-46ce-8ddf-24aec3602ffa/pdf",
        headers={"Authorization": f"Bearer {tok}"}, timeout=60)
    assert r.status_code == 200, r.text[:200]
    # Extract text via pdftotext.
    import subprocess, tempfile, os
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tf:
        tf.write(r.content); tmp = tf.name
    try:
        out = subprocess.run(["pdftotext", tmp, "-"], capture_output=True, text=True).stdout
    finally:
        os.unlink(tmp)
    assert "PANELTEC CIVIL" not in out, "live PDF still contains PANELTEC CIVIL"
    assert "Paneltec Civil" not in out, "live PDF still contains Paneltec Civil"
    assert ("The Paneltec Group" in out) or ("THE PANELTEC GROUP" in out), (
        "live PDF must render the new 'The Paneltec Group' brand string")


def test_version_bumped_to_132fx():
    assert "paneltec-v160.3.9.58.13.132fx" in _read("frontend/src/lib/version.js")
    assert "paneltec-v160.3.9.58.13.132fx" in _read("frontend/public/service-worker.js")

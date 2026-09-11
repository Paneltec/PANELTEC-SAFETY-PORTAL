"""v58.13.132dp — Organisation Settings expansion.

Locks 5 items:
  1. Editable slug w/ validation + uniqueness + previous_slugs
     backward-compat.
  2. Portal URL rendered on PDF footer (via `pdf_chrome`).
  3. Additional org fields (trading_name, emergency contact,
     after-hours contact, website_url, insurance blocks).
  4. Insurance expiry helper — 30-day warning, 7-day critical.
  5. Frontend elevated card + IMPORTANT chip + emphasis banner.
"""
from __future__ import annotations

import io
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import requests

APP_ROOT = Path(__file__).resolve().parents[2]
ORG_MOD = APP_ROOT / "backend" / "org_settings.py"
PDF_CHROME = APP_ROOT / "backend" / "pdf_chrome.py"
ORG_JSX = APP_ROOT / "frontend" / "src" / "pages" / "OrgSettings.jsx"
MODAL_JSX = APP_ROOT / "frontend" / "src" / "components" / "InsuranceCriticalModal.jsx"
APPSHELL_JSX = APP_ROOT / "frontend" / "src" / "components" / "layout" / "AppShell.jsx"
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


# ─── Source-pin: backend endpoints & shape ───────────────────────

def test_org_settings_source_pins():
    src = ORG_MOD.read_text(encoding="utf-8")
    assert "132dp" in src
    # New slug validation regex.
    assert 'SLUG_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")' in src
    # New endpoints.
    assert '@router.post("/insurance/{policy_type}/upload")' in src
    assert '@router.get("/insurance/{policy_type}/download")' in src
    assert '@router.post("/logo/upload")' in src
    assert '@router.get("/logo/{gridfs_id}")' in src
    # GridFS-only for uploads (no writes to disk).
    assert "AsyncIOMotorGridFSBucket" in src
    assert "UPLOAD_DIR" not in src
    # Insurance expiry helper.
    assert "def insurance_status(org: dict)" in src
    # New fields on the pydantic model.
    for f in ("trading_name", "emergency_contact_phone",
              "after_hours_contact_name", "after_hours_contact_phone",
              "website_url", "portal_url",
              "public_liability_insurance", "workers_comp_insurance"):
        assert f in src, f"Missing field: {f}"


def test_pdf_chrome_footer_renders_portal_url():
    src = PDF_CHROME.read_text(encoding="utf-8")
    assert "132dp" in src
    assert 'f"Portal: {portal}"' in src
    assert "PUBLIC_APP_URL" in src


def test_frontend_org_page_new_shape():
    src = ORG_JSX.read_text(encoding="utf-8")
    assert "132dp" in src
    # Confirm dialog + testids.
    assert 'data-testid="org-slug-confirm-modal"' in src
    assert 'data-testid="org-slug-confirm-continue"' in src
    assert 'data-testid="org-slug-surfaces"' in src
    # IMPORTANT chip + emphasis banner.
    assert 'data-testid="org-importance-chip"' in src
    assert 'data-testid="org-importance-banner"' in src
    # Insurance banner + blocks (blocks use `${kind}` template
    # literal — assert on the template pattern).
    assert 'data-testid="org-insurance-alerts"' in src
    assert 'org-insurance-block-${kind}' in src or 'org-insurance-block-public_liability' in src
    # Logo upload UI.
    assert 'data-testid="org-logo-upload-btn"' in src
    # New fields present (defined as `f.key` values on the FIELDS
    # arrays; testid rendered via `org-field-${f.key}` template).
    for key in ("trading_name",
                "emergency_contact_phone",
                "after_hours_contact_name",
                "after_hours_contact_phone",
                "website_url",
                "portal_url"):
        assert f"key: '{key}'" in src, f"Missing field key: {key}"
    assert "org-field-${f.key}" in src


def test_appshell_mounts_insurance_critical_modal():
    src = APPSHELL_JSX.read_text(encoding="utf-8")
    assert "InsuranceCriticalModal" in src
    assert "<InsuranceCriticalModal" in src
    # Modal source itself.
    ms = MODAL_JSX.read_text(encoding="utf-8")
    assert 'data-testid="insurance-critical-modal"' in ms
    assert "role !== 'admin'" in ms and "role_id !== 'admin'" in ms
    # Session-scoped ack.
    assert "sessionStorage" in ms


def test_three_way_version_sync_at_132dp():
    running = re.search(r"^export const RUNNING_VERSION = '([^']+)'",
                        VERSION_JS.read_text(), re.MULTILINE).group(1)
    expected = re.search(r"^export const EXPECTED_CACHE_VERSION = '([^']+)'",
                         VERSION_JS.read_text(), re.MULTILINE).group(1)
    cache = re.search(r"^const CACHE_VERSION = '([^']+)'",
                      SW.read_text(), re.MULTILINE).group(1)
    assert running == expected == cache
    tail = re.search(r"132([a-z]+)", running).group(1)
    assert tail >= "dp"


# ─── Behavioural: insurance_status helper ────────────────────────

def test_insurance_status_levels():
    import sys
    sys.path.insert(0, str(APP_ROOT / "backend"))
    from org_settings import insurance_status
    today = datetime.now(timezone.utc)
    org = {
        "public_liability_insurance": {
            "policy_number": "PL-123",
            "expiry_date": (today + timedelta(days=5)).strftime("%Y-%m-%d"),
        },
        "workers_comp_insurance": {
            "policy_number": "WC-456",
            "expiry_date": (today + timedelta(days=20)).strftime("%Y-%m-%d"),
        },
    }
    s = insurance_status(org)
    # PL: 5 days → critical
    assert s["public_liability"]["level"] == "critical"
    assert any(c["policy"] == "public_liability" for c in s["criticals"])
    # WC: 20 days → warning
    assert s["workers_comp"]["level"] == "warning"
    assert any(w["policy"] == "workers_comp" for w in s["warnings"])
    # ok case
    ok = insurance_status({
        "public_liability_insurance": {
            "expiry_date": (today + timedelta(days=180)).strftime("%Y-%m-%d"),
        }
    })
    assert ok["public_liability"]["level"] == "ok"
    assert ok["criticals"] == [] and ok["warnings"] == []
    # missing case
    empty = insurance_status({})
    assert empty["public_liability"]["level"] == "ok"


# ─── Behavioural: live PATCH / uploads ───────────────────────────

@pytest.mark.live_db_writes
def test_org_patch_new_fields_round_trip():
    hdr = _admin_headers()
    # GET baseline
    r0 = requests.get(f"{API}/api/org", headers=hdr, timeout=30)
    assert r0.status_code == 200
    base = r0.json()
    original = {
        "trading_name": base.get("trading_name"),
        "emergency_contact_phone": base.get("emergency_contact_phone"),
        "after_hours_contact_name": base.get("after_hours_contact_name"),
        "after_hours_contact_phone": base.get("after_hours_contact_phone"),
        "website_url": base.get("website_url"),
        "portal_url": base.get("portal_url"),
    }
    sample = {
        "trading_name": f"Paneltec Test {uuid.uuid4().hex[:6]}",
        "emergency_contact_phone": "+61-2-9999-0000",
        "after_hours_contact_name": "After-Hours Test",
        "after_hours_contact_phone": "+61-4-1111-2222",
        "website_url": "https://paneltec.example.com",
        "portal_url": "https://portal.paneltec.example.com",
    }
    r = requests.patch(f"{API}/api/org", json=sample, headers=hdr, timeout=30)
    assert r.status_code == 200, r.text
    got = r.json()
    for k, v in sample.items():
        assert got.get(k) == v
    # Portal URL default surfaces on subsequent GETs even after we
    # clear it (spec: "sensible fallback").
    # Restore original values (only non-None; None can't unset via PATCH).
    restore = {k: v for k, v in original.items() if v is not None}
    if restore:
        requests.patch(f"{API}/api/org", json=restore, headers=hdr, timeout=30)


@pytest.mark.live_db_writes
def test_slug_edit_validation_and_backward_compat():
    hdr = _admin_headers()
    r0 = requests.get(f"{API}/api/org", headers=hdr, timeout=30)
    original_slug = r0.json().get("slug")
    assert original_slug, "org must have a slug to run this test"

    # Invalid: uppercase.
    r = requests.patch(f"{API}/api/org", json={"slug": "BadSlug"},
                       headers=hdr, timeout=30)
    assert r.status_code == 400, r.text

    # Invalid: special char.
    r = requests.patch(f"{API}/api/org", json={"slug": "bad_slug!"},
                       headers=hdr, timeout=30)
    assert r.status_code == 400

    # Invalid: leading hyphen.
    r = requests.patch(f"{API}/api/org", json={"slug": "-bad"},
                       headers=hdr, timeout=30)
    assert r.status_code == 400

    # Valid: change slug, then restore.
    new_slug = f"pytest-slug-{uuid.uuid4().hex[:6]}"
    r = requests.patch(f"{API}/api/org", json={"slug": new_slug},
                       headers=hdr, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["slug"] == new_slug
    assert original_slug in (body.get("previous_slugs") or []), \
        f"Old slug {original_slug} not preserved in previous_slugs"

    # Restore original.
    r2 = requests.patch(f"{API}/api/org", json={"slug": original_slug},
                        headers=hdr, timeout=30)
    assert r2.status_code == 200
    body2 = r2.json()
    assert body2["slug"] == original_slug
    # `new_slug` should now be in previous_slugs too.
    assert new_slug in (body2.get("previous_slugs") or [])
    # v58.13.132dp — Prune the pytest-generated slug so previous_slugs
    # doesn't grow unbounded across CI runs. Direct DB write; the
    # public API deliberately doesn't offer a "forget previous slug"
    # endpoint.
    from pymongo import MongoClient  # noqa: WPS433
    db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    db.orgs.update_one(
        {"slug": original_slug},
        {"$pull": {"previous_slugs": {"$regex": "^pytest-slug-"}}},
    )


@pytest.mark.live_db_writes
def test_logo_upload_and_serve_via_gridfs():
    hdr = _admin_headers()
    # Minimal PNG payload (1x1 transparent).
    png = bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
        "890000000d49444154789c626001000000ffff030000060005e26dfb020000"
        "00004945" "4e44ae426082"
    )
    files = {"file": ("test-logo.png", io.BytesIO(png), "image/png")}
    r = requests.post(f"{API}/api/org/logo/upload",
                      files=files, headers=hdr, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["logo_url"].startswith("/api/org/logo/")
    gid = body["logo_gridfs_id"]
    # Fetch it back.
    r2 = requests.get(f"{API}/api/org/logo/{gid}",
                      headers=hdr, timeout=30)
    assert r2.status_code == 200
    assert r2.headers["content-type"].startswith("image/")


@pytest.mark.live_db_writes
def test_insurance_certificate_upload_and_download_gridfs():
    hdr = _admin_headers()
    # Minimal PDF (magic bytes only — enough to round-trip).
    pdf = b"%PDF-1.4\n%pytest\n%%EOF\n"
    for kind in ("public_liability", "workers_comp"):
        files = {"file": (f"{kind}-cert.pdf", io.BytesIO(pdf),
                          "application/pdf")}
        r = requests.post(f"{API}/api/org/insurance/{kind}/upload",
                          files=files, headers=hdr, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["policy_type"] == kind
        assert body["certificate_id"]
        # Download round-trip.
        r2 = requests.get(f"{API}/api/org/insurance/{kind}/download",
                          headers=hdr, timeout=30)
        assert r2.status_code == 200
        assert r2.content == pdf


def test_admin_only_guards_on_new_endpoints():
    """403 for anon (no auth header)."""
    # PATCH /org
    r1 = requests.patch(f"{API}/api/org", json={"trading_name": "x"},
                        timeout=15)
    assert r1.status_code in (401, 403)
    # Logo upload
    r2 = requests.post(f"{API}/api/org/logo/upload",
                       files={"file": ("x.png", b"x", "image/png")},
                       timeout=15)
    assert r2.status_code in (401, 403)
    # Insurance upload
    r3 = requests.post(f"{API}/api/org/insurance/public_liability/upload",
                       files={"file": ("x.pdf", b"x", "application/pdf")},
                       timeout=15)
    assert r3.status_code in (401, 403)


# ─── PDF footer renders Portal URL ───────────────────────────────

@pytest.mark.live_db_writes
def test_pdf_footer_carries_portal_url():
    """Instrument `BrandedCanvas.drawCentredString` to capture every
    string drawn during `_finalize_page`, then assert one of them is
    `Portal: <url>`. Much more reliable than grepping raw PDF bytes
    since ReportLab may split strings across kerning ops."""
    import sys
    sys.path.insert(0, str(APP_ROOT / "backend"))
    from pdf_chrome import BrandedDocTemplate, BrandedCanvas
    from reportlab.platypus import Paragraph
    from reportlab.lib.styles import getSampleStyleSheet

    captured: list[str] = []
    real = BrandedCanvas.drawCentredString

    def spy(self, x, y, text, *a, **kw):
        captured.append(str(text))
        return real(self, x, y, text, *a, **kw)

    portal = f"https://pytest-{uuid.uuid4().hex[:6]}.example.com"
    BrandedCanvas.drawCentredString = spy
    try:
        buf = io.BytesIO()
        doc = BrandedDocTemplate(
            buf, org={"name": "Pytest Org", "portal_url": portal},
            report_title="Pytest",
        )
        styles = getSampleStyleSheet()
        doc.build([Paragraph("Body", styles["BodyText"])])
    finally:
        BrandedCanvas.drawCentredString = real

    hit = [s for s in captured if s == f"Portal: {portal}"]
    assert hit, (
        f"Portal footer line not drawn. Captured: {captured[-5:]}")

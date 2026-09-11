"""v58.13.132dq — Insurance expansion + M365 email dispatch + Simpro
client picker + Portal URL copy button + certificate archive.

Locks:
  1. General Cover as 3rd insurance slot (mirrors PL/WC pattern).
  2. Certificate archive: uploads move old cert into
     `previous_certificates[]`; never delete from GridFS.
  3. History endpoints: list + download archived certs, admin-only.
  4. Email dispatch: recipients + certificate_types +
     archived_certificate_ids selections; falls back to MOCKED when
     M365 not configured; writes to `insurance_email_log`.
  5. Simpro customers/search wrapper for the recipient picker.
  6. Portal URL copy-to-clipboard button testid.
"""
from __future__ import annotations

import io
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch, AsyncMock

import pytest
import requests

APP_ROOT = Path(__file__).resolve().parents[2]
ORG_MOD = APP_ROOT / "backend" / "org_settings.py"
SIMPRO_MOD = APP_ROOT / "backend" / "integrations_simpro.py"
M365_MOD = APP_ROOT / "backend" / "integrations_m365.py"
ORG_JSX = APP_ROOT / "frontend" / "src" / "pages" / "OrgSettings.jsx"
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

def test_general_cover_wired_end_to_end():
    src = ORG_MOD.read_text(encoding="utf-8")
    assert "132dq" in src
    assert '("general_cover",' in src
    # v58.13.132dq (add-on) — 4th slot Professional Indemnity.
    assert '("professional_indemnity",' in src
    assert '"professional_indemnity"' in src  # in _INSURANCE_KINDS
    assert "general_cover_insurance:" in src
    assert "professional_indemnity_insurance:" in src
    # Merge loop covers all four kinds.
    assert '"general_cover_insurance"' in src
    assert '"professional_indemnity_insurance"' in src


def test_certificate_archive_source_pins():
    src = ORG_MOD.read_text(encoding="utf-8")
    # Archive helper writes into previous_certificates[].
    assert "previous_certificates" in src
    assert '"previous_certificates": prev_list' in src
    # Delete-from-GridFS on replace is REMOVED (audit compliance).
    assert "bucket.delete(ObjectId(existing[\"certificate_id\"]))" not in src
    # History endpoints registered.
    assert '@router.get("/insurance/{policy_type}/history")' in src
    assert '@router.get("/insurance/{policy_type}/history/{file_id}/download")' in src


def test_email_dispatch_endpoint_registered():
    src = ORG_MOD.read_text(encoding="utf-8")
    assert '@router.post("/insurance/email")' in src
    assert '@router.get("/insurance/email/log")' in src
    assert "class InsuranceEmailIn" in src
    assert "archived_certificate_ids" in src
    assert "graph_send_mail" in src
    assert "mocked" in src.lower()
    assert "insurance_email_log" in src


def test_m365_send_mail_supports_content_bytes():
    src = M365_MOD.read_text(encoding="utf-8")
    assert "132dq" in src
    assert "content_bytes" in src
    # Base64-encoded on the fly when raw bytes are supplied.
    assert 'base64.b64encode(bytes(raw))' in src


def test_simpro_customers_search_wrapper():
    src = SIMPRO_MOD.read_text(encoding="utf-8")
    assert "132dq" in src
    assert '@router.get("/customers/search")' in src


def test_frontend_org_page_new_features():
    src = ORG_JSX.read_text(encoding="utf-8")
    assert "132dq" in src
    # Portal URL copy button.
    assert 'data-testid="org-portal-url-copy-btn"' in src
    # Email Certificates button.
    assert 'data-testid="org-email-certs-btn"' in src
    # Email modal + Simpro picker + certificate kinds + archived
    # cert selection. Kind-specific testids use `${kind}` template
    # so we assert the template pattern rather than each rendered id.
    for tid in ("insurance-email-modal",
                "insurance-email-simpro-search",
                "insurance-email-custom-recipient",
                "insurance-email-preamble",
                "insurance-email-send",
                "insurance-email-audit-log"):
        assert tid in src, f"Missing testid: {tid}"
    assert "insurance-email-cert-${kind}" in src
    # Past certs collapsible under each block.
    assert "org-insurance-history-toggle-" in src
    # General Cover + Professional Indemnity blocks rendered.
    assert 'kind="general_cover"' in src
    assert 'kind="professional_indemnity"' in src
    # 4th kind wired into the Email popup kinds[] list.
    assert "'professional_indemnity'" in src or '"professional_indemnity"' in src


def test_three_way_version_sync_at_132dq():
    running = re.search(r"^export const RUNNING_VERSION = '([^']+)'",
                        VERSION_JS.read_text(), re.MULTILINE).group(1)
    expected = re.search(r"^export const EXPECTED_CACHE_VERSION = '([^']+)'",
                         VERSION_JS.read_text(), re.MULTILINE).group(1)
    cache = re.search(r"^const CACHE_VERSION = '([^']+)'",
                      SW.read_text(), re.MULTILINE).group(1)
    assert running == expected == cache
    tail = re.search(r"132([a-z]+)", running).group(1)
    assert tail >= "dq"


# ─── Behavioural: General Cover round-trip + archive ─────────────

@pytest.mark.live_db_writes
@pytest.mark.parametrize("kind", ["public_liability", "workers_comp",
                                   "general_cover", "professional_indemnity"])
def test_general_cover_and_certificate_archive_round_trip(kind):
    """Upload two certificates in succession. The first should
    archive into `previous_certificates[]` when the second lands.
    History + download endpoints both return the archived cert
    bytes intact. Parameterised over ALL four policy types so
    adding a 5th slot in future just needs a row here."""
    hdr = _admin_headers()
    pdf1 = b"%PDF-1.4\n%v1-" + uuid.uuid4().hex[:6].encode() + b"\n%%EOF\n"
    pdf2 = b"%PDF-1.4\n%v2-" + uuid.uuid4().hex[:6].encode() + b"\n%%EOF\n"

    r1 = requests.post(f"{API}/api/org/insurance/{kind}/upload",
                       files={"file": ("cert-v1.pdf", io.BytesIO(pdf1),
                                       "application/pdf")},
                       headers=hdr, timeout=30)
    assert r1.status_code == 200, r1.text
    v1_cert_id = r1.json()["certificate_id"]
    hist = requests.get(f"{API}/api/org/insurance/{kind}/history",
                        headers=hdr, timeout=30)
    baseline_hist = hist.json()["total"]

    field = f"{kind}_insurance"
    requests.patch(f"{API}/api/org", json={
        field: {"policy_number": f"{kind.upper()}-v1-2026",
                "expiry_date": "2026-12-31"},
    }, headers=hdr, timeout=30)

    r2 = requests.post(f"{API}/api/org/insurance/{kind}/upload",
                       files={"file": ("cert-v2.pdf", io.BytesIO(pdf2),
                                       "application/pdf")},
                       headers=hdr, timeout=30)
    assert r2.status_code == 200, r2.text
    assert r2.json()["archived_count"] == baseline_hist + 1

    hist2 = requests.get(f"{API}/api/org/insurance/{kind}/history",
                         headers=hdr, timeout=30)
    rows = hist2.json()["items"]
    v1_row = next(r for r in rows if r["certificate_id"] == v1_cert_id)
    assert v1_row["policy_number"] == f"{kind.upper()}-v1-2026"
    assert v1_row["expiry_date"] == "2026-12-31"

    dl = requests.get(
        f"{API}/api/org/insurance/{kind}/history/{v1_cert_id}/download",
        headers=hdr, timeout=30)
    assert dl.status_code == 200
    assert dl.content == pdf1

    cur = requests.get(f"{API}/api/org/insurance/{kind}/download",
                       headers=hdr, timeout=30)
    assert cur.status_code == 200
    assert cur.content == pdf2

    requests.patch(f"{API}/api/org", json={
        field: {"policy_number": None, "expiry_date": None},
    }, headers=hdr, timeout=30)


def test_general_cover_in_insurance_status_helper():
    """`insurance_status()` computes level for the new slots (both
    General Cover and Professional Indemnity). Parameterised so a
    future 5th slot just needs a row here."""
    import sys
    sys.path.insert(0, str(APP_ROOT / "backend"))
    from org_settings import insurance_status
    today = datetime.now(timezone.utc)
    d5  = (today + timedelta(days=5)).strftime("%Y-%m-%d")
    d20 = (today + timedelta(days=20)).strftime("%Y-%m-%d")
    for kind in ("public_liability", "workers_comp", "general_cover",
                 "professional_indemnity"):
        s5 = insurance_status({f"{kind}_insurance":
                               {"policy_number": f"{kind}-P1",
                                "expiry_date": d5}})
        assert s5[kind]["level"] == "critical", \
            f"{kind}: expected critical at 5d, got {s5[kind]['level']}"
        assert any(c["policy"] == kind for c in s5["criticals"])
        s20 = insurance_status({f"{kind}_insurance":
                                {"policy_number": f"{kind}-P1",
                                 "expiry_date": d20}})
        assert s20[kind]["level"] == "warning", \
            f"{kind}: expected warning at 20d, got {s20[kind]['level']}"


# ─── Behavioural: Email dispatch (mocked M365) ───────────────────

@pytest.mark.live_db_writes
def test_email_dispatch_mocked_when_m365_not_configured():
    """No M365 config in test env → dispatch returns `mocked=True`,
    audit log row still written, no 500."""
    hdr = _admin_headers()
    # Seed a PL cert so at least one attachment is buildable.
    pdf = b"%PDF-1.4\n%pytest-email\n%%EOF\n"
    up = requests.post(f"{API}/api/org/insurance/public_liability/upload",
                       files={"file": ("pl.pdf", io.BytesIO(pdf),
                                       "application/pdf")},
                       headers=hdr, timeout=30)
    assert up.status_code == 200
    # Dispatch.
    r = requests.post(f"{API}/api/org/insurance/email", json={
        "recipients": ["stephen+test@example.com"],
        "certificate_types": ["public_liability"],
        "subject": "Pytest — Insurance",
    }, headers=hdr, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["mocked"] is True or body["ok"] is True
    assert body["sent_to"] == ["stephen+test@example.com"]
    assert "public_liability" in body["included_types"]
    audit = requests.get(f"{API}/api/org/insurance/email/log",
                        headers=hdr, timeout=30).json()
    assert any(r_["id"] == body["audit_id"] for r_ in audit["items"])


@pytest.mark.live_db_writes
def test_email_dispatch_guards():
    hdr = _admin_headers()
    # No recipients.
    r1 = requests.post(f"{API}/api/org/insurance/email", json={
        "recipients": [],
        "certificate_types": ["public_liability"],
    }, headers=hdr, timeout=30)
    assert r1.status_code == 400
    # No cert types + no archived.
    r2 = requests.post(f"{API}/api/org/insurance/email", json={
        "recipients": ["x@example.com"],
        "certificate_types": [],
    }, headers=hdr, timeout=30)
    assert r2.status_code == 400
    # 401/403 unauth.
    r3 = requests.post(f"{API}/api/org/insurance/email", json={
        "recipients": ["x@example.com"],
        "certificate_types": ["public_liability"],
    }, timeout=15)
    assert r3.status_code in (401, 403)


@pytest.mark.live_db_writes
def test_email_dispatch_silently_skips_missing_certs():
    """Requesting types that have no uploaded cert → dispatch still
    succeeds if AT LEAST ONE requested type exists."""
    hdr = _admin_headers()
    # Ensure PL cert exists; drop general_cover cert if any (we can't
    # easily "delete", but requesting a kind with no upload should
    # gracefully skip). Test the "one exists, one missing" path.
    r = requests.post(f"{API}/api/org/insurance/email", json={
        "recipients": ["skip-test@example.com"],
        "certificate_types": ["public_liability", "general_cover"],
    }, headers=hdr, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    # At least public_liability should have made it through.
    assert "public_liability" in body["included_types"]
    # general_cover may or may not be included depending on prior
    # test state — but the endpoint must not have raised.


# ─── Simpro customers search endpoint (behavioural, may skip) ────

def test_simpro_customers_search_endpoint_available():
    """The wrapper endpoint must be reachable when authenticated.
    Returns cached items (possibly empty if Simpro isn't connected
    in this env) — never 500."""
    hdr = _admin_headers()
    r = requests.get(f"{API}/api/integrations/simpro/customers/search",
                     params={"q": "test", "limit": 10},
                     headers=hdr, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "items" in body
    assert isinstance(body["items"], list)

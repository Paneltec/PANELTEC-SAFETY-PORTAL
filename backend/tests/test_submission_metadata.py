"""
Backend test: form submission metadata persistence.

Verifies the bug fix where create_submission was discarding client-sent
label/type and stamping them as '' and 'text'. The fix snapshots
{label, type, config} from the template by field id at submit time.

Test flow:
  1. login as admin
  2. submit Heavy Vehicle Daily Check with full {id,label,type,value}
     -> response should have non-empty label & correct type per field
  3. GET the submission -> same metadata persisted in DB
  4. submit AGAIN with only {id, value} (no label/type)
     -> backend must still snapshot label/type from template
  5. PDF endpoint returns 200, application/pdf, %PDF- magic bytes
  6. PDF should contain at least one expected field label string
  7. Existing submissions (legacy, possibly without label/type) -> PDF still 200
"""
import os
import re
import io
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://whs-compliance.preview.emergentagent.com").rstrip("/")
TEMPLATE_ID = "be6e01d5-1e98-4d81-bb4a-33fd607f0d20"
ADMIN_EMAIL = "stephen@paneltec.com.au"
ADMIN_PASSWORD = "Mcgstephen50#"

EXPECTED_LABELS = ["Date", "Vehicle Type", "Vehicle Rego", "Odometer (km)", "Scan asset", "Fuel Level OK?"]


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                      timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    data = r.json()
    tok = data.get("access_token") or data.get("token")
    assert tok, f"no token in response: {data}"
    return tok


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def template(headers):
    r = requests.get(f"{BASE_URL}/api/forms/templates/{TEMPLATE_ID}", headers=headers, timeout=30)
    assert r.status_code == 200, f"template fetch failed: {r.status_code} {r.text}"
    tpl = r.json()
    assert tpl.get("fields"), "template has no fields"
    return tpl


def _build_value_for(field):
    """Synthesize a plausible value for a field given its type."""
    t = field.get("type") or "text"
    if t == "number":
        return 12345
    if t == "date":
        return "2026-01-15"
    if t == "radio":
        opts = (field.get("config") or {}).get("options") or field.get("options") or ["Yes", "No"]
        return opts[0] if opts else "Yes"
    if t == "select":
        opts = (field.get("config") or {}).get("options") or field.get("options") or ["Truck"]
        return opts[0] if opts else "Truck"
    if t == "signature":
        # 1x1 transparent PNG (base64)
        return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
    if t == "asset_scan":
        return {"asset_id": "ASSET-001", "asset_name": "Test Truck", "scanned_at": "2026-01-15T00:00:00Z"}
    if t == "vehicle_navixy":
        return {"label": "REGO-123", "id": "veh-1"}
    if t == "photo":
        return []
    if t == "gps":
        return {"lat": -33.8, "lng": 151.2}
    return "test-value"


class TestSubmissionMetadata:

    def test_1_submit_with_full_metadata(self, headers, template):
        """Submit with {id,label,type,value} – response must have non-empty label and correct type."""
        payload_fields = []
        for f in template["fields"]:
            payload_fields.append({
                "id": f["id"],
                "label": f.get("label"),
                "type": f.get("type"),
                "value": _build_value_for(f),
            })
        r = requests.post(
            f"{BASE_URL}/api/forms/templates/{TEMPLATE_ID}/submissions",
            json={"fields": payload_fields}, headers=headers, timeout=30,
        )
        assert r.status_code == 201, f"create_submission failed: {r.status_code} {r.text}"
        data = r.json()
        assert data.get("id"), "submission has no id"
        assert data.get("fields"), "submission response missing fields"

        tpl_by_id = {f["id"]: f for f in template["fields"]}
        for ans in data["fields"]:
            fid = ans.get("id")
            tpl_f = tpl_by_id.get(fid)
            assert tpl_f, f"unknown field id in response: {fid}"
            # label must be non-empty AND match template
            assert ans.get("label"), f"empty label on field {fid}"
            assert ans["label"] == tpl_f["label"], f"label mismatch for {fid}: got {ans['label']!r} expected {tpl_f['label']!r}"
            # type must NOT be defaulted to 'text' when template says otherwise
            assert ans.get("type") == tpl_f["type"], f"type mismatch for {fid}: got {ans.get('type')!r} expected {tpl_f['type']!r}"

        pytest.submission_id_full = data["id"]

    def test_2_get_submission_persists_metadata(self, headers, template):
        """GET the submission and confirm label/type still present (persisted, not echoed)."""
        sid = pytest.submission_id_full
        r = requests.get(f"{BASE_URL}/api/forms/submissions/{sid}", headers=headers, timeout=30)
        assert r.status_code == 200, f"get submission failed: {r.status_code} {r.text}"
        data = r.json()
        tpl_by_id = {f["id"]: f for f in template["fields"]}
        for ans in data["fields"]:
            fid = ans.get("id")
            tpl_f = tpl_by_id.get(fid)
            assert ans.get("label") == tpl_f["label"], f"persisted label wrong for {fid}"
            assert ans.get("type") == tpl_f["type"], f"persisted type wrong for {fid}"

    def test_3_config_preserved_on_asset_scan(self, headers, template):
        """If the template has asset_scan with config (e.g., requireScan/kindFilter), submission must keep it."""
        sid = pytest.submission_id_full
        r = requests.get(f"{BASE_URL}/api/forms/submissions/{sid}", headers=headers, timeout=30)
        data = r.json()
        # find an asset_scan field in template with config
        as_tpl = next((f for f in template["fields"] if f.get("type") == "asset_scan" and f.get("config")), None)
        if not as_tpl:
            pytest.skip("template has no asset_scan field with config to assert against")
        as_ans = next((a for a in data["fields"] if a.get("id") == as_tpl["id"]), None)
        assert as_ans, "asset_scan answer missing from submission"
        # config blob should match the template's config dict
        assert as_ans.get("config") == as_tpl.get("config"), \
            f"asset_scan config not preserved: got {as_ans.get('config')!r} expected {as_tpl.get('config')!r}"

    def test_4_submit_id_value_only_snapshots_from_template(self, headers, template):
        """Client sends only {id, value} -- backend must still stamp label/type from template."""
        payload_fields = [{"id": f["id"], "value": _build_value_for(f)} for f in template["fields"]]
        r = requests.post(
            f"{BASE_URL}/api/forms/templates/{TEMPLATE_ID}/submissions",
            json={"fields": payload_fields}, headers=headers, timeout=30,
        )
        assert r.status_code == 201, f"minimal submission failed: {r.status_code} {r.text}"
        data = r.json()
        tpl_by_id = {f["id"]: f for f in template["fields"]}
        for ans in data["fields"]:
            fid = ans.get("id")
            tpl_f = tpl_by_id.get(fid)
            assert ans.get("label"), f"empty label after snapshot for {fid}"
            assert ans.get("label") == tpl_f["label"], f"snapshot label mismatch for {fid}"
            assert ans.get("type") == tpl_f["type"], f"snapshot type mismatch for {fid} (got {ans.get('type')})"
        pytest.submission_id_minimal = data["id"]

    def test_5_pdf_renders_for_new_submission(self, headers):
        sid = pytest.submission_id_full
        r = requests.get(f"{BASE_URL}/api/forms/submissions/{sid}/pdf", headers=headers, timeout=60)
        assert r.status_code == 200, f"pdf failed: {r.status_code} {r.text[:300]}"
        ct = r.headers.get("content-type", "")
        assert "application/pdf" in ct, f"unexpected content-type: {ct}"
        assert r.content[:5] == b"%PDF-", f"missing PDF magic, got {r.content[:10]!r}"
        # bonus: confirm at least one expected label in the PDF stream
        # try pdfplumber, then pypdf, then raw byte grep
        text = ""
        try:
            import pdfplumber  # type: ignore
            with pdfplumber.open(io.BytesIO(r.content)) as pdf:
                text = "\n".join((p.extract_text() or "") for p in pdf.pages)
        except Exception:
            try:
                from pypdf import PdfReader  # type: ignore
                reader = PdfReader(io.BytesIO(r.content))
                text = "\n".join((p.extract_text() or "") for p in reader.pages)
            except Exception:
                text = ""
        # final fallback: raw byte grep
        haystack = text if text else r.content.decode("latin-1", errors="ignore")
        found = [lbl for lbl in EXPECTED_LABELS if lbl in haystack]
        assert found, f"none of expected labels {EXPECTED_LABELS} present in PDF text/bytes"
        print(f"PDF labels found: {found}")

    def test_6_pdf_renders_for_minimal_submission(self, headers):
        sid = pytest.submission_id_minimal
        r = requests.get(f"{BASE_URL}/api/forms/submissions/{sid}/pdf", headers=headers, timeout=60)
        assert r.status_code == 200, f"pdf for minimal submission failed: {r.status_code} {r.text[:300]}"
        assert r.content[:5] == b"%PDF-"

    def test_7_existing_legacy_submissions_pdf_does_not_500(self, headers):
        """List existing submissions, try PDF on the oldest one to exercise legacy/no-label rows."""
        r = requests.get(
            f"{BASE_URL}/api/forms/templates/{TEMPLATE_ID}/submissions",
            headers=headers, timeout=30,
        )
        assert r.status_code == 200, f"list submissions failed: {r.status_code} {r.text[:300]}"
        rows = r.json()
        assert isinstance(rows, list)
        if len(rows) < 2:
            pytest.skip("only the freshly-created submission exists, no legacy to test")
        # last entry (oldest by sort 'submitted_at' desc)
        legacy = rows[-1]
        sid = legacy["id"]
        rp = requests.get(f"{BASE_URL}/api/forms/submissions/{sid}/pdf", headers=headers, timeout=60)
        assert rp.status_code == 200, f"legacy PDF failed: {rp.status_code} {rp.text[:300]}"
        assert rp.content[:5] == b"%PDF-"

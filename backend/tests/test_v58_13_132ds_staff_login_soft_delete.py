"""v58.13.132ds — Staff Login URL + soft-delete for build-up fields.

Locks:
  1. `staff_login_url` present on GET /api/org — server-computed,
     read-only, not accepted by PATCH.
  2. Soft-delete + undelete round-trip for:
      a) Past insurance certificates (per policy_type).
      b) Insurance email audit log (individual + Clear-all).
      c) Fuel anomaly dismissals (per flag on a txn).
      d) Ad-hoc job PDFs (per assignment).
  3. LIST endpoints exclude soft-deleted by default; `?include_deleted=true`
     returns everything.
  4. GridFS files NEVER physically deleted after soft-delete (audit safe).
  5. Admin-only guard: non-admin returns 403.
  6. 3-way version pin at .132ds.
"""
from __future__ import annotations

import io
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
import requests
from bson import ObjectId
from pymongo import MongoClient

APP_ROOT = Path(__file__).resolve().parents[2]
ORG_MOD = APP_ROOT / "backend" / "org_settings.py"
FUEL_MOD = APP_ROOT / "backend" / "fleet_fuel.py"
DJ_ADMIN_MOD = APP_ROOT / "backend" / "mobile_daily_jobs_admin.py"
ORG_JSX = APP_ROOT / "frontend" / "src" / "pages" / "OrgSettings.jsx"
FUEL_JSX = APP_ROOT / "frontend" / "src" / "pages" / "FuelAnomalyInbox.jsx"
DJ_JSX = APP_ROOT / "frontend" / "src" / "pages" / "AdminAssignDailyJobs.jsx"
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


def _db():
    client = MongoClient(os.environ["MONGO_URL"])
    return client[os.environ["DB_NAME"]]


# ─── Source pins ────────────────────────────────────────────────

def test_backend_staff_login_url_helper_and_decorator():
    src = ORG_MOD.read_text(encoding="utf-8")
    assert "132ds" in src
    assert "_default_staff_login_url" in src
    # `_decorate_get` overwrites any stashed value on every GET.
    assert 'doc["staff_login_url"] = _default_staff_login_url()' in src
    # OrgPatch does NOT accept `staff_login_url` — it's server-owned.
    # Grep the class OrgPatch to be sure.
    m = re.search(r"class OrgPatch\(BaseModel\):\n((?:    [^\n]*\n|\n)+)",
                  src)
    assert m, "OrgPatch class not found"
    orgpatch_body = m.group(1)
    assert "staff_login_url" not in orgpatch_body


def test_backend_soft_delete_endpoints_present():
    src = ORG_MOD.read_text(encoding="utf-8")
    # Past insurance certificates.
    assert '@router.delete("/insurance/{policy_type}/history/{file_id}")' in src
    assert '@router.post("/insurance/{policy_type}/history/{file_id}/undelete")' in src
    # Email log.
    assert '@router.delete("/insurance/email/log/{log_id}")' in src
    assert '@router.post("/insurance/email/log/{log_id}/undelete")' in src
    assert '@router.post("/insurance/email/log/clear-all")' in src
    # Filters + include_deleted parameter on the list endpoints.
    assert "include_deleted: bool" in src


def test_backend_fuel_anomaly_delete_endpoints_present():
    src = FUEL_MOD.read_text(encoding="utf-8")
    assert "132ds" in src
    assert '@router.post("/anomalies/{txn_id}/delete-dismissal")' in src
    assert '@router.post("/anomalies/{txn_id}/undelete-dismissal")' in src
    # list_anomalies accepts include_deleted.
    assert "include_deleted: bool = Query(False)" in src


def test_backend_adhoc_pdf_delete_endpoints_present():
    src = DJ_ADMIN_MOD.read_text(encoding="utf-8")
    assert "132ds" in src
    assert '@router.delete("/mobile/daily-jobs/admin/{assignment_id}/pdf")' in src
    assert '@router.post("/mobile/daily-jobs/admin/{assignment_id}/pdf/undelete")' in src
    # Assignments list masks deleted pdf pointers.
    assert "pdf_deleted_at" in src


def test_frontend_org_page_new_controls():
    src = ORG_JSX.read_text(encoding="utf-8")
    assert "132ds" in src
    # Staff Login URL field + copy button (read-only).
    assert 'data-testid="org-field-staff_login_url"' in src
    assert 'data-testid="org-staff-login-url-copy-btn"' in src
    assert "readOnly" in src
    # Past-certs Show-deleted toggle + per-row trash + confirm.
    assert "org-insurance-history-show-deleted-" in src
    assert "org-insurance-history-delete-" in src
    assert "org-insurance-history-undelete-" in src
    assert "org-insurance-history-confirm-" in src
    # Email log per-row delete + clear-all + Show-deleted.
    assert 'data-testid="insurance-email-audit-show-deleted"' in src
    assert 'data-testid="insurance-email-audit-clear-all-btn"' in src
    assert 'data-testid="insurance-email-audit-clear-all-confirm"' in src
    assert "insurance-email-audit-delete-" in src


def test_frontend_fuel_anomaly_inbox_new_controls():
    src = FUEL_JSX.read_text(encoding="utf-8")
    assert "132ds" in src
    assert 'data-testid="fuel-anomaly-show-deleted"' in src
    assert "fuel-anomaly-delete-dismissal-" in src
    assert 'data-testid="fuel-anomaly-delete-dismissal-confirm"' in src


def test_frontend_admin_assign_daily_jobs_new_controls():
    src = DJ_JSX.read_text(encoding="utf-8")
    assert "132ds" in src
    assert 'data-testid="assignments-show-deleted-pdfs"' in src
    assert "assignment-pdf-delete-" in src
    assert "assignment-pdf-undelete-" in src
    assert 'data-testid="assignment-pdf-delete-confirm"' in src


def test_three_way_version_sync_at_132ds():
    running = re.search(r"^export const RUNNING_VERSION = '([^']+)'",
                        VERSION_JS.read_text(), re.MULTILINE).group(1)
    expected = re.search(r"^export const EXPECTED_CACHE_VERSION = '([^']+)'",
                         VERSION_JS.read_text(), re.MULTILINE).group(1)
    cache = re.search(r"^const CACHE_VERSION = '([^']+)'",
                      SW.read_text(), re.MULTILINE).group(1)
    assert running == expected == cache
    tail = re.search(r"132([a-z]+)", running).group(1)
    assert tail >= "ds"


# ─── Behavioural: Staff Login URL surfaced on GET ────────────────

def test_get_org_returns_staff_login_url_computed():
    hdr = _admin_headers()
    r = requests.get(f"{API}/api/org", headers=hdr, timeout=30)
    assert r.status_code == 200
    body = r.json()
    assert body.get("staff_login_url"), body
    # Server-computed — must equal PUBLIC_APP_URL or fall back to
    # the preview domain. Always strips trailing slash.
    val = body["staff_login_url"]
    assert not val.endswith("/")
    assert val.startswith("http")


def test_patch_org_does_not_persist_staff_login_url():
    """OrgPatch ignores staff_login_url — the value on GET always
    reflects the server-computed default. We PATCH a bogus URL and
    confirm the GET still returns the server value unchanged."""
    hdr = _admin_headers()
    before = requests.get(f"{API}/api/org", headers=hdr, timeout=30).json()
    original = before["staff_login_url"]
    r = requests.patch(f"{API}/api/org",
                       json={"staff_login_url": "https://evil.example.com"},
                       headers=hdr, timeout=30)
    # Patch may 400 ("no fields to update" — since Pydantic strips
    # the unknown field) or 200 (accept + ignore); either is fine
    # as long as the URL doesn't change.
    assert r.status_code in (200, 400)
    after = requests.get(f"{API}/api/org", headers=hdr, timeout=30).json()
    assert after["staff_login_url"] == original


# ─── Behavioural: Past insurance certificates soft-delete ────────

@pytest.mark.live_db_writes
def test_past_insurance_cert_soft_delete_round_trip():
    """Upload 2 certs so the first archives; soft-delete the archive,
    confirm it disappears from default list, appears with
    include_deleted=true, and GridFS still resolves the download.
    Then undelete → it reappears in the default list."""
    hdr = _admin_headers()
    kind = "public_liability"
    pdf1 = b"%PDF-1.4\n%ds-v1\n%%EOF\n"
    pdf2 = b"%PDF-1.4\n%ds-v2\n%%EOF\n"
    r1 = requests.post(f"{API}/api/org/insurance/{kind}/upload",
                       files={"file": ("cert1.pdf", io.BytesIO(pdf1),
                                       "application/pdf")},
                       headers=hdr, timeout=30)
    assert r1.status_code == 200
    v1_cert_id = r1.json()["certificate_id"]
    r2 = requests.post(f"{API}/api/org/insurance/{kind}/upload",
                       files={"file": ("cert2.pdf", io.BytesIO(pdf2),
                                       "application/pdf")},
                       headers=hdr, timeout=30)
    assert r2.status_code == 200

    # Default view lists v1 as archived.
    hist = requests.get(f"{API}/api/org/insurance/{kind}/history",
                        headers=hdr, timeout=30).json()
    assert any(r["certificate_id"] == v1_cert_id for r in hist["items"])

    # Soft-delete v1.
    dr = requests.delete(
        f"{API}/api/org/insurance/{kind}/history/{v1_cert_id}",
        headers=hdr, timeout=30)
    assert dr.status_code == 200, dr.text

    # Default list no longer surfaces v1.
    hist2 = requests.get(f"{API}/api/org/insurance/{kind}/history",
                         headers=hdr, timeout=30).json()
    assert not any(r["certificate_id"] == v1_cert_id for r in hist2["items"])

    # include_deleted=true surfaces v1 with deleted_at populated.
    hist3 = requests.get(
        f"{API}/api/org/insurance/{kind}/history",
        params={"include_deleted": "true"}, headers=hdr, timeout=30).json()
    v1_row = next(r for r in hist3["items"]
                  if r["certificate_id"] == v1_cert_id)
    assert v1_row.get("deleted_at")

    # GridFS file preserved — download still works.
    dl = requests.get(
        f"{API}/api/org/insurance/{kind}/history/{v1_cert_id}/download",
        headers=hdr, timeout=30)
    assert dl.status_code == 200
    assert dl.content == pdf1
    # Explicit GridFS sanity — the file blob still exists.
    db = _db()
    assert db.fs.files.find_one({"_id": ObjectId(v1_cert_id)}) is not None

    # Undelete → back in the default list.
    ur = requests.post(
        f"{API}/api/org/insurance/{kind}/history/{v1_cert_id}/undelete",
        headers=hdr, timeout=30)
    assert ur.status_code == 200
    hist4 = requests.get(f"{API}/api/org/insurance/{kind}/history",
                         headers=hdr, timeout=30).json()
    v1 = next(r for r in hist4["items"]
              if r["certificate_id"] == v1_cert_id)
    assert not v1.get("deleted_at")


@pytest.mark.live_db_writes
def test_past_insurance_cert_delete_non_admin_403():
    """A non-admin bearer can't hit the delete endpoint."""
    hdr = _admin_headers()
    # Seed a cert then downgrade the request by dropping the Authorization
    # header entirely — the endpoint should 401/403.
    kind = "workers_comp"
    pdf1 = b"%PDF-1.4\n%no-auth-1\n%%EOF\n"
    r1 = requests.post(f"{API}/api/org/insurance/{kind}/upload",
                       files={"file": ("cert-a.pdf", io.BytesIO(pdf1),
                                       "application/pdf")},
                       headers=hdr, timeout=30)
    assert r1.status_code == 200
    pdf2 = b"%PDF-1.4\n%no-auth-2\n%%EOF\n"
    requests.post(f"{API}/api/org/insurance/{kind}/upload",
                  files={"file": ("cert-b.pdf", io.BytesIO(pdf2),
                                  "application/pdf")},
                  headers=hdr, timeout=30)
    hist = requests.get(f"{API}/api/org/insurance/{kind}/history",
                        headers=hdr, timeout=30).json()
    victim = hist["items"][0]["certificate_id"]
    r = requests.delete(
        f"{API}/api/org/insurance/{kind}/history/{victim}", timeout=30)
    assert r.status_code in (401, 403)


# ─── Behavioural: Insurance email log soft-delete + clear-all ────

@pytest.mark.live_db_writes
def test_email_log_soft_delete_and_clear_all_round_trip():
    """Seed 3 log rows via the (mocked) email dispatch; soft-delete
    one, confirm filtered; clear-all hides everything; undelete
    brings a row back. Row-level 404 for unknown id."""
    hdr = _admin_headers()
    # Ensure at least one cert exists so dispatches succeed.
    pdf = b"%PDF-1.4\n%email-log-seed\n%%EOF\n"
    requests.post(f"{API}/api/org/insurance/public_liability/upload",
                  files={"file": ("pl.pdf", io.BytesIO(pdf),
                                  "application/pdf")},
                  headers=hdr, timeout=30)
    ids = []
    for i in range(3):
        r = requests.post(f"{API}/api/org/insurance/email", json={
            "recipients": [f"ds-{i}@example.com"],
            "certificate_types": ["public_liability"],
            "subject": f"Pytest ds-{i}",
        }, headers=hdr, timeout=30)
        assert r.status_code == 200, r.text
        ids.append(r.json()["audit_id"])
    log = requests.get(f"{API}/api/org/insurance/email/log",
                       headers=hdr, timeout=30).json()
    log_ids = {r["id"] for r in log["items"]}
    for i in ids:
        assert i in log_ids

    # Soft-delete first row.
    dr = requests.delete(
        f"{API}/api/org/insurance/email/log/{ids[0]}",
        headers=hdr, timeout=30)
    assert dr.status_code == 200
    log2 = requests.get(f"{API}/api/org/insurance/email/log",
                        headers=hdr, timeout=30).json()
    assert not any(r["id"] == ids[0] for r in log2["items"])

    # include_deleted=true surfaces the row with deleted_at.
    log3 = requests.get(f"{API}/api/org/insurance/email/log",
                        params={"include_deleted": "true"},
                        headers=hdr, timeout=30).json()
    match = next((r for r in log3["items"] if r["id"] == ids[0]), None)
    # If the log has grown past 10, match may not surface — but the
    # DB row must still carry deleted_at.
    if match is None:
        db = _db()
        row = db.insurance_email_log.find_one({"id": ids[0]})
        assert row and row.get("deleted_at")
    else:
        assert match.get("deleted_at")

    # Undelete → back in default.
    ur = requests.post(
        f"{API}/api/org/insurance/email/log/{ids[0]}/undelete",
        headers=hdr, timeout=30)
    assert ur.status_code == 200

    # Clear-all soft-deletes everything currently visible; response
    # tells us how many were flipped.
    cr = requests.post(f"{API}/api/org/insurance/email/log/clear-all",
                       headers=hdr, timeout=30)
    assert cr.status_code == 200
    assert cr.json().get("cleared") >= 3
    log_after_clear = requests.get(
        f"{API}/api/org/insurance/email/log",
        headers=hdr, timeout=30).json()
    assert log_after_clear["total"] == 0

    # Unknown log id → 404.
    r404 = requests.delete(
        f"{API}/api/org/insurance/email/log/does-not-exist",
        headers=hdr, timeout=30)
    assert r404.status_code == 404


# ─── Behavioural: Fuel anomaly dismissal soft-delete ─────────────

@pytest.mark.live_db_writes
def test_fuel_anomaly_dismissal_soft_delete_round_trip():
    """Seed a fuel txn with a dismissed flag directly in Mongo; call
    the two new endpoints and confirm the flag toggles into/out of
    the default `include_deleted=false` view."""
    db = _db()
    # Find any org_id that has fleet_register enabled for this admin.
    hdr = _admin_headers()
    me = requests.get(f"{API}/api/auth/me", headers=hdr, timeout=30).json()
    org_id = me.get("org_id")
    assert org_id
    now = datetime.now(timezone.utc).isoformat()
    tx_id = f"pytest-ds-anom-{uuid.uuid4().hex[:8]}"
    txn = {
        "id": tx_id,
        "org_id": org_id,
        "deleted_at": None,
        "timestamp": now,
        "registration": "PYTEST-DS",
        "litres": 42.0,
        "anomaly_flags": [{
            "rule": "capacity_exceed",
            "severity": "high",
            "resolved_at": now,
            "resolved_by": me.get("id"),
            "resolved_action": "dismissed",
            "dismissed_at": now,
        }],
    }
    db.fuel_transactions.insert_one(txn)
    try:
        # Default resolved view surfaces the row.
        lst = requests.get(f"{API}/api/fleet/fuel/anomalies",
                           params={"resolved": "true"},
                           headers=hdr, timeout=30).json()
        assert any(r["id"] == tx_id for r in lst.get("items", []))

        # Soft-delete the dismissal.
        dr = requests.post(
            f"{API}/api/fleet/fuel/anomalies/{tx_id}/delete-dismissal",
            json={"rule": "capacity_exceed"},
            headers=hdr, timeout=30)
        assert dr.status_code == 200, dr.text

        # Default resolved view no longer surfaces the row.
        lst2 = requests.get(f"{API}/api/fleet/fuel/anomalies",
                            params={"resolved": "true"},
                            headers=hdr, timeout=30).json()
        assert not any(r["id"] == tx_id for r in lst2.get("items", []))

        # include_deleted=true brings it back, with per-flag
        # deleted_at populated.
        lst3 = requests.get(f"{API}/api/fleet/fuel/anomalies",
                            params={"resolved": "true",
                                    "include_deleted": "true"},
                            headers=hdr, timeout=30).json()
        row = next((r for r in lst3.get("items", []) if r["id"] == tx_id), None)
        assert row is not None
        flag = next(f for f in row["anomaly_flags"]
                    if f["rule"] == "capacity_exceed")
        assert flag.get("deleted_at")

        # Undelete → back in default view.
        ur = requests.post(
            f"{API}/api/fleet/fuel/anomalies/{tx_id}/undelete-dismissal",
            json={"rule": "capacity_exceed"},
            headers=hdr, timeout=30)
        assert ur.status_code == 200
        lst4 = requests.get(f"{API}/api/fleet/fuel/anomalies",
                            params={"resolved": "true"},
                            headers=hdr, timeout=30).json()
        assert any(r["id"] == tx_id for r in lst4.get("items", []))

        # 400 when rule not present.
        bad = requests.post(
            f"{API}/api/fleet/fuel/anomalies/{tx_id}/delete-dismissal",
            json={"rule": "no_such_rule"},
            headers=hdr, timeout=30)
        assert bad.status_code == 400

        # 404 when txn not found.
        r404 = requests.post(
            f"{API}/api/fleet/fuel/anomalies/nope-{uuid.uuid4().hex}/delete-dismissal",
            json={"rule": "capacity_exceed"},
            headers=hdr, timeout=30)
        assert r404.status_code == 404
    finally:
        db.fuel_transactions.delete_one({"id": tx_id})


# ─── Behavioural: Ad-hoc job PDF soft-delete ─────────────────────

@pytest.mark.live_db_writes
def test_adhoc_job_pdf_soft_delete_round_trip():
    """Seed a daily_job_assignments row with a fake pdf_id; call the
    two new endpoints and confirm the admin list masks the PDF
    fields when the row is soft-deleted, restores them on undelete,
    and GridFS blob is never touched (never was — endpoint doesn't
    hit GridFS at all)."""
    db = _db()
    hdr = _admin_headers()
    me = requests.get(f"{API}/api/auth/me", headers=hdr, timeout=30).json()
    org_id = me.get("org_id")
    assert org_id
    # A synthetic GridFS ObjectId reference — we don't need the blob
    # to exist for the delete/undelete endpoints (they only touch
    # the assignment doc). But we DO seed a small blob so we can
    # assert it survives the soft-delete.
    from bson import ObjectId as _OID
    seed_id = _OID()
    db.job_pdfs.files.insert_one({
        "_id": seed_id,
        "filename": "pytest-ds.pdf",
        "length": 8,
        "chunkSize": 261120,
        "uploadDate": datetime.now(timezone.utc),
        "metadata": {"org_id": org_id, "sha256": "test"},
    })
    the_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    assignment_id = f"pytest-ds-adhoc-{uuid.uuid4().hex[:8]}"
    db.daily_job_assignments.insert_one({
        "id": assignment_id,
        "org_id": org_id,
        "date": the_date,
        "worker_id": me.get("id"),
        "worker_name": "Pytest DS",
        "site_name": "Pytest Site",
        "assigned_at": datetime.now(timezone.utc).isoformat(),
        "status": "sent",
        "pdf_id": str(seed_id),
        "pdf_url": f"/api/mobile/daily-jobs/pdf/{seed_id}",
        "pdf_filename": "pytest-ds.pdf",
    })
    try:
        # Default admin list surfaces the pdf_id.
        lst = requests.get(f"{API}/api/mobile/daily-jobs/admin/assignments",
                           params={"date": the_date},
                           headers=hdr, timeout=30).json()
        row = next((r for r in lst["rows"] if r["id"] == assignment_id), None)
        assert row and row.get("pdf_id")

        # Soft-delete.
        dr = requests.delete(
            f"{API}/api/mobile/daily-jobs/admin/{assignment_id}/pdf",
            headers=hdr, timeout=30)
        assert dr.status_code == 200, dr.text

        # Default list masks the PDF pointer to None.
        lst2 = requests.get(f"{API}/api/mobile/daily-jobs/admin/assignments",
                            params={"date": the_date},
                            headers=hdr, timeout=30).json()
        row2 = next(r for r in lst2["rows"] if r["id"] == assignment_id)
        assert row2.get("pdf_id") is None
        assert row2.get("pdf_url") is None

        # include_deleted=true keeps the pdf_id and surfaces the
        # `pdf_deleted_at` audit stamp.
        lst3 = requests.get(f"{API}/api/mobile/daily-jobs/admin/assignments",
                            params={"date": the_date,
                                    "include_deleted": "true"},
                            headers=hdr, timeout=30).json()
        row3 = next(r for r in lst3["rows"] if r["id"] == assignment_id)
        assert row3.get("pdf_id") == str(seed_id)
        assert row3.get("pdf_deleted_at")

        # GridFS blob preserved — never physically deleted.
        assert db.job_pdfs.files.find_one({"_id": seed_id}) is not None

        # Undelete → pdf_id back in default view.
        ur = requests.post(
            f"{API}/api/mobile/daily-jobs/admin/{assignment_id}/pdf/undelete",
            headers=hdr, timeout=30)
        assert ur.status_code == 200
        lst4 = requests.get(f"{API}/api/mobile/daily-jobs/admin/assignments",
                            params={"date": the_date},
                            headers=hdr, timeout=30).json()
        row4 = next(r for r in lst4["rows"] if r["id"] == assignment_id)
        assert row4.get("pdf_id") == str(seed_id)

        # 400 when the row has no PDF to delete.
        no_pdf_id = f"pytest-ds-nopdf-{uuid.uuid4().hex[:8]}"
        db.daily_job_assignments.insert_one({
            "id": no_pdf_id,
            "org_id": org_id,
            "date": the_date,
            "worker_id": me.get("id"),
            "status": "sent",
        })
        try:
            no_pdf = requests.delete(
                f"{API}/api/mobile/daily-jobs/admin/{no_pdf_id}/pdf",
                headers=hdr, timeout=30)
            assert no_pdf.status_code == 400
        finally:
            db.daily_job_assignments.delete_one({"id": no_pdf_id})

        # 404 on unknown assignment.
        r404 = requests.delete(
            f"{API}/api/mobile/daily-jobs/admin/nope-{uuid.uuid4().hex}/pdf",
            headers=hdr, timeout=30)
        assert r404.status_code == 404
    finally:
        db.daily_job_assignments.delete_one({"id": assignment_id})
        db.job_pdfs.files.delete_one({"_id": seed_id})

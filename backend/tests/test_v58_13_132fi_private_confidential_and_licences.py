"""v58.13.132fi — Section D · Private & Confidential + Licences.

Investigation surprise: both categories already existed.
  · Private & Confidential: `worker_hr_documents` collection with a
    read endpoint (`GET /workers/{id}/hr-documents`). Simpro's zip
    importer routes `private/confidential/hr` folder files into it.
    What was MISSING: admin-managed CRUD (upload, notes, delete).
  · Licences: exist as certifications with `cert_kind_slug` in the
    licence family (`hr_licence`, `mr_licence`, `ewp_licence`,
    `forklift_licence`, plus WAH, First Aid, White Card, Trade Cert,
    Drivers Licence).

.132fi ships:
  · Backend admin CRUD on `worker_hr_documents` (POST + PATCH notes
    + soft-DELETE with archive_audit).
  · Two new frontend panels on the worker edit page:
    - PrivateConfidentialPanel  — drop-zone + notes-edit + delete.
    - LicencesPanel             — filtered view over certifications
                                   with expiry-tint rows.
"""
from __future__ import annotations

import io
import re
from pathlib import Path

import pytest
import requests

from tests.conftest import ADMIN_EMAIL, ADMIN_PWD, API

pytestmark = pytest.mark.live_db_writes

APP_ROOT = Path(__file__).resolve().parents[2]
FE = APP_ROOT / "frontend" / "src"
BE_SZI = APP_ROOT / "backend" / "simpro_zip_import.py"
WORKERS_PAGE = FE / "pages" / "Workers.jsx"
PNC = FE / "components" / "workers" / "PrivateConfidentialPanel.jsx"
LIC = FE / "components" / "workers" / "LicencesPanel.jsx"
VERSION_JS = FE / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


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


@pytest.fixture(scope="module")
def worker_id(admin_hdr):
    """Grab any live worker id — hr-documents is worker-scoped."""
    r = requests.get(f"{API}/workers", headers=admin_hdr, timeout=30)
    assert r.status_code == 200
    rows = r.json() if isinstance(r.json(), list) else r.json().get("rows") or []
    assert rows, "no workers seeded — cannot run e2e"
    return rows[0]["id"]


# ── BE source-pins: CRUD endpoints exist ─────────────────────────

def test_upload_endpoint_wired():
    src = _read(BE_SZI)
    m = re.search(
        r'@router\.post\("/\{worker_id\}/hr-documents"[^)]*\)\s*\n'
        r'async def upload_hr_document',
        src)
    assert m, "POST /workers/{id}/hr-documents must be wired"
    # 50 MB guard.
    assert re.search(r"_HR_DOC_MAX_BYTES\s*=\s*50\s*\*\s*1024\s*\*\s*1024", src)
    # Mime allow-list present.
    assert "_HR_DOC_ALLOWED_MIME_PREFIXES" in src
    # Notes is Form(...) — not query param.
    assert re.search(r"notes:\s*str\s*=\s*Form\(", src)


def test_patch_endpoint_wired_notes_only():
    src = _read(BE_SZI)
    m = re.search(
        r'@router\.patch\("/\{worker_id\}/hr-documents/\{doc_id\}"[^)]*\)\s*\n'
        r'async def patch_hr_document',
        src)
    assert m
    # Only the `notes` key is honoured.
    assert re.search(r'if "notes" in body:', src)


def test_delete_endpoint_soft_deletes_and_audits():
    src = _read(BE_SZI)
    m = re.search(
        r'@router\.delete\("/\{worker_id\}/hr-documents/\{doc_id\}"[^)]*\)\s*\n'
        r'async def delete_hr_document',
        src)
    assert m, "DELETE endpoint missing"
    # Soft-delete sets deleted_at, not $unset.
    assert re.search(
        r'\{"\$set":\s*\{"deleted_at":\s*ts,\s*"deleted_by":\s*user\["id"\]\}\}',
        src), "DELETE must be soft (sets deleted_at)"
    # v58.13.132fj — audit write now goes through the shared
    # helper. .132fi shipped an inline archive_audit.insert_one;
    # .132fj replaced it with the shared helper.
    assert "from archive_audit_helpers import record_file_archive_audit" in src
    assert re.search(
        r"await record_file_archive_audit\(\s*"
        r'module="hr_documents",\s*resource="worker_hr_documents"',
        src)


# ── FE source-pins: panels exist and are wired in ─────────────────

def test_pnc_panel_exists_and_routes_correctly():
    src = _read(PNC)
    assert 'section-private-confidential' in src
    assert re.search(r'api\.post\(`?/workers/\$\{workerId\}/hr-documents`?', src)
    assert re.search(r'api\.patch\(`?/workers/\$\{workerId\}/hr-documents/\$\{editingNotes\.id\}`?', src)
    assert re.search(r'api\.delete\(`?/workers/\$\{workerId\}/hr-documents/\$\{confirmDelete\.id\}`?', src)
    # Confirm modal present.
    assert 'pnc-delete-confirm' in src and 'pnc-delete-confirm-yes' in src
    # Empty state.
    assert 'pnc-empty' in src


def test_pnc_dropzone_and_input():
    src = _read(PNC)
    assert 'pnc-dropzone' in src
    assert 'pnc-file-input' in src
    # 50 MB client guard matches BE.
    assert re.search(r"const MAX_MB\s*=\s*50", src)


def test_licences_panel_filters_by_licence_family():
    src = _read(LIC)
    # Slug allow-list matches backend cert_kinds families.
    for slug in ("hr_licence", "mr_licence", "ewp_licence",
                  "forklift_licence", "working_at_heights",
                  "first_aid", "white_card", "trade_certificate"):
        assert slug in src, f"licence slug {slug!r} missing from filter"
    # Expiry tint helpers.
    assert re.search(r"if \(d < 0\) return 'expired';", src)
    assert re.search(r"if \(d <= 30\) return 'expiring';", src)
    # Empty state.
    assert 'licences-empty' in src


def test_workers_page_wires_both_panels():
    src = _read(WORKERS_PAGE)
    assert "import PrivateConfidentialPanel from '../components/workers/PrivateConfidentialPanel'" in src
    assert "import LicencesPanel from '../components/workers/LicencesPanel'" in src
    # Both mounted on the edit page.
    assert "<PrivateConfidentialPanel workerId={worker.id}" in src
    assert "<LicencesPanel workerId={worker.id}" in src


# ── BE behavioural: full CRUD round-trip via live API ─────────────

def test_e2e_hr_document_crud(admin_hdr, worker_id):
    # 1) List baseline.
    r0 = requests.get(f"{API}/workers/{worker_id}/hr-documents",
                       headers=admin_hdr, timeout=30)
    assert r0.status_code == 200
    baseline = len(r0.json().get("documents") or [])

    # 2) POST upload.
    blob = b"%PDF-1.4\n.132fi round-trip test blob\n%%EOF"
    files = {"file": ("test_132fi.pdf", io.BytesIO(blob), "application/pdf")}
    data = {"notes": "created by test_132fi"}
    r1 = requests.post(f"{API}/workers/{worker_id}/hr-documents",
                        headers=admin_hdr, files=files, data=data, timeout=30)
    assert r1.status_code == 201, r1.text
    created = r1.json()
    doc_id = created["id"]
    assert created["notes"] == "created by test_132fi"
    assert created["mime_type"] == "application/pdf"
    assert created["size"] == len(blob)
    assert created["source"] == "admin_upload"
    assert created["deleted_at"] is None

    try:
        # 3) List — new doc appears.
        r2 = requests.get(f"{API}/workers/{worker_id}/hr-documents",
                           headers=admin_hdr, timeout=30)
        docs = r2.json().get("documents") or []
        assert len(docs) == baseline + 1
        assert any(d["id"] == doc_id for d in docs)

        # 4) PATCH notes.
        r3 = requests.patch(f"{API}/workers/{worker_id}/hr-documents/{doc_id}",
                             headers=admin_hdr,
                             json={"notes": "edited by test_132fi"}, timeout=30)
        assert r3.status_code == 200
        assert r3.json()["notes"] == "edited by test_132fi"

        # 5) Download file.
        r4 = requests.get(f"{API}/workers/{worker_id}/hr-documents/{doc_id}/file",
                           headers=admin_hdr, timeout=30)
        assert r4.status_code == 200
        assert r4.content == blob
    finally:
        # 6) DELETE soft-delete.
        r5 = requests.delete(f"{API}/workers/{worker_id}/hr-documents/{doc_id}",
                              headers=admin_hdr, timeout=30)
        assert r5.status_code == 204

    # 7) List — doc no longer appears.
    r6 = requests.get(f"{API}/workers/{worker_id}/hr-documents",
                       headers=admin_hdr, timeout=30)
    docs2 = r6.json().get("documents") or []
    assert not any(d["id"] == doc_id for d in docs2), (
        "soft-deleted doc must not appear in default list")


def test_unsupported_mime_type_rejected(admin_hdr, worker_id):
    files = {"file": ("bad.exe", io.BytesIO(b"MZ..."), "application/x-msdownload")}
    r = requests.post(f"{API}/workers/{worker_id}/hr-documents",
                       headers=admin_hdr, files=files,
                       data={"notes": ""}, timeout=30)
    assert r.status_code == 400
    assert "Unsupported" in r.text


def test_empty_file_rejected(admin_hdr, worker_id):
    files = {"file": ("empty.pdf", io.BytesIO(b""), "application/pdf")}
    r = requests.post(f"{API}/workers/{worker_id}/hr-documents",
                       headers=admin_hdr, files=files,
                       data={"notes": ""}, timeout=30)
    assert r.status_code == 400


def test_unauthenticated_upload_rejected(worker_id):
    files = {"file": ("t.pdf", io.BytesIO(b"data"), "application/pdf")}
    r = requests.post(f"{API}/workers/{worker_id}/hr-documents",
                       files=files, data={"notes": ""}, timeout=30)
    assert r.status_code in (401, 403)


# ── Version pin ───────────────────────────────────────────────────

def test_version_pinned_to_132fi_or_higher():
    v = _read(VERSION_JS)
    sw = _read(SW)
    m_v = re.search(r"RUNNING_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", v)
    m_ex = re.search(r"EXPECTED_CACHE_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", v)
    m_sw = re.search(r"CACHE_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", sw)
    for name, m in (("RUNNING_VERSION", m_v),
                     ("EXPECTED_CACHE_VERSION", m_ex),
                     ("CACHE_VERSION", m_sw)):
        assert m and m.group(1) >= "fi", (
            f"{name} suffix must be >= 132fi, got {m and m.group(1)}")

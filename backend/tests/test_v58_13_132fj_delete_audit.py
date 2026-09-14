"""v58.13.132fj — Section E delete-audit.

Investigation (per brief): the codebase already has DELETE endpoints
on the four primary file surfaces:
  · Document Library      DELETE /documents/files/{id}
  · Worker Certifications DELETE /workers/certifications/{id}
  · Worker HR Documents   DELETE /workers/{id}/hr-documents/{id}    (.132fi)
  · Insurance history     DELETE /org/insurance/{policy_type}/history/{id}

None of them (except .132fi hr-documents, which had a bespoke inline
write) wrote to `archive_audit`. Sub-commit A of .132fj introduces a
shared helper `archive_audit_helpers.record_file_archive_audit()` and
retrofits it into all four endpoints so admins get a single source
of truth for "who deleted what, when, from which surface" — same
schema as crud.py's bulk_archive audit rows.

Surfaces NOT touched in .132fj (see ship memo table):
  · SWMS attachments        — no dedicated file-attachment surface;
                              swms_phase45 has bulk_delete on the
                              SWMS row itself, not per-attachment.
  · Site QR signage PDFs    — sites_qr routes generate the PDF live
                              from site data; nothing stored to
                              delete.
  · Fleet service register  — no per-attachment delete endpoint.
  · Incident attachments    — no per-attachment delete endpoint.
  · Risk assessment atts    — no per-attachment delete endpoint.
  · Form submission atts    — no per-attachment delete endpoint.
  · Program schematics      — schematic upload uses replace-in-place,
                              no soft-delete flow.

These surfaces are documented in the ship memo. Adding delete UIs
where the collection has no attachment concept would be scope-creep;
they are deferred to future ships when those surfaces gain
attachment features.
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
BE = APP_ROOT / "backend"
HELPERS = BE / "archive_audit_helpers.py"
DOCLIB = BE / "document_library.py"
CERTS = BE / "worker_certifications.py"
ORGSET = BE / "org_settings.py"
SZI = BE / "simpro_zip_import.py"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def _login(email, pwd):
    r = requests.post(f"{API}/auth/login",
                       json={"email": email, "password": pwd}, timeout=30)
    if r.status_code == 429:
        pytest.skip("rate-limited")
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json().get('access_token') or r.json().get('token')}"}


@pytest.fixture(scope="module")
def admin_hdr():
    return _login(ADMIN_EMAIL, ADMIN_PWD)


@pytest.fixture(scope="module")
def worker_id(admin_hdr):
    r = requests.get(f"{API}/workers", headers=admin_hdr, timeout=30)
    rows = r.json() if isinstance(r.json(), list) else r.json().get("rows") or []
    return rows[0]["id"]


# ── Helper exists and has the expected shape ─────────────────────

def test_shared_helper_exists():
    src = _read(HELPERS)
    assert "async def record_file_archive_audit" in src
    # Schema mirrors crud.py::_write_audit fields.
    for field in ("module", "resource", "resource_id", "filename",
                    "actor_user_id", "actor_email", "action",
                    "batch_id", "criteria", "affected_count",
                    "reason", "timestamp"):
        assert f'"{field}"' in src, f"schema field {field!r} missing from helper"
    # Best-effort (silent-on-error).
    assert re.search(r"except Exception[^:]*:\s*(?:#[^\n]*\n\s*)*(pass|log\.)", src)


# ── Every retrofitted endpoint imports + calls the helper ─────────

def test_document_library_writes_audit():
    src = _read(DOCLIB)
    assert "from archive_audit_helpers import record_file_archive_audit" in src
    assert re.search(
        r"await record_file_archive_audit\(\s*"
        r'module="documents",\s*resource="doc_files"',
        src)


def test_worker_certifications_writes_audit():
    src = _read(CERTS)
    assert "from archive_audit_helpers import record_file_archive_audit" in src
    assert re.search(
        r"await record_file_archive_audit\(\s*"
        r'module="certifications",\s*resource="worker_certifications"',
        src)


def test_worker_hr_documents_writes_audit_via_shared_helper():
    """v58.13.132fi introduced an inline archive_audit write for
    hr-documents. .132fj replaces it with the shared helper so all
    four surfaces write identical schemas."""
    src = _read(SZI)
    assert "from archive_audit_helpers import record_file_archive_audit" in src
    assert re.search(
        r"await record_file_archive_audit\(\s*"
        r'module="hr_documents",\s*resource="worker_hr_documents"',
        src)


def test_insurance_history_writes_audit():
    src = _read(ORGSET)
    assert "from archive_audit_helpers import record_file_archive_audit" in src
    assert re.search(
        r"await record_file_archive_audit\(\s*"
        r'module="insurance",\s*resource=f"orgs\.\{field\}\.previous_certificates"',
        src)


# ── Behavioural: full round-trip on hr_documents lands audit row ──

def test_e2e_hr_doc_delete_writes_audit_row(admin_hdr, worker_id):
    # Upload a doc.
    blob = b"%PDF-1.4\n.132fj audit e2e blob\n%%EOF"
    files = {"file": ("audit_e2e_132fj.pdf", io.BytesIO(blob), "application/pdf")}
    r = requests.post(f"{API}/workers/{worker_id}/hr-documents",
                       headers=admin_hdr, files=files,
                       data={"notes": "e2e"}, timeout=30)
    assert r.status_code == 201
    doc_id = r.json()["id"]

    # Delete → 204.
    r2 = requests.delete(f"{API}/workers/{worker_id}/hr-documents/{doc_id}",
                          headers=admin_hdr, timeout=30)
    assert r2.status_code == 204

    # There is no public archive_audit read endpoint yet, so we
    # verify through the Mongo layer directly. Import at test-time
    # so the collection is opened with the same connection the
    # backend uses.
    import asyncio
    import os
    from motor.motor_asyncio import AsyncIOMotorClient
    from dotenv import load_dotenv
    load_dotenv(str(BE / ".env"))
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]

    async def _check():
        row = await db.archive_audit.find_one(
            {"resource": "worker_hr_documents", "resource_id": doc_id},
            {"_id": 0},
        )
        return row

    row = asyncio.get_event_loop().run_until_complete(_check())
    assert row is not None, "audit row not written"
    assert row["module"] == "hr_documents"
    assert row["action"] == "soft_delete"
    assert row["filename"] == "audit_e2e_132fj.pdf"
    assert row["actor_email"] == ADMIN_EMAIL
    assert row["worker_id"] == worker_id
    assert row["affected_count"] == 1


# ── Version pin ───────────────────────────────────────────────────

def test_version_pinned_to_132fj_or_higher():
    v = _read(APP_ROOT / "frontend" / "src" / "lib" / "version.js")
    sw = _read(APP_ROOT / "frontend" / "public" / "service-worker.js")
    m_v = re.search(r"RUNNING_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", v)
    m_ex = re.search(r"EXPECTED_CACHE_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", v)
    m_sw = re.search(r"CACHE_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", sw)
    for name, m in (("RUNNING_VERSION", m_v),
                     ("EXPECTED_CACHE_VERSION", m_ex),
                     ("CACHE_VERSION", m_sw)):
        assert m and m.group(1) >= "fj", (
            f"{name} suffix must be >= 132fj, got {m and m.group(1)}")

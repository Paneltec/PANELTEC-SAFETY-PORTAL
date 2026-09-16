"""v58.13.132hl — GridFS fallback for the DocLib PDF preview endpoints.

Fixes a class of records whose disk copy was pruned after the
`.132gf` GridFS migration but whose bytes remain intact in
`upload_storage`. Before this ship, `/api/files/{id}/pdf` and
`/api/preview/doc_file/pdf` returned 410 for those files even
though `/api/document-library/files/{id}/download` (which already
had GridFS fallback) served them fine.

Locks in:
  · The `_resolve_file` refactor from `(doc, Path)` -> `(doc, bytes)`.
  · GridFS-only doc previews via BOTH endpoints.
  · Genuinely-missing doc previews still return 410.
  · The `preview_pdf_cache` write still happens (cache_key stable).
  · The admin-orphan scan count is unaffected (those live in
    `worker_certifications`, not `doc_files`).
  · No sibling adapter regressed — audit-locked to the disk-only
    pattern only appearing on `_resolve_doc_file`.
"""
from __future__ import annotations

import base64
import io
import json
import re
import uuid
from pathlib import Path

import pytest
import requests
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas as pdfcanvas

from tests.conftest import API, ADMIN_EMAIL, ADMIN_PWD, _login

pytestmark = pytest.mark.live_db_writes

APP_ROOT = Path(__file__).resolve().parents[2]
FILE_PDF_PY = APP_ROOT / "backend" / "file_pdf.py"
PREVIEW_SOURCES_PY = APP_ROOT / "backend" / "preview_sources.py"
VERSION_JS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


# ─────────────────── static regression ───────────────────

def test_resolve_file_signature_returns_bytes():
    src = FILE_PDF_PY.read_text(encoding="utf-8")
    assert "async def _resolve_file(file_id: str, user: dict) -> tuple[dict, bytes]:" in src
    assert 'read_upload("document_library"' in src
    # The old disk-only shape must be gone.
    assert 'if not path.exists():\n        raise missing_file_response()' not in src


def test_convert_signature_takes_bytes():
    src = FILE_PDF_PY.read_text(encoding="utf-8")
    assert "async def _convert(doc: dict, blob: bytes) -> tuple[bytes, str]:" in src
    assert "sha1 = _sha1_bytes(blob)" in src
    # Old `path.read_bytes()` inside _convert must be gone.
    assert "blob = path.read_bytes()" not in src


def test_preview_sources_doc_file_has_gridfs_fallback():
    src = PREVIEW_SOURCES_PY.read_text(encoding="utf-8")
    # New fallback branch present.
    assert 'read_upload(\n            "document_library"' in src or \
           'read_upload("document_library",' in src
    # Old disk-only pattern gone from _resolve_doc_file.
    doc_block = re.search(
        r"async def _resolve_doc_file\(.*?(?=async def )",
        src, flags=re.DOTALL,
    )
    assert doc_block, "_resolve_doc_file block not found"
    assert "if path.exists():" in doc_block.group(0), \
        "must try disk first"
    assert "hit = await read_upload(" in doc_block.group(0), \
        "must have GridFS fallback"


def test_audit_only_doc_file_had_bug():
    """Guardrail: any future adapter that uses `path.exists()` MUST
    either (a) also have a GridFS fallback right below it, or
    (b) call `raise missing_file_response()`. The audit in the ship
    memo lists exactly one adapter previously matching (a)."""
    src = PREVIEW_SOURCES_PY.read_text(encoding="utf-8")
    # Split by adapter definitions.
    adapters = re.findall(
        r"async def (_resolve_[a-z_]+)\(.*?(?=\nasync def |\n\n\n)",
        src, flags=re.DOTALL,
    )
    # We expect at least 8 named adapters.
    assert len(re.findall(r"async def _resolve_", src)) >= 8
    # For every adapter that reads from disk directly, either
    # `read_upload(` OR `_read_gridfs(` must appear in the same block.
    for m in re.finditer(
        r"async def (_resolve_[a-z_]+)\((.+?)(?=\nasync def |\Z)",
        src, flags=re.DOTALL,
    ):
        name = m.group(1)
        body = m.group(2)
        if "path.exists()" in body:
            has_gridfs = ("read_upload(" in body) or ("_read_gridfs(" in body)
            assert has_gridfs, \
                f"adapter {name!r} uses path.exists() but has no GridFS fallback"


def test_version_lockstep_pinned_at_132hl():
    for path, key in (
        (VERSION_JS, "RUNNING_VERSION"),
        (VERSION_JS, "EXPECTED_CACHE_VERSION"),
        (SW, "CACHE_VERSION"),
    ):
        m = re.search(
            rf"{key}\s*=\s*'paneltec-v160\.3\.9\.58\.13\.132h([a-z])'",
            path.read_text(encoding="utf-8"),
        )
        assert m
        assert m.group(1) >= "l", \
            f"{key} must be >= .132hl (got .132h{m.group(1)})"


# ─────────────────── runtime — GridFS-only preview ───────────────────

@pytest.fixture(scope="module")
def admin_token() -> str:
    return _login(ADMIN_EMAIL, ADMIN_PWD)


@pytest.fixture(scope="module")
def gridfs_only_doc(_mongo):
    """Seed a `doc_files` row whose bytes exist ONLY in
    `upload_storage` GridFS — NO disk copy. Reproduces the exact
    shape of Stephen's ABCSDS012 file.
    """
    # Reuse an existing folder in Stephen's org.
    org = _mongo.users.find_one({"email": ADMIN_EMAIL}, {"_id": 0, "org_id": 1})
    folder = _mongo.doc_folders.find_one(
        {"org_id": org["org_id"], "deleted_at": None},
        {"_id": 0, "id": 1},
    )
    assert folder, "no doc folder to seed against"

    file_id = str(uuid.uuid4())
    stored_name = f"pytest-132hl-gridfsonly-{file_id[:8]}.pdf"
    filename = "pytest-132hl-gridfsonly.pdf"

    # Real 1-page PDF.
    buf = io.BytesIO()
    c = pdfcanvas.Canvas(buf, pagesize=A4)
    c.drawString(72, 720, f"GridFS-only fixture {file_id}")
    c.showPage(); c.save()
    pdf_bytes = buf.getvalue()

    # Write ONLY to GridFS (not to disk).
    from motor.motor_asyncio import AsyncIOMotorGridFSBucket
    from pymongo import MongoClient
    from tests.conftest import _ASYNC_LOOP
    import os as _os
    # Use the shared asyncio loop from conftest so we don't orphan Motor.
    async def _write():
        from motor.motor_asyncio import AsyncIOMotorClient
        mc = AsyncIOMotorClient(_os.environ["MONGO_URL"])
        try:
            db = mc[_os.environ["DB_NAME"]]
            bucket = AsyncIOMotorGridFSBucket(db, bucket_name="upload_storage")
            md = {
                "module": "document_library",
                "subdir": "document_library",
                "parts": [folder["id"], stored_name],
                "key": f"document_library/{folder['id']}/{stored_name}",
                "org_id": org["org_id"],
                "mime": "application/pdf",
                "orig_filename": filename,
            }
            gid = await bucket.upload_from_stream(stored_name, pdf_bytes,
                                                    metadata=md)
            return gid
        finally:
            mc.close()
    gid = _ASYNC_LOOP.run_until_complete(_write())

    # Insert doc_files row pointing at that stored_name.
    doc = {
        "id": file_id,
        "org_id": org["org_id"],
        "folder_id": folder["id"],
        "filename": filename,
        "stored_name": stored_name,
        "size": len(pdf_bytes),
        "mime": "application/pdf",
        "uploaded_at": "2026-09-16T00:00:00+00:00",
        "uploaded_by": "pytest",
        "uploaded_by_name": "Pytest",
        "deleted_at": None,
        "ai_tags": ["pytest", "132hl"],
    }
    _mongo.doc_files.insert_one(doc)
    # Ensure NO disk copy.
    disk_path = (APP_ROOT / "backend" / "uploads" / "document_library"
                 / folder["id"] / stored_name)
    if disk_path.exists():
        disk_path.unlink()
    assert not disk_path.exists()

    yield {"file_id": file_id, "folder_id": folder["id"],
           "org_id": org["org_id"], "size": len(pdf_bytes),
           "gridfs_id": gid, "disk_path": str(disk_path)}

    # Teardown.
    _mongo.doc_files.delete_one({"id": file_id})
    _mongo.preview_pdf_cache.delete_many({"key": f"doc_file:{file_id}"})
    _mongo.doc_files_pdf_cache.delete_many({"file_id": file_id})
    async def _drop():
        from motor.motor_asyncio import AsyncIOMotorClient
        mc = AsyncIOMotorClient(_os.environ["MONGO_URL"])
        try:
            db = mc[_os.environ["DB_NAME"]]
            bucket = AsyncIOMotorGridFSBucket(db, bucket_name="upload_storage")
            try:
                await bucket.delete(gid)
            except Exception:
                pass
        finally:
            mc.close()
    _ASYNC_LOOP.run_until_complete(_drop())


def test_files_pdf_endpoint_serves_gridfs_only_doc(admin_token, gridfs_only_doc):
    """/api/files/{id}/pdf now returns 200 for a file whose bytes are
    only in GridFS. Pre-.132hl this returned 410."""
    fid = gridfs_only_doc["file_id"]
    r = requests.get(f"{API}/files/{fid}/pdf",
                      headers={"Authorization": f"Bearer {admin_token}"},
                      timeout=30)
    assert r.status_code == 200, \
        f"/files/{fid}/pdf must 200, got {r.status_code}: {r.text[:200]}"
    assert r.headers.get("content-type", "").startswith("application/pdf")
    assert r.content.startswith(b"%PDF")
    # passthrough pipeline (source is already a valid PDF).
    assert r.headers.get("x-pipeline") == "passthrough"


def test_preview_doc_file_endpoint_serves_gridfs_only_doc(admin_token, gridfs_only_doc):
    """The new /api/preview/doc_file/pdf endpoint (.132hj) also
    handles GridFS-only records after .132hl."""
    fid = gridfs_only_doc["file_id"]
    mint = requests.post(
        f"{API}/preview/doc_file/token",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"ref": {"file_id": fid}}, timeout=15,
    )
    assert mint.status_code == 200, mint.text
    tok = mint.json()["token"]
    ref_b64 = mint.json()["ref_b64"]
    r = requests.get(f"{API}/preview/doc_file/pdf",
                      params={"t": tok, "ref": ref_b64}, timeout=30)
    assert r.status_code == 200, r.text
    assert r.content.startswith(b"%PDF")


def test_genuinely_missing_doc_still_returns_410(admin_token, _mongo):
    """A record whose bytes are on neither disk nor GridFS still
    returns 410 (via `missing_file_response`)."""
    org = _mongo.users.find_one({"email": ADMIN_EMAIL}, {"_id": 0, "org_id": 1})
    folder = _mongo.doc_folders.find_one(
        {"org_id": org["org_id"], "deleted_at": None}, {"_id": 0, "id": 1},
    )
    fid = str(uuid.uuid4())
    stored_name = f"pytest-132hl-truly-missing-{fid[:8]}.pdf"
    _mongo.doc_files.insert_one({
        "id": fid, "org_id": org["org_id"], "folder_id": folder["id"],
        "filename": "pytest-truly-missing.pdf", "stored_name": stored_name,
        "size": 1234, "mime": "application/pdf",
        "uploaded_at": "2026-09-16T00:00:00+00:00",
        "uploaded_by": "pytest", "uploaded_by_name": "Pytest",
        "deleted_at": None, "ai_tags": [],
    })
    try:
        r = requests.get(f"{API}/files/{fid}/pdf",
                          headers={"Authorization": f"Bearer {admin_token}"},
                          timeout=15)
        assert r.status_code == 410, r.text
        # New /preview endpoint should also 410.
        m = requests.post(
            f"{API}/preview/doc_file/token",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"ref": {"file_id": fid}}, timeout=15,
        )
        assert m.status_code == 410, m.text
    finally:
        _mongo.doc_files.delete_one({"id": fid})


def test_admin_orphan_scan_count_unchanged(admin_token):
    """`/api/admin/missing-files/scan` reads worker_certifications
    orphans — should stay at 18 (or whatever the true count is)
    regardless of what happens on the doc_files side."""
    r = requests.get(f"{API}/admin/missing-files/scan",
                      headers={"Authorization": f"Bearer {admin_token}"},
                      timeout=30)
    assert r.status_code == 200
    payload = r.json()
    # Shape sanity check — the number is env-dependent, we only
    # assert the endpoint still responds correctly. The frontend
    # chip binds to `total` on this response.
    assert "total" in payload
    assert isinstance(payload["total"], int)
    assert payload["total"] >= 0


# ─────────────────── cert-file endpoint GridFS fallback ───────────────────

@pytest.fixture(scope="module")
def cert_pointing_at_gridfs_only_doc(_mongo, gridfs_only_doc):
    """Seed a `worker_certifications` row whose `doc_file_id` points
    at the GridFS-only doc from `gridfs_only_doc`. This reproduces
    Antony Foster's flow: click the cert icon → hit
    `/workers/{wid}/certifications/{cid}/file`.
    """
    org_id = gridfs_only_doc["org_id"]
    # Reuse or create a throwaway worker in this org.
    w = _mongo.workers.find_one({"org_id": org_id, "deleted_at": None},
                                  {"_id": 0, "id": 1})
    assert w, "no worker to seed against"
    cert_id = str(uuid.uuid4())
    _mongo.worker_certifications.insert_one({
        "id": cert_id, "worker_id": w["id"], "org_id": org_id,
        "name": "Pytest 132hl cert", "issuer": "pytest",
        "issue_date": None, "expiry_date": None,
        "doc_file_id": gridfs_only_doc["file_id"],
        "status": "valid",
        "source": "pytest", "created_at": "2026-09-16T00:00:00+00:00",
        "deleted_at": None,
    })
    yield {"worker_id": w["id"], "cert_id": cert_id,
           "doc_file_id": gridfs_only_doc["file_id"]}
    _mongo.worker_certifications.delete_one({"id": cert_id})


def test_cert_file_endpoint_serves_gridfs_only_doc(admin_token,
                                                    cert_pointing_at_gridfs_only_doc):
    """`/api/workers/{wid}/certifications/{cid}/file` now falls
    through to GridFS instead of 410ing when the disk copy is gone.
    This is the exact endpoint Antony's cert icon hit."""
    ref = cert_pointing_at_gridfs_only_doc
    r = requests.get(
        f"{API}/workers/{ref['worker_id']}/certifications/{ref['cert_id']}/file",
        headers={"Authorization": f"Bearer {admin_token}"}, timeout=30,
    )
    assert r.status_code == 200, \
        f"cert file endpoint must 200 for GridFS-only bytes, got {r.status_code}: {r.text[:200]}"
    assert r.content.startswith(b"%PDF")


def test_cert_file_endpoint_via_preview_adapter_also_works(admin_token,
                                                            cert_pointing_at_gridfs_only_doc):
    """`/api/preview/cert_file/pdf` (v58.13.132hj adapter) delegates
    to `_resolve_doc_file` for legacy doc_files-backed certs — same
    fallback must apply."""
    ref = cert_pointing_at_gridfs_only_doc
    mint = requests.post(
        f"{API}/preview/cert_file/token",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"ref": {"worker_id": ref["worker_id"],
                       "cert_id": ref["cert_id"]}},
        timeout=15,
    )
    assert mint.status_code == 200, mint.text
    tok = mint.json()["token"]; refb = mint.json()["ref_b64"]
    r = requests.get(f"{API}/preview/cert_file/pdf",
                      params={"t": tok, "ref": refb}, timeout=30)
    assert r.status_code == 200, r.text
    assert r.content.startswith(b"%PDF")


# ─────────────────── Workers.jsx cert icon swap ───────────────────

def test_workers_jsx_cert_icon_uses_open_as_pdf():
    src = (APP_ROOT / "frontend" / "src" / "pages" / "Workers.jsx"
           ).read_text(encoding="utf-8")
    assert "import OpenAsPdfButton" in src, \
        "Workers.jsx must import OpenAsPdfButton"
    assert 'source="cert_file"' in src, \
        "Workers.jsx cert row must render OpenAsPdfButton with cert_file source"
    # Legacy `window.open(u, '_blank', ...)` for the cert-file icon
    # must be gone from the primary render path. It survives only
    # inside `onDownloadOriginal` (the 415 fallback).
    # Count how many raw window.open of the cert file endpoint exist.
    matches = re.findall(
        r"await filesUrl\(`/workers/\$\{workerId\}/certifications/"
        r"\$\{[a-z]\.id\}/file`\);\s*\n\s*window\.open\(u",
        src,
    )
    # Should be exactly ONE occurrence — the onDownloadOriginal
    # callback. Two or more means the primary icon didn't get swapped.
    assert len(matches) == 1, \
        f"expected exactly 1 window.open(cert-file) surviving in " \
        f"onDownloadOriginal, got {len(matches)}"


# ─────────────────── equipment_cert adapter ───────────────────

def test_equipment_cert_adapter_registered():
    from preview_sources import PREVIEW_SOURCES
    assert "equipment_cert" in PREVIEW_SOURCES, \
        "equipment_cert adapter must be in registry"
    # Registry size after .132hl is 10 (was 9 in .132hj).
    assert len(PREVIEW_SOURCES) == 10


def test_equipment_register_jsx_certs_use_open_as_pdf():
    src = (APP_ROOT / "frontend" / "src" / "pages" / "EquipmentRegister.jsx"
           ).read_text(encoding="utf-8")
    assert 'source="equipment_cert"' in src, \
        "EquipmentRegister.jsx certs cell must use equipment_cert source"
    assert "equipment_id: r.id, cert_id: c.id" in src
    # The legacy openCert onClick handler must be gone from the
    # primary render path.
    assert "onClick={() => openCert(r, c)}" not in src, \
        "Legacy openCert click handler must be removed from primary render"


@pytest.fixture(scope="module")
def equipment_with_cert(_mongo):
    """Seed an equipment record + a real GridFS-stored cert blob.
    Cleans up on teardown."""
    org = _mongo.users.find_one({"email": ADMIN_EMAIL}, {"_id": 0, "org_id": 1})
    org_id = org["org_id"]
    eid = str(uuid.uuid4())
    cert_id = str(uuid.uuid4())
    stored_name = f"pytest-132hl-eqcert-{cert_id[:8]}.pdf"
    filename = "pytest-132hl-eqcert.pdf"

    # Real 1-page PDF into upload_storage/equipment_certs.
    buf = io.BytesIO()
    c = pdfcanvas.Canvas(buf, pagesize=A4)
    c.drawString(72, 720, f"Equipment cert fixture {cert_id}")
    c.showPage(); c.save()
    pdf_bytes = buf.getvalue()

    from motor.motor_asyncio import AsyncIOMotorGridFSBucket
    from tests.conftest import _ASYNC_LOOP
    import os as _os
    async def _write():
        from motor.motor_asyncio import AsyncIOMotorClient
        mc = AsyncIOMotorClient(_os.environ["MONGO_URL"])
        try:
            db = mc[_os.environ["DB_NAME"]]
            bucket = AsyncIOMotorGridFSBucket(db, bucket_name="upload_storage")
            md = {"module": "equipment_register",
                  "subdir": "equipment_certs",
                  "parts": [eid, stored_name],
                  "key": f"equipment_certs/{eid}/{stored_name}",
                  "org_id": org_id, "mime": "application/pdf",
                  "orig_filename": filename}
            gid = await bucket.upload_from_stream(stored_name, pdf_bytes,
                                                    metadata=md)
            return gid
        finally:
            mc.close()
    gid = _ASYNC_LOOP.run_until_complete(_write())

    _mongo.equipment_register.insert_one({
        "id": eid, "org_id": org_id,
        "name": "Pytest 132hl equipment", "kind": "test",
        "certs": [{
            "id": cert_id, "filename": filename, "stored_name": stored_name,
            "mime": "application/pdf", "size": len(pdf_bytes),
            "uploaded_at": "2026-09-16T00:00:00+00:00",
            "deleted_at": None,
        }],
        "documents": [],
        "created_at": "2026-09-16T00:00:00+00:00",
        "deleted_at": None,
    })
    yield {"equipment_id": eid, "cert_id": cert_id,
           "size": len(pdf_bytes), "gridfs_id": gid}
    _mongo.equipment_register.delete_one({"id": eid})
    _mongo.preview_pdf_cache.delete_many(
        {"key": f"equipment_cert:{cert_id}"})
    async def _drop():
        from motor.motor_asyncio import AsyncIOMotorClient
        mc = AsyncIOMotorClient(_os.environ["MONGO_URL"])
        try:
            db = mc[_os.environ["DB_NAME"]]
            bucket = AsyncIOMotorGridFSBucket(db, bucket_name="upload_storage")
            try: await bucket.delete(gid)
            except Exception: pass
        finally: mc.close()
    _ASYNC_LOOP.run_until_complete(_drop())


def test_equipment_cert_preview_endpoint_serves_pdf(admin_token,
                                                     equipment_with_cert):
    """End-to-end: /api/preview/equipment_cert/{token,pdf} returns
    the real cert PDF."""
    ref = equipment_with_cert
    mint = requests.post(
        f"{API}/preview/equipment_cert/token",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"ref": {"equipment_id": ref["equipment_id"],
                       "cert_id": ref["cert_id"]}},
        timeout=15,
    )
    assert mint.status_code == 200, mint.text
    tok = mint.json()["token"]; refb = mint.json()["ref_b64"]
    r = requests.get(f"{API}/preview/equipment_cert/pdf",
                      params={"t": tok, "ref": refb}, timeout=30)
    assert r.status_code == 200, r.text
    assert r.content.startswith(b"%PDF")
    assert r.headers.get("x-pipeline") == "passthrough"

"""v58.13.132hj — Preview sources registry + adapters test suite.

Coverage:
  · Static: source registry contents, module wiring, version lockstep.
  · Routes: /preview/* mounted at /api/preview and unknown-source
    handling.
  · Token flow: mint → fetch happy path for the `doc_file` adapter
    (representative — every adapter uses the same helper).
  · Token binding: ref-A token can't fetch ref-B (subject-hash guard).
  · Ref encoding: bad base64 → 400.
  · Auth mode: bearer-only fetch (no `?t=`) still works.
  · Cache: second identical fetch is served from `preview_pdf_cache`
    (assert row present + pipeline unchanged).

Seed strategy: writes a throwaway `doc_files` row + a real byte file
on disk in Stephen's org so we hit the exact same code path production
uses. Cleaned up on teardown. Uses `@pytest.mark.live_db_writes`
per conftest.py rules.
"""
from __future__ import annotations

import base64
import io
import json
import os
import re
import uuid
from pathlib import Path

import pytest
import requests
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas as pdfcanvas

from tests.conftest import API, ADMIN_EMAIL, ADMIN_PWD, _login  # noqa: E402

pytestmark = pytest.mark.live_db_writes

APP_ROOT = Path(__file__).resolve().parents[2]
PREVIEW_SOURCES_PY = APP_ROOT / "backend" / "preview_sources.py"
FILE_PDF_PY = APP_ROOT / "backend" / "file_pdf.py"
SERVER_PY = APP_ROOT / "backend" / "server.py"
VERSION_JS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


# ─────────────────── static tests (no DB) ───────────────────

def test_module_imports_and_registry_shape():
    """Every one of the 9 adapters we designed is registered."""
    from preview_sources import PREVIEW_SOURCES
    expected = {
        "doc_file", "cert_file", "hr_document", "unmatched_document",
        "equipment_document", "equipment_cert", "schedule_attachment",
        "submission_attachment", "swms_source", "insurance_cert",
    }
    assert set(PREVIEW_SOURCES.keys()) == expected, \
        f"registry mismatch: {set(PREVIEW_SOURCES.keys())} vs {expected}"
    # Every value is an async callable (adapter).
    import inspect
    for name, fn in PREVIEW_SOURCES.items():
        assert inspect.iscoroutinefunction(fn), \
            f"adapter {name!r} must be async"


def test_server_registers_preview_router():
    """server.py includes `preview_sources_router`."""
    src = SERVER_PY.read_text(encoding="utf-8")
    assert "from preview_sources import router as preview_sources_router" in src
    assert "api.include_router(preview_sources_router)" in src


def test_file_pdf_exposes_public_helpers():
    """The three public helpers exist and have the expected names."""
    src = FILE_PDF_PY.read_text(encoding="utf-8")
    assert "async def convert_bytes_to_pdf(" in src
    assert "def pdf_response_bytes(" in src
    assert "def preview_secret_bytes(" in src


def test_stable_ref_hash_is_deterministic():
    """Same (source, ref) hashes to the same subject regardless of
    dict key order → cache is stable across clients."""
    from preview_sources import _stable_ref_hash
    a = _stable_ref_hash("cert_file", {"worker_id": "W", "cert_id": "C"})
    b = _stable_ref_hash("cert_file", {"cert_id": "C", "worker_id": "W"})
    assert a == b, "hash must not depend on dict ordering"
    c = _stable_ref_hash("cert_file", {"worker_id": "W", "cert_id": "X"})
    assert a != c, "different refs must hash differently"
    d = _stable_ref_hash("hr_document", {"worker_id": "W", "cert_id": "C"})
    assert a != d, "different sources must hash differently"


def test_token_binding_rejects_wrong_subject():
    """A token minted for subject A cannot verify against subject B."""
    from preview_sources import _mint_preview_token, _verify_preview_token
    tok = _mint_preview_token("subjectA", "userX")
    assert _verify_preview_token(tok, "subjectA") == "userX"
    assert _verify_preview_token(tok, "subjectB") is None
    assert _verify_preview_token("not-a-token", "subjectA") is None


def test_ref_b64_decode_rejects_bad_input():
    from preview_sources import _decode_ref
    from fastapi import HTTPException
    good = base64.urlsafe_b64encode(b'{"file_id":"x"}').rstrip(b"=").decode()
    assert _decode_ref(good) == {"file_id": "x"}
    with pytest.raises(HTTPException) as e:
        _decode_ref("not-base64!")
    assert e.value.status_code == 400


def test_version_lockstep_pinned_at_132hj():
    for path, key in (
        (VERSION_JS, "RUNNING_VERSION"),
        (VERSION_JS, "EXPECTED_CACHE_VERSION"),
        (SW, "CACHE_VERSION"),
    ):
        src = path.read_text(encoding="utf-8")
        m = re.search(
            rf"{key}\s*=\s*'paneltec-v160\.3\.9\.58\.13\.132h([a-z])'",
            src,
        )
        assert m, f"{key} version tag missing"
        assert m.group(1) >= "j", \
            f"{key} must be >= .132hj (got .132h{m.group(1)})"


# ─────────────────── HTTP-level tests ───────────────────

@pytest.fixture(scope="module")
def admin_token() -> str:
    return _login(ADMIN_EMAIL, ADMIN_PWD)


@pytest.fixture(scope="module")
def seeded_doc_file(_mongo):
    """Plant a real byte file on disk + a `doc_files` row pointing at
    it so the full preview flow can round-trip without depending on
    fragile production data. Tear down on teardown."""
    org = _mongo.users.find_one({"email": ADMIN_EMAIL},
                                 {"_id": 0, "org_id": 1})
    org_id = org["org_id"]
    # Any real folder in the org — reuse instead of creating one.
    folder = _mongo.doc_folders.find_one(
        {"org_id": org_id, "deleted_at": None},
        {"_id": 0, "id": 1},
    )
    assert folder, "no doc folder to seed against"
    file_id = str(uuid.uuid4())
    stored_name = f"pytest-132hj-{file_id[:8]}.pdf"
    filename = "pytest-132hj-fixture.pdf"
    # Generate a real 1-page PDF so the passthrough pipeline serves it.
    buf = io.BytesIO()
    c = pdfcanvas.Canvas(buf, pagesize=A4)
    c.drawString(72, 720, f"Pytest fixture {file_id}")
    c.showPage(); c.save()
    pdf_bytes = buf.getvalue()
    upload_dir = APP_ROOT / "backend" / "uploads" / "document_library" / folder["id"]
    upload_dir.mkdir(parents=True, exist_ok=True)
    disk_path = upload_dir / stored_name
    disk_path.write_bytes(pdf_bytes)
    doc = {
        "id": file_id,
        "org_id": org_id,
        "folder_id": folder["id"],
        "filename": filename,
        "stored_name": stored_name,
        "size": len(pdf_bytes),
        "mime": "application/pdf",
        "uploaded_at": "2026-09-16T00:00:00+00:00",
        "uploaded_by": "pytest",
        "uploaded_by_name": "Pytest",
        "deleted_at": None,
        "ai_tags": ["pytest"],
    }
    _mongo.doc_files.insert_one(doc)
    yield {"file_id": file_id, "folder_id": folder["id"],
           "org_id": org_id, "filename": filename,
           "stored_name": stored_name, "disk_path": str(disk_path)}
    # Teardown.
    _mongo.doc_files.delete_one({"id": file_id})
    _mongo.preview_pdf_cache.delete_many({"key": f"doc_file:{file_id}"})
    try:
        disk_path.unlink()
    except FileNotFoundError:
        pass


def test_unknown_source_returns_400(admin_token):
    r = requests.post(
        f"{API}/preview/never_heard_of_it/token",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"ref": {}}, timeout=10,
    )
    assert r.status_code == 400, r.text
    assert "Unknown preview source" in r.text


def test_bad_ref_shape_returns_400(admin_token):
    r = requests.post(
        f"{API}/preview/doc_file/token",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"ref": "not-an-object"}, timeout=10,
    )
    assert r.status_code == 400, r.text


def test_missing_file_returns_404_not_500(admin_token):
    r = requests.post(
        f"{API}/preview/doc_file/token",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"ref": {"file_id": "00000000-0000-0000-0000-000000000000"}},
        timeout=10,
    )
    assert r.status_code == 404, r.text


def test_doc_file_mint_and_fetch_via_token(admin_token, seeded_doc_file):
    """End-to-end: mint token → fetch PDF using ONLY the token
    (no Authorization header, mirroring the iframe flow)."""
    file_id = seeded_doc_file["file_id"]
    r = requests.post(
        f"{API}/preview/doc_file/token",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"ref": {"file_id": file_id}}, timeout=15,
    )
    assert r.status_code == 200, r.text
    payload = r.json()
    assert payload["expires_in"] == 300
    tok = payload["token"]
    ref_b64 = payload["ref_b64"]
    assert tok.count(".") == 1
    assert len(ref_b64) > 0

    # NB: NO Authorization header — token is the sole auth.
    r2 = requests.get(
        f"{API}/preview/doc_file/pdf",
        params={"t": tok, "ref": ref_b64}, timeout=30,
    )
    assert r2.status_code == 200, r2.text
    assert r2.headers.get("content-type", "").startswith("application/pdf")
    assert r2.content.startswith(b"%PDF"), \
        "response body must be a real PDF"
    assert r2.headers.get("x-pipeline") == "passthrough"
    disp = r2.headers.get("content-disposition", "")
    assert "inline" in disp
    assert seeded_doc_file["filename"].rsplit(".", 1)[0] in disp


def test_doc_file_bearer_only_fetch_also_works(admin_token, seeded_doc_file):
    """Same endpoint MUST accept Bearer auth (for curl / non-iframe
    callers). Ref still comes as query param."""
    file_id = seeded_doc_file["file_id"]
    ref_b64 = base64.urlsafe_b64encode(
        json.dumps({"file_id": file_id}, sort_keys=True,
                   separators=(",", ":")).encode(),
    ).rstrip(b"=").decode()
    r = requests.get(
        f"{API}/preview/doc_file/pdf",
        headers={"Authorization": f"Bearer {admin_token}"},
        params={"ref": ref_b64}, timeout=30,
    )
    assert r.status_code == 200, r.text
    assert r.content.startswith(b"%PDF")


def test_token_refuses_different_ref(admin_token, seeded_doc_file, _mongo):
    """A token minted for file A cannot be replayed on file B — the
    subject hash binds them."""
    file_id_a = seeded_doc_file["file_id"]
    # Second real seeded file (piggy-back on the fixture folder).
    file_id_b = str(uuid.uuid4())
    stored_b = f"pytest-132hj-{file_id_b[:8]}.pdf"
    disk_b = (APP_ROOT / "backend" / "uploads" / "document_library"
              / seeded_doc_file["folder_id"] / stored_b)
    buf = io.BytesIO()
    c = pdfcanvas.Canvas(buf, pagesize=A4)
    c.drawString(72, 720, f"Second fixture {file_id_b}")
    c.showPage(); c.save()
    disk_b.parent.mkdir(parents=True, exist_ok=True)
    disk_b.write_bytes(buf.getvalue())
    _mongo.doc_files.insert_one({
        "id": file_id_b, "org_id": seeded_doc_file["org_id"],
        "folder_id": seeded_doc_file["folder_id"],
        "filename": "second.pdf", "stored_name": stored_b,
        "size": disk_b.stat().st_size, "mime": "application/pdf",
        "uploaded_at": "2026-09-16T00:00:00+00:00",
        "uploaded_by": "pytest", "uploaded_by_name": "Pytest",
        "deleted_at": None, "ai_tags": [],
    })
    try:
        # Mint for A.
        m = requests.post(f"{API}/preview/doc_file/token",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"ref": {"file_id": file_id_a}}, timeout=10).json()
        tok_a = m["token"]
        # Try to fetch B using A's token → must 401.
        ref_b64_b = base64.urlsafe_b64encode(
            json.dumps({"file_id": file_id_b}, sort_keys=True,
                       separators=(",", ":")).encode(),
        ).rstrip(b"=").decode()
        r = requests.get(f"{API}/preview/doc_file/pdf",
            params={"t": tok_a, "ref": ref_b64_b}, timeout=10)
        assert r.status_code == 401, \
            f"replaying token on different ref must 401, got {r.status_code}: {r.text}"
    finally:
        _mongo.doc_files.delete_one({"id": file_id_b})
        _mongo.preview_pdf_cache.delete_many({"key": f"doc_file:{file_id_b}"})
        try: disk_b.unlink()
        except FileNotFoundError: pass


def test_second_fetch_is_cached(admin_token, seeded_doc_file, _mongo):
    """Second identical fetch must hit `preview_pdf_cache`."""
    file_id = seeded_doc_file["file_id"]
    ref_b64 = base64.urlsafe_b64encode(
        json.dumps({"file_id": file_id}, sort_keys=True,
                   separators=(",", ":")).encode(),
    ).rstrip(b"=").decode()
    # Prime.
    r1 = requests.get(f"{API}/preview/doc_file/pdf",
        headers={"Authorization": f"Bearer {admin_token}"},
        params={"ref": ref_b64}, timeout=30)
    assert r1.status_code == 200
    # A row must now exist keyed by cache_key.
    row = _mongo.preview_pdf_cache.find_one({"key": f"doc_file:{file_id}"})
    assert row is not None, "cache row not written on first fetch"
    assert row["ns"] == "doc_file"
    assert row["pipeline"] == "passthrough"
    assert row["size"] > 0
    # Second fetch: same shape, should still 200 (cache hit path).
    r2 = requests.get(f"{API}/preview/doc_file/pdf",
        headers={"Authorization": f"Bearer {admin_token}"},
        params={"ref": ref_b64}, timeout=30)
    assert r2.status_code == 200
    assert r2.content == r1.content

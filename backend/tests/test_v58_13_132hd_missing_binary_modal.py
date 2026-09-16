"""v58.13.132hd — Missing-binary drill-down modal.

Locks in:
  · GET /counts/missing-binary (admin-only, returns orphan list
    with folder_path + uploader + size).
  · POST /files/{id}/replace-binary (admin-only, rewrites GridFS
    under the same metadata.key so file_url still resolves; audit
    entry `binary_replaced`).
  · POST /files/{id}/mark-gone (admin-only, soft-deletes with
    reason `permanently_gone_missing_binary`; audit entry
    `marked_permanently_gone`).
  · Frontend MissingBinaryModal + MissingBinaryRow.
  · Amber chip becomes clickable for admins only.
  · CSV export button.
"""
from __future__ import annotations

import re
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[2]
DOCLIB_PY = APP_ROOT / "backend" / "document_library.py"
DOCLIB_JSX = APP_ROOT / "frontend" / "src" / "pages" / "DocumentLibrary.jsx"
VERSION_JS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


# ─── Backend endpoints ─────────────────────────────────────────

def test_missing_binary_endpoint_defined_admin_only():
    src = _read(DOCLIB_PY)
    assert '@router.get("/counts/missing-binary")' in src
    m = re.search(
        r'@router\.get\("/counts/missing-binary"\).*?return \{"count": len\(orphans\)',
        src, re.DOTALL,
    )
    assert m, "/counts/missing-binary handler body not found"
    body = m.group(0)
    assert '_require(user, {"admin"}' in body, "must be admin-gated"
    # Response fields
    for k in ('"id":', '"filename":', '"folder_path":', '"size":',
              '"mime":', '"uploaded_at":', '"uploaded_by_name":',
              '"file_url":'):
        assert k in body, f"orphan payload missing {k}"


def test_replace_binary_endpoint_defined_admin_only():
    src = _read(DOCLIB_PY)
    assert '@router.post("/files/{file_id}/replace-binary")' in src
    m = re.search(
        r'@router\.post\("/files/\{file_id\}/replace-binary"\).*?return \{"ok": True',
        src, re.DOTALL,
    )
    assert m, "replace-binary handler not found"
    body = m.group(0)
    assert '_require(user, {"admin"}' in body, "must be admin-gated"
    assert 'save_upload(' in body, "must write into GridFS via save_upload()"
    assert '"binary_replaced"' in body, "audit action must be recorded"
    assert 'MAX_FILE_BYTES' in body, "must enforce 50 MB cap"


def test_mark_gone_endpoint_defined_admin_only():
    src = _read(DOCLIB_PY)
    assert '@router.post("/files/{file_id}/mark-gone")' in src
    m = re.search(
        r'@router\.post\("/files/\{file_id\}/mark-gone"\).*?return \{"ok": True\}',
        src, re.DOTALL,
    )
    assert m, "mark-gone handler not found"
    body = m.group(0)
    assert '_require(user, {"admin"}' in body
    assert '"deleted_at": now_iso()' in body, "must soft-delete"
    assert '"permanently_gone_missing_binary"' in body, "reason must be stamped"
    assert '"marked_permanently_gone"' in body, "audit action must be recorded"


# ─── Frontend modal ────────────────────────────────────────────

def test_countspill_opens_modal_on_missing_chip_admin_only():
    src = _read(DOCLIB_JSX)
    assert "MissingBinaryModal" in src, "modal must be referenced from CountsPill"
    assert "canManage = (user?.role === 'admin')" in src, \
        "admin gate on the clickable chip"
    assert "setModalOpen(true)" in src, "chip must open the modal"


def test_missing_binary_modal_defined_with_testids():
    src = _read(DOCLIB_JSX)
    assert re.search(r'^function MissingBinaryModal\(', src, re.M), \
        "MissingBinaryModal component missing"
    required = [
        'data-testid="missing-binary-modal"',
        'data-testid="missing-binary-close"',
        'data-testid="missing-binary-count"',
        'data-testid="missing-binary-export-csv"',
        "data-testid={`missing-binary-row-${row.id}`}",
        "data-testid={`missing-binary-replace-${row.id}`}",
        "data-testid={`missing-binary-replace-input-${row.id}`}",
        "data-testid={`missing-binary-mark-gone-${row.id}`}",
    ]
    for tid in required:
        assert tid in src, f"Missing testid: {tid}"


def test_modal_fetches_endpoint():
    src = _read(DOCLIB_JSX)
    assert "api.get('/document-library/counts/missing-binary')" in src, \
        "modal must fetch the orphan list endpoint"


def test_replace_posts_multipart():
    src = _read(DOCLIB_JSX)
    assert "api.post(`/document-library/files/${row.id}/replace-binary`" in src
    assert "'Content-Type': 'multipart/form-data'" in src, \
        "replace must send multipart/form-data"
    assert "fd.append('replacement', file)" in src, \
        "replacement field name must match backend expectation"


def test_mark_gone_posts_correct_endpoint():
    src = _read(DOCLIB_JSX)
    assert "api.post(`/document-library/files/${row.id}/mark-gone`)" in src


def test_csv_export_present():
    src = _read(DOCLIB_JSX)
    assert "const exportCSV = () =>" in src
    assert "text/csv" in src
    assert "paneltec-missing-binaries-" in src


# ─── Version lockstep ──────────────────────────────────────────

def test_version_lockstep_pinned_at_132hd():
    for path, key in (
        (VERSION_JS, "RUNNING_VERSION"),
        (VERSION_JS, "EXPECTED_CACHE_VERSION"),
        (SW, "CACHE_VERSION"),
    ):
        m = re.search(
            rf"{key}\s*=\s*'paneltec-v160\.3\.9\.58\.13\.132h([a-z])'",
            _read(path),
        )
        assert m, f"{key} not pinned to .132h?"
        assert m.group(1) >= "d", f"{key} must be >= .132hd"

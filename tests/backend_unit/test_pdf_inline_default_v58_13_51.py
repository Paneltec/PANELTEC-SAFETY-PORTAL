"""v58.13.51 — PDF open-inline default.

The user reported that clicking a file icon in the UI triggered a
"Save As" prompt instead of opening the PDF in a browser tab. Root
cause: Starlette's `FileResponse(filename=...)` defaults to
`Content-Disposition: attachment` when a filename is supplied, and
three of our view-oriented file-serving endpoints did not override
that default.

Fix (this ship):
  1. `asset_service.serve_schedule_attachment`
     `GET /api/assets/{asset_id}/schedules/{sid}/attachments/{stored_name}`
  2. `forms.serve_submission_attachment`
     `GET /api/forms/submissions/{submission_id}/attachments/{stored_name}`
  3. `simpro_zip_import.stream_cert_file` (disk branch only — the
     GridFS branch was already correct via `_stream_gridfs`)
     `GET /api/workers/{worker_id}/certifications/{cert_id}/file`

Each now:
  - Accepts optional `?download: int = Query(0, ge=0, le=1)`
  - Passes `content_disposition_type="inline"` by default
  - Passes `content_disposition_type="attachment"` when `?download=1`

This gives the UI the "open a PDF in a new tab" behaviour the user
asked for while preserving an explicit opt-out for bulk-export or
"save the invoice" flows.

Test strategy: static source-code assertions. TestClient-based
end-to-end would need an authed session + scratch records, which
`test_schedule_attachments_v58_13_14.py` already provides. This
suite is intentionally hermetic — it fails the moment the fix is
reverted, regardless of DB state.

Cross-cut: `Content-Disposition: attachment` is deliberately kept
on true DOWNLOAD paths (e.g. `document_library.download_file`
`GET /api/document-library/files/{file_id}/download`, backup
snapshot zip export, workers-inductions matrix XLSX export,
sites-signon CSV/PDF export). The audit table lives in the
v58.13.51 changelog block inside `frontend/src/lib/version.js`.
"""
from __future__ import annotations

import re
from pathlib import Path


_BACKEND = Path("/app/backend")


def _read(name: str) -> str:
    return (_BACKEND / name).read_text(encoding="utf-8")


# ── 1. asset_service.py — schedule attachments ─────────────────────


def test_schedule_attachment_endpoint_defaults_to_inline():
    src = _read("asset_service.py")
    # Locate the endpoint block.
    marker = "@router.get(\"/{asset_id}/schedules/{sid}/attachments/{stored_name}\")"
    assert marker in src, "endpoint decorator moved or renamed"
    block = src.split(marker, 1)[1].split("\n\n\n", 1)[0]
    # Optional download query param present and defaults to 0.
    assert re.search(
        r"download:\s*int\s*=\s*Query\(\s*0\s*,\s*ge\s*=\s*0\s*,\s*le\s*=\s*1\s*\)",
        block,
    ), "expected `download: int = Query(0, ge=0, le=1)` in serve_schedule_attachment"
    # FileResponse uses content_disposition_type based on download flag.
    assert re.search(
        r'content_disposition_type\s*=\s*"attachment"\s+if\s+download\s+else\s+"inline"',
        block,
    ), "expected ternary content_disposition_type on FileResponse"


# ── 2. forms.py — submission attachments ───────────────────────────


def test_submission_attachment_endpoint_defaults_to_inline():
    src = _read("forms.py")
    marker = "async def serve_submission_attachment"
    assert marker in src, "serve_submission_attachment moved or renamed"
    block = src.split(marker, 1)[1].split("\n\n\n", 1)[0]
    assert re.search(
        r"download:\s*int\s*=\s*Query\(\s*0\s*,\s*ge\s*=\s*0\s*,\s*le\s*=\s*1\s*\)",
        block,
    ), "expected `download: int = Query(0, ge=0, le=1)` in serve_submission_attachment"
    assert re.search(
        r'content_disposition_type\s*=\s*"attachment"\s+if\s+download\s+else\s+"inline"',
        block,
    ), "expected ternary content_disposition_type on FileResponse"


# ── 3. simpro_zip_import.py — cert-file disk branch ─────────────────


def test_cert_file_disk_branch_defaults_to_inline():
    src = _read("simpro_zip_import.py")
    marker = "async def stream_cert_file"
    assert marker in src, "stream_cert_file moved or renamed"
    block = src.split(marker, 1)[1].split("\n\n\n", 1)[0]
    assert re.search(
        r"download:\s*int\s*=\s*Query\(\s*0\s*,\s*ge\s*=\s*0\s*,\s*le\s*=\s*1\s*\)",
        block,
    ), "expected `download: int = Query(0, ge=0, le=1)` in stream_cert_file"
    assert re.search(
        r'content_disposition_type\s*=\s*"attachment"\s+if\s+download\s+else\s+"inline"',
        block,
    ), "expected ternary content_disposition_type on FileResponse (disk branch)"


# ── 5. Version-sync pin for this ship ───────────────────────────────
# Documented recurrence: hard-coded version literals inside tests
# break on subsequent bumps. To avoid this test self-invalidating
# after the next ship, we only assert that the .51 fixture files
# have MOVED PAST .50 — the forward-safe assertion pattern.
# The .51 literal itself is intentionally NOT pinned here; the
# next ship's own test will pin its own version. This test only
# proves the .50 → forward transition survived the .51 ship.


def test_version_sync_moved_past_v58_13_50():
    v_js = Path("/app/frontend/src/lib/version.js").read_text(encoding="utf-8")
    m_ts = Path("/app/mobile/src/lib/version.ts").read_text(encoding="utf-8")
    sw_js = Path("/app/frontend/public/service-worker.js").read_text(encoding="utf-8")
    assert "RUNNING_VERSION = 'paneltec-v160.3.9.58.13.50'" not in v_js
    assert "'paneltec-v160.3.9.58.13.50'" not in m_ts
    assert "'paneltec-v160.3.9.58.13.50'" not in sw_js
    # And the ship this test was born with — .51 — was reached at
    # some point. The `# v160.3.9.58.13.51 —` changelog block in
    # version.js is the historical marker; grepping for it also
    # protects against an accidental history rewrite that removes
    # the .51 ship note.
    assert "v160.3.9.58.13.51" in v_js, (
        "v58.13.51 changelog block missing from version.js — history rewrite?"
    )


# ── 4. Cross-cut: explicit download paths retain attachment ─────────
# We deliberately preserve `attachment` disposition on endpoints
# where the caller has explicitly asked to SAVE the file. Regressing
# those would be equally wrong. This test pins the current shape.


def test_explicit_download_endpoints_keep_attachment_disposition():
    """A short list of endpoints that MUST NOT default to inline."""
    # 4a. document_library.py — `/files/{file_id}/download` is a
    #      named download route, called from the "Download original"
    #      button in `DocumentLibraryFolder`. Passes `filename=` and
    #      does NOT pass `content_disposition_type=inline`, so
    #      Starlette's default (`attachment`) applies.
    dl = _read("document_library.py")
    block = dl.split("async def download_file", 1)[1].split("\n\n\n", 1)[0]
    assert "filename=doc.get(\"filename\")" in block, (
        "document_library download route lost its filename kwarg — "
        "verify the explicit-download endpoint still emits attachment"
    )
    assert 'content_disposition_type="inline"' not in block, (
        "document_library download route must NOT default to inline"
    )
    # 4b. sites_signon_v127.py — CSV/PDF exports of the sign-in log.
    #      These are bulk-download endpoints, not view endpoints.
    ss = _read("sites_signon_v127.py")
    assert 'attachment; filename="signon-log-' in ss, (
        "sites_signon export lost its explicit attachment disposition"
    )
    # 4c. backup_service.py — snapshot zip export.
    bs = _read("backup_service.py")
    assert 'attachment; filename=' in bs, (
        "backup_service snapshot export lost its explicit attachment disposition"
    )

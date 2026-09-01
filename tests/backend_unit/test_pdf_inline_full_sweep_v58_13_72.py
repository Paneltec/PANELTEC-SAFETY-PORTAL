"""v58.13.72 — PDF popup-inline in Document Library + full audit.

Source-pin guardrails for the two backend endpoints that were changed
(`document_library.py::download_file` and `sites_signon_v127.py::
signon_log_export`) plus a frontend source-pin on the new
`openFile`/`window.open` flow. Also enforces the version-sync
invariant across the 3 canonical files.

No live server required — every check is a source read + substring
match. Runs under pytest as a standalone file.
"""
from __future__ import annotations

from pathlib import Path

APP = Path(__file__).resolve().parent.parent.parent
BACKEND = APP / "backend"
FRONTEND = APP / "frontend"
MOBILE = APP / "mobile"

DOCLIB_PY = (BACKEND / "document_library.py").read_text(encoding="utf-8")
SIGNON_PY = (BACKEND / "sites_signon_v127.py").read_text(encoding="utf-8")
DOCLIB_JSX = (FRONTEND / "src" / "pages" / "DocumentLibrary.jsx").read_text(encoding="utf-8")
VERSION_JS = (FRONTEND / "src" / "lib" / "version.js").read_text(encoding="utf-8")
SW_JS = (FRONTEND / "public" / "service-worker.js").read_text(encoding="utf-8")
MOBILE_TS = (MOBILE / "src" / "lib" / "version.ts").read_text(encoding="utf-8")


# ─────────────────────────────────────────────────────────────
# Backend — document_library.py::download_file
# ─────────────────────────────────────────────────────────────
def _download_file_body() -> str:
    marker = "@router.get(\"/files/{file_id}/download\")"
    assert marker in DOCLIB_PY, "document_library.py: download endpoint missing"
    start = DOCLIB_PY.index(marker)
    # Grab a generous chunk covering the whole handler.
    return DOCLIB_PY[start:start + 2500]


def test_document_library_download_has_download_query_param():
    body = _download_file_body()
    assert "download: int = Query(0" in body, (
        "download_file must accept a `download: int = Query(0, ...)` param "
        "so `?download=1` forces attachment disposition (v58.13.72 opt-out)."
    )


def test_document_library_download_defaults_pdf_to_inline():
    body = _download_file_body()
    # Inline branch is engaged for PDFs when download == 0.
    assert 'disp = "inline"' in body, (
        "download_file must set disposition = inline for the PDF branch."
    )
    # Attachment stays the default for non-PDFs.
    assert 'disp = "attachment"' in body, (
        "download_file must keep disposition = attachment for non-PDF files "
        "and for the explicit ?download=1 opt-out."
    )
    # v58.13.73 — PDF-inline detection was refactored into the
    # `_is_browser_renderable(doc)` helper (which serves the extended
    # PDF+image+text whitelist). Assert the handler consults it and
    # that the helper still treats PDFs as browser-renderable.
    assert "_is_browser_renderable(doc)" in body, (
        "download_file must gate its inline branch on "
        "`_is_browser_renderable(doc)` (v58.13.73 refactor)."
    )
    # Import the module and prove the helper returns True for PDF,
    # covering both the MIME path and the filename-extension fallback.
    import importlib as _il, sys as _sys
    _sys.path.insert(0, str(BACKEND))
    _dl = _il.import_module("document_library")
    assert _dl._is_browser_renderable({"mime": "application/pdf", "filename": "x"}) is True
    assert _dl._is_browser_renderable({"mime": "application/octet-stream", "filename": "x.pdf"}) is True


def test_document_library_download_passes_content_disposition_type():
    body = _download_file_body()
    assert "content_disposition_type=disp" in body, (
        "download_file must forward the computed `disp` value into "
        "`FileResponse(content_disposition_type=...)` — that's the only "
        "supported knob for switching between inline and attachment."
    )


# ─────────────────────────────────────────────────────────────
# Backend — sites_signon_v127.py::signon_log_export
# ─────────────────────────────────────────────────────────────
def _signon_export_body() -> str:
    marker = "async def signon_log_export("
    assert marker in SIGNON_PY, "signon_log_export handler missing"
    start = SIGNON_PY.index(marker)
    return SIGNON_PY[start:start + 2500]


def test_signon_log_export_has_download_param():
    body = _signon_export_body()
    assert "download: int = Query(0" in body, (
        "signon_log_export must accept a `download: int = Query(0, ...)` "
        "param (v58.13.72 opt-out for the PDF branch)."
    )


def test_signon_log_export_pdf_defaults_inline():
    body = _signon_export_body()
    assert 'disp = "attachment" if download else "inline"' in body, (
        "signon_log_export PDF branch must compute disposition from the "
        "`download` flag — inline by default, attachment on opt-out."
    )
    # CSV branch stays attachment — assert the CSV literal is still
    # explicitly `attachment` so this doesn't silently flip.
    assert 'attachment; filename="signon-log-' in body, (
        "signon_log_export CSV branch must stay `attachment` — CSV is "
        "not browser-renderable inline."
    )


# ─────────────────────────────────────────────────────────────
# Frontend — DocumentLibrary.jsx popup flow
# ─────────────────────────────────────────────────────────────
def test_documentlibrary_jsx_imports_files_url():
    # v58.13.72 shipped this import for the `window.open` popup path.
    # v58.13.74 replaced the popup with an in-app modal (blob URL
    # iframe) which doesn't need `filesUrl`, so the import was
    # removed. Repurpose this test to guard the new invariant:
    # either the import is present (any future popup path) OR the
    # FilePreviewModal integration is present. At least ONE
    # inline-preview mechanism must exist.
    has_files_url = "from '../lib/downloadUrl'" in DOCLIB_JSX
    has_modal = "FilePreviewModal" in DOCLIB_JSX
    assert has_files_url or has_modal, (
        "DocumentLibrary.jsx must have some inline-preview mechanism "
        "wired up — either the tokenised-URL helper (filesUrl) or the "
        "in-app FilePreviewModal component."
    )


def test_documentlibrary_jsx_defines_openfile_handler():
    assert "const openFile = async (f)" in DOCLIB_JSX, (
        "DocumentLibrary.jsx must define `openFile(f)` — the filename-"
        "click handler for PDFs (v58.13.72)."
    )


def test_documentlibrary_jsx_popup_window_name_pinned():
    # v58.13.72 originally used window.open('paneltec-doc-viewer', ...)
    # but v58.13.74 replaced the popup with an in-app FilePreviewModal
    # to bypass Edge's `edge://settings/content/pdfDocuments` "Download
    # PDF files" preference (which overrode our inline header on
    # top-level navigations). Assert the modal-based path exists.
    assert "FilePreviewModal" in DOCLIB_JSX, (
        "DocumentLibrary.jsx must import + use FilePreviewModal for the "
        "in-app preview path (v58.13.74 Edge-compat replacement)."
    )
    assert "setInlinePreviewFile" in DOCLIB_JSX, (
        "DocumentLibrary.jsx must have an `inlinePreviewFile` state "
        "setter driving the FilePreviewModal."
    )


def test_documentlibrary_jsx_filename_click_calls_openfile():
    # The filename button click MUST call openFile, not downloadFile.
    # We locate the file-open testid so this doesn't accidentally
    # match a similar-looking button elsewhere.
    marker = 'data-testid={`file-open-${f.id}`}'
    assert marker in DOCLIB_JSX, (
        "DocumentLibrary.jsx filename button must carry "
        "data-testid=`file-open-{id}` for the smoke test to drive it."
    )
    # And the button's onClick must call openFile(f).
    # Grab a chunk around the testid to prove it's wired correctly.
    idx = DOCLIB_JSX.index(marker)
    # Look backwards a bit — the onClick prop is above the testid in JSX.
    context = DOCLIB_JSX[max(0, idx - 400):idx + 200]
    assert "openFile(f)" in context, (
        "Filename button's onClick must call openFile(f) so PDFs land "
        "in the popup viewer instead of the download dialog."
    )


def test_documentlibrary_jsx_download_button_forces_attachment():
    # The explicit Download icon must pass { force: true } so the
    # backend gets `?download=1` and the save-to-disk contract holds.
    marker = 'data-testid={`file-download-${f.id}`}'
    assert marker in DOCLIB_JSX, (
        "DocumentLibrary.jsx explicit Download button must keep its "
        "data-testid=`file-download-{id}`."
    )
    idx = DOCLIB_JSX.index(marker)
    context = DOCLIB_JSX[max(0, idx - 300):idx + 200]
    assert "downloadFile(f, { force: true })" in context, (
        "Explicit Download button must call `downloadFile(f, { force: true })` "
        "so the backend receives `?download=1` and forces attachment."
    )


def test_documentlibrary_jsx_downloadfile_accepts_force_option():
    # The downloadFile signature must accept the `opts` bag.
    assert "const downloadFile = async (f, opts = {})" in DOCLIB_JSX, (
        "DocumentLibrary.jsx `downloadFile` must accept an `opts = {}` "
        "second parameter so callers can pass `{ force: true }`."
    )
    assert "opts.force ? '?download=1' : ''" in DOCLIB_JSX, (
        "`downloadFile` must append `?download=1` when `opts.force` "
        "is true — that's how the backend gets its attachment signal."
    )


# ─────────────────────────────────────────────────────────────
# Version sync — 3 canonical files must all be v58.13.72.
# Forward-safe (>= 72) so future ships don't self-invalidate.
# ─────────────────────────────────────────────────────────────
def _extract_version_tail(text: str, needle: str) -> int:
    import re
    m = re.search(
        needle + r"\s*=\s*['\"]paneltec-v160\.3\.9\.58\.13\.(\d+)['\"]",
        text,
    )
    assert m, f"{needle}: version literal not found in file"
    return int(m.group(1))


def test_running_version_bumped_to_at_least_72():
    n = _extract_version_tail(VERSION_JS, "RUNNING_VERSION")
    assert n >= 72, f"RUNNING_VERSION tail must be >= 72 (got {n})"


def test_cache_version_bumped_to_at_least_72():
    n = _extract_version_tail(SW_JS, "CACHE_VERSION")
    assert n >= 72, f"CACHE_VERSION tail must be >= 72 (got {n})"


def test_mobile_bundle_version_bumped_to_at_least_72():
    n = _extract_version_tail(MOBILE_TS, "MOBILE_BUNDLE_VERSION")
    assert n >= 72, f"MOBILE_BUNDLE_VERSION tail must be >= 72 (got {n})"

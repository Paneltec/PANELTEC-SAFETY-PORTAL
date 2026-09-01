"""v58.13.73 — Document Library inline preview extended to all
browser-renderable types.

Static source-pins for the extended `INLINE_MIMES` / `INLINE_EXTS`
whitelist in `document_library.py`, the `_is_browser_renderable`
helper's behaviour on both the MIME-hit and extension-hit paths,
and the mirroring `INLINE_VIEWABLE_*` sets in the frontend.
Plus the `?download=1` force-attachment invariant and the version
sync pin.

No live server required — the helper is imported and exercised
directly.
"""
from __future__ import annotations

import importlib
import sys
from pathlib import Path

APP = Path(__file__).resolve().parent.parent.parent
BACKEND = APP / "backend"
FRONTEND = APP / "frontend"
MOBILE = APP / "mobile"

# Make `backend` importable — the module has to be loadable in a
# unit-test context so we can call `_is_browser_renderable` directly
# rather than only source-scanning.
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

doclib = importlib.import_module("document_library")

DOCLIB_PY = (BACKEND / "document_library.py").read_text(encoding="utf-8")
DOCLIB_JSX = (FRONTEND / "src" / "pages" / "DocumentLibrary.jsx").read_text(encoding="utf-8")
VERSION_JS = (FRONTEND / "src" / "lib" / "version.js").read_text(encoding="utf-8")
SW_JS = (FRONTEND / "public" / "service-worker.js").read_text(encoding="utf-8")
MOBILE_TS = (MOBILE / "src" / "lib" / "version.ts").read_text(encoding="utf-8")


# ─────────────────────────────────────────────────────────────
# Backend — INLINE_MIMES / INLINE_EXTS module constants
# ─────────────────────────────────────────────────────────────
def test_inline_mimes_is_frozenset():
    assert isinstance(doclib.INLINE_MIMES, frozenset), (
        "INLINE_MIMES must be a frozenset — immutable to prevent "
        "accidental runtime mutation from an ill-advised import cycle."
    )


def test_inline_exts_is_frozenset():
    assert isinstance(doclib.INLINE_EXTS, frozenset), (
        "INLINE_EXTS must be a frozenset."
    )


def test_inline_whitelist_contains_all_user_requested_types():
    """The user's ship note explicitly lists these — assert them all."""
    for m in ("application/pdf", "image/png", "image/jpeg", "image/gif",
              "image/webp", "image/svg+xml", "text/plain",
              "application/json", "application/xml", "text/xml"):
        assert m in doclib.INLINE_MIMES, f"INLINE_MIMES missing {m!r}"
    for e in (".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg",
              ".txt", ".json", ".xml"):
        assert e in doclib.INLINE_EXTS, f"INLINE_EXTS missing {e!r}"


def test_inline_whitelist_excludes_office_and_archive_types():
    """Ship note is emphatic: docx/xlsx/pptx/zip/rar/csv stay attachment."""
    for m in (
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/zip", "application/x-rar-compressed",
        "text/csv",
    ):
        assert m not in doclib.INLINE_MIMES, (
            f"INLINE_MIMES must NOT include {m!r} — user explicitly "
            "excluded Office/archives/CSV from the inline whitelist."
        )
    for e in (".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
              ".zip", ".rar", ".7z", ".csv"):
        assert e not in doclib.INLINE_EXTS, (
            f"INLINE_EXTS must NOT include {e!r}."
        )


# ─────────────────────────────────────────────────────────────
# Backend — `_is_browser_renderable` behaviour
# ─────────────────────────────────────────────────────────────
def test_is_browser_renderable_via_mime():
    assert doclib._is_browser_renderable({"mime": "application/pdf", "filename": "x"}) is True
    assert doclib._is_browser_renderable({"mime": "image/png", "filename": "x"}) is True
    assert doclib._is_browser_renderable({"mime": "text/plain", "filename": "x"}) is True


def test_is_browser_renderable_case_insensitive_mime():
    assert doclib._is_browser_renderable({"mime": "APPLICATION/PDF", "filename": "x"}) is True
    assert doclib._is_browser_renderable({"mime": "Image/PNG", "filename": "x"}) is True


def test_is_browser_renderable_via_extension_fallback():
    """Files uploaded with generic `application/octet-stream` MIME (or
    an empty MIME) must still hit the inline path when the filename
    extension makes the format obvious."""
    assert doclib._is_browser_renderable(
        {"mime": "application/octet-stream", "filename": "photo.png"}) is True
    assert doclib._is_browser_renderable(
        {"mime": "", "filename": "notes.txt"}) is True
    assert doclib._is_browser_renderable(
        {"mime": None, "filename": "diagram.svg"}) is True


def test_is_browser_renderable_returns_false_for_office_and_archive():
    for mime, name in (
        ("application/vnd.openxmlformats-officedocument.wordprocessingml.document",
         "report.docx"),
        ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
         "matrix.xlsx"),
        ("application/zip", "bundle.zip"),
        ("text/csv", "export.csv"),
        ("application/octet-stream", "unknown.dat"),
    ):
        assert doclib._is_browser_renderable(
            {"mime": mime, "filename": name}) is False, (
            f"({mime}, {name}) must NOT be browser-renderable"
        )


# ─────────────────────────────────────────────────────────────
# Backend — download_file handler still respects ?download=1
# ─────────────────────────────────────────────────────────────
def test_download_file_still_forces_attachment_on_download_query():
    """Source-pin: the handler's disposition-select block must honour
    `?download=1` unconditionally, regardless of MIME/extension.
    Guards against a regression where the whitelist expansion masks
    the force-attachment opt-out."""
    marker = "async def download_file("
    idx = DOCLIB_PY.index(marker)
    body = DOCLIB_PY[idx:idx + 2200]
    # These two literals must appear IN ORDER — download check first,
    # then the browser-renderable branch.
    force_pos = body.find('if download:\n        disp = "attachment"')
    inline_pos = body.find('disp = "inline" if _is_browser_renderable')
    assert force_pos >= 0, (
        "download_file must contain the `if download: disp = 'attachment'` "
        "force-branch (v58.13.72 opt-out, preserved through .73)."
    )
    assert inline_pos > force_pos, (
        "The `?download=1` force-attachment branch must be evaluated "
        "BEFORE the browser-renderable branch, so an explicit download "
        "request always wins over the auto-inline heuristic."
    )


def test_download_file_passes_disp_into_file_response():
    body = DOCLIB_PY[DOCLIB_PY.index("async def download_file("):]
    assert "content_disposition_type=disp" in body[:2200], (
        "download_file must forward the computed `disp` into "
        "`FileResponse(content_disposition_type=...)`."
    )


# ─────────────────────────────────────────────────────────────
# Frontend — mirror sets + openFile gate
# ─────────────────────────────────────────────────────────────
def test_frontend_inline_viewable_sets_defined():
    assert "INLINE_VIEWABLE_MIMES" in DOCLIB_JSX, (
        "DocumentLibrary.jsx must define an `INLINE_VIEWABLE_MIMES` set "
        "so the frontend gates on the same whitelist as the backend."
    )
    assert "INLINE_VIEWABLE_EXTS" in DOCLIB_JSX, (
        "DocumentLibrary.jsx must define an `INLINE_VIEWABLE_EXTS` set."
    )
    # Sanity: each user-requested inline type appears verbatim in the JSX.
    for tok in ("'application/pdf'", "'image/png'", "'image/jpeg'",
                "'image/gif'", "'image/webp'", "'image/svg+xml'",
                "'text/plain'", "'application/json'",
                "'.pdf'", "'.png'", "'.jpg'", "'.jpeg'", "'.gif'",
                "'.webp'", "'.svg'", "'.txt'", "'.json'", "'.xml'"):
        assert tok in DOCLIB_JSX, (
            f"DocumentLibrary.jsx inline whitelist is missing token {tok!r}."
        )


def test_frontend_inline_viewable_sets_exclude_office_and_archive():
    """The JSX whitelist mustn't accidentally include Office/archive
    MIMEs — otherwise a docx click would open a popup with a browser
    "download this file" prompt (worse UX than the current save)."""
    for banned in ("'.docx'", "'.xlsx'", "'.pptx'", "'.zip'", "'.rar'",
                   "'.csv'"):
        assert banned not in DOCLIB_JSX, (
            f"DocumentLibrary.jsx whitelist must NOT include {banned!r}."
        )


def test_frontend_openfile_gates_on_isinlineviewable():
    """openFile must consult isInlineViewable(mime, filename) before
    opening the preview modal — otherwise clicking a docx would still
    fire the modal path."""
    idx = DOCLIB_JSX.index("const openFile = async (f)")
    body = DOCLIB_JSX[idx:idx + 1200]
    assert "isInlineViewable(f.mime, f.filename)" in body, (
        "openFile must call isInlineViewable(f.mime, f.filename) as "
        "its first guard so non-renderables fall through to "
        "downloadFile."
    )
    # And the fallback must be downloadFile (NOT a nested window.open
    # or a nested modal-open for non-renderables).
    assert "return downloadFile(f)" in body, (
        "openFile must fall through to `return downloadFile(f)` for "
        "non-renderable files."
    )
    # v58.13.74 — modal-based inline preview (blob URL iframe/img/pre).
    # This is IMMUNE to Edge's `edge://settings/content/pdfDocuments`
    # "Download PDF files" preference which was overriding our inline
    # header on top-level `window.open()` navigations (v58.13.73
    # field regression).
    assert "setInlinePreviewFile(f)" in body, (
        "openFile must call `setInlinePreviewFile(f)` to open the "
        "in-app FilePreviewModal — v58.13.74 Edge-compat path."
    )


def test_frontend_download_icon_tooltip_signals_reason():
    """The download icon's tooltip must differentiate between
    renderable-file "download original" and non-renderable-file
    "can't preview". This closes the "why did my docx save?"
    support-question loop."""
    assert "Download original (save to disk)" in DOCLIB_JSX, (
        "Download icon must show `Download original (save to disk)` "
        "for renderable files."
    )
    assert "can\\'t preview in the browser" in DOCLIB_JSX or \
           "can't preview in the browser" in DOCLIB_JSX, (
        "Download icon must explain WHY non-renderable files save — "
        "expected substring `can't preview in the browser` (raw or "
        "backslash-escaped apostrophe)."
    )


# ─────────────────────────────────────────────────────────────
# Version sync — >= 73 (forward-safe)
# ─────────────────────────────────────────────────────────────
def _extract_version_tail(text: str, needle: str) -> int:
    import re
    m = re.search(
        needle + r"\s*=\s*['\"]paneltec-v160\.3\.9\.58\.13\.(\d+)['\"]",
        text,
    )
    assert m, f"{needle}: version literal not found in file"
    return int(m.group(1))


def test_running_version_bumped_to_at_least_73():
    n = _extract_version_tail(VERSION_JS, "RUNNING_VERSION")
    assert n >= 73, f"RUNNING_VERSION tail must be >= 73 (got {n})"


def test_cache_version_bumped_to_at_least_73():
    n = _extract_version_tail(SW_JS, "CACHE_VERSION")
    assert n >= 73, f"CACHE_VERSION tail must be >= 73 (got {n})"


def test_mobile_bundle_version_bumped_to_at_least_73():
    n = _extract_version_tail(MOBILE_TS, "MOBILE_BUNDLE_VERSION")
    assert n >= 73, f"MOBILE_BUNDLE_VERSION tail must be >= 73 (got {n})"

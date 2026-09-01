"""v58.13.74 — In-app FilePreviewModal (Edge PDF-download bypass).

Static source-pins for the new modal component and the DocumentLibrary
integration. No live server needed.
"""
from __future__ import annotations
from pathlib import Path

APP = Path(__file__).resolve().parent.parent.parent
FRONTEND = APP / "frontend"
MOBILE = APP / "mobile"

MODAL_JSX = (FRONTEND / "src" / "components" / "FilePreviewModal.jsx").read_text(encoding="utf-8")
DOCLIB_JSX = (FRONTEND / "src" / "pages" / "DocumentLibrary.jsx").read_text(encoding="utf-8")
VERSION_JS = (FRONTEND / "src" / "lib" / "version.js").read_text(encoding="utf-8")
SW_JS = (FRONTEND / "public" / "service-worker.js").read_text(encoding="utf-8")
MOBILE_TS = (MOBILE / "src" / "lib" / "version.ts").read_text(encoding="utf-8")


# ─────────────────────────────────────────────────────────────
# FilePreviewModal component — kind detection + blob-URL rendering
# ─────────────────────────────────────────────────────────────
def test_modal_exports_default_and_kind_helper():
    assert "export default function FilePreviewModal" in MODAL_JSX, (
        "FilePreviewModal.jsx must default-export the component."
    )
    assert "export function isFileInlinePreviewable" in MODAL_JSX, (
        "FilePreviewModal.jsx must export the `isFileInlinePreviewable` "
        "helper so callers can pre-guard the click handler."
    )


def test_modal_detects_all_three_kinds():
    for tok in ("'pdf'", "'image'", "'text'"):
        assert tok in MODAL_JSX, f"detectKind must produce {tok}"
    # PDF via MIME AND via extension fallback.
    assert "'application/pdf'" in MODAL_JSX, "PDF MIME must be checked"
    assert ".endsWith('.pdf')" in MODAL_JSX, ".pdf extension fallback missing"
    # Image detection covers both `image/*` prefix and the raster/vector
    # extensions users actually upload.
    assert "image/" in MODAL_JSX, "image/* MIME prefix check missing"
    assert "png|jpe?g|gif|webp|svg" in MODAL_JSX, (
        "Image-extension regex must cover png/jpg/jpeg/gif/webp/svg."
    )
    # Text detection covers plain, JSON, XML.
    assert "'text/plain'" in MODAL_JSX
    assert "'application/json'" in MODAL_JSX
    assert "txt|log|md|json|xml" in MODAL_JSX


def test_modal_uses_blob_url_not_top_level_navigation():
    """CORE INVARIANT: the modal must render the file via a same-origin
    `blob:` URL wired to an <iframe>/<img>/<pre>. Any regression to
    `window.open` or `<a target="_blank">` will re-trigger Edge's
    PDF-download preference and defeat the whole point of this ship."""
    assert "URL.createObjectURL(blob)" in MODAL_JSX, (
        "Modal MUST create a blob URL from the fetched response — that's "
        "what bypasses Edge's PDF-download preference."
    )
    assert "URL.revokeObjectURL" in MODAL_JSX, (
        "Modal must revoke the blob URL on cleanup to avoid a memory leak."
    )
    # No live window.open call in the modal (comment prose mentioning
    # it for historical context is fine — filter those out).
    live_lines = [
        ln for ln in MODAL_JSX.splitlines()
        if "window.open(" in ln and not ln.lstrip().startswith("//")
    ]
    assert not live_lines, (
        "FilePreviewModal.jsx must NOT contain a live `window.open(` "
        "call — that path is what caused the v58.13.73 Edge "
        f"regression. Offending line(s):\n" + "\n".join(live_lines)
    )


def test_modal_renders_iframe_img_and_pre():
    assert '<iframe' in MODAL_JSX and 'src={blobUrl}' in MODAL_JSX, (
        "PDF branch must render <iframe src={blobUrl}>."
    )
    assert '<img' in MODAL_JSX, "Image branch must render <img>."
    assert '<pre' in MODAL_JSX, "Text branch must render <pre>."


def test_modal_attaches_bearer_before_blob():
    """The fetch that produces the blob must carry the Bearer JWT so
    the auth-gated backend accepts it. Otherwise the modal 401s."""
    assert "Authorization: `Bearer ${getToken()}`" in MODAL_JSX, (
        "Modal fetch must attach `Authorization: Bearer ${getToken()}`."
    )


def test_modal_download_button_uses_download_query_opt_out():
    """The header Download button must hit `?download=1` so the backend
    responds with attachment disposition. This preserves the "save as"
    contract for users who deliberately want the file on disk."""
    assert "?download=1" in MODAL_JSX, (
        "Modal Download button must call the endpoint with `?download=1`."
    )


def test_modal_locks_body_scroll_and_handles_escape():
    assert "useLockBodyScroll" in MODAL_JSX, (
        "Modal must use useLockBodyScroll (matches PdfPreviewModal ergonomics)."
    )
    assert "e.key === 'Escape'" in MODAL_JSX, (
        "Modal must close on ESC."
    )


def test_modal_carries_stable_testids():
    for tid in ('file-preview-modal', 'file-preview-close',
                'file-preview-download', 'file-preview-iframe',
                'file-preview-image', 'file-preview-text'):
        assert f'"{tid}"' in MODAL_JSX, (
            f"FilePreviewModal must carry data-testid=\"{tid}\" for smoke tests."
        )


# ─────────────────────────────────────────────────────────────
# DocumentLibrary integration
# ─────────────────────────────────────────────────────────────
def test_documentlibrary_imports_and_mounts_the_modal():
    assert (
        "import FilePreviewModal from '../components/FilePreviewModal'"
        in DOCLIB_JSX
    ), "DocumentLibrary.jsx must import FilePreviewModal."
    assert "<FilePreviewModal" in DOCLIB_JSX, (
        "DocumentLibrary.jsx must mount <FilePreviewModal /> in the JSX tree."
    )
    assert "inlinePreviewFile" in DOCLIB_JSX, (
        "DocumentLibrary.jsx must maintain an `inlinePreviewFile` state slot."
    )


def test_documentlibrary_openfile_uses_modal_not_windowopen():
    """The FILENAME click handler must route through the in-app modal.
    Any regression to `window.open('paneltec-doc-viewer', …)` will
    re-trigger the Edge PDF-download bug this ship fixes."""
    idx = DOCLIB_JSX.index("const openFile = async (f)")
    body = DOCLIB_JSX[idx:idx + 1200]
    assert "setInlinePreviewFile(f)" in body, (
        "openFile must open the modal via `setInlinePreviewFile(f)`."
    )
    assert "window.open" not in body, (
        "openFile MUST NOT call window.open — that's the exact path "
        "the v58.13.73 Edge regression traced to."
    )


def test_documentlibrary_no_more_filesurl_import():
    """`filesUrl` from downloadUrl.js was only used by the old
    `window.open` popup. If the import survives, someone likely
    started a new top-level-navigation code path — assert it's gone."""
    assert "from '../lib/downloadUrl'" not in DOCLIB_JSX, (
        "DocumentLibrary.jsx must NOT import filesUrl — it was only "
        "needed for the removed window.open popup path."
    )


# ─────────────────────────────────────────────────────────────
# Version sync — >= 74 (forward-safe)
# ─────────────────────────────────────────────────────────────
def _tail(text: str, needle: str) -> int:
    import re
    m = re.search(
        needle + r"\s*=\s*['\"]paneltec-v160\.3\.9\.58\.13\.(\d+)['\"]",
        text,
    )
    assert m, f"{needle}: version literal not found"
    return int(m.group(1))


def test_running_version_bumped_to_at_least_74():
    n = _tail(VERSION_JS, "RUNNING_VERSION")
    assert n >= 74, f"RUNNING_VERSION tail must be >= 74 (got {n})"


def test_cache_version_bumped_to_at_least_74():
    n = _tail(SW_JS, "CACHE_VERSION")
    assert n >= 74, f"CACHE_VERSION tail must be >= 74 (got {n})"


def test_mobile_bundle_version_bumped_to_at_least_74():
    n = _tail(MOBILE_TS, "MOBILE_BUNDLE_VERSION")
    assert n >= 74, f"MOBILE_BUNDLE_VERSION tail must be >= 74 (got {n})"

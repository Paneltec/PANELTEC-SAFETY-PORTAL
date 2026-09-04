"""v58.13.77 — Document Library: folder delete UX (stopPropagation +
page-level confirmation modal).
"""
from __future__ import annotations
from pathlib import Path

APP = Path(__file__).resolve().parent.parent.parent
FRONTEND = APP / "frontend"
MOBILE = APP / "mobile"
BACKEND = APP / "backend"

DOCLIB_JSX = (FRONTEND / "src" / "pages" / "DocumentLibrary.jsx").read_text(encoding="utf-8")
DOCLIB_PY = (BACKEND / "document_library.py").read_text(encoding="utf-8")
VERSION_JS = (FRONTEND / "src" / "lib" / "version.js").read_text(encoding="utf-8")
SW_JS = (FRONTEND / "public" / "service-worker.js").read_text(encoding="utf-8")
MOBILE_TS = (MOBILE / "src" / "lib" / "version.ts").read_text(encoding="utf-8")


# ─────────────────────────────────────────────────────────────
# Inner buttons carry stopPropagation
# ─────────────────────────────────────────────────────────────
def test_folder_delete_button_stops_propagation():
    # The delete-X button used to be `onClick={() => setConfirmDeleteId(f.id)}`
    # with no propagation guard, so a click on the button could bubble to
    # the parent card's nav button and mid-delete navigate away.
    assert "e.stopPropagation(); setConfirmDeleteId(f.id)" in DOCLIB_JSX, (
        "Folder delete-X onClick must call `e.stopPropagation()` before "
        "`setConfirmDeleteId(f.id)` so the click never bubbles to the "
        "parent card's nav button (v58.13.77)."
    )


def test_folder_rename_button_stops_propagation():
    assert "e.stopPropagation(); startRename(f)" in DOCLIB_JSX, (
        "Folder rename onClick must call `e.stopPropagation()`."
    )


def test_folder_recolor_button_stops_propagation():
    assert "e.stopPropagation(); setColorPickerFolderId(f.id)" in DOCLIB_JSX, (
        "Folder recolour onClick must call `e.stopPropagation()`."
    )


# ─────────────────────────────────────────────────────────────
# Inline confirm strip removed — page-level modal in place
# ─────────────────────────────────────────────────────────────
def test_inline_delete_confirm_strip_removed():
    """The old inline strip at `absolute inset-x-1.5 top-1.5 flex … bg-[#fbe4e7]`
    was the source of the "cannot delete completely" bug — clicks on
    the tiny strip sometimes missed the checkmark and hit the folder
    card underneath. Must be gone."""
    # The strip was uniquely identified by the `folder-delete-confirm-yes`
    # per-card testid; the `bg-[#fbe4e7]` hex also survives on the pastel
    # `blush` palette constant so it's not a reliable removal marker.
    assert 'folder-delete-confirm-yes' not in DOCLIB_JSX, (
        "Per-card `folder-delete-confirm-yes-{id}` testid must be gone "
        "— replaced by the page-level `folder-delete-modal-confirm`."
    )
    assert 'folder-delete-confirm-no' not in DOCLIB_JSX, (
        "Per-card `folder-delete-confirm-no-{id}` testid must be gone."
    )
    # The strip's copy `<span … >Delete?</span>` was hyper-specific to
    # the strip — its absence confirms the strip's JSX block is gone.
    # (The MODAL uses "Delete folder?" with the word "folder" — a
    # different string.)
    assert '>Delete?<' not in DOCLIB_JSX, (
        "Old inline confirm strip's `>Delete?<` label must be gone."
    )


def test_page_level_delete_modal_exists():
    for tid in ('folder-delete-modal',
                'folder-delete-modal-name',
                'folder-delete-modal-counts',
                'folder-delete-modal-cancel',
                'folder-delete-modal-confirm'):
        assert f'"{tid}"' in DOCLIB_JSX, (
            f"Page-level delete modal missing testid `{tid}`."
        )


def test_delete_modal_shows_file_and_subfolder_count():
    """Modal body must surface the file + subfolder counts so the user
    understands what's being cascaded."""
    # Locate the modal block and inspect its content.
    idx = DOCLIB_JSX.index('"folder-delete-modal-counts"')
    body = DOCLIB_JSX[max(0, idx - 400):idx + 900]
    # Modal computes `fc` and `sc` from `target.file_count` / `target.subfolder_count`.
    assert "target.file_count" in DOCLIB_JSX, (
        "Delete modal must reference `target.file_count` so the user "
        "sees how many files will be cascaded-deleted."
    )
    assert "target.subfolder_count" in DOCLIB_JSX, (
        "Delete modal must reference `target.subfolder_count` so the "
        "user sees how many subfolders will be cascaded-deleted."
    )
    # Empty-folder friendly copy present in the modal block.
    assert "Empty folder" in body, (
        "Delete modal must have a friendly `Empty folder` copy for the "
        "zero-file / zero-subfolder case."
    )


def test_delete_modal_backdrop_dismisses():
    """Clicking the backdrop must dismiss the modal (setConfirmDeleteId(null))
    while clicking the modal body must NOT (stopPropagation)."""
    # The backdrop's onClick calls the null setter.
    assert "onClick={() => setConfirmDeleteId(null)}" in DOCLIB_JSX, (
        "Delete modal backdrop click must call setConfirmDeleteId(null)."
    )
    # Modal body has an onClick that stops propagation so clicks inside
    # the panel don't bubble to the backdrop and close it.
    idx = DOCLIB_JSX.index('"folder-delete-modal"')
    body = DOCLIB_JSX[idx:idx + 900]
    assert "e.stopPropagation()" in body, (
        "Delete modal panel must call `e.stopPropagation()` on click "
        "so clicks inside the panel don't dismiss the modal."
    )


def test_delete_modal_confirm_calls_deleteFolder():
    """The confirm button must call the existing deleteFolder(f) helper
    — the same helper that was working end-to-end via curl."""
    idx = DOCLIB_JSX.index('"folder-delete-modal-confirm"')
    body = DOCLIB_JSX[max(0, idx - 300):idx + 400]
    assert "deleteFolder(target)" in body, (
        "Delete modal confirm button must call deleteFolder(target)."
    )


# ─────────────────────────────────────────────────────────────
# Backend contract unchanged — DELETE by UUID still works
# ─────────────────────────────────────────────────────────────
def test_backend_delete_by_uuid_endpoint_still_present():
    """The frontend has always deleted by UUID, never by name — so the
    ampersand-in-name theory was a red herring. This test pins that
    the UUID-based route is still in place and hasn't been renamed to
    something name-based which would re-introduce URL-encoding risk."""
    import re
    # Route may carry additional decorator kwargs (`status_code=204`, etc.),
    # so accept any decorator opening that names the {folder_id} path.
    assert re.search(r'@router\.delete\("/folders/\{folder_id\}"', DOCLIB_PY), (
        "Backend DELETE /folders/{folder_id} route must remain — the "
        "UUID-based delete is what makes special-char folder names safe."
    )


# ─────────────────────────────────────────────────────────────
# Version sync — >= 77 (forward-safe)
# ─────────────────────────────────────────────────────────────
def _tail(text: str, needle: str) -> int:
    import re
    m = re.search(
        needle + r"\s*=\s*['\"]paneltec-v160\.3\.9\.58\.13\.(\d+)[a-z]*['\"]",
        text,
    )
    assert m, f"{needle}: version literal not found"
    return int(m.group(1))


def test_running_version_bumped_to_at_least_77():
    n = _tail(VERSION_JS, "RUNNING_VERSION")
    assert n >= 77


def test_cache_version_bumped_to_at_least_77():
    n = _tail(SW_JS, "CACHE_VERSION")
    assert n >= 77


def test_mobile_bundle_version_bumped_to_at_least_77():
    n = _tail(MOBILE_TS, "MOBILE_BUNDLE_VERSION")
    assert n >= 77

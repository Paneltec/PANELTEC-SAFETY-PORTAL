"""v58.13.132he — File drag-and-drop between folders."""
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


def test_filepatch_accepts_folder_id():
    src = _read(DOCLIB_PY)
    # FilePatch model must have folder_id
    m = re.search(
        r'class FilePatch\(BaseModel\):[\s\S]+?(?=\n\n@router)',
        src,
    )
    assert m, "FilePatch model not found"
    body = m.group(0)
    assert "folder_id:" in body, "FilePatch must accept folder_id"


def test_patch_files_reparents_and_audits():
    src = _read(DOCLIB_PY)
    m = re.search(
        r'async def rename_or_update_file\(.*?return _serialise_file\(r\)',
        src, re.DOTALL,
    )
    assert m, "rename_or_update_file handler not found"
    body = m.group(0)
    # Must validate the target exists in the same org
    assert 'db.doc_folders.find_one' in body
    assert 'deleted_at": None' in body, "target folder must be non-deleted"
    # Must audit the move
    assert '"file_moved"' in body, "move must emit file_moved audit entry"
    assert '"old_folder_id":' in body
    assert '"new_folder_id":' in body


def test_admin_editor_only_via_write_roles_gate():
    # Uses existing require_permission("documents", "edit") + WRITE_ROLES.
    # No viewer-role widening.
    src = _read(DOCLIB_PY)
    m = re.search(
        r'@router\.patch\("/files/\{file_id\}"\)\s*\nasync def rename_or_update_file\((.+?)\):',
        src, re.DOTALL,
    )
    assert m
    sig = m.group(1)
    assert 'require_permission("documents", "edit")' in sig
    # And the inner _require pins WRITE_ROLES
    body_m = re.search(
        r'async def rename_or_update_file\(.*?return _serialise_file\(r\)',
        src, re.DOTALL,
    )
    assert body_m
    assert '_require(user, WRITE_ROLES, action="edit")' in body_m.group(0)


def test_frontend_file_row_is_draggable():
    src = _read(DOCLIB_JSX)
    # File <tr> must have draggable + a paneltec-file dataTransfer key
    assert "draggable={canEdit}" in src
    assert "e.dataTransfer.setData('text/paneltec-file', f.id)" in src


def test_frontend_subfolder_card_accepts_file_drops():
    src = _read(DOCLIB_JSX)
    # SubfolderCard gains fileDropActive + onFileDrop props
    assert "fileDropActive, onFileDrop" in src, \
        "SubfolderCard signature must accept fileDropActive + onFileDrop"
    assert "e.dataTransfer.getData('text/paneltec-file')" in src
    # Highlight class when a valid drop is hovering
    assert "border-brand-blue ring-2" in src, \
        "SubfolderCard must show hover-highlight on file drag-over"


def test_frontend_movefile_posts_folder_id():
    src = _read(DOCLIB_JSX)
    assert re.search(
        r"api\.patch\(`/document-library/files/\$\{fileId\}`,\s*\{\s*folder_id: targetFolderId\s*\}",
        src,
    ), "moveFile must PATCH /files/<id> with { folder_id: <target> }"


def test_frontend_breadcrumb_accepts_file_drops():
    src = _read(DOCLIB_JSX)
    # The ancestor breadcrumb button must include file-move DnD wiring.
    assert "moveFile(fid, a.id, a.name)" in src, \
        "Breadcrumb ancestor must invoke moveFile on drop"
    # onDragOver on the ancestor button must gate on canEdit + draggingFileId
    assert "if (!canEdit || !draggingFileId) return" in src, \
        "Ancestor drop target must gate on canEdit + active drag"


def test_version_lockstep_pinned_at_132he():
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
        assert m.group(1) >= "e", f"{key} must be >= .132he"

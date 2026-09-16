"""v58.13.132gz — Document Library Frontend Tree UI ship pins.

Locks in:
  · Backend `/folders/all` payload extended with `file_count`,
    `color_key`, `sort_order` so the FE tree renders from a single
    fetch.
  · Frontend `DocumentLibrary.jsx` gains `FolderTreeView`, `TreeRow`,
    and `TreeSubtree` React components.
  · Tree renders when both filters are empty; flat grid renders
    otherwise.
  · Expand state persists in `localStorage.paneltec_doclib_tree_
    expanded_v1_<user_id>`.
  · Reparent PATCH `/document-library/folders/<id>` with
    `parent_folder_id` payload wired from `reparentFolder`.
  · Root drop zone uses the `-` sentinel to detach to root
    (matches the backend `.132gy` contract).
  · Every promised testid pattern is present in source.
  · Version-file lockstep to `.132gz`.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[2]
BACKEND = APP_ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

DOCLIB_PY = BACKEND / "document_library.py"
DOCLIB_JSX = APP_ROOT / "frontend" / "src" / "pages" / "DocumentLibrary.jsx"
VERSION_JS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


# ─── Backend source pins ────────────────────────────────────────

def test_folders_all_endpoint_projects_file_count_and_color():
    src = _read(DOCLIB_PY)
    # The `/folders/all` handler must project the new fields into
    # the Mongo find() projection and into the response dict.
    m = re.search(
        r'@router\.get\("/folders/all"\).*?return out',
        src, re.DOTALL,
    )
    assert m, "/folders/all handler not found"
    body = m.group(0)
    assert '"color_key": 1' in body, \
        "/folders/all projection must include color_key"
    assert '"sort_order": 1' in body, \
        "/folders/all projection must include sort_order"
    assert 'counts.get(f["id"], 0)' in body or 'counts.get(f["id"],0)' in body, \
        "/folders/all must derive file_count from _file_counts()"
    assert '"file_count":' in body, \
        "/folders/all response must expose file_count"
    assert '"color_key":' in body, \
        "/folders/all response must expose color_key"


def test_folders_all_still_excludes_worker_folders():
    src = _read(DOCLIB_PY)
    m = re.search(
        r'@router\.get\("/folders/all"\).*?return out',
        src, re.DOTALL,
    )
    assert m
    body = m.group(0)
    assert 'if f.get("worker_id"):' in body and 'continue' in body, \
        "/folders/all must skip per-worker folders"


# ─── Frontend source pins ───────────────────────────────────────

def test_documentlibrary_defines_tree_components():
    src = _read(DOCLIB_JSX)
    assert re.search(r'^function TreeRow\(', src, re.M), \
        "TreeRow component missing"
    assert re.search(r'^function TreeSubtree\(', src, re.M), \
        "TreeSubtree component missing"
    assert re.search(r'^function FolderTreeView\(', src, re.M), \
        "FolderTreeView component missing"


def test_documentlibrary_has_index_builder_and_default_helper():
    src = _read(DOCLIB_JSX)
    assert 'function buildFolderIndex(' in src, \
        "buildFolderIndex helper missing"
    assert 'function computeDefaultExpanded(' in src, \
        "computeDefaultExpanded helper missing"
    assert 'function isDescendantOrSelf(' in src, \
        "isDescendantOrSelf DnD cycle guard missing"


def test_documentlibrary_tree_renders_when_no_filter():
    src = _read(DOCLIB_JSX)
    # The primary render must gate the tree on empty filter AND
    # empty colour filter, and mount <FolderTreeView>.
    assert re.search(
        r"\(\s*!filter\s*&&\s*colorFilter\.size\s*===\s*0\s*\)",
        src,
    ), "Tree must only render when both filters are empty"
    assert '<FolderTreeView' in src, "FolderTreeView must be mounted"


def test_documentlibrary_grid_remains_for_filter_mode():
    src = _read(DOCLIB_JSX)
    # The flat grid is preserved so filter/search results still render.
    assert 'data-testid="folder-grid"' in src, \
        "Flat grid must remain as filter-mode fallback"
    assert "data-testid={`folder-card-${f.id}`}" in src, \
        "folder-card testid pattern must remain (filter mode)"


def test_documentlibrary_persists_expanded_state_per_user():
    src = _read(DOCLIB_JSX)
    assert '_treeStorageKey' in src, "_treeStorageKey helper missing"
    assert 'paneltec_doclib_tree_expanded_v1_' in src, \
        "localStorage key prefix must be paneltec_doclib_tree_expanded_v1_"
    assert '_loadExpandedFromStorage(user?.id)' in src, \
        "Expanded state must load per user"
    assert '_saveExpandedToStorage(user?.id' in src, \
        "Expanded state must save per user"


def test_documentlibrary_reparent_patches_backend():
    src = _read(DOCLIB_JSX)
    # reparentFolder must PATCH /document-library/folders/<id> with a
    # parent_folder_id body — matches the .132gy backend contract.
    m = re.search(
        r'const reparentFolder\s*=.*?\}, \[allFolders, user\?\.id\]\);',
        src, re.DOTALL,
    )
    assert m, "reparentFolder handler not found"
    body = m.group(0)
    assert "api.patch(`/document-library/folders/${folderId}`" in body, \
        "reparentFolder must PATCH the folder endpoint"
    assert 'parent_folder_id: newParentId' in body, \
        "reparentFolder must send parent_folder_id in the payload"


def test_documentlibrary_root_drop_uses_dash_sentinel():
    src = _read(DOCLIB_JSX)
    # Root drop reparents via the "-" sentinel (backend .132gy
    # PATCH contract).
    assert "reparent(src, '-')" in src, \
        "Root drop must call reparent with the '-' sentinel"


def test_documentlibrary_promised_testids_present():
    src = _read(DOCLIB_JSX)
    required = [
        'data-testid="folder-tree"',
        'data-testid="tree-root-drop-zone"',
        "data-testid={`tree-row-${node.id}`}",
        "data-testid={`tree-chevron-${node.id}`}",
        "data-testid={`tree-open-${node.id}`}",
        "data-testid={`tree-count-${node.id}`}",
        "data-testid={`tree-actions-${node.id}`}",
        "data-testid={`tree-rename-${node.id}`}",
        "data-testid={`tree-delete-${node.id}`}",
    ]
    for tid in required:
        assert tid in src, f"Missing testid pattern: {tid}"


def test_documentlibrary_recursive_rollup_formula():
    src = _read(DOCLIB_JSX)
    # The count cell must render a "direct (total)" pair when the
    # recursive total differs from the direct count.
    m = re.search(
        r'const showRollup = hasKids && total !== direct;',
        src,
    )
    assert m, "Recursive rollup gate missing"


def test_documentlibrary_tree_dnd_uses_native_html5():
    src = _read(DOCLIB_JSX)
    # No new drag-and-drop dependency: the tree row must use native
    # HTML5 DnD attributes.
    assert 'draggable={draggable}' in src, "TreeRow must set draggable"
    assert 'onDragStart' in src and 'onDrop' in src and 'onDragOver' in src, \
        "Native HTML5 DnD handlers required"
    assert "e.dataTransfer.setData('text/paneltec-folder'" in src, \
        "DnD payload key must be text/paneltec-folder"


# ─── Version lockstep ───────────────────────────────────────────

def test_version_lockstep_pinned_at_132gz():
    running = re.search(
        r"RUNNING_VERSION\s*=\s*'paneltec-v160\.3\.9\.58\.13\.132g([a-z])'",
        _read(VERSION_JS),
    )
    expected = re.search(
        r"EXPECTED_CACHE_VERSION\s*=\s*'paneltec-v160\.3\.9\.58\.13\.132g([a-z])'",
        _read(VERSION_JS),
    )
    cache = re.search(
        r"CACHE_VERSION\s*=\s*'paneltec-v160\.3\.9\.58\.13\.132g([a-z])'",
        _read(SW),
    )
    for m, label in ((running, "RUNNING_VERSION"),
                     (expected, "EXPECTED_CACHE_VERSION"),
                     (cache, "CACHE_VERSION")):
        assert m, f"{label} not pinned to .132g?"
        assert m.group(1) >= "z", f"{label} must be >= .132gz (got .132g{m.group(1)})"

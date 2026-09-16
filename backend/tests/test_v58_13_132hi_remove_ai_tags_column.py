"""v58.13.132hi — Doc Library: remove AI Tags column + drop sticky divider.

Static regression suite. Guarantees:
- No AI-tag column header, cell, or overflow-chip renders in the
  folder-detail table.
- Sticky <th>/<td> for Actions have NO shadow/border divider.
- Actions cells remain sticky right-0 (i.e. the .132hh gain is
  preserved).
- Group-header row's `colSpan` is 6 (one fewer than .132hh's 7).
- Version lockstep pinned to `.132hi` in all three files.
- Backend search endpoint still queries `ai_tags` (locked in so any
  future edit that quietly drops tag-search will fail this test).
"""
from __future__ import annotations
import re
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[2]
DOCLIB_JSX = APP_ROOT / "frontend" / "src" / "pages" / "DocumentLibrary.jsx"
VERSION_JS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"
DOCLIB_PY = APP_ROOT / "backend" / "document_library.py"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def _table_block() -> str:
    """Return only the folder-detail file-table block (thead + tbody
    for one row) so we don't accidentally match unrelated code."""
    src = _read(DOCLIB_JSX)
    m = re.search(
        r'data-testid="folder-files-table".*?</table>',
        src, flags=re.DOTALL,
    )
    assert m, "folder-files-table block not found"
    return m.group(0)


def test_no_ai_tags_header_in_folder_table():
    block = _table_block()
    assert "AI tags" not in block, \
        "AI tags <th> must be removed from the folder file table"


def test_no_ai_tags_cell_render():
    block = _table_block()
    # No render of f.ai_tags chips inside the table
    assert "f.ai_tags" not in block, \
        "No ai_tags rendering may remain in the folder file table"
    assert "ai-tags-overflow" not in block, \
        "The +N overflow-chip logic must be removed"
    assert "ai-tags-cell" not in block, \
        "No stub ai-tags <td> should remain"


def test_group_header_colspan_updated_to_six():
    block = _table_block()
    assert "colSpan={6}" in block, \
        "Group header <td> must colSpan=6 after AI-tag column removal"
    assert "colSpan={7}" not in block, \
        "Stale colSpan=7 must be gone"


def test_actions_th_sticky_without_shadow():
    block = _table_block()
    m = re.search(
        r'<th\s+className="text-right px-4 py-3 sticky right-0 bg-slate-50"\s+data-testid="folder-files-th-actions"',
        block,
    )
    assert m, "Actions <th> must be sticky right-0 WITH NO shadow class"
    # Explicitly guard against the .132hh shadow class returning
    assert "shadow-[inset_1px_0_0_rgba(226,232,240,1)]" not in block, \
        "Sticky-column inset shadow must be removed"


def test_actions_td_sticky_without_shadow():
    block = _table_block()
    m = re.search(
        r'<td\s+className="px-4 py-3 text-right sticky right-0 bg-white group-hover:bg-slate-50"\s+data-testid=\{`file-actions-cell-\$\{f\.id\}`\}',
        block,
    )
    assert m, "Actions <td> must be sticky right-0 WITH NO shadow class"


def test_search_placeholder_still_advertises_ai_tags():
    """Regression lock: the search box still tells the admin that AI
    tags are searchable. If someone later strips the tag hint from
    the placeholder this test forces a conversation about it."""
    src = _read(DOCLIB_JSX)
    assert 'Search this folder (filename, AI tags, uploader)' in src, \
        "Folder search placeholder must still mention AI tags"


def test_backend_search_still_queries_ai_tags():
    """Regression lock: the /search endpoint must include ai_tags in
    its Mongo regex $or clause. Locks in AI-tag searchability now
    that the column is no longer visible on screen."""
    src = _read(DOCLIB_PY)
    assert '{"ai_tags": {"$regex": pattern, "$options": "i"}}' in src, \
        "Backend search must still query ai_tags via regex"


def test_version_lockstep_pinned_at_132hi():
    for path, key in (
        (VERSION_JS, "RUNNING_VERSION"),
        (VERSION_JS, "EXPECTED_CACHE_VERSION"),
        (SW, "CACHE_VERSION"),
    ):
        m = re.search(
            rf"{key}\s*=\s*'paneltec-v160\.3\.9\.58\.13\.132h([a-z])'",
            _read(path),
        )
        assert m, f"{key} not found in expected format"
        assert m.group(1) >= "i", f"{key} must be >= .132hi"

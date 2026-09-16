"""v58.13.132hc — Doc Library folder-detail breadcrumb rail."""
from __future__ import annotations
import re
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[2]
DOCLIB_JSX = APP_ROOT / "frontend" / "src" / "pages" / "DocumentLibrary.jsx"
VERSION_JS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def test_ancestors_state_present():
    src = _read(DOCLIB_JSX)
    assert "const [ancestors, setAncestors] = useState([])" in src, \
        "Ancestor chain state must exist on DocumentLibraryFolder"


def test_loadfolder_walks_parent_chain_via_folders_all():
    src = _read(DOCLIB_JSX)
    # loadFolder must fetch /folders/all AND walk parent_folder_id up.
    m = re.search(
        r"const loadFolder = useCallback\(async \(\) => \{.*?\}, \[folderId, navigate\]\);",
        src, re.DOTALL,
    )
    assert m, "loadFolder handler not found"
    body = m.group(0)
    assert "api.get('/document-library/folders/all')" in body, \
        "loadFolder must fetch /folders/all for the crumb chain"
    assert "parent_folder_id" in body, \
        "loadFolder must walk parent_folder_id links"
    assert "chain.unshift(parent)" in body, \
        "loadFolder must build the chain root-first (unshift)"
    assert "setAncestors(chain)" in body


def test_breadcrumb_rail_rendered_with_testids():
    src = _read(DOCLIB_JSX)
    required = [
        'data-testid="folder-breadcrumb-rail"',
        'data-testid="folder-breadcrumb-root"',
        "data-testid={`folder-breadcrumb-${a.id}`}",
        'data-testid="folder-breadcrumb-current"',
    ]
    for tid in required:
        assert tid in src, f"Missing testid: {tid}"


def test_breadcrumb_segments_clickable_navigate():
    src = _read(DOCLIB_JSX)
    # Root button jumps to the tree page.
    assert "onClick={() => navigate('/app/document-library')}" in src, \
        "Root crumb must navigate to the library root"
    # Each ancestor button jumps to its folder-detail page.
    assert "navigate(`/app/document-library/${a.id}`)" in src, \
        "Ancestor crumbs must navigate to their folder-detail page"


def test_breadcrumb_replaces_old_static_crumb():
    src = _read(DOCLIB_JSX)
    # Old hardcoded string must be gone — we now render a real nav.
    assert "Compliance / Document Library /" not in src, \
        "Old static crumb string must be removed"


def test_version_lockstep_pinned_at_132hc():
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
        assert m.group(1) >= "c", f"{key} must be >= .132hc"

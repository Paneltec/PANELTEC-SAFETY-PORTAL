"""v58.13.132g3 — HOTFIX. `.132g1` shipped the tile 3-dots menu +
drag-to-reorder + PIN gate on the standalone `/apps-directory`
page and the Manage-Tiles editor, but missed the launcher modal
(`components/AppsDirectoryModal.jsx`) that regular users actually
open from the sidebar. Stephen's screenshot showed 10 plain
"LAUNCH X" tiles — no 3-dots, no drag, no PIN state.

.132g3 extracts the tile primitives to
`components/apps-directory/TileCard.jsx` and wires the modal
through them so BOTH surfaces use the same shared code path.
"""
from __future__ import annotations

from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[2]
FRONTEND = APP_ROOT / "frontend"
TILECARD = FRONTEND / "src" / "components" / "apps-directory" / "TileCard.jsx"
LAUNCHER = FRONTEND / "src" / "components" / "AppsDirectoryModal.jsx"
STANDALONE = FRONTEND / "src" / "pages" / "AppsDirectory.jsx"
VERSION_JS = FRONTEND / "src" / "lib" / "version.js"
SW = FRONTEND / "public" / "service-worker.js"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


# ─── Shared TileCard extraction ────────────────────────────────

def test_shared_tilecard_exists_with_expected_exports():
    assert TILECARD.exists(), (
        "shared TileCard module missing — .132g3 extracts the tile "
        "primitives so both surfaces stay in sync")
    src = _read(TILECARD)
    for named in (
        "export function TileCard(",
        "export function SortableTileCard(",
        "export function TilePinModal(",
        "export function useHiddenTiles(",
        "export function openCheatSheet(",
        "export const DEFAULT_TILE_COLOR",
    ):
        assert named in src, f"shared TileCard must export: {named}"
    # PIN modal is portalled to document.body (regression fix from
    # .132g1 — @dnd-kit transform stacking traps a non-portalled
    # modal).
    assert "createPortal" in src
    assert "document.body" in src
    # Credential-aware launch is available via a `credentialLaunch`
    # prop — used by the modal, off by default on the standalone page.
    assert "credentialLaunch" in src
    # Testid prefix flows in — both surfaces stay uniquely addressable.
    assert "testIdPrefix" in src


# ─── Launcher modal wired through the shared component ────────

def test_modal_uses_shared_tilecard():
    src = _read(LAUNCHER)
    assert "from './apps-directory/TileCard'" in src, (
        "AppsDirectoryModal must import from the shared TileCard "
        "so it stays in sync with the standalone page")
    assert "SortableTileCard" in src
    assert "useHiddenTiles" in src
    # The pre-.132g3 credential-aware launch code path (`onLaunch`,
    # `openCheatSheet`) that used to live inline in the modal must
    # now come from the shared module.
    assert "function HubTile(" not in src, (
        "the private HubTile function must be gone — the modal now "
        "renders via SortableTileCard")
    assert "function openCheatSheet(" not in src, (
        "openCheatSheet must be imported from the shared module, "
        "not redeclared inline")


def test_modal_renders_dnd_context_and_sortable_context():
    src = _read(LAUNCHER)
    assert "<DndContext" in src
    assert "<SortableContext" in src
    assert "onDragEnd" in src
    assert "arrayMove(tiles, fromIdx, toIdx)" in src
    assert "api.patch('/org/url-tiles/reorder'" in src


def test_modal_passes_credentialLaunch_flag():
    src = _read(LAUNCHER)
    # Modal surface is where the auto-copy-password + cheat-sheet
    # popup behaviour lives — this prop flips it on.
    assert "credentialLaunch" in src
    # Standalone page must NOT pass it (keep the standalone page's
    # plain-open behaviour unchanged).
    stand = _read(STANDALONE)
    assert "credentialLaunch" not in stand, (
        "credentialLaunch is a launcher-modal-only flag — the "
        "standalone page does the plain window.open path")


def test_modal_testid_prefix_is_apps_directory_modal_tile():
    src = _read(LAUNCHER)
    assert 'testIdPrefix="apps-directory-modal-tile"' in src


def test_standalone_testid_prefix_unchanged():
    src = _read(STANDALONE)
    assert 'testIdPrefix="apps-directory-hub-tile"' in src


# ─── Modal picks up the same 3-dots / PIN / session-hide semantics ─

def test_modal_menu_and_pin_testids_are_present():
    """The shared TileCard emits testids of the form
    `${testIdPrefix}-menu-${tile.id}`, `${testIdPrefix}-lock-overlay-${tile.id}`
    etc. Confirm the modal's testIdPrefix is wired so those emit
    correctly (the shared code will produce e.g.
    `apps-directory-modal-tile-menu-<id>`)."""
    src = _read(TILECARD)
    # Composed testids exist in the shared code.
    for slot in (
        "${testIdPrefix}-menu-${tile.id}",
        "${testIdPrefix}-menu-panel-${tile.id}",
        "${testIdPrefix}-menu-open-${tile.id}",
        "${testIdPrefix}-menu-copy-${tile.id}",
        "${testIdPrefix}-menu-hide-${tile.id}",
        "${testIdPrefix}-drag-${tile.id}",
        "${testIdPrefix}-lock-overlay-${tile.id}",
        "${testIdPrefix}-body-${tile.id}",
        "${testIdPrefix}-unlock-${tile.id}",
    ):
        assert slot in src, f"shared TileCard must emit testid slot: {slot}"


def test_modal_footer_show_all_wired():
    src = _read(LAUNCHER)
    assert 'data-testid="apps-directory-modal-show-all"' in src
    assert 'data-testid="apps-directory-modal-hidden-count"' in src


# ─── Version lockstep ──────────────────────────────────────────

def test_version_bumped_to_132g3():
    assert "paneltec-v160.3.9.58.13.132g3" in _read(VERSION_JS)
    assert "paneltec-v160.3.9.58.13.132g3" in _read(SW)

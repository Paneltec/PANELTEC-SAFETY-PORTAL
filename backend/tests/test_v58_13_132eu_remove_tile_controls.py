"""v58.13.132eu — Strip per-tile controls from `<AppsDirectoryModal />`.

Stephen: "why would you give a user a delete x for thats a job for
super admin meaning me".

Removals:
  · Per-tile X (hide) button — `apps-directory-modal-tile-hide-*`.
  · Per-tile ⚙ settings button — `apps-directory-modal-tile-settings-*`.
  · Footer "N APPS HIDDEN FROM YOUR HUB · SHOW & MANAGE".
  · `localStorage.apps_directory_hidden` per-user hidden state.
  · Import of the `Settings` icon (unused after this cleanup).

Retained: clean launcher tile (icon + name + description + coloured
`LAUNCH <NAME> ↗` bottom action). Whole tile is the click target
via a single `<a target=_blank>`.
"""
from __future__ import annotations

import re
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[2]
FE = APP_ROOT / "frontend" / "src"

MODAL = FE / "components" / "AppsDirectoryModal.jsx"
VERSION_JS = FE / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


# ── Per-tile controls stripped ────────────────────────────────────

def test_per_tile_hide_and_settings_buttons_removed():
    src = _read(MODAL)
    assert "apps-directory-modal-tile-hide-" not in src, (
        "per-tile X hide button was intentionally removed in .132eu")
    assert "apps-directory-modal-tile-settings-" not in src, (
        "per-tile ⚙ settings link was intentionally removed in .132eu")


def test_settings_icon_import_removed():
    """`Settings` from lucide-react was only used for the removed ⚙
    button. Drop the import to keep the module clean."""
    src = _read(MODAL)
    m = re.search(r"import \{([^}]+)\} from 'lucide-react';", src)
    assert m, "lucide-react import not found"
    imported = [tok.strip() for tok in m.group(1).split(",") if tok.strip()]
    assert "Settings" not in imported, (
        f"`Settings` icon import should be removed in .132eu, got: {imported}")


def test_localstorage_hidden_key_removed():
    src = _read(MODAL)
    assert "apps_directory_hidden" not in src, (
        "per-user hidden state key `apps_directory_hidden` was "
        "intentionally removed in .132eu")
    # And no lingering `locallyHidden` state variable.
    assert "locallyHidden" not in src
    assert "persistHidden" not in src


def test_footer_removed():
    src = _read(MODAL)
    for tid in ("apps-directory-modal-footer",
                 "apps-directory-modal-hidden-count",
                 "apps-directory-modal-show-manage",
                 "apps-directory-modal-manage-link"):
        assert tid not in src, (
            f"footer testid {tid} was intentionally removed in .132eu")


def test_tiles_render_as_clean_launcher_cards():
    """Whole tile is now a single `<a target=_blank>`; no nested
    buttons/links carrying `stopPropagation` inside."""
    src = _read(MODAL)
    # HubTile still exists.
    assert "function HubTile" in src
    # Root element is an <a> with target=_blank.
    m = re.search(r"function HubTile\([^)]*\)\s*\{[\s\S]+?return \(\s*<a([^>]+)>",
                   src)
    assert m, "HubTile root element must be <a>"
    root_attrs = m.group(1)
    assert 'target="_blank"' in root_attrs
    assert 'rel="noopener noreferrer"' in root_attrs
    # Launch action is a <span> now (was <a>) because the parent is
    # already the anchor — nested anchors would be invalid HTML.
    assert "apps-directory-modal-tile-launch-" in src


def test_map_no_longer_passes_onhide():
    """The tile map used to pass `onHide` for per-user hiding. That
    prop is gone."""
    src = _read(MODAL)
    assert "onHide" not in src


# ── Version-sync ──────────────────────────────────────────────────

def test_version_pinned_to_132eu_or_higher():
    v = _read(VERSION_JS)
    sw = _read(SW)
    m_v = re.search(r"RUNNING_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", v)
    m_sw = re.search(r"CACHE_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", sw)
    assert m_v and m_v.group(1) >= "eu", f"RUNNING_VERSION suffix must be >= 132eu, got {m_v and m_v.group(1)}"
    assert m_sw and m_sw.group(1) >= "eu", f"CACHE_VERSION suffix must be >= 132eu, got {m_sw and m_sw.group(1)}"

"""v58.13.132em — Row-based zebra shading + slate-200 tint."""
from __future__ import annotations

import re
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[2]
FE = APP_ROOT / "frontend" / "src"
CARD = FE / "components" / "CaptureCard.jsx"
GTV = FE / "components" / "capture" / "GroupedTilesView.jsx"
VERSION_JS = FE / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def test_zebra_uses_slate_200():
    """v58.13.132em bumped the tint from `bg-slate-100` (still too
    subtle at desktop sizes) to `bg-slate-200` (#E2E8F0)."""
    src = _read(CARD)
    assert "zebraTint ? 'bg-slate-200" in src, (
        "Zebra tint must be `bg-slate-200` (v58.13.132em bump)")
    # Archived override still owns bg-slate-50 for visual separation.
    assert "isArchived ? 'opacity-60 saturate-50 bg-slate-50" in src


def test_zebra_parity_is_row_based_not_tile_based():
    """Parity now uses `Math.floor(rowIdx / cols) % 2` so the pattern
    reads as horizontal stripes across the grid, not a per-tile
    checkerboard."""
    src = _read(GTV)
    assert "const cols = colsByGroup[key]" in src, (
        "GroupedTilesView must resolve grid columns per group")
    assert "Math.floor(rowIdx / cols)" in src, (
        "Zebra parity must derive from the horizontal row index "
        "(Math.floor(rowIdx / cols)) not the flat tile index")
    assert "zebraTint: zebra && (visualRow % 2 === 1)" in src


def test_grouped_tiles_observes_grid_resize():
    """`cols` must adapt to viewport changes — a ResizeObserver reads
    `gridTemplateColumns` off the grid element."""
    src = _read(GTV)
    assert "new ResizeObserver" in src
    assert "gridTemplateColumns" in src
    assert "setColsByGroup" in src


def test_version_pinned_to_132em_or_higher():
    v = _read(VERSION_JS)
    sw = _read(SW)
    m_v = re.search(r"RUNNING_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", v)
    m_sw = re.search(r"CACHE_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", sw)
    assert m_v and m_v.group(1) >= "em"
    assert m_sw and m_sw.group(1) >= "em"

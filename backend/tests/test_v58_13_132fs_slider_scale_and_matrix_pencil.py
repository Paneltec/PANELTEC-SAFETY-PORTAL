"""v58.13.132fs — Slider scale reduction 200% → 120% + workers-portal
matrix edit pencils.

Two source-pins:

  1. All three photo render sites in Workers.jsx now use h=120%
     (was 200% in .132fq — Stephen said "only needs to be dragged
     down a bit to fit her head in the middle i dont want to
     resize it"). The translateY multipliers scale down
     proportionally: 40→3.2 px, 56→11.2 px, 128→25.6 px overflow.
  2. InductionsMatrix (the "workers portal" view Stephen was on
     when he reported "there is no edit pencil") now surfaces an
     edit-pencil affordance on every row (matrix-row-edit-<id>)
     AND in the pinned-worker chip (matrix-pinned-edit-profile).
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

APP_ROOT = Path(__file__).resolve().parents[2]
WORKERS_JSX = APP_ROOT / "frontend" / "src" / "pages" / "Workers.jsx"
MATRIX_JSX = APP_ROOT / "frontend" / "src" / "components" / "InductionsMatrix.jsx"
VERSION_JS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def test_worker_photo_sites_use_120_percent_height_not_200():
    src = _read(WORKERS_JSX)
    # The .132fq ship used height: '200%'; .132fs must have swapped
    # every occurrence tied to a photo render to '120%'.
    heights = re.findall(r"height:\s*'(\d+)%'", src)
    # We only care about the sites that also carry `objectFit:
    # 'cover'` — those are the photo wrappers. Collect them.
    photo_heights = re.findall(
        r"height:\s*'(\d+)%',\s*\n\s*objectFit:\s*'cover'", src)
    assert len(photo_heights) == 3, (
        f"expected exactly 3 photo render sites, found {len(photo_heights)}: {heights!r}")
    for h in photo_heights:
        assert h == "120", (
            f"photo render site still at height {h}% — .132fs requires 120%")


def test_worker_photo_translate_multipliers_match_120_percent_scale():
    """h=120% ⇒ overflow is 20% of wrapper height. translateY range
    per unit of offset (0..100) MUST equal wrapper_height * 0.002."""
    src = _read(WORKERS_JSX)
    assert "translateY(${-effectiveOffset * 0.112}px)" in src, (
        "edit-modal slider preview (56 px) must translateY by "
        "offset * 0.112 at 120% scale")
    # 40 px row avatar
    assert "* 0.08}px)" in src, (
        "row 40 px avatar must translateY by offset * 0.08 at 120% scale")
    # 128 px ID card
    assert "* 0.256}px)" in src, (
        "128 px ID card must translateY by offset * 0.256 at 120% scale")


def test_matrix_per_row_edit_pencil_present():
    src = _read(MATRIX_JSX)
    assert 'data-testid={`matrix-row-edit-${r.id}`}' in src, (
        "InductionsMatrix must expose a per-row edit pencil with "
        "data-testid=matrix-row-edit-<id> in .132fs")
    assert '<Edit3 />' in src, (
        "InductionsMatrix must import + render the Edit3 pencil icon")


def test_matrix_pinned_chip_has_edit_pencil():
    src = _read(MATRIX_JSX)
    assert 'data-testid="matrix-pinned-edit-profile"' in src, (
        "pinned-worker chip must carry a visible edit-pencil button "
        "(matrix-pinned-edit-profile) in .132fs")
    assert 'title="Edit worker profile"' in src, (
        "pinned edit-pencil button must have a descriptive title")


def test_version_bumped_to_132fs():
    ver = _read(VERSION_JS)
    sw = _read(SW)
    assert "paneltec-v160.3.9.58.13.132fs" in ver
    assert "paneltec-v160.3.9.58.13.132fs" in sw

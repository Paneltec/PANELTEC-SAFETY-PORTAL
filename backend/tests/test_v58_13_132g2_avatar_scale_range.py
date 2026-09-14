"""v58.13.132g2 — Avatar-scale range bump (120% → 150%).

Stephen wants more downward range on the Workers.jsx avatar wrapper
so subjects like Mel where the face sits high in the source photo
can be pushed lower. Wrapper height goes from `120%` to `150%` at
all 3 render sites; translateY multipliers scale in lockstep at 2.5×
so `photo_offset_y` = 100 still hits the fully-shifted-down edge.

Pre-.132g2 → .132g2:
  · site A (edit modal preview):  height 120%  mul 0.112   →  150%  0.280
  · site B (list row 40-ish avatar): height 120%  mul 0.08 →  150%  0.200
  · site C (ID card 128px):       height 120%  mul 0.256   →  150%  0.640
"""
from __future__ import annotations

from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[2]
WORKERS_JSX = APP_ROOT / "frontend" / "src" / "pages" / "Workers.jsx"
VERSION_JS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


# ─── Wrapper height ────────────────────────────────────────────

def test_avatar_wrapper_bumped_to_150_percent():
    src = _read(WORKERS_JSX)
    # All prior 120% wrappers on the avatar `<img>` tags must be
    # gone; every avatar `height:` on the transform-wrapped image
    # must now be 150%.
    assert src.count("height: '120%'") == 0, (
        "no avatar wrapper should still be at 120% — .132g2 bump")
    # Exactly 3 avatar render sites → exactly 3 hits at 150%.
    assert src.count("height: '150%'") == 3, (
        "expected 3 avatar wrappers at 150% (edit modal + list row "
        "+ ID card); found "
        f"{src.count(chr(0x27) + '150%' + chr(0x27))}")


# ─── translateY multipliers scaled 2.5× ────────────────────────

def test_translateY_multipliers_scaled_25x():
    src = _read(WORKERS_JSX)
    # Old .132fs multipliers must be gone.
    for old in ("0.112", "0.08}px", "0.256"):
        assert old not in src, (
            f"pre-.132g2 avatar translateY multiplier {old!r} still "
            "present in Workers.jsx — bump was incomplete")
    # New multipliers exactly 2.5× the .132fs values.
    #   0.112 × 2.5 = 0.280
    #   0.080 × 2.5 = 0.200
    #   0.256 × 2.5 = 0.640
    assert "* 0.280}px)" in src
    assert "* 0.200}px)" in src
    assert "* 0.640}px)" in src


def test_offset_still_clamped_0_100():
    """The offset clamp `Math.max(0, Math.min(100, photoOffsetY))`
    on the edit-modal path is untouched by this ship — its role
    is unchanged (offset input still 0-100). This guard keeps
    later refactors from breaking the mapping."""
    src = _read(WORKERS_JSX)
    assert "Math.max(0, Math.min(100, photoOffsetY))" in src


# ─── Version lockstep ──────────────────────────────────────────

def test_version_bumped_to_132g2():
    assert "paneltec-v160.3.9.58.13.132g2" in _read(VERSION_JS)
    assert "paneltec-v160.3.9.58.13.132g2" in _read(SW)

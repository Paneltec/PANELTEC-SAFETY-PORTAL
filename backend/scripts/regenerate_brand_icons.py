#!/usr/bin/env python3
"""
Paneltec Civil — PWA / launcher icon regenerator (Phase 4.10.1, v116).

Renders the orange chevron "A" mark (same SVG path data the React Logo.jsx
component uses) into every PNG size the PWA / iOS / Android pipelines need.
Run once whenever the brand mark changes:

    python3 /app/backend/scripts/regenerate_brand_icons.py

Output:
    /app/frontend/public/brand/icon-192.png             (transparent)
    /app/frontend/public/brand/icon-512.png             (transparent)
    /app/frontend/public/brand/icon-maskable-192.png    (slate-900 + 20% safe pad)
    /app/frontend/public/brand/icon-maskable-512.png    (slate-900 + 20% safe pad)
    /app/frontend/public/brand/apple-touch-icon.png     (slate-900, 180x180)
    /app/frontend/public/brand/mark.png                 (256x256, transparent)
    /app/frontend/public/brand/icon-monochrome-512.png  (slate-900 + white chevron)

No CSS variables involved — Pillow draws the polygon directly from the same
control points the SVG uses. If the marketing wordmark ever changes shape,
update `CHEVRON_PATH` here and re-run.
"""
from __future__ import annotations

from pathlib import Path
from PIL import Image, ImageDraw

# ─────────────────────── Brand constants ───────────────────────
ORANGE = (249, 115, 22, 255)        # Tailwind orange-500 / #F97316
ORANGE_STROKE = (234, 88, 12, 255)  # Tailwind orange-600 / #EA580C
SLATE_900 = (30, 41, 59, 255)       # Tailwind slate-900 / #1E293B
WHITE = (255, 255, 255, 255)

# 24×24 viewBox vertices, identical to the SVG path data in Logo.jsx:
#   M12 3 L21 19 L15 19 L12 13 L9 19 L3 19 Z
CHEVRON_PATH = [(12, 3), (21, 19), (15, 19), (12, 13), (9, 19), (3, 19)]

OUT_DIR = Path("/app/frontend/public/brand")


def _scale(points, side: int, pad_pct: float = 0.0) -> list[tuple[float, float]]:
    """Scale 24×24 viewBox vertices to a `side`-pixel canvas, centred,
    optionally inset by `pad_pct` (0.0–0.5) for maskable safe area."""
    inner = side * (1 - 2 * pad_pct)
    offset = (side - inner) / 2
    s = inner / 24.0
    return [(offset + x * s, offset + y * s) for (x, y) in points]


def _render_chevron(side: int, *,
                    background: tuple | None = None,
                    fill: tuple = ORANGE,
                    stroke: tuple | None = ORANGE_STROKE,
                    pad_pct: float = 0.0) -> Image.Image:
    """Render one chevron icon at `side`×`side` with the given background,
    fill, optional stroke, and padding (used for maskable safe area)."""
    img = Image.new("RGBA", (side, side),
                    background if background is not None else (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    pts = _scale(CHEVRON_PATH, side, pad_pct=pad_pct)
    # Two-pass render: stroke as a thicker base, then fill on top so the
    # rasterised polygon has the same subtle outline the SVG carries.
    if stroke is not None:
        # Stroke is drawn as a slightly-thicker filled polygon then the
        # main fill goes on top. Width derived from canvas size — keeps
        # the stroke visually consistent across icon dimensions.
        sw = max(2, side // 256)
        draw.polygon(pts, fill=stroke)
        # Inset the fill polygon by ~sw px so the stroke shows through.
        cx = sum(x for x, _ in pts) / len(pts)
        cy = sum(y for _, y in pts) / len(pts)
        inset = [(x + (cx - x) * (sw / max(side, 1) * 6),
                  y + (cy - y) * (sw / max(side, 1) * 6)) for (x, y) in pts]
        draw.polygon(inset, fill=fill)
    else:
        draw.polygon(pts, fill=fill)
    return img


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # icon-192 / icon-512 — transparent background, plain orange chevron.
    # These are the "any" purpose icons in manifest.json.
    _render_chevron(192).save(OUT_DIR / "icon-192.png", "PNG", optimize=True)
    _render_chevron(512).save(OUT_DIR / "icon-512.png", "PNG", optimize=True)

    # Maskable variants — Android crops icons to whatever launcher shape the
    # device wants (circle, squircle, rounded square…), so we inset the
    # chevron 20% from each edge per the W3C maskable icon spec.
    _render_chevron(192, background=SLATE_900, pad_pct=0.20)\
        .save(OUT_DIR / "icon-maskable-192.png", "PNG", optimize=True)
    _render_chevron(512, background=SLATE_900, pad_pct=0.20)\
        .save(OUT_DIR / "icon-maskable-512.png", "PNG", optimize=True)

    # apple-touch-icon — iOS renders this as a rounded-square home-screen
    # tile. Use the slate-900 background so the chevron pops against the
    # iOS lock-screen + home-screen wallpapers.
    _render_chevron(180, background=SLATE_900, pad_pct=0.12)\
        .save(OUT_DIR / "apple-touch-icon.png", "PNG", optimize=True)

    # Legacy `mark.png` — kept on disk for any external embed / email
    # signature / OG-image use even though Cover.jsx no longer renders it
    # inline. 256×256 transparent, plain orange chevron.
    _render_chevron(256).save(OUT_DIR / "mark.png", "PNG", optimize=True)

    # Monochrome variant — used by some Android themed-icon engines and
    # the Windows tile. White chevron on slate-900.
    _render_chevron(512, background=SLATE_900, fill=WHITE,
                    stroke=None, pad_pct=0.20)\
        .save(OUT_DIR / "icon-monochrome-512.png", "PNG", optimize=True)

    for f in sorted(OUT_DIR.glob("*.png")):
        print(f"  {f.name}  ({f.stat().st_size:>7} bytes)")


if __name__ == "__main__":
    main()

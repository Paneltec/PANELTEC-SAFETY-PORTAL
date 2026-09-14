"""v58.13.132fk — Paneltec Group brand sweep.

Ships:
  · Regenerated brand asset set under frontend/public/brand/:
      - logo-wordmark-480.png, logo-wordmark-960.png    header
      - logo-16.png / -32.png / -48.png / -192.png / -512.png
      - favicon.ico (composite 16/32/48)                (also copied to
                                                          /public/favicon.ico)
      - icon-192.png / icon-512.png (rebuilt from Group art)
      - apple-touch-icon.png (rebuilt from Group art)
      - mark.png (rebuilt from Group art)
  · Frontend Logo component now serves the PNG wordmark for the
    Paneltec-family display names ("Paneltec Civil",
    "Paneltec Group", "The Paneltec Group"), keeps the SVG-chevron
    fallback for custom-tenant names.
  · Backend pdf_chrome falls back to the bundled wordmark PNG
    when no per-org logo_url is set.

Conversion pipeline (documented for future rebuilds):
  gs -sDEVICE=pngalpha -dEPSCrop -r300 -o hi.png source.eps
  → PIL.getbbox() → crop → resize onto padded canvas for each size
"""
from __future__ import annotations

import re
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[2]
BRAND = APP_ROOT / "frontend" / "public" / "brand"
LOGO_JSX = APP_ROOT / "frontend" / "src" / "components" / "brand" / "Logo.jsx"
PDF_CHROME = APP_ROOT / "backend" / "pdf_chrome.py"
VERSION_JS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


# ── Brand assets on disk ─────────────────────────────────────────

def test_brand_asset_files_shipped():
    for name in ("logo-wordmark-480.png", "logo-wordmark-960.png",
                  "logo-16.png", "logo-32.png", "logo-48.png",
                  "logo-192.png", "logo-512.png",
                  "favicon.ico", "icon-192.png", "icon-512.png",
                  "apple-touch-icon.png", "mark.png"):
        p = BRAND / name
        assert p.is_file(), f"missing asset: {p}"
        assert p.stat().st_size > 100, f"asset {name} is unreasonably small ({p.stat().st_size} bytes)"


def test_root_favicon_shipped():
    """`/favicon.ico` at the public/ root — some browsers still
    request this path directly regardless of manifest."""
    p = APP_ROOT / "frontend" / "public" / "favicon.ico"
    assert p.is_file()


def test_png_wordmark_transparent_and_wide():
    """Sanity-check the header wordmark: must be RGBA, must be
    wide (Paneltec Group logo is ~5:1)."""
    from PIL import Image
    im = Image.open(BRAND / "logo-wordmark-480.png")
    assert im.mode == "RGBA"
    w, h = im.size
    assert w >= 400 and w / h >= 3, f"wordmark aspect too tall: {w}x{h}"


# ── Frontend Logo component ─────────────────────────────────────

def test_logo_component_serves_png_for_paneltec_family():
    src = _read(LOGO_JSX)
    # Paneltec-family display names hit the PNG branch.
    assert "'Paneltec Civil'" in src and "'Paneltec Group'" in src \
        and "'The Paneltec Group'" in src, (
            "PANELTEC_FAMILY must include the three known display names")
    # PNG src + 2x srcSet.
    assert re.search(
        r'src="/brand/logo-wordmark-480\.png"',
        src)
    assert re.search(
        r'srcSet="/brand/logo-wordmark-480\.png 1x,\s*'
        r'/brand/logo-wordmark-960\.png 2x"',
        src)
    # data-brand-variant tag for tests.
    assert 'data-brand-variant="paneltec-group-png"' in src
    assert 'data-brand-variant="fallback-svg"' in src


def test_logo_fallback_svg_preserved_for_custom_tenants():
    """Multi-tenant instances that pass a non-Paneltec displayName
    must still get the SVG-chevron + text wordmark."""
    src = _read(LOGO_JSX)
    # Fallback still renders the orange chevron path.
    assert 'fill="#F97316"' in src
    # And the text split still highlights the last word in orange.
    assert 'className="text-orange-500"' in src


# ── Backend PDF letterhead falls back to bundled asset ───────────

def test_pdf_chrome_falls_back_to_bundled_wordmark():
    src = _read(PDF_CHROME)
    m = re.search(
        r"# v58\.13\.132fk[\s\S]{0,400}"
        r'"logo-wordmark-960\.png"',
        src)
    assert m, ("pdf_chrome must fall back to bundled wordmark PNG "
                "when the org has no logo_url")


# ── Version pin ──────────────────────────────────────────────────

def test_version_pinned_to_132fk_or_higher():
    v = _read(VERSION_JS)
    sw = _read(SW)
    m_v = re.search(r"RUNNING_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", v)
    m_ex = re.search(r"EXPECTED_CACHE_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", v)
    m_sw = re.search(r"CACHE_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", sw)
    for name, m in (("RUNNING_VERSION", m_v),
                     ("EXPECTED_CACHE_VERSION", m_ex),
                     ("CACHE_VERSION", m_sw)):
        assert m and m.group(1) >= "fk", (
            f"{name} suffix must be >= 132fk, got {m and m.group(1)}")

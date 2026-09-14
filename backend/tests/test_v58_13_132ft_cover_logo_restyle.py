"""v58.13.132ft — Cover.jsx logo restyle.

Pins:
  1. Logo component accepts an `onDark` prop.
  2. Cover.jsx renders the hero logo with `onDark`, size="2xl".
  3. Cover.jsx no longer renders the desktop topbar logo (it was
     moved into the hero block so it aligns with the heading).
  4. AppShell (header / sidebar) does NOT pass `onDark` so it keeps
     the original grey + orange PNG.
  5. Both white-variant PNGs exist on disk.
"""
from __future__ import annotations

import re
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[2]
LOGO_JSX = APP_ROOT / "frontend" / "src" / "components" / "brand" / "Logo.jsx"
COVER_JSX = APP_ROOT / "frontend" / "src" / "pages" / "Cover.jsx"
SHELL_JSX = APP_ROOT / "frontend" / "src" / "components" / "layout" / "AppShell.jsx"
LOGIN_JSX = APP_ROOT / "frontend" / "src" / "pages" / "Login.jsx"
BRAND_DIR = APP_ROOT / "frontend" / "public" / "brand"
VERSION_JS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def test_logo_component_accepts_on_dark_prop():
    src = _read(LOGO_JSX)
    assert "onDark = false" in src, "Logo must accept an `onDark` prop"
    assert "paneltec-group-png-on-dark" in src, (
        "Logo must emit data-brand-variant=paneltec-group-png-on-dark when "
        "onDark is true")
    assert "logo-wordmark-white" in src, (
        "Logo must swap the src to /brand/logo-wordmark-white-*.png when "
        "onDark is true")


def test_cover_uses_on_dark_hero_logo():
    src = _read(COVER_JSX)
    assert 'size="2xl"' in src, "Cover hero logo must render at size='2xl'"
    assert 'displayName="The Paneltec Group" onDark' in src, (
        "Cover hero logo must set onDark for the pre-login page")


def test_cover_removed_desktop_topbar_logo():
    """The desktop topbar logo has been moved into the hero block so
    it aligns with the heading. Verify the topbar is now
    `justify-end` (right-side items only) and no longer wraps a
    <Logo /> inside cover-brand at the topbar level."""
    src = _read(COVER_JSX)
    # Topbar container was `justify-between`, now `justify-end`.
    assert re.search(
        r'absolute top-0 inset-x-0 z-20 items-center justify-end',
        src), "Cover topbar must use justify-end after .132ft logo move"


def test_shell_and_login_do_not_pass_on_dark():
    """Every OTHER Logo caller must keep the original grey + orange
    variant (no `onDark` prop). Guards against a regression that
    would swap the header, sidebar, standalone login page, resolvers,
    or renewal page to the white-only variant."""
    for path in (SHELL_JSX, LOGIN_JSX):
        src = _read(path)
        assert "onDark" not in src, (
            f"{path.name} must NOT pass onDark to <Logo /> — only Cover.jsx "
            "uses the on-dark variant.")


def test_white_wordmark_png_assets_exist():
    for w in ("480", "960"):
        p = BRAND_DIR / f"logo-wordmark-white-{w}.png"
        assert p.exists(), (
            f"missing on-dark PNG asset {p} — generate with PIL from the "
            "original logo-wordmark-<w>.png by swapping mid-range grey "
            "pixels to white.")


def test_version_bumped_to_132ft():
    ver = _read(VERSION_JS)
    sw = _read(SW)
    assert "paneltec-v160.3.9.58.13.132ft" in ver
    assert "paneltec-v160.3.9.58.13.132ft" in sw

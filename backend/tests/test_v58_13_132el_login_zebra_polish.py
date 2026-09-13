"""v58.13.132el — Copyright drops extra `v` + zebra shading bumped."""
from __future__ import annotations

import re
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[2]
FE = APP_ROOT / "frontend" / "src"
COVER = FE / "pages" / "Cover.jsx"
CARD = FE / "components" / "CaptureCard.jsx"
VERSION_JS = FE / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def test_copyright_drops_extra_v_prefix():
    """Template must be `· {RUNNING_VERSION}` — the `v` prefix is
    already baked into the version string itself."""
    src = _read(COVER)
    pos = src.find('data-testid="cover-copyright"')
    assert pos > 0
    window = src[pos:pos + 500]
    assert "· v{RUNNING_VERSION}" not in window, (
        "Copyright must not double-prefix with `v` — RUNNING_VERSION "
        "already starts with `paneltec-v…`.")
    assert "· {RUNNING_VERSION}" in window, (
        "Copyright must inline `{RUNNING_VERSION}` directly")


def test_zebra_uses_slate_100_not_slate_50():
    """The tint bumped from `bg-slate-50` → `bg-slate-100` in .132el,
    and again to `bg-slate-200` in .132em. Accept 100 or 200 as
    valid so .132el and .132em can co-exist."""
    src = _read(CARD)
    assert re.search(r"zebraTint \? 'bg-slate-(100|200)", src), (
        "Zebra tint must be `bg-slate-{100,200}` (.132el/.132em bumps)")
    assert "isArchived ? 'opacity-60 saturate-50 bg-slate-50" in src, (
        "Archived override must still use `bg-slate-50`")


def test_version_pinned_to_132el_or_higher():
    v = _read(VERSION_JS)
    sw = _read(SW)
    m_v = re.search(r"RUNNING_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", v)
    m_sw = re.search(r"CACHE_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", sw)
    assert m_v and m_v.group(1) >= "el"
    assert m_sw and m_sw.group(1) >= "el"

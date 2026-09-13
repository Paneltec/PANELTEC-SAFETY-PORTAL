"""v58.13.132ej — Login page copyright reposition + recolour."""
from __future__ import annotations

import re
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[2]
COVER = APP_ROOT / "frontend" / "src" / "pages" / "Cover.jsx"
VERSION_JS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def test_copyright_uses_paneltec_gold():
    src = _read(COVER)
    # Locate the copyright block and confirm it wears the same
    # `--paneltec-gold` token the "Build Together." headline uses.
    pos = src.find('data-testid="cover-copyright"')
    assert pos > 0
    window = src[max(0, pos - 400): pos + 200]
    assert "var(--paneltec-gold)" in window, (
        "Copyright must be tinted with --paneltec-gold (v58.13.132ej)")


def test_copyright_sits_under_trust_line_on_left():
    """Trust line and copyright must live in the same left column,
    not in a flex-row that spreads them across the hero."""
    src = _read(COVER)
    trust_pos = src.find('data-testid="cover-trust"')
    cr_pos = src.find('data-testid="cover-copyright"')
    assert trust_pos > 0 and cr_pos > 0
    # Copyright must come AFTER trust (stacked vertically), not before.
    assert cr_pos > trust_pos, (
        "Copyright must render after (below) the trust line")
    # No `flex items-end justify-between` wrapper between them —
    # that was the right-column layout from .132ei.
    between = src[trust_pos:cr_pos]
    assert "justify-between" not in between, (
        "Copyright must NOT be in a justify-between row (right-aligned).")


def test_copyright_text_preserved():
    src = _read(COVER)
    assert "© 2026 Stephen Guy" in src
    assert "Paneltec Civil" in src
    assert "All rights reserved" in src


def test_cover_keeps_hero_and_wordmark():
    src = _read(COVER)
    assert 'data-testid="cover-hero-img"' in src
    assert src.count("PANELTEC CIVIL") >= 2
    assert "PaneltecHero" in src


def test_version_pinned_to_132ej_or_higher():
    v = _read(VERSION_JS)
    sw = _read(SW)
    m_v = re.search(r"RUNNING_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", v)
    m_sw = re.search(r"CACHE_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", sw)
    assert m_v and m_v.group(1) >= "ej"
    assert m_sw and m_sw.group(1) >= "ej"

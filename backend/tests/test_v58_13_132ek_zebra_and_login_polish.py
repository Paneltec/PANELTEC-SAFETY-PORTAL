"""v58.13.132ek — Zebra shading on Incident Reports + login cover polish."""
from __future__ import annotations

import re
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[2]
FE = APP_ROOT / "frontend" / "src"
CARD = FE / "components" / "CaptureCard.jsx"
GTV = FE / "components" / "capture" / "GroupedTilesView.jsx"
INCIDENTS = FE / "pages" / "Incidents.jsx"
HERO = FE / "components" / "marketing" / "PaneltecHero.jsx"
COVER = FE / "pages" / "Cover.jsx"
VERSION_JS = FE / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


# ─── Zebra plumbing ───────────────────────────────────────────
def test_capture_card_accepts_zebra_tint():
    src = _read(CARD)
    assert "zebraTint = false" in src, (
        "CaptureCard must accept an opt-in `zebraTint` prop")
    # Applied to the outer wrapper background. v58.13.132el bumped the
    # tint from `bg-slate-50` → `bg-slate-100` for stronger visibility;
    # accept either so the .132ek pin doesn't fight .132el.
    assert re.search(r"zebraTint \? 'bg-slate-(50|100|200)", src), (
        "zebraTint must swap the outer wrapper to bg-slate-{50,100,200}")
    # Archived still wins visually (opacity + saturate + own bg-slate-50).
    assert "isArchived ? 'opacity-60 saturate-50 bg-slate-50" in src


def test_grouped_tiles_view_supports_zebra():
    src = _read(GTV)
    assert "zebra = false" in src or "zebra=" in src
    # rowIdx feeds the parity check.
    assert "rows.map((rec, rowIdx)" in src
    # v58.13.132ek: `rowIdx % 2 === 1`
    # v58.13.132em: `visualRow % 2 === 1` where visualRow = floor(rowIdx / cols)
    assert ("zebraTint: zebra && (rowIdx % 2 === 1)" in src
            or "zebraTint: zebra && (visualRow % 2 === 1)" in src)


def test_incidents_opts_in_to_zebra():
    src = _read(INCIDENTS)
    # Locate the GroupedTilesView opening tag through its self-closing
    # `/>` — allow arbitrarily large blocks (the block is >900 chars).
    m = re.search(r'<GroupedTilesView([\s\S]+?)/>', src)
    assert m, "GroupedTilesView block not found in Incidents.jsx"
    block = m.group(1)
    assert re.search(r'\bzebra\b', block), (
        "Incidents must opt in via `zebra` prop on GroupedTilesView")
    # Threads ctx.zebraTint through renderTile → CaptureCard.
    assert "zebraTint={ctx.zebraTint}" in src


# ─── Login cover — unified yellow tagline ────────────────────
def test_hero_all_three_headline_lines_are_paneltec_gold():
    src = _read(HERO)
    # Count spans that carry the gold style adjacent to a headline slot.
    n = src.count("style={{ color: 'var(--paneltec-gold)' }}")
    assert n >= 3, (
        f"All 3 headline spans must wear --paneltec-gold "
        f"(found {n}); v58.13.132ek")


# ─── Login cover — copyright shows live version ──────────────
def test_copyright_imports_running_version():
    src = _read(COVER)
    assert "import { RUNNING_VERSION } from '../lib/version'" in src, (
        "Cover must import RUNNING_VERSION from version.js")


def test_copyright_renders_live_version_and_drops_paneltec_civil():
    src = _read(COVER)
    # Locate copyright block and check the visible text.
    pos = src.find('data-testid="cover-copyright"')
    assert pos > 0
    window = src[pos:pos + 500]
    # v58.13.132el — accept either `· v{RUNNING_VERSION}` (.132ek) OR
    # `· {RUNNING_VERSION}` (.132el, which drops the extra v prefix
    # because RUNNING_VERSION already starts with `paneltec-v…`).
    assert ("· v{RUNNING_VERSION}" in window
            or "· {RUNNING_VERSION}" in window), (
        "Copyright must inline `{RUNNING_VERSION}` (with or without a "
        "leading `v`)")
    # "Paneltec Civil" must NOT appear inside the copyright block.
    assert "Paneltec Civil" not in window, (
        "Copyright must no longer include the `Paneltec Civil` string")
    assert "© 2026 Stephen Guy" in window
    assert "All rights reserved" in window


def test_copyright_keeps_paneltec_gold():
    src = _read(COVER)
    pos = src.find('data-testid="cover-copyright"')
    window = src[max(0, pos - 400):pos + 200]
    assert "var(--paneltec-gold)" in window


# ─── Version pin ─────────────────────────────────────────────
def test_version_pinned_to_132ek_or_higher():
    v = _read(VERSION_JS)
    sw = _read(SW)
    m_v = re.search(r"RUNNING_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", v)
    m_sw = re.search(r"CACHE_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", sw)
    assert m_v and m_v.group(1) >= "ek"
    assert m_sw and m_sw.group(1) >= "ek"

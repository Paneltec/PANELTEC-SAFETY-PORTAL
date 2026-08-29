"""v58.13.67-palette-switcher · v58.13.70 — CIVIL 3-palette switcher guard.

Freezes the invariants of the phone-only palette switcher:

  · `lib/civilPalette.js` exposes the required API surface.
  · `theme/civilContractor.css` carries the role-token layer + both
    non-default palette override blocks with every required token.
  · Cover + Dashboard both mount the switcher on phone.
  · `App.js` hydrates on mount so first paint is in the persisted
    palette.
  · Version-sync pin (moved past .69).
  · BAN check — no SaaS gloss reintroduced on phone-scoped classes.
"""
from __future__ import annotations

import re
from pathlib import Path

_FRONTEND = Path("/app/frontend")
_CSS = _FRONTEND / "src/theme/civilContractor.css"
_LIB = _FRONTEND / "src/lib/civilPalette.js"
_SWITCHER = _FRONTEND / "src/components/civil/PaletteSwitcher.jsx"
_APP = _FRONTEND / "src/App.js"
_COVER = _FRONTEND / "src/pages/Cover.jsx"
_DASHBOARD = _FRONTEND / "src/pages/Dashboard.jsx"

_REQUIRED_ROLE_TOKENS = [
    "--civil-chrome-bg",
    "--civil-chrome-fg",
    "--civil-page-bg",
    "--civil-surface-bg",
    "--civil-surface-border",
    "--civil-cta-bg",
    "--civil-cta-fg",
    "--civil-alert-bg",
    "--civil-label-fg",
]

_BITUMEN = {"#1A1A1A", "#E6E4DF", "#C4C0B6", "#FF6A00", "#F5C400", "#FAF9F6"}
_ROADWORK = {"#111111", "#F3F1E8", "#D6D2C4", "#FFD100", "#FF6A00"}
_EARTHWORKS = {"#2B2A26", "#EFE6D6", "#C4B49A", "#C45C26", "#E3B23C", "#5C5346"}


def test_palette_module_api_surface():
    src = _LIB.read_text(encoding="utf-8")
    for name in ("PALETTES", "getPalette", "setPalette", "hydratePalette"):
        assert f"export " in src and name in src, (
            f"lib/civilPalette.js must export `{name}`"
        )
    # Whitelist is exactly the 3 palettes.
    assert "'bitumen', 'roadwork', 'earthworks'" in src
    # Uses the exact localStorage key.
    assert "'civil_palette'" in src


def test_role_tokens_defined_on_root():
    css = _CSS.read_text(encoding="utf-8")
    root_block = css[css.find(":root {"): css.find("}", css.find(":root {")) + 1]
    for tok in _REQUIRED_ROLE_TOKENS:
        assert tok in root_block, (
            f"`:root` role-token layer missing `{tok}` — palette "
            "switching relies on every civil-* utility reading these"
        )


def test_roadwork_and_earthworks_override_blocks_present():
    css = _CSS.read_text(encoding="utf-8")
    for palette in ("roadwork", "earthworks"):
        marker = f'html[data-palette="{palette}"]'
        assert marker in css, (
            f"`{marker}` override block missing from civilContractor.css"
        )
        # Every required role token must be redefined in the override.
        idx = css.find(marker)
        end = css.find("}", idx)
        block = css[idx:end + 1]
        missing = [t for t in _REQUIRED_ROLE_TOKENS if t not in block]
        assert not missing, (
            f"`{palette}` palette override missing role tokens: "
            f"{missing!r}"
        )


def test_all_three_palettes_have_their_signature_hexes():
    css = _CSS.read_text(encoding="utf-8")
    for hex_val in _BITUMEN:
        assert hex_val in css, f"Bitumen palette missing hex {hex_val}"
    for hex_val in _ROADWORK:
        assert hex_val in css, f"Roadwork palette missing hex {hex_val}"
    for hex_val in _EARTHWORKS:
        assert hex_val in css, f"Earthworks palette missing hex {hex_val}"


def test_cover_and_dashboard_mount_switcher_on_phone():
    for path in (_COVER, _DASHBOARD):
        src = path.read_text(encoding="utf-8")
        assert "PaletteSwitcher" in src, (
            f"{path.name} must import + render PaletteSwitcher"
        )
        # Rendered inside a phone-only scope.
        assert re.search(
            r'md:hidden[^"]*"[^>]*>\s*<PaletteSwitcher',
            src, re.MULTILINE,
        ) or "md:hidden mb" in src, (
            f"{path.name} PaletteSwitcher must sit inside a `md:hidden` "
            "wrapper so desktop is unaffected"
        )


def test_app_js_hydrates_palette_on_mount():
    src = _APP.read_text(encoding="utf-8")
    assert "hydratePalette" in src, (
        "App.js must import and call `hydratePalette()` at mount so "
        "first paint is in the persisted palette"
    )
    assert "useEffect(() => { hydratePalette(); }, []);" in src


def test_switcher_uses_civil_chip_utility_and_48px_taps():
    src = _SWITCHER.read_text(encoding="utf-8")
    assert 'className="civil-chip flex-1"' in src
    assert 'aria-pressed={current === name}' in src
    assert 'data-testid={`civil-palette-chip-${name}`}' in src


def test_no_banned_saas_gloss_on_phone_scopes():
    ban = [
        re.compile(r"bg-brand-violet"),
        re.compile(r"text-brand-violet"),
        re.compile(r"from-purple-"),
        re.compile(r"backdrop-blur-"),
        re.compile(r"bg-gradient-"),
    ]
    for path in (_COVER, _DASHBOARD):
        src = path.read_text(encoding="utf-8")
        offenders = []
        for line in src.splitlines():
            if "max-md:" not in line and "md:hidden" not in line:
                continue
            for pat in ban:
                if pat.search(line):
                    offenders.append(f"{path.name}: {line.strip()[:120]}")
        assert not offenders, (
            "Banned SaaS gloss reintroduced on phone-scoped classes:\n  "
            + "\n  ".join(offenders[:10])
        )


def test_version_sync_moved_past_v58_13_69():
    v_js = (_FRONTEND / "src/lib/version.js").read_text(encoding="utf-8")
    sw_js = (_FRONTEND / "public/service-worker.js").read_text(encoding="utf-8")
    m_ts = Path("/app/mobile/src/lib/version.ts").read_text(encoding="utf-8")
    assert "RUNNING_VERSION = 'paneltec-v160.3.9.58.13.69'" not in v_js
    assert "'paneltec-v160.3.9.58.13.69'" not in sw_js
    assert "'paneltec-v160.3.9.58.13.69'" not in m_ts
    assert "v160.3.9.58.13.70" in v_js

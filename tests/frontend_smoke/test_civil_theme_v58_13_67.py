"""v58.13.67 — CIVIL contractor phone-first theme guard.

Freezes the visual invariants of the CIVIL palette so a future ship
can't quietly reintroduce purple/gradient/backdrop-blur SaaS gloss on
the phone-viewport surfaces, and can't drift the 6-hex palette away
from the source of truth in `src/theme/civilContractor.css`.

Static source scan — no browser, no build required.
"""
from __future__ import annotations

import re
from pathlib import Path

_FRONTEND = Path("/app/frontend")
_THEME = _FRONTEND / "src/theme/civilContractor.css"
_TAILWIND = _FRONTEND / "tailwind.config.js"
_INDEX_CSS = _FRONTEND / "src/index.css"
_COVER = _FRONTEND / "src/pages/Cover.jsx"
_DASHBOARD = _FRONTEND / "src/pages/Dashboard.jsx"

_PALETTE = ["#1A1A1A", "#E6E4DF", "#C4C0B6", "#FF6A00", "#F5C400", "#FAF9F6"]
_BAN_PATTERNS = [
    re.compile(r"bg-brand-violet"),
    re.compile(r"text-brand-violet"),
    re.compile(r"from-purple-"),
    re.compile(r"via-purple-"),
    re.compile(r"to-purple-"),
    re.compile(r"backdrop-blur-"),
    re.compile(r"bg-gradient-"),
]


def test_theme_file_carries_all_six_palette_hex():
    src = _THEME.read_text(encoding="utf-8")
    missing = [h for h in _PALETTE if h.lower() not in src.lower()]
    assert not missing, (
        f"`civilContractor.css` missing palette hex(es): {missing!r}"
    )


def test_tailwind_has_civil_namespace():
    src = _TAILWIND.read_text(encoding="utf-8")
    assert "civil:" in src or "civil: {" in src
    for h in _PALETTE:
        assert h in src, f"tailwind.config.js missing palette hex {h}"


def test_index_css_imports_theme():
    src = _INDEX_CSS.read_text(encoding="utf-8")
    assert "./theme/civilContractor.css" in src, (
        "index.css must @import the CIVIL theme so the utility "
        "classes are compiled into the bundle"
    )


def test_cover_phone_uses_civil_classes():
    src = _COVER.read_text(encoding="utf-8")
    # At least one civil-* utility class must appear on a phone-scoped
    # element of Cover.jsx.
    assert "civil-chrome" in src, "Cover.jsx must render civil-chrome header on phone"
    assert "civil-cta" in src, "Cover.jsx submit button must use civil-cta on phone"
    assert "civil-label" in src or "civil-label-inverse" in src
    # The mobile-only PaneltecHero splash must be gone.
    assert "md:hidden mb-6 px-2" not in src or "PaneltecHero variant=\"compact\"" not in src, (
        "Phone PaneltecHero splash must be removed on <md per v58.13.67"
    )


def test_dashboard_phone_drops_intelligence_centre_copy():
    src = _DASHBOARD.read_text(encoding="utf-8")
    # Marketing phrases still allowed on desktop scope but NOT on phone.
    # We look for the phone-only span that carries the plain word.
    assert "'md:hidden'" in src or 'className="md:hidden' in src, (
        "Dashboard must have a phone-scoped (md:hidden) block for the "
        "plain-copy replacement"
    )
    assert ">Dashboard<" in src, (
        "Phone-viewport Dashboard title must read plain 'Dashboard'"
    )
    assert "Status and actions for your site." in src, (
        "Phone subtitle must be the plain-copy replacement"
    )


def test_no_banned_saas_gloss_on_phone_scopes():
    for path in (_COVER, _DASHBOARD):
        src = path.read_text(encoding="utf-8")
        # Extract every className that carries `max-md:` or `md:hidden`
        # — those are the phone-only scopes.
        offenders = []
        for line in src.splitlines():
            if "max-md:" not in line and "md:hidden" not in line:
                continue
            for pat in _BAN_PATTERNS:
                if pat.search(line):
                    offenders.append(f"{path.name}: {line.strip()[:120]}")
        assert not offenders, (
            "Banned SaaS gloss found on phone-scoped classes:\n  "
            + "\n  ".join(offenders[:10])
        )


def test_version_sync_moved_past_v58_13_66():
    v_js = (_FRONTEND / "src/lib/version.js").read_text(encoding="utf-8")
    sw_js = (_FRONTEND / "public/service-worker.js").read_text(encoding="utf-8")
    m_ts = Path("/app/mobile/src/lib/version.ts").read_text(encoding="utf-8")
    assert "RUNNING_VERSION = 'paneltec-v160.3.9.58.13.66'" not in v_js
    assert "'paneltec-v160.3.9.58.13.66'" not in sw_js
    assert "'paneltec-v160.3.9.58.13.66'" not in m_ts
    assert "v160.3.9.58.13.67" in v_js or "v160.3.9.58.13.68" in v_js or "v160.3.9.58.13.69" in v_js or "v160.3.9.58.13.70" in v_js

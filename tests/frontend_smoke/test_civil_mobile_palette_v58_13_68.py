"""v58.13.68 — CIVIL palette mirrored into the Expo mobile tokens.

Freezes the invariant: `mobile/src/lib/colors.ts` carries the same
6 CIVIL palette hex values as `frontend/src/theme/civilContractor.css`,
the previous "Airy Construction" primary amber (#F5B301) is gone, and
every export name that the RN components consume is preserved so no
component-level refactor is needed.
"""
from __future__ import annotations

from pathlib import Path

_MOBILE_COLORS = Path("/app/mobile/src/lib/colors.ts")

_CIVIL_PALETTE = ["#1A1A1A", "#E6E4DF", "#C4C0B6", "#FF6A00", "#F5C400", "#FAF9F6"]
_LEGACY_HEXES_THAT_MUST_BE_GONE = [
    "#F5B301",   # airy amber primary — was Colors.imBronze
]
_REQUIRED_EXPORTS = [
    "export const Colors",
    "export const StatusColors",
    "imBronze",
    "imConcrete",
    "imInk",
    "imSurface",
    "hvOrange",
    "hvYellow",
    "orange:",
    "warning:",
    "brandOrange",
    "brandTabActive",
]


def test_civil_palette_present_in_mobile_colors():
    src = _MOBILE_COLORS.read_text(encoding="utf-8")
    missing = [h for h in _CIVIL_PALETTE if h.lower() not in src.lower()]
    assert not missing, (
        f"`mobile/src/lib/colors.ts` missing CIVIL palette hex(es): "
        f"{missing!r}"
    )


def test_airy_amber_primary_is_fully_removed():
    src = _MOBILE_COLORS.read_text(encoding="utf-8")
    offenders = [h for h in _LEGACY_HEXES_THAT_MUST_BE_GONE
                 if h in src or h.lower() in src.lower()]
    assert not offenders, (
        "Legacy Airy-Construction primary hex(es) still present in "
        f"the mobile palette — v58.13.68 must repoint them: {offenders!r}"
    )


def test_every_prior_export_name_is_retained():
    src = _MOBILE_COLORS.read_text(encoding="utf-8")
    missing = [name for name in _REQUIRED_EXPORTS if name not in src]
    assert not missing, (
        "`mobile/src/lib/colors.ts` lost these exports/tokens — RN "
        "components rely on the previous API surface staying stable. "
        "v58.13.68 was supposed to be palette-only:\n  "
        + "\n  ".join(missing)
    )


def test_hi_vis_orange_is_the_primary_brand_accent():
    """`Colors.orange`, `Colors.imBronze`, `Colors.brandOrange`, and
    `Colors.brandTabActive` all carry the hi-vis orange hex — the
    primary CTA colour that cascades through the RN screens."""
    src = _MOBILE_COLORS.read_text(encoding="utf-8")
    # Find each token line and confirm it points at #FF6A00.
    for tok in ("orange:", "imBronze:", "brandOrange:", "brandTabActive:"):
        idx = src.find(tok)
        assert idx > 0, f"missing token `{tok}`"
        tail = src[idx:idx + 60]
        assert "#FF6A00" in tail, (
            f"Token `{tok}` must point at hi-vis orange (#FF6A00); "
            f"found: {tail!r}"
        )


def test_version_sync_moved_past_v58_13_67():
    v_js = Path("/app/frontend/src/lib/version.js").read_text(encoding="utf-8")
    sw_js = Path("/app/frontend/public/service-worker.js").read_text(encoding="utf-8")
    m_ts = Path("/app/mobile/src/lib/version.ts").read_text(encoding="utf-8")
    assert "RUNNING_VERSION = 'paneltec-v160.3.9.58.13.67'" not in v_js
    assert "'paneltec-v160.3.9.58.13.67'" not in sw_js
    assert "'paneltec-v160.3.9.58.13.67'" not in m_ts
    assert "v160.3.9.58.13.69" in v_js or "v160.3.9.58.13.68" in v_js or "v160.3.9.58.13.70" in v_js

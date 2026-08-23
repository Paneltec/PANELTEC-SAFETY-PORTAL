"""v58.13.45 — Double-stripe regression guard.

Before v58.13.45 the grouped-tile pages (Incidents, Inspections,
SiteSignin, CsIncidents) rendered a card-within-a-card because
`GroupedTilesView` wrapped every rendered tile in its own full card
chrome + left stripe on top of `CaptureCard`'s own full card chrome +
left stripe. Two visible stripes per tile, offset by the outer
wrapper's `pl-2.5` content padding — 10 px apart.

This suite locks in the fix by asserting:

  1. `GroupedTilesView`'s per-tile wrapper is a minimal positioning
     container — no `rounded-lg`, no `border-slate-200`, no
     `hover:shadow`, no `absolute left-0` stripe `<div>`, no
     `pl-2.5` content padding. If any of those come back, we're
     drawing a card-within-a-card again.
  2. Every one of the 4 grouped-page `renderTile` closures uses
     `ctx.stripeHex` as the SOLE `stripeStyle` input and does NOT
     compute a stripe from `paletteForType(...)` / `templateColor(...)`
     as a fallback (would re-introduce the colour drift v58.13.41
     was supposed to eliminate).
  3. Inspections.jsx no longer imports `paletteForType` — v58.13.45
     dropped that import so the "single source of truth" rule is
     enforced at the module boundary too.

Location: `/app/tests/frontend_smoke/` — outside `--reload-dir
/app/backend`, per the v58.13.10 hard rule.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

FRONTEND = Path("/app/frontend/src")
GTV = FRONTEND / "components" / "capture" / "GroupedTilesView.jsx"


def _strip_js_comments(src: str) -> str:
    """Best-effort strip of `//` line comments + `/* */` block comments.
    Good enough for a static grep test — we don't need a full JS parser
    because we're only trying to avoid matching banned tokens that
    live inside changelog / rationale comments (e.g. the v58.13.45
    fix commentary references the exact classes we're forbidding)."""
    # Block comments first, then single-line — order matters so we
    # don't eat `//` that lives inside `/* */`.
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.DOTALL)
    src = re.sub(r"(?m)//[^\n]*$", "", src)
    return src


_GROUPED_PAGES = [
    ("pages/Incidents.jsx",       "incidents"),
    ("pages/Inspections.jsx",     "inspections"),
    ("pages/SiteSigninList.jsx",  "site-signin"),
    ("pages/CsIncidentsList.jsx", "cs-incidents"),
]


# ─── GroupedTilesView outer wrapper — must be minimal ───────────────

def _outer_wrapper_block(src: str) -> str:
    """Return the block from `rows.map((rec) => {` through the
    `</div>` that closes the tile-grid `<div>`. This is the per-tile
    section we care about — everything OUTSIDE (banner header,
    hash-palette resolution, chip styling, etc.) is out of scope.

    Comments stripped first so the banned-token grep doesn't false-
    fire on the changelog rationale comment inside the map body.
    """
    stripped = _strip_js_comments(src)
    # Match the whole tile-grid `<div>` — its closing `</div>` is
    # the unambiguous end of the `rows.map(...)` block. Regex is
    # non-greedy so it stops at the FIRST `</div>` after `rows.map`.
    m = re.search(
        r"rows\.map\(\(rec\)\s*=>\s*\{(?P<body>.*?)\}\)\}\s*</div>",
        stripped,
        re.DOTALL,
    )
    assert m, (
        "Couldn't locate the `rows.map((rec) => { ... })}</div>` "
        "block in GroupedTilesView.jsx — did someone refactor the "
        "map into a helper? Update this test to point at the new "
        "location."
    )
    return m.group("body")


def test_grouped_tiles_view_outer_wrapper_has_no_card_chrome():
    """Regression: outer per-tile wrapper must NOT re-introduce
    rounded-lg / border-slate-200 / hover:shadow / bg-white — any
    of those together with CaptureCard's own chrome produces the
    card-within-a-card visual v58.13.45 fixed."""
    src = GTV.read_text(encoding="utf-8")
    block = _outer_wrapper_block(src)
    for banned in (
        "rounded-lg",
        "border-slate-200",
        "hover:shadow-md",
        "hover:border-slate-300",
    ):
        assert banned not in block, (
            f"GroupedTilesView per-tile wrapper contains `{banned}` — "
            "that reintroduces a card-within-a-card once CaptureCard "
            "adds its own chrome. See v58.13.45 changelog."
        )


def test_grouped_tiles_view_outer_wrapper_has_no_stripe_element():
    """Regression: outer per-tile wrapper must NOT paint its own
    `<div class="absolute left-0 top-0 bottom-0 w-1">` stripe —
    CaptureCard is now the sole stripe painter, driven by
    `ctx.stripeHex`."""
    src = GTV.read_text(encoding="utf-8")
    block = _outer_wrapper_block(src)
    assert "absolute left-0 top-0 bottom-0 w-1" not in block, (
        "GroupedTilesView per-tile wrapper is drawing its own left "
        "stripe again — that produces two visible stripes per tile. "
        "CaptureCard owns the stripe; only pass `ctx.stripeHex` down."
    )
    assert "backgroundColor: rowStripe.hex" not in block, (
        "GroupedTilesView per-tile wrapper is painting `rowStripe.hex` "
        "onto its own DOM element — remove and rely on `ctx.stripeHex` "
        "→ CaptureCard.stripeStyle only."
    )


def test_grouped_tiles_view_outer_wrapper_has_no_content_padding():
    """Regression: the outer wrapper must not add `pl-2.5` /
    `pr-1.5` / `py-1.5` content padding. CaptureCard has its own
    padding; adding a second padding layer both wastes space and
    (historically) offset the inner stripe to a different pixel
    column."""
    src = GTV.read_text(encoding="utf-8")
    block = _outer_wrapper_block(src)
    for banned in ("pl-2.5", "pr-1.5", "py-1.5"):
        assert banned not in block, (
            f"GroupedTilesView per-tile wrapper contains `{banned}` — "
            "content padding on the outer wrapper offsets the inner "
            "tile and shifts CaptureCard's stripe out of alignment. "
            "See v58.13.45 changelog."
        )


def test_grouped_tiles_view_still_threads_ctx_stripe_hex():
    """Belt-and-braces: the entire fix is worthless if
    GroupedTilesView stops passing `ctx.stripeHex` down. This is
    also asserted in v58.13.41's suite but pinned here so the
    v58.13.45 story is complete in a single file."""
    src = GTV.read_text(encoding="utf-8")
    block = _outer_wrapper_block(src)
    assert "stripeHex:" in block, (
        "renderTile ctx must carry `stripeHex` so CaptureCard can "
        "paint the group-palette stripe. Without it CaptureCard "
        "falls back to templateColor's tailwind class → colour drift."
    )


# ─── Per-page renderTile — ctx.stripeHex is the sole source ─────────

@pytest.mark.parametrize("rel, page_key", _GROUPED_PAGES,
                         ids=[p[1] for p in _GROUPED_PAGES])
def test_page_uses_ctx_stripe_hex_as_sole_stripe_source(rel: str, page_key: str):
    """Every grouped-page renderTile must pass `ctx.stripeHex`
    (and only ctx.stripeHex) as the stripeStyle input — no
    `paletteForType(...).hex` / `templateColor(...).stripe`
    fallbacks that would let the tile drift from the group banner
    when `ctx.stripeHex` happens to be null."""
    src = (FRONTEND / rel).read_text(encoding="utf-8")
    # Must forward ctx.stripeHex to CaptureCard.
    assert "stripeStyle={ctx.stripeHex" in src, (
        f"{rel}: renderTile must set "
        "`stripeStyle={ctx.stripeHex ? { background: ctx.stripeHex } : undefined}` "
        "— that keeps the tile stripe locked to the group palette."
    )
    # Must NOT have a `stripeStyle={{ background: paletteForType(...).hex ...}}` fallback.
    bad_pattern = re.compile(
        r"stripeStyle=\{[^}]*paletteForType", re.DOTALL,
    )
    assert not bad_pattern.search(src), (
        f"{rel}: stripeStyle is being computed from `paletteForType(...)` "
        "— that's the legacy per-template fallback the v58.13.41 fix "
        "was supposed to retire. Use `ctx.stripeHex` only."
    )
    bad_tc = re.compile(
        r"stripeStyle=\{[^}]*templateColor", re.DOTALL,
    )
    assert not bad_tc.search(src), (
        f"{rel}: stripeStyle is being computed from `templateColor(...)` "
        "— same rule as paletteForType. Use `ctx.stripeHex` only."
    )


def test_inspections_no_longer_imports_palette_for_type():
    """v58.13.45 dropped the `paletteForType` import from
    Inspections.jsx together with the legacy fallback. Guard that
    the import doesn't crawl back — an unused import is the first
    signal that someone re-introduced the fallback path."""
    src = (FRONTEND / "pages" / "Inspections.jsx").read_text(encoding="utf-8")
    stripped = _strip_js_comments(src)
    # Match `import { paletteForType }` / `import paletteForType from`
    # patterns after comment stripping. Comments themselves are
    # allowed to reference the name (the changelog does).
    assert not re.search(r"import\s*\{[^}]*paletteForType", stripped), (
        "Inspections.jsx must not import `paletteForType`. Group "
        "palette (via ctx.stripeHex) is the single stripe source. "
        "See v58.13.45 changelog."
    )
    assert not re.search(r"import\s+paletteForType", stripped), (
        "Inspections.jsx must not have a default `paletteForType` "
        "import either."
    )
    # And the function must not be called anywhere in real code.
    assert "paletteForType(" not in stripped, (
        "Inspections.jsx must not CALL `paletteForType(...)` — that "
        "reintroduces the legacy per-template stripe fallback."
    )


def test_version_sync_current_v58_13_45():
    # v58.13.46 note: relaxed from `expected in <all three files>`
    # to the append-only-changelog pattern. Cross-file identity of
    # the CURRENT version constant is enforced by
    # `test_version_sync_v58_13_13.py`; this test just guards that
    # the v58.13.45 changelog block remains present in `version.js`
    # after subsequent bumps.
    v_js = (FRONTEND / "lib" / "version.js").read_text(encoding="utf-8")
    assert "v160.3.9.58.13.45 —" in v_js, (
        "The v58.13.45 changelog block must remain in version.js — "
        "history is append-only per the ship-checklist."
    )

"""v58.13.132do — Fuel Transaction Detail: Portal Unit Price row policy.

v58.13.132dy — INVERTED for the frozen-price architecture. The row
no longer swaps caption / value based on the live toggle:

  * Under the pre-.132dy model, the row would render either
    `SmartFill price — reflects fuel price policy` (slate) or
    `Provisional override active — reflects fuel price policy`
    (amber) depending on the org-wide toggle. Both captions were
    tied to a live read-time reprice.

  * Under `.132dy`, the row ALWAYS renders the frozen `$/L` (`dpl`)
    with a single neutral `Frozen at import` caption. Which policy
    was active at IMPORT TIME is signalled instead by the chip at
    the top of the modal (`fuel-txn-detail-frozen-source-chip`),
    which carries the historicised `frozen_price_source` value.

  * The SmartFill raw (reference) row is now gated on the frozen
    source tag (`price_source_snapshot === 'provisional_override' ||
    frozen_price_source === 'provisional_override'`), NOT the live
    `overrideActive` boolean — because the historicised source is
    what actually applies to the row.
"""
from __future__ import annotations

import re
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[2]
MODAL = APP_ROOT / "frontend" / "src" / "components" / "FuelTransactionDetailModal.jsx"
VERSION_JS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


def _src() -> str:
    return MODAL.read_text(encoding="utf-8")


def test_stale_dev_jargon_removed():
    """The `stale — ignored, we use total ÷ litres` copy must NOT
    appear as user-visible text anywhere in the modal. Source-code
    comments describing the historical `.132dl` wording are allowed
    (documentary value) but no JSX string literal may still carry
    it."""
    src = _src()
    # Strip JS/JSX single-line comments so we only inspect emitted
    # markup + strings.
    stripped = re.sub(r"//[^\n]*", "", src)
    stripped = re.sub(r"/\*.*?\*/", "", stripped, flags=re.DOTALL)
    assert "stale — ignored" not in stripped.lower()
    assert "we use total ÷ litres" not in stripped.lower()
    assert "stale -- ignored" not in stripped.lower()


def test_live_policy_captions_removed():
    """v58.13.132dy — The two live-policy captions
    (`SmartFill price — reflects fuel price policy` /
    `Provisional override active — reflects fuel price policy`)
    are DEAD. Neither one may appear as user-visible copy in the
    modal — the frozen-source chip carries that signal now."""
    src = _src()
    stripped = re.sub(r"//[^\n]*", "", src)
    stripped = re.sub(r"/\*.*?\*/", "", stripped, flags=re.DOTALL)
    assert "reflects fuel price policy" not in stripped
    assert "SmartFill price — reflects" not in stripped
    assert "Provisional override active — reflects" not in stripped


def test_portal_unit_price_row_always_shows_frozen_dpl():
    """v58.13.132dy — The Portal Unit Price row is now toggle-agnostic:
    it always renders the frozen `$/L` (`dpl`) with the neutral
    "Frozen at import" caption. No more branching on `overrideActive`."""
    src = _src()
    # Row uses `dpl` (computed_price_per_litre) rendered at 4-decimal
    # precision (matches the `$/L (computed)` metric card).
    m = re.search(
        r'data-testid="fuel-txn-detail-portal-unit-price">\s*'
        r'<span className="font-mono">\{fmtDollar\(dpl,\s*4\)\}',
        src,
    )
    assert m is not None, (
        "Portal Unit Price row must render `fmtDollar(dpl, 4)` "
        "(same source as $/L Computed card)."
    )
    # Neutral "Frozen at import" caption in slate tone (no amber swap).
    m2 = re.search(
        r'text-slate-500">\s*Frozen at import',
        src,
    )
    assert m2 is not None, (
        "Portal Unit Price row must carry the neutral "
        "`Frozen at import` caption in slate tone."
    )


def test_no_live_toggle_branching_on_portal_unit_price():
    """v58.13.132dy — The row must NOT branch on `overrideActive` for
    its rendering. There should be no separate
    `fuel-txn-detail-portal-unit-price-override` testid — one row
    handles both historicised sources."""
    src = _src()
    assert 'fuel-txn-detail-portal-unit-price-override' not in src


def test_raw_reference_row_gated_on_frozen_source():
    """v58.13.132dy — SmartFill raw (reference) row must render only
    when the row was frozen under `provisional_override`. Gate reads
    both `price_source_snapshot` (from list_transactions) and
    `frozen_price_source` (from the raw doc)."""
    src = _src()
    assert "price_source_snapshot === 'provisional_override'" in src
    assert "frozen_price_source === 'provisional_override'" in src
    # Row still exposes the audit testid.
    assert 'fuel-txn-detail-smartfill-raw' in src


def test_frozen_source_chip_wired_at_top_of_modal():
    """v58.13.132dy — The chip at the top of the modal is the primary
    signal of which pricing policy was frozen for the row. Must
    render one of three labels based on `frozen_price_source`:
    `Provisional override (at import)`, `SmartFill real (at import)`,
    or `Provisional fallback (at import)`."""
    src = _src()
    assert 'fuel-txn-detail-frozen-source-chip' in src
    assert 'Provisional override (at import)' in src
    assert 'SmartFill real (at import)' in src
    assert 'Provisional fallback (at import)' in src


# ─── Version sync ────────────────────────────────────────────────

def test_three_way_sync_at_132dy_or_later():
    running = re.search(r"^export const RUNNING_VERSION = '([^']+)'",
                        VERSION_JS.read_text(), re.MULTILINE).group(1)
    expected = re.search(r"^export const EXPECTED_CACHE_VERSION = '([^']+)'",
                         VERSION_JS.read_text(), re.MULTILINE).group(1)
    cache = re.search(r"^const CACHE_VERSION = '([^']+)'",
                      SW.read_text(), re.MULTILINE).group(1)
    assert running == expected == cache
    tail = re.search(r"132([a-z]+)", running).group(1)
    assert tail >= "dy"

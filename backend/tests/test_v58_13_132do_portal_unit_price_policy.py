"""v58.13.132do — Fuel Transaction Detail: Portal Unit Price row
reflects fuel policy under BOTH modes.

Prior state:
  * `smartfill_with_fallback` → row showed `t.unit_price` + the
    developer-jargon caption "stale — ignored, we use total ÷ litres".
  * `provisional_all` → row correctly showed provisional + amber
    "reflects fuel price policy" caption.

`.132do` normalises the row so both modes show the effective per-fill
price with a "reflects fuel price policy" caption. The
`smartfill_with_fallback` branch now sources the value from `dpl`
(the `computed_price_per_litre`) so it exactly matches the `$/L
(Computed)` metric card above. The stale/ignored copy is deleted.

The SmartFill raw (reference) row keeps its existing gate
(`overrideActive && rawTotal != null`) — only renders under
`provisional_all` when a real SmartFill portal price was overridden.
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


def test_smartfill_branch_uses_computed_dpl():
    """Under `smartfill_with_fallback`, the Portal Unit Price row
    must render `dpl` (computed_price_per_litre) — same source as
    the `$/L (Computed)` metric card — not `t.unit_price`."""
    src = _src()
    # Structural: the non-override branch of the Portal Unit Price
    # row now formats `dpl`, not `t.unit_price`.
    # We anchor on the testid to make sure we're checking the
    # correct branch.
    smartfill_branch = re.search(
        r'data-testid="fuel-txn-detail-portal-unit-price">\s*'
        r'<span className="font-mono">\{fmtDollar\((\w+),\s*3\)',
        src,
    )
    assert smartfill_branch is not None, \
        "SmartFill branch of Portal Unit Price row missing or malformed"
    assert smartfill_branch.group(1) == "dpl", (
        f"SmartFill branch must render `dpl` (matches $/L Computed card), "
        f"got `{smartfill_branch.group(1)}`"
    )


def test_smartfill_branch_new_policy_caption():
    """New neutral / slate caption under SmartFill mode:
    `SmartFill price — reflects fuel price policy`."""
    src = _src()
    assert "SmartFill price — reflects fuel price policy" in src
    # Slate tone, not amber.
    # The caption span sits inside the non-override branch. Snap
    # a stronger structural check: the `SmartFill price` copy is
    # inside a `text-slate-500` span (not amber).
    m = re.search(
        r'text-slate-500">\s*SmartFill price — reflects fuel price policy',
        src,
    )
    assert m is not None, \
        "SmartFill price caption must render in slate tone (text-slate-500)"


def test_provisional_branch_unchanged():
    """`.132dl` provisional branch is preserved: value = provPrice,
    caption = amber 'Provisional override active — reflects fuel price policy'."""
    src = _src()
    assert "Provisional override active — reflects fuel price policy" in src
    m = re.search(
        r'data-testid="fuel-txn-detail-portal-unit-price-override">\s*'
        r'<span className="font-mono">\{fmtDollar\(provPrice,\s*3\)\}',
        src,
    )
    assert m is not None, "Provisional override branch missing or altered"
    # Amber tone preserved.
    assert re.search(
        r'text-amber-800">\s*Provisional override active — reflects fuel price policy',
        src,
    ) is not None


def test_raw_reference_row_gated_on_override_only():
    """SmartFill raw (reference) row must only render under
    `provisional_all` (i.e. `overrideActive`). Never under
    `smartfill_with_fallback`."""
    src = _src()
    # The gate expression is `overrideActive && rawTotal != null`.
    m = re.search(
        r'\{overrideActive && rawTotal != null && \(\s*<Row',
        src,
    )
    assert m is not None, (
        "SmartFill raw reference row must be gated on "
        "`overrideActive && rawTotal != null`"
    )


def test_visibility_guard_widened_to_dpl():
    """The row's outer guard must include `dpl != null` so a fill
    without a portal `unit_price` still renders the SmartFill row
    when the computed price is available."""
    src = _src()
    assert "(dpl != null || (overrideActive && provPrice != null))" in src


# ─── Version sync ────────────────────────────────────────────────

def test_three_way_sync_at_132do_or_later():
    running = re.search(r"^export const RUNNING_VERSION = '([^']+)'",
                        VERSION_JS.read_text(), re.MULTILINE).group(1)
    expected = re.search(r"^export const EXPECTED_CACHE_VERSION = '([^']+)'",
                         VERSION_JS.read_text(), re.MULTILINE).group(1)
    cache = re.search(r"^const CACHE_VERSION = '([^']+)'",
                      SW.read_text(), re.MULTILINE).group(1)
    assert running == expected == cache
    tail = re.search(r"132([a-z]+)", running).group(1)
    assert tail >= "do"

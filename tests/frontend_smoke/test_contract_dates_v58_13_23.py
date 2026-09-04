"""v58.13.23 — Contract dates FE smoke.

Static-grep verification of the ScheduleEditor grid + tile badge
without running a JS runtime.
"""
from __future__ import annotations
from pathlib import Path
import re

APP = Path("/app")
TABS = APP / "frontend/src/components/AssetServiceTabs.jsx"


def test_form_state_carries_all_four_contract_fields():
    src = TABS.read_text(encoding="utf-8")
    for k in ("contract_cust_on", "contract_start",
              "contract_review", "contract_expiry"):
        # Whitespace-tolerant: source uses column-aligned spacing.
        assert re.search(
            rf"\b{k}\s*:\s*initial\?\.{k}\s*\?\?\s*''", src
        ), f"form init missing {k}"


def test_save_payload_nullifies_empty_contract_strings():
    src = TABS.read_text(encoding="utf-8")
    for k in ("contract_cust_on", "contract_start",
              "contract_review", "contract_expiry"):
        assert f"form.{k}" in src and "=== '' ? null" in src, (
            f"payload nullify block missing for {k}"
        )
        # Precise: the nullify line for each field.
        assert re.search(
            rf"{k}:\s*form\.{k}\s*===\s*''\s*\?\s*null\s*:\s*form\.{k}",
            src,
        ), f"nullify line for {k} not matching expected pattern"


def test_ui_grid_ordering_and_testids():
    """Chronological order: Cust On · Start (row 1) · Review · Expiry
    (row 2). Must match approved Pass 1 plan."""
    src = TABS.read_text(encoding="utf-8")
    # Sub-header container present.
    assert 'data-testid="sch-contract-dates"' in src
    # All 4 testids present.
    for tid in ("sch-contract-cust-on", "sch-contract-start",
                "sch-contract-review", "sch-contract-expiry"):
        assert f'data-testid="{tid}"' in src, f"missing testid {tid}"
    # Ordering: cust-on first, then start, review, expiry.
    positions = {tid: src.index(f'data-testid="{tid}"') for tid in
                 ("sch-contract-cust-on", "sch-contract-start",
                  "sch-contract-review", "sch-contract-expiry")}
    ordered = sorted(positions, key=positions.get)
    assert ordered == ["sch-contract-cust-on", "sch-contract-start",
                       "sch-contract-review", "sch-contract-expiry"], (
        f"grid ordering wrong: {ordered}"
    )
    # 2×2 grid = `grid-cols-2` on the immediate parent of the 4 inputs.
    grid_idx = src.find('data-testid="sch-contract-dates"')
    tail = src[grid_idx: grid_idx + 4000]
    assert "grid-cols-2" in tail, "date grid missing grid-cols-2"


def test_all_four_inputs_are_native_date_type():
    src = TABS.read_text(encoding="utf-8")
    for tid in ("sch-contract-cust-on", "sch-contract-start",
                "sch-contract-review", "sch-contract-expiry"):
        idx = src.find(f'data-testid="{tid}"')
        # Look backwards ~200 chars for `type="date"` on the same input.
        window = src[max(0, idx - 400): idx + 100]
        assert 'type="date"' in window, f"{tid} is not type=date"


def test_traffic_light_badge_conditional_and_colours():
    """Badge only renders when `s.contract_expiry` is truthy. All 3
    colour buckets present."""
    src = TABS.read_text(encoding="utf-8")
    # Conditional gate.
    assert "s.contract_expiry &&" in src
    # Badge testid template.
    assert "schedule-contract-badge-" in src
    # Three colour classes (green / amber / rose).
    assert "bg-emerald-50 border-emerald-200 text-emerald-700" in src
    assert "bg-amber-50 border-amber-200 text-amber-800" in src
    assert "bg-rose-50 border-rose-200 text-rose-700" in src
    # Threshold: 30 days is the amber → green cutoff.
    assert "daysLeft <= 30" in src or "daysLeft > 30" in src
    # Copy: labels roughly match the approved wording.
    assert "CONTRACT EXPIRED" in src
    assert "Contract expires in" in src
    assert "Contract active" in src


def test_version_sync_current():
    """Read RUNNING_VERSION dynamically."""
    import re
    running = (APP / "frontend/src/lib/version.js").read_text(encoding="utf-8")
    sw = (APP / "frontend/public/service-worker.js").read_text(encoding="utf-8")
    mobile = (APP / "mobile/src/lib/version.ts").read_text(encoding="utf-8")
    m = re.search(r"export const RUNNING_VERSION = '(paneltec-v[\d.]+[a-z]*)'", running)
    assert m
    current = m.group(1)
    assert f"'{current}'" in sw
    assert f"'{current}'" in mobile

"""v58.13.128 — Retired/Sold segregation + Manual → Added Manually."""
from __future__ import annotations
from pathlib import Path

ROOT = Path("/app")


def _read(p: str) -> str:
    return (ROOT / p).read_text()


BACKEND = _read("backend/fleet.py")
FRONTEND = _read("frontend/src/pages/FleetRegister.jsx")


# ─── Backend: retired filter + categories payload ────────────────

def test_register_endpoint_accepts_retired_only():
    assert "retired_only: bool = Query(False)" in BACKEND
    assert 'filt["status"] = "retired"' in BACKEND
    assert 'filt["status"] = {"$ne": "retired"}' in BACKEND


def test_categories_returns_retired_rollup():
    assert '"retired": retired' in BACKEND
    assert '"by_kind"' in BACKEND
    # Retired assets skip the active kinds bucket.
    assert 'if status == "retired":' in BACKEND
    assert "continue" in BACKEND


# ─── Frontend: filter state + tree row + row visuals ─────────────

def test_filter_state_carries_retired_only():
    assert "retired_only: false" in FRONTEND
    assert "params.retired_only = true" in FRONTEND


def test_filter_tree_has_retired_sold_row():
    assert 'data-testid="fleet-filter-kind-retired"' in FRONTEND
    assert "Retired / Sold" in FRONTEND
    assert "chooseRetired" in FRONTEND
    assert 'data-testid="fleet-filter-retired-breakdown"' in FRONTEND
    # Uses Archive icon.
    assert "Archive," in FRONTEND
    assert "<Archive size={13}" in FRONTEND


def test_row_muted_and_pill_when_retired():
    # opacity-60 on retired rows.
    assert "r.status === 'retired' ? 'opacity-60' : ''" in FRONTEND
    # Rose "Retired" pill.
    assert "`fleet-retired-pill-${r.id}`" in FRONTEND
    assert "bg-rose-100 text-rose-800" in FRONTEND


def test_data_source_label_renamed_to_added_manually():
    assert "'Added Manually'" in FRONTEND
    # Old label gone as a display string (may still appear as a
    # comment/state key, so check the specific radio-option line).
    for line in FRONTEND.splitlines():
        if "key: 'manual'" in line and "label:" in line:
            assert "Added Manually" in line, f"unrenamed line: {line}"


# ─── Version pins ────────────────────────────────────────────────

def test_version_bumped_to_128_everywhere():
    # v58.13.130 ratchets the pin forward. Accept .128 or any newer
    # .13.128+ ship (same pattern as the .124 pin).
    import re as _re
    _CANONICAL = {
        "frontend/src/lib/version.js": r"export const RUNNING_VERSION\s*=\s*'paneltec-v160\.3\.9\.58\.13\.(\d+)",
        "frontend/public/service-worker.js": r"const CACHE_VERSION\s*=\s*'paneltec-v160\.3\.9\.58\.13\.(\d+)",
        "mobile/src/lib/version.ts": r"export const MOBILE_BUNDLE_VERSION\s*=\s*'paneltec-v160\.3\.9\.58\.13\.(\d+)",
    }
    for f, pat in _CANONICAL.items():
        m = _re.search(pat, _read(f))
        # v58.13.122b — .122b ship follows chronologically.
        num = int(m.group(1)) if m else 0
        assert m and (num >= 128 or num == 122), f"{f} not at .128 or newer (got {num})"

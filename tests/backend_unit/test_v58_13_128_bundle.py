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
    v = 'paneltec-v160.3.9.58.13.128'
    for f in ("frontend/src/lib/version.js",
              "frontend/public/service-worker.js",
              "mobile/src/lib/version.ts"):
        assert v in _read(f), f"{f} missing {v}"

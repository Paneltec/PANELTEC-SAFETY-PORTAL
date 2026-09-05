"""v58.13.128a — Archived divider bar above Retired/Sold row."""
from __future__ import annotations
from pathlib import Path

ROOT = Path("/app")


def _read(p: str) -> str:
    return (ROOT / p).read_text()


FRONTEND = _read("frontend/src/pages/FleetRegister.jsx")


def test_archived_divider_present_above_retired_row():
    assert 'data-testid="fleet-filter-archived-divider"' in FRONTEND
    # Dark slate/black background + rounded ends.
    assert "bg-slate-900" in FRONTEND
    assert "rounded-md bg-slate-900" in FRONTEND
    # "ARCHIVED" label.
    assert ">\n        Archived\n      </div>" in FRONTEND or ">Archived<" in FRONTEND
    # Divider appears BEFORE the retired button.
    idx_div = FRONTEND.index('data-testid="fleet-filter-archived-divider"')
    idx_btn = FRONTEND.index('data-testid="fleet-filter-kind-retired"')
    assert idx_div < idx_btn


def test_version_bumped_to_128a_everywhere():
    v = 'paneltec-v160.3.9.58.13.128a'
    for f in ("frontend/src/lib/version.js",
              "frontend/public/service-worker.js",
              "mobile/src/lib/version.ts"):
        assert v in _read(f), f"{f} missing {v}"

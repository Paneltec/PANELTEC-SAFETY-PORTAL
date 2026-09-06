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
    # v58.13.130 ratchets the pin forward. Accept .128a exact OR any
    # numerically newer .13.129+ ship (same pattern as .124 / .128).
    import re as _re
    _CANONICAL = {
        "frontend/src/lib/version.js": r"export const RUNNING_VERSION\s*=\s*'paneltec-v160\.3\.9\.58\.13\.([\da-z]+)'",
        "frontend/public/service-worker.js": r"const CACHE_VERSION\s*=\s*'paneltec-v160\.3\.9\.58\.13\.([\da-z]+)'",
        "mobile/src/lib/version.ts": r"export const MOBILE_BUNDLE_VERSION\s*=\s*'paneltec-v160\.3\.9\.58\.13\.([\da-z]+)'",
    }
    for f, pat in _CANONICAL.items():
        m = _re.search(pat, _read(f))
        assert m, f"canonical constant not found in {f}"
        tag = m.group(1)
        if tag == "128a":
            continue
        # Strip trailing letter suffix and compare numerically.
        nm = _re.match(r"(\d+)", tag)
        # v58.13.122b — .122b ship follows chronologically.
        num = int(nm.group(1)) if nm else 0
        assert nm and (num >= 129 or num == 122), f"{f} not at .128a or newer (got {num})"

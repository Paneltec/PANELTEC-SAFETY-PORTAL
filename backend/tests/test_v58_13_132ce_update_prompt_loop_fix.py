"""v58.13.132ce — Update-prompt loop fix · pytests.

Root cause: `EXPECTED_CACHE_VERSION` in `frontend/src/lib/version.js`
drifted three ships behind (`.132ca` while `RUNNING_VERSION` +
`CACHE_VERSION` were at `.132cd`). CacheBusterBanner compares
`serverVersion (== SW CACHE_VERSION)` vs `EXPECTED_CACHE_VERSION`;
mismatch → banner fires every load.

Fix: bump all three constants to `.132ce` in lockstep + add a
guardrail pytest that PINS the three-way equality so no future ship
can bump only two of them.
"""
from __future__ import annotations

import re
from pathlib import Path


REPO = Path(__file__).resolve().parent.parent.parent
FRONTEND = REPO / "frontend"

VERSION_JS = FRONTEND / "src" / "lib" / "version.js"
SW_JS = FRONTEND / "public" / "service-worker.js"

MIN = "132ce"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def _running() -> str:
    m = re.search(r"^export const RUNNING_VERSION\s*=\s*'([^']+)'", _read(VERSION_JS), re.M)
    assert m, "RUNNING_VERSION not found"
    return m.group(1)


def _expected() -> str:
    m = re.search(r"^export const EXPECTED_CACHE_VERSION\s*=\s*'([^']+)'", _read(VERSION_JS), re.M)
    assert m, "EXPECTED_CACHE_VERSION not found"
    return m.group(1)


def _sw_cache() -> str:
    m = re.search(r"^const CACHE_VERSION\s*=\s*'([^']+)'", _read(SW_JS), re.M)
    assert m, "SW CACHE_VERSION not found"
    return m.group(1)


def test_all_three_version_pins_agree():
    """The three-way lockstep. This is the guardrail that would have
    caught the `.132cb / .132cc / .132cd` drift at ship time."""
    r, e, c = _running(), _expected(), _sw_cache()
    assert r == e == c, (
        f"version drift: RUNNING={r} EXPECTED={e} SW_CACHE={c} — "
        "all three must be identical or CacheBusterBanner loops."
    )


def test_version_pins_at_least_132ce():
    tail_re = re.compile(r"paneltec-v160\.3\.9\.58\.13\.(\d+[a-z]*)")
    for label, s in (("RUNNING", _running()), ("EXPECTED", _expected()), ("SW", _sw_cache())):
        m = tail_re.match(s)
        assert m, f"{label} token unreadable: {s}"
        assert m.group(1) >= MIN, f"{label} at {m.group(1)}, want ≥ {MIN}"

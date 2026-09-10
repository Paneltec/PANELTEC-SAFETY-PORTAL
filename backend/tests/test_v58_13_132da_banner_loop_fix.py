"""v58.13.132da — CacheBusterBanner loop fix.

Locks the banner render condition so the "Update available"
toast can never fire when the user's bundle is already in sync
with the SW cache. Root cause of the .132cz loop Stephen hit:
`RUNNING_VERSION` + `CACHE_VERSION` were bumped to .132cz but
`EXPECTED_CACHE_VERSION` was left at .132cx. The banner
compares `serverVersion` (=SW cache_version) against
`EXPECTED_CACHE_VERSION`, so mismatch stayed true forever.
Reloading the tab reloaded the same .132cz bundle → banner
reappeared → loop.

Locks:
  · Render condition requires BOTH `serverVersion !==
    EXPECTED_CACHE_VERSION` AND `serverVersion !== RUNNING_VERSION`.
    When the user's bundle already matches the SW there is
    nothing to gain from reloading, so the banner stays hidden
    regardless of `EXPECTED_CACHE_VERSION` drift.
  · Banner body renders all THREE version strings (running · SW
    · expected) so future 3-way drift is visible at a glance.
  · SW `install` handler calls `self.skipWaiting()` and
    `activate` handler calls `self.clients.claim()` — new SW
    takes over immediately instead of stalling in `waiting`.
  · Three-way version constants at .132da lockstep.
"""
from __future__ import annotations

import re
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[2]
BANNER_JSX = APP_ROOT / "frontend" / "src" / "components" / "CacheBusterBanner.jsx"
SERVICE_WORKER = APP_ROOT / "frontend" / "public" / "service-worker.js"
VERSION_JS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"


def test_banner_requires_double_guard():
    """The render condition must include both a
    `serverVersion !== EXPECTED_CACHE_VERSION` check AND a
    `serverVersion !== RUNNING_VERSION` check so the banner is
    suppressed when the user's bundle IS already in sync."""
    src = BANNER_JSX.read_text(encoding="utf-8")
    # The two required inequalities on serverVersion.
    assert "serverVersion !== EXPECTED_CACHE_VERSION" in src, (
        "banner missing serverVersion !== EXPECTED_CACHE_VERSION guard"
    )
    assert "serverVersion !== RUNNING_VERSION" in src, (
        "banner missing serverVersion !== RUNNING_VERSION guard "
        "(the .132da hardening — prevents the .132cz-style loop "
        "where EXPECTED drifted but SW/bundle already matched)"
    )
    # And both must appear inside the same `const mismatched = ...`
    # expression.
    m = re.search(r"const mismatched = ([\s\S]*?);", src)
    assert m, "const mismatched = ... expression not found"
    body = m.group(1)
    assert "serverVersion !== EXPECTED_CACHE_VERSION" in body
    assert "serverVersion !== RUNNING_VERSION" in body


def test_banner_body_shows_all_three_versions():
    """The banner body must render RUNNING_VERSION, serverVersion,
    and EXPECTED_CACHE_VERSION so 3-way drift is visible to the
    reader."""
    src = BANNER_JSX.read_text(encoding="utf-8")
    # Find the versions block (data-testid).
    m = re.search(
        r'data-testid="cache-buster-versions"[\s\S]*?</div>', src,
    )
    assert m, "cache-buster-versions div not found"
    body = m.group(0)
    assert "{RUNNING_VERSION}" in body
    assert "{serverVersion}" in body
    assert "{EXPECTED_CACHE_VERSION}" in body


def test_service_worker_calls_skip_waiting_and_claim():
    """Belt-and-braces: SW install → skipWaiting, activate →
    clients.claim. Without these a new SW installs but stays in
    `waiting` until every existing tab closes, which the browser
    reads as "there's an update pending" and can drive some UAs
    into surface-level "reload" prompts."""
    src = SERVICE_WORKER.read_text(encoding="utf-8")
    assert "self.skipWaiting()" in src, (
        "service-worker.js missing self.skipWaiting() call in install"
    )
    assert "self.clients.claim()" in src, (
        "service-worker.js missing self.clients.claim() call in activate"
    )


def _tail(s: str) -> str:
    m = re.search(r"paneltec-v160\.3\.9\.58\.13\.132([a-z]+)", s)
    assert m, s
    return m.group(1)


def test_running_version_at_least_132da():
    src = VERSION_JS.read_text(encoding="utf-8")
    m = re.search(r"RUNNING_VERSION = '([^']+)'", src)
    assert m and _tail(m.group(1)) >= "da"


def test_expected_cache_version_at_least_132da():
    src = VERSION_JS.read_text(encoding="utf-8")
    m = re.search(r"EXPECTED_CACHE_VERSION = '([^']+)'", src)
    assert m and _tail(m.group(1)) >= "da"


def test_cache_version_at_least_132da():
    src = SERVICE_WORKER.read_text(encoding="utf-8")
    m = re.search(r"^const CACHE_VERSION = '([^']+)'", src, re.MULTILINE)
    assert m and _tail(m.group(1)) >= "da"


def test_three_way_version_sync_locked_at_132da():
    """The whole point of this ship — prevents a repeat of the
    .132cz regression where two of three files got bumped."""
    vjs = VERSION_JS.read_text(encoding="utf-8")
    swjs = SERVICE_WORKER.read_text(encoding="utf-8")
    running = re.search(r"RUNNING_VERSION = '([^']+)'", vjs).group(1)
    expected = re.search(r"EXPECTED_CACHE_VERSION = '([^']+)'", vjs).group(1)
    cache = re.search(r"^const CACHE_VERSION = '([^']+)'", swjs, re.MULTILINE).group(1)
    assert running == expected == cache, (
        f"three-way version sync broken: RUNNING={running!r}, "
        f"EXPECTED={expected!r}, CACHE={cache!r}"
    )

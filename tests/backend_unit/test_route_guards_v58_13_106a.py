"""v58.13.106a — Route-guard source pins for the P0 follow-up to the
v58.13.106 Public Visitor Sign-in Form ship.

Guards enforced:
  · `/scan/site/:token/visitor` route registered BEFORE the bare
    `/scan/site/:token` route in `App.js`.
  · `SiteScanResolver.jsx` imports `Navigate` from `react-router-dom`.
  · Anon-bounce guard fires with a `/scan/site/${token}/visitor` target
    and the `replace` flag.
  · Anon-bounce guard is placed AFTER `useMemo(...filteredWorkers...)`
    so rules-of-hooks invariant holds on every render.
  · Version-sync: RUNNING_VERSION / MOBILE_BUNDLE_VERSION / CACHE_VERSION
    all carry `.106a` or later.

Pattern mirrors .98/.99/.100/.101/.102/.103/.104/.105/.106 source-pin
tests.
"""
from __future__ import annotations

import re
from pathlib import Path

REPO = Path("/app")

APP_JS = REPO / "frontend/src/App.js"
RESOLVER = REPO / "frontend/src/pages/SiteScanResolver.jsx"
VERSION_JS = REPO / "frontend/src/lib/version.js"
MOBILE_VERSION_TS = REPO / "mobile/src/lib/version.ts"
SW_JS = REPO / "frontend/public/service-worker.js"


def _read(p: Path) -> str:
    assert p.exists(), f"expected file {p} to exist"
    return p.read_text(encoding="utf-8")


# ── App.js route ordering ────────────────────────────────────────
def test_visitor_route_declared_before_bare_scan_route():
    src = _read(APP_JS)
    idx_visitor = src.find('path="/scan/site/:token/visitor"')
    idx_bare = src.find('path="/scan/site/:token"')
    assert idx_visitor > -1, "visitor route not declared in App.js"
    assert idx_bare > -1, "bare scan route not declared in App.js"
    assert idx_visitor < idx_bare, (
        "v58.13.106a — `/scan/site/:token/visitor` MUST be declared BEFORE "
        "the bare `/scan/site/:token` route so declaration-order agrees "
        "with React Router's static-segment ranking."
    )


# ── SiteScanResolver.jsx anon-bounce ────────────────────────────
def test_resolver_imports_Navigate():
    src = _read(RESOLVER)
    assert re.search(
        r"from\s+'react-router-dom'.*Navigate|Navigate.*from\s+'react-router-dom'",
        src, re.S,
    ), "SiteScanResolver.jsx must import Navigate from 'react-router-dom'"


def test_resolver_anon_bounce_guard_present():
    src = _read(RESOLVER)
    pattern = re.compile(
        r"if\s*\(\s*!user\s*\)\s*\{\s*return\s*<Navigate\s+to=\{`/scan/site/\$\{token\}/visitor`\}\s+replace\s*/>",
        re.S,
    )
    assert pattern.search(src), (
        "v58.13.106a — SiteScanResolver.jsx must guard unauth callers with "
        "`if (!user) return <Navigate to={`/scan/site/${token}/visitor`} replace/>`"
    )


def test_resolver_guard_placed_after_filtered_workers_useMemo():
    """Rules-of-hooks invariant: the early return must sit AFTER every hook
    call so no hook is ever skipped across renders."""
    src = _read(RESOLVER)
    idx_memo = src.find("filteredWorkers")
    idx_guard = src.find("if (!user)")
    assert idx_memo > -1 and idx_guard > -1
    assert idx_guard > idx_memo, (
        "Anon-bounce guard must be placed AFTER the useMemo(filteredWorkers) "
        "hook so React never skips a hook between renders."
    )


# ── Version-sync forward-safe pins ───────────────────────────────
def _ge_106a(version: str) -> bool:
    """True when the version string is >= v58.13.106a (accepts any suffix
    starting with '.106' followed by an alpha/beta/etc. or nothing)."""
    m = re.search(r"58\.13\.(\d+)([a-z]*)", version)
    if not m:
        return False
    major = int(m.group(1))
    suffix = m.group(2)
    if major > 106:
        return True
    if major == 106:
        # bare '.106' is the previous ship; require a letter suffix
        return bool(suffix)
    return False


def test_running_version_ge_106a():
    src = _read(VERSION_JS)
    m = re.search(r"RUNNING_VERSION\s*=\s*'([^']+)'", src)
    assert m, "RUNNING_VERSION export not found"
    assert _ge_106a(m.group(1)), f"RUNNING_VERSION {m.group(1)!r} must be >= .106a"


def test_mobile_bundle_version_ge_106a():
    src = _read(MOBILE_VERSION_TS)
    m = re.search(r"MOBILE_BUNDLE_VERSION\s*=\s*'([^']+)'", src)
    assert m, "MOBILE_BUNDLE_VERSION export not found"
    assert _ge_106a(m.group(1)), f"MOBILE_BUNDLE_VERSION {m.group(1)!r} must be >= .106a"


def test_service_worker_cache_version_ge_106a():
    src = _read(SW_JS)
    m = re.search(r"CACHE_VERSION\s*=\s*'([^']+)'", src)
    assert m, "service-worker CACHE_VERSION not found"
    assert _ge_106a(m.group(1)), f"SW CACHE_VERSION {m.group(1)!r} must be >= .106a"

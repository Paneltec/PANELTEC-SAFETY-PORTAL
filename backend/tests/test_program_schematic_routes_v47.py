"""v160.3.9.47 — Program Schematic route contract.

Static analysis: every `route:` string declared in
`/app/frontend/src/lib/programSchematic.js` MUST resolve to a real
`<Route path=...>` under the `/app` layout in
`/app/frontend/src/App.js`.

Motivation: the previous ReactFlow schematic silently sent users to
the catch-all wildcard when an icon pointed at a stale path. The
UX bug was "clicking a node kicks me back to Cover". This test
turns that class of drift into a CI failure.

Zero DB touch, zero HTTP calls — pure regex over source files.
"""
from __future__ import annotations
import re
from pathlib import Path

_FRONTEND = Path("/app/frontend/src")
_SCHEMATIC = _FRONTEND / "lib" / "programSchematic.js"
_APP_JS = _FRONTEND / "App.js"

# Every `<Route path=...>` under the `/app/*` layout receives an
# implicit `/app/` prefix. Standalone top-level Routes (e.g. `/login`,
# `/scan/site/:token`) do NOT get that prefix.
_APP_LAYOUT_MOUNT = "/app"


def _extract_schematic_routes() -> list[str]:
    """Pull every `route: '...'` value from the schematic registry."""
    src = _SCHEMATIC.read_text(encoding="utf-8")
    # Only match `route:` keys inside NODE object literals — the
    # registry currently has no other `route:` occurrences, but this
    # regex is deliberately narrow to future-proof against config
    # comments that mention the word.
    pattern = re.compile(r"""\broute:\s*['"]([^'"]+)['"]""")
    return [m.group(1) for m in pattern.finditer(src)]


def _extract_app_routes() -> set[str]:
    """Enumerate every fully-qualified path served by App.js.

    Handles two shapes:
      * Top-level  <Route path="/login" ...> → returned verbatim.
      * Nested     <Route path="settings/x" ...> under the
        `<Route path="/app" ...>` layout → returned as `/app/settings/x`.

    Wildcard `*` and index routes are ignored — a node can't legitimately
    point at those.
    """
    src = _APP_JS.read_text(encoding="utf-8")

    routes: set[str] = set()

    # Find every `<Route path="..."` occurrence and its position, then
    # split into "top-level" vs "nested under /app" using the position
    # of the `<Route path="/app"` mount and its closing `</Route>` /
    # self-close boundary.
    layout_mount = re.search(r'<Route\s+path="/app"[^>]*>', src)
    if not layout_mount:
        raise AssertionError("Could not locate the `/app` layout mount in App.js")
    layout_start = layout_mount.end()
    # The layout block closes at the FIRST `</Route>` following the
    # mount that is NOT inside a nested `<Route>` — App.js is flat
    # (no grand-children), so a simple search suffices.
    layout_close = src.find("</Route>", layout_start)
    if layout_close == -1:
        raise AssertionError("Could not locate the closing `</Route>` for `/app`")

    nested_block = src[layout_start:layout_close]
    outside_block = src[:layout_mount.start()] + src[layout_close:]

    route_re = re.compile(r'<Route\s+path="([^"]+)"')

    for m in route_re.finditer(outside_block):
        p = m.group(1)
        if p == "*" or p == "/app":
            continue
        routes.add(p)

    for m in route_re.finditer(nested_block):
        p = m.group(1)
        if p == "*":
            continue
        # Nested paths are relative — strip any leading slash defensively.
        p = p.lstrip("/")
        routes.add(f"{_APP_LAYOUT_MOUNT}/{p}")

    return routes


def _pattern_matches(route: str, patterns: set[str]) -> bool:
    """Match a concrete route against React-Router patterns.

    Nodes in the schematic use CONCRETE URLs (no `:id` placeholders),
    so a straight equality check works for every current declaration.
    A parametrised pattern like `contractors/:id` would match a
    concrete `/app/contractors/abc123` — implemented for defensive
    completeness even though no current node needs it.
    """
    if route in patterns:
        return True
    for pat in patterns:
        if ":" not in pat:
            continue
        regex = "^" + re.sub(r":[A-Za-z_]+", r"[^/]+", pat) + "$"
        if re.match(regex, route):
            return True
    return False


def test_schematic_routes_exist_in_app_js():
    """Every schematic node route must be reachable via App.js."""
    node_routes = _extract_schematic_routes()
    assert node_routes, "programSchematic.js declared zero routes — did the registry change shape?"

    app_routes = _extract_app_routes()
    assert app_routes, "App.js parse returned zero routes — did the file layout change?"

    missing = [r for r in node_routes if not _pattern_matches(r, app_routes)]
    assert not missing, (
        f"programSchematic.js declares {len(missing)} route(s) that "
        f"App.js does not serve:\n  " + "\n  ".join(missing)
        + "\n\nEither correct the schematic node or add the missing route."
    )


def test_schematic_routes_are_app_scoped():
    """Every schematic node MUST live under `/app/*` (no public URLs)."""
    node_routes = _extract_schematic_routes()
    off_scope = [r for r in node_routes if not r.startswith("/app/")]
    assert not off_scope, (
        "Schematic nodes must point at authenticated `/app/*` routes; "
        f"the following are outside that scope: {off_scope}"
    )


def test_legacy_program_schematic_redirect_registered():
    """The `/app/settings/program-schematic` legacy URL must redirect."""
    src = _APP_JS.read_text(encoding="utf-8")
    assert 'path="settings/program-schematic"' in src, (
        "Legacy `/app/settings/program-schematic` route not found in App.js — "
        "the v160.3.9.47 redirect is missing."
    )
    assert '<Navigate to="/app/settings/schematic"' in src, (
        "Legacy `/app/settings/program-schematic` route exists but does not "
        "redirect to `/app/settings/schematic` via <Navigate>."
    )

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
from urllib.parse import urlsplit
from pathlib import Path

_FRONTEND = Path(__file__).resolve().parents[2] / "frontend" / "src"
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
    """Collect nested routes, excluding commented JSX routes."""
    src = re.sub(r"\{/\*.*?\*/\}", "", _APP_JS.read_text(encoding="utf-8"), flags=re.S)
    routes, parents = set(), []
    tags = re.finditer(r'<Route\b.*?element=\{.*?\}\s*/?>|<Route\b[^>]*>|</Route\s*>', src, re.S)
    for match in tags:
        tag = match.group()
        if tag.startswith("</"):
            parents.pop()
            continue
        path = re.search(r'\bpath="([^"]+)"', tag)
        parent = parents[-1] if parents else ""
        part = path.group(1) if path else ""
        full = part if part.startswith("/") else parent.rstrip("/") + "/" + part
        if path and "*" not in full:
            routes.add(full)
        if not tag.endswith("/>"):
            parents.append(full.rstrip("/"))
    return routes


def _pattern_matches(route: str, patterns: set[str]) -> bool:
    """Match a concrete route against React-Router patterns.

    Nodes in the schematic use CONCRETE URLs (no `:id` placeholders),
    so a straight equality check works for every current declaration.
    A parametrised pattern like `contractors/:id` would match a
    concrete `/app/contractors/abc123` — implemented for defensive
    completeness even though no current node needs it.
    """
    route = urlsplit(route).path
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

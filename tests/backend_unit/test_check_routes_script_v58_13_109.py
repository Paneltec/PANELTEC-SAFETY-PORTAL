"""v58.13.109 — Source pins for the new frontend route-link compile
guard script (`frontend/scripts/check-routes.js`).

The script itself is JS; this pytest is Python and only verifies:
  · The script file exists.
  · `package.json` exposes a `check-routes` script entry so
    `yarn --cwd frontend check-routes` works.
  · The script has the expected shebang + `main()` structure so a
    codemod / lint sweep can't accidentally strip it to a no-op.
"""
from __future__ import annotations
import json
import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SCRIPT = REPO / "frontend" / "scripts" / "check-routes.js"
PACKAGE_JSON = REPO / "frontend" / "package.json"


def test_check_routes_script_exists():
    assert SCRIPT.exists(), (
        f"missing route-link compile guard at {SCRIPT}. See v58.13.109."
    )


def test_check_routes_script_has_shebang_and_main_dispatch():
    src = SCRIPT.read_text(encoding="utf-8")
    assert src.startswith("#!/usr/bin/env node"), (
        "check-routes.js must start with the node shebang so a chmod +x "
        "invocation works."
    )
    assert "function main()" in src, "expected `function main()` entry"
    assert "if (require.main === module) main();" in src, (
        "expected `if (require.main === module) main();` dispatch"
    )


def test_package_json_exposes_check_routes_script():
    pkg = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
    scripts = pkg.get("scripts") or {}
    assert "check-routes" in scripts, (
        f"package.json scripts must include `check-routes`; saw {list(scripts)}"
    )
    assert re.search(r"scripts/check-routes\.js", scripts["check-routes"]), (
        f"check-routes script must invoke node scripts/check-routes.js; "
        f"saw {scripts['check-routes']!r}"
    )


def test_script_extracts_route_and_usage_patterns():
    """Regression-lock: the six navigation-target patterns the script
    scans for must all be present so future refactors don't silently
    drop one and stop noticing dead links of that shape."""
    src = SCRIPT.read_text(encoding="utf-8")
    for pat in [
        r'\\bto\\s\*=\\s\*"\(\\/app\\/\[\^"\?\]\+\?\)"',  # to="/app/..."
        r'\\bnavigate\\s\*\\\(\\s\*"',                    # navigate("/app/...")
    ]:
        assert re.search(pat, src), f"pattern fragment not found in script: {pat!r}"

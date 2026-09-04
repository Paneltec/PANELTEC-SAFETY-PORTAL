"""v58.13.20 — Polish bundle smoke tests.

Three-item housekeeping ship. Placed under
`/app/tests/frontend_smoke/` per the v58.13.10 hard rule.
"""
from __future__ import annotations
from pathlib import Path
import subprocess

APP = Path("/app")


def test_cs_incident_tab_orphan_deleted():
    """Item 1 — CsIncidentTab.jsx must not exist on disk."""
    assert not (APP / "frontend/src/pages/CsIncidentTab.jsx").exists(), (
        "CsIncidentTab.jsx orphan file should be deleted in v58.13.20"
    )


def test_no_live_code_references_to_cs_incident_tab():
    """Item 1 (regression) — after deletion, no live code file should
    import/mock/reference CsIncidentTab. Docs under /app/memory/*.md
    are allowed to keep historical mentions."""
    for ext in ("*.jsx", "*.js", "*.tsx", "*.ts"):
        for f in (APP / "frontend/src").rglob(ext):
            src = f.read_text(encoding="utf-8", errors="ignore")
            if "CsIncidentTab" not in src:
                continue
            # Only the historical code-comment in CsIncidentsList.jsx
            # is allowed. That comment must NOT be an actual import
            # or dynamic import.
            for line in src.splitlines():
                if "CsIncidentTab" not in line:
                    continue
                stripped = line.strip()
                assert stripped.startswith(("//", "/*", "*", "#")), (
                    f"live code reference to CsIncidentTab in {f}: {line!r}"
                )
                # No `require(` / `import(` patterns even inside comments
                # that get eval'd via templating (defensive).
                assert "require(" not in line
                assert "import(" not in line


def test_next_due_km_hours_fallback_present():
    """Item 2 — DUE tile in ServiceInboxTab has km/hours fallback."""
    src = (APP / "frontend/src/pages/ServiceInboxTab.jsx").read_text(encoding="utf-8")
    assert "nextDueDisplay" in src, "nextDueDisplay helper missing"
    # Hours branch.
    assert "row.interval_kind === 'hours'" in src
    assert "` h`" in src or " h`" in src, "hours suffix missing"
    # Km branch.
    assert "row.interval_kind === 'km'" in src
    assert "` km`" in src or " km`" in src, "km suffix missing"
    # Calendar branch preserved (fmtDate on next_due_at).
    assert "fmtDate(row.next_due_at)" in src


def test_workers_py_f811_clean():
    """Item 3 — ruff F811 must be zero on workers.py."""
    r = subprocess.run(
        ["ruff", "check", str(APP / "backend/workers.py"), "--select", "F811"],
        capture_output=True, text=True, timeout=30,
    )
    combined = (r.stdout or "") + (r.stderr or "")
    assert "F811" not in combined, (
        f"workers.py still emits F811 after v58.13.20 fix:\n{combined}"
    )
    # Exit 0 = clean (ruff returns 1 when it finds violations).
    assert r.returncode == 0, (
        f"ruff F811 returned {r.returncode}:\n{combined}"
    )


def test_version_sync_still_green():
    """v58.13.13 version-sync guardrail — all 3 canonical files agree
    on the CURRENT RUNNING_VERSION (read dynamically so this test
    survives future bumps)."""
    import re
    running = (APP / "frontend/src/lib/version.js").read_text(encoding="utf-8")
    sw = (APP / "frontend/public/service-worker.js").read_text(encoding="utf-8")
    mobile = (APP / "mobile/src/lib/version.ts").read_text(encoding="utf-8")
    m = re.search(r"export const RUNNING_VERSION = '(paneltec-v[\d.]+[a-z]*)'", running)
    assert m, "RUNNING_VERSION export not found"
    current = m.group(1)
    assert f"'{current}'" in sw, f"service-worker CACHE_VERSION != {current}"
    assert f"'{current}'" in mobile, f"mobile MOBILE_BUNDLE_VERSION != {current}"

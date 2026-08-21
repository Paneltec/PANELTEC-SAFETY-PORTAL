"""v58.13.27 — AssetDrawer stable deep-link path FE smoke.

Ensures `PlantVehicles.jsx` consumes `?assetDrawer=<id>&tab=<tab>`,
strips the query after opening, and that the drawer exposes a stable
`asset-drawer-open-<id>` testid on the render root so automated visual
QA can wait on it. Also confirms the v58.13.18 ServiceInboxTab
"Open schedule" link uses the same pattern.
"""
from __future__ import annotations
from pathlib import Path
import re

APP = Path("/app")
PAGE = APP / "frontend/src/pages/PlantVehicles.jsx"
DRAWER = APP / "frontend/src/components/AssetDrawer.jsx"
INBOX = APP / "frontend/src/pages/ServiceInboxTab.jsx"


def test_page_consumes_query_params():
    src = PAGE.read_text(encoding="utf-8")
    # Router hooks imported.
    assert "useNavigate" in src
    assert "useLocation" in src
    # Read both params.
    assert "params.get('assetDrawer')" in src
    assert "params.get('tab')" in src


def test_page_strips_query_via_replace_true():
    src = PAGE.read_text(encoding="utf-8")
    # navigate('/app/vehicles', { replace: true }) after open.
    m = re.search(
        r"_navigate\s*\(\s*['\"]/app/vehicles['\"]\s*,\s*\{\s*replace:\s*true\s*\}\s*\)",
        src,
    )
    assert m, "expected navigate('/app/vehicles', { replace: true }) after deep-link open"


def test_page_passes_initial_tab_to_drawer():
    src = PAGE.read_text(encoding="utf-8")
    # AssetDrawer receives initialTab prop.
    assert re.search(r"<AssetDrawer\b[^>]*initialTab=\{drawerInitialTab\}", src), \
        "AssetDrawer must receive initialTab={drawerInitialTab}"
    # State declared.
    assert "setDrawerInitialTab" in src


def test_drawer_accepts_initial_tab_prop_and_validates():
    src = DRAWER.read_text(encoding="utf-8")
    # Prop destructured.
    assert re.search(r"function AssetDrawer\(\{[^}]*initialTab[^}]*\}", src), \
        "AssetDrawer must destructure initialTab prop"
    # Validation against TABS present (unknown tab → 'details').
    assert "_validTab" in src
    assert "TABS.some" in src


def test_drawer_has_stable_open_testid():
    src = DRAWER.read_text(encoding="utf-8")
    # asset-drawer-open-<id> template on the render root.
    assert "asset-drawer-open-${current.id}" in src
    # Fallback for new-asset mode so the attribute is always defined.
    assert "asset-drawer-open-new" in src


def test_service_inbox_uses_stable_deep_link():
    src = INBOX.read_text(encoding="utf-8")
    # The producer link that Pass 1 identified.
    assert "assetDrawer=" in src
    assert "tab=schedules" in src
    # Confirm it's an "Open schedule" handler (not a leftover comment).
    m = re.search(
        r"navigate\(`/app/vehicles\?assetDrawer=\$\{[^`]+\}&tab=schedules`\)",
        src,
    )
    assert m, "ServiceInboxTab must navigate to /app/vehicles?assetDrawer=<id>&tab=schedules"


def test_no_backend_changes_this_ship():
    """Guardrail: this is a pure FE ship. Backend hr_employees.py,
    workers.py, and asset_service.py must not carry a v58.13.27 marker."""
    for fname in ("hr_employees.py", "workers.py", "asset_service.py"):
        p = APP / "backend" / fname
        if p.exists():
            assert "58.13.27" not in p.read_text(encoding="utf-8"), \
                f"backend/{fname} carries a v58.13.27 marker — pure FE ship expected"


def test_version_sync_current():
    running = (APP / "frontend/src/lib/version.js").read_text(encoding="utf-8")
    sw = (APP / "frontend/public/service-worker.js").read_text(encoding="utf-8")
    mobile = (APP / "mobile/src/lib/version.ts").read_text(encoding="utf-8")
    m = re.search(r"export const RUNNING_VERSION = '(paneltec-v[\d.]+)'", running)
    assert m
    current = m.group(1)
    assert f"'{current}'" in sw
    assert f"'{current}'" in mobile

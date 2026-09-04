"""v58.13.18 — Service Inbox frontend smoke (static grep).

Placed under `/app/tests/frontend_smoke/` per v58.13.10 rule.
Verifies structural invariants without spinning up a JS runtime:
  · PlantVehicles.jsx has 5 tabs including the new "service-inbox"
    tab and its ServiceInboxTab import.
  · ServiceInboxTab imports GroupedTilesView + RecordEditor and
    hits the new `/assets/service/inbox` endpoint.
  · v58.13.10 flash-bug guardrail: `e.stopPropagation()` +
    `e.preventDefault()` present in every ServiceInboxTab action.
  · Empty-state strings are present.
  · Version-sync guardrail still passes.
"""
from __future__ import annotations
from pathlib import Path
import re

APP = Path("/app")
PLANT = APP / "frontend/src/pages/PlantVehicles.jsx"
INBOX = APP / "frontend/src/pages/ServiceInboxTab.jsx"
ASSET_TABS = APP / "frontend/src/components/AssetServiceTabs.jsx"


def test_plant_vehicles_registers_five_tabs():
    src = PLANT.read_text(encoding="utf-8")
    # Grid col count bumped from 4 → 5.
    assert "md:grid-cols-5" in src, "TabsList must be 5-col to hold Service Inbox tab"
    # All 5 testids present.
    for tid in ("vehicles-tab-maintenance", "vehicles-tab-unmatched",
                "vehicles-tab-list", "vehicles-tab-dashboard",
                "vehicles-tab-service-inbox"):
        assert f'data-testid="{tid}"' in src, f"missing tab trigger {tid}"
    # ServiceInboxTab import + content mount.
    assert "import ServiceInboxTab from './ServiceInboxTab'" in src
    assert 'data-testid="vehicles-tab-service-inbox-content"' in src
    assert "<ServiceInboxTab />" in src


def test_service_inbox_component_imports_and_endpoint():
    src = INBOX.read_text(encoding="utf-8")
    assert "GroupedTilesView" in src
    assert "RecordEditor" in src
    assert "from '../components/AssetServiceTabs'" in src
    assert "/assets/service/inbox" in src
    # Two sub-tabs (Due / Generated).
    assert 'data-testid="inbox-subtab-due"' in src
    assert 'data-testid="inbox-subtab-generated"' in src


def test_action_buttons_stop_propagation_and_prevent_default():
    """v58.13.10 flash-bug guardrail. Every action handler must
    guard the synthetic-event bubble so a freshly-mounted modal
    doesn't receive its own opening click."""
    src = INBOX.read_text(encoding="utf-8")
    # Presence in every action handler declaration.
    # openLogService, openScheduleDrawer, markAsPerformed,
    # dismissGenerated should all have e?.stopPropagation?.() +
    # e?.preventDefault?.().
    for handler in ("openLogService", "openScheduleDrawer",
                    "markAsPerformed", "dismissGenerated"):
        # Body of each handler contains both guards. Regex grabs
        # the handler's arrow body up to the next `}, [`.
        m = re.search(
            handler + r"\s*=\s*useCallback\(\s*(?:async\s+)?\(e,\s*row\)\s*=>\s*\{([\s\S]*?)\},\s*\[",
            src,
        )
        assert m, f"could not find handler `{handler}` body"
        body = m.group(1)
        assert "e?.stopPropagation?.()" in body, f"{handler} missing stopPropagation"
        assert "e?.preventDefault?.()" in body, f"{handler} missing preventDefault"


def test_empty_state_strings_present():
    src = INBOX.read_text(encoding="utf-8")
    assert "Nothing due right now." in src
    assert "No auto-generated services waiting." in src
    # Second sentence is admin-only — verify the flag conditional
    # ships and mentions the env flag so admins know why it's empty.
    assert "ASSET_SERVICE_GENERATE_CRON" in src
    assert "isAdmin" in src


def test_record_editor_is_exported():
    """The Service Inbox reuses `RecordEditor` verbatim. Ensure
    the export refactor (module-scoped `function` → `export function`)
    hasn't been reverted."""
    src = ASSET_TABS.read_text(encoding="utf-8")
    assert "export function RecordEditor(" in src, (
        "RecordEditor must be exported for ServiceInboxTab reuse"
    )


def test_version_sync_still_green():
    """Belt-and-braces: don't let this ship regress the v58.13.13
    version-sync guardrail. Full guardrail lives at
    /app/tests/frontend_smoke/test_version_sync_v58_13_13.py — this
    just re-asserts the three files agree on the CURRENT
    RUNNING_VERSION (whatever it is post-any-later-ship)."""
    import re
    running = (APP / "frontend/src/lib/version.js").read_text(encoding="utf-8")
    sw = (APP / "frontend/public/service-worker.js").read_text(encoding="utf-8")
    mobile = (APP / "mobile/src/lib/version.ts").read_text(encoding="utf-8")
    m = re.search(r"export const RUNNING_VERSION = '(paneltec-v[\d.]+[a-z]*)'", running)
    assert m, "RUNNING_VERSION export not found"
    current = m.group(1)
    assert f"'{current}'" in sw, f"service-worker CACHE_VERSION != {current}"
    assert f"'{current}'" in mobile, f"mobile MOBILE_BUNDLE_VERSION != {current}"

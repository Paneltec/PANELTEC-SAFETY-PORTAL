"""v58.13.26 — Bulk worker-link wizard FE smoke."""
from __future__ import annotations
from pathlib import Path
import re

APP = Path("/app")
WIZ = APP / "frontend/src/components/BulkWorkerLinkWizard.jsx"
PAGE = APP / "frontend/src/pages/settings/HrEmployeesPage.jsx"


def test_wizard_file_exists_with_expected_exports():
    src = WIZ.read_text(encoding="utf-8")
    assert "export default function BulkWorkerLinkWizard" in src
    # Bulk endpoints wired.
    assert "/hr/employees/link-candidates/bulk" in src
    assert "/hr/employees/link-worker/bulk" in src


def test_wizard_two_step_state_machine():
    src = WIZ.read_text(encoding="utf-8")
    # State machine references both steps.
    assert "useState('auto')" in src
    assert "setStep('no_match')" in src or "setStep(\"no_match\")" in src
    # Step pills present.
    assert 'data-testid="bulk-link-step-auto"' in src
    assert 'data-testid="bulk-link-step-no-match"' in src


def test_wizard_tier_badges_all_three_mapped():
    src = WIZ.read_text(encoding="utf-8")
    # All 3 tiers appear in the TIER_STYLE map.
    assert "email:" in src and "norm_basic:" in src and "norm_lfi:" in src
    # Colour classes per approved plan: email=emerald, norm_basic=blue, norm_lfi=amber.
    assert "bg-emerald-100" in src
    assert "bg-blue-100" in src
    assert "bg-amber-100" in src
    # Tier badge testid template.
    assert "bulk-link-tier-${tier}" in src


def test_wizard_bulk_accept_controls_present():
    src = WIZ.read_text(encoding="utf-8")
    assert 'data-testid="bulk-link-accept-all"' in src
    assert 'data-testid="bulk-link-accept-email"' in src
    assert 'data-testid="bulk-link-reject-all"' in src
    assert 'data-testid="bulk-link-confirm"' in src


def test_wizard_all_button_handlers_stop_propagation():
    """v58.13.10 flash-bug guardrail — every click handler that mutates
    state must call e.stopPropagation() before doing so."""
    src = WIZ.read_text(encoding="utf-8")
    for handler in ("toggleOne", "acceptAll", "acceptEmailOnly",
                    "rejectAll", "confirmLinks"):
        # Each handler's arrow body must contain stopPropagation.
        m = re.search(rf"{handler}\s*=\s*useCallback\(\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{{([\s\S]*?)\}},\s*\[",
                      src)
        assert m, f"handler {handler} not resolvable"
        body = m.group(1)
        assert "e.stopPropagation()" in body, f"{handler} missing stopPropagation"
        assert "e.preventDefault()" in body, f"{handler} missing preventDefault"


def test_page_has_bulk_link_button_and_wizard_mount():
    src = PAGE.read_text(encoding="utf-8")
    # Bulk-link button testid.
    assert 'data-testid="bulk-link-open-btn"' in src
    # Wizard imported + mounted.
    assert "import BulkWorkerLinkWizard" in src
    assert "<BulkWorkerLinkWizard" in src


def test_wizard_backdrop_close_pattern():
    src = WIZ.read_text(encoding="utf-8")
    assert "e.target === e.currentTarget" in src
    assert "useLockBodyScroll" in src


def test_version_sync_current():
    running = (APP / "frontend/src/lib/version.js").read_text(encoding="utf-8")
    sw = (APP / "frontend/public/service-worker.js").read_text(encoding="utf-8")
    mobile = (APP / "mobile/src/lib/version.ts").read_text(encoding="utf-8")
    m = re.search(r"export const RUNNING_VERSION = '(paneltec-v[\d.]+)'", running)
    assert m
    current = m.group(1)
    # Version-sync guardrail — three canonical files must be identical.
    assert f"'{current}'" in sw
    assert f"'{current}'" in mobile

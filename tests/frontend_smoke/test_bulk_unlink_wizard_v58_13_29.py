"""v58.13.29 — Bulk unlink wizard FE smoke."""
from __future__ import annotations
from pathlib import Path
import re

APP = Path("/app")
WIZ = APP / "frontend/src/components/BulkWorkerUnlinkWizard.jsx"
PAGE = APP / "frontend/src/pages/settings/HrEmployeesPage.jsx"


def test_wizard_file_exists_with_expected_exports():
    src = WIZ.read_text(encoding="utf-8")
    assert "export default function BulkWorkerUnlinkWizard" in src
    # Backend endpoints wired.
    assert "/hr/employees/linked" in src
    assert "/hr/employees/unlink-worker/bulk" in src


def test_wizard_has_selection_controls():
    src = WIZ.read_text(encoding="utf-8")
    assert 'data-testid="bulk-unlink-select-all"' in src
    assert 'data-testid="bulk-unlink-deselect-all"' in src
    assert 'data-testid="bulk-unlink-selected-count"' in src


def test_wizard_has_destructive_confirmation_step():
    """The confirm button opens a confirmation dialog before firing —
    destructive actions must never one-click through."""
    src = WIZ.read_text(encoding="utf-8")
    # Distinct testids for the "request confirm" step and the actual "fire" step.
    assert 'data-testid="bulk-unlink-request-confirm"' in src
    assert 'data-testid="bulk-unlink-confirm-dialog"' in src
    assert 'data-testid="bulk-unlink-confirm-fire"' in src
    assert 'data-testid="bulk-unlink-confirm-cancel"' in src
    # Confirming state machine reference.
    assert "confirming" in src
    assert "setConfirming" in src
    # Warning icon in the confirm dialog.
    assert "AlertTriangle" in src


def test_wizard_uses_destructive_red_styling():
    """Destructive intent must be signalled visually — rose/red palette
    on the confirm buttons + warning icon background."""
    src = WIZ.read_text(encoding="utf-8")
    # Rose = the app's destructive palette (matches DeleteRecordButton).
    assert "bg-rose-600" in src
    assert "hover:bg-rose-700" in src
    # Confirmation dialog uses rose-100 for the warning icon background.
    assert "bg-rose-100" in src
    assert "text-rose-600" in src


def test_wizard_all_button_handlers_stop_propagation():
    """v58.13.10 flash-bug guardrail — every handler that mutates state
    calls e.stopPropagation() + e.preventDefault() before doing so."""
    src = WIZ.read_text(encoding="utf-8")
    for handler in ("toggleOne", "selectAll", "deselectAll",
                    "requestConfirm", "fireUnlink"):
        m = re.search(
            rf"{handler}\s*=\s*useCallback\(\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{{([\s\S]*?)\}},\s*\[",
            src,
        )
        assert m, f"handler {handler} not resolvable"
        body = m.group(1)
        assert "e.stopPropagation()" in body, f"{handler} missing stopPropagation"
        assert "e.preventDefault()" in body, f"{handler} missing preventDefault"


def test_wizard_backdrop_close_and_body_scroll_lock():
    src = WIZ.read_text(encoding="utf-8")
    assert "e.target === e.currentTarget" in src
    assert "useLockBodyScroll" in src


def test_page_has_bulk_unlink_button_and_wizard_mount():
    src = PAGE.read_text(encoding="utf-8")
    # Bulk-unlink button testid.
    assert 'data-testid="bulk-unlink-open-btn"' in src
    # Wizard imported + mounted.
    assert "import BulkWorkerUnlinkWizard" in src
    assert "<BulkWorkerUnlinkWizard" in src


def test_page_unlink_button_only_visible_when_links_exist():
    """Grep guard: button visibility must be gated on a linked-count
    signal, not always-rendered."""
    src = PAGE.read_text(encoding="utf-8")
    # Same gating idiom as v58.13.26's bulk-link button.
    assert re.search(r"linkedCount\s*>\s*0", src) or \
        re.search(r"linked_count\s*>\s*0", src), \
        "unlink button must be gated on a linked-count signal"


def test_version_sync_current():
    running = (APP / "frontend/src/lib/version.js").read_text(encoding="utf-8")
    sw = (APP / "frontend/public/service-worker.js").read_text(encoding="utf-8")
    mobile = (APP / "mobile/src/lib/version.ts").read_text(encoding="utf-8")
    m = re.search(r"export const RUNNING_VERSION = '(paneltec-v[\d.]+)'", running)
    assert m
    current = m.group(1)
    assert f"'{current}'" in sw
    assert f"'{current}'" in mobile

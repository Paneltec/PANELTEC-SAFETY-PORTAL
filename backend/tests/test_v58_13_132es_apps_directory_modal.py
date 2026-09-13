"""v58.13.132es — Apps Directory in-app modal (revised scope).

Original scope had a `window.open` new browser window + admin PIN
gate. Stephen course-corrected mid-ship:
  · Item 1 — swap `window.open` for an IN-APP MODAL. Sidebar entry
    fires the `paneltec:open-apps-directory` CustomEvent; AppShell
    catches it and renders `<AppsDirectoryModal />`.
  · Item 2 — PIN gate DROPPED entirely (portal login already gates).
    Manage tiles button opens the manager directly again.

Locks:
  · Sidebar entry uses `action: 'open-apps-directory'` (not
    `newWindow`), admin-gated via `requiresCan: ['users', 'edit']`.
  · No `POST /auth/verify-admin-pin` endpoint on the backend.
  · `<AppsDirectoryModal />` mounted in AppShell + listens for the
    event.
  · Modal Escape-to-close + tile launches `target="_blank"`.
  · `QuickLinksSection` Manage tiles button opens the manager without
    a PIN prompt; `PinPromptModal` code has been removed.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest
import requests

from tests.conftest import API

pytestmark = pytest.mark.live_db_writes

APP_ROOT = Path(__file__).resolve().parents[2]
BACKEND = APP_ROOT / "backend"
FE = APP_ROOT / "frontend" / "src"

AUTH_PY = BACKEND / "auth.py"
APPSHELL = FE / "components" / "layout" / "AppShell.jsx"
QUICK_SECT = FE / "components" / "QuickLinksSection.jsx"
MODAL = FE / "components" / "AppsDirectoryModal.jsx"
VERSION_JS = FE / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


# ── Item 1 — sidebar + modal ──────────────────────────────────────

def test_sidebar_apps_directory_uses_action_not_newwindow():
    """Sidebar entry must fire an in-app CustomEvent, not open a
    fresh browser window."""
    src = _read(APPSHELL)
    m = re.search(
        r"\{\s*action:\s*'open-apps-directory'[^}]+\}", src)
    assert m, "Apps Directory NAV entry not found or wrong shape"
    entry = m.group(0)
    assert "newWindow" not in entry
    assert "'nav-apps-directory'" in entry
    assert "Rocket24Regular" in entry
    # Admin-only.
    assert "requiresCan: ['users', 'edit']" in entry


def test_newwindow_scaffolding_removed_from_appshell():
    """The `newWindow` sidebar branch scaffolded in the initial
    `.132es` draft must be removed after the scope correction."""
    src = _read(APPSHELL)
    assert "if (it.newWindow)" not in src
    # ExternalLinkGlyph was only used by the newWindow branch.
    assert "ExternalLinkGlyph" not in src


def test_appshell_mounts_modal_and_listens_for_event():
    src = _read(APPSHELL)
    assert (
        "import AppsDirectoryModal from '@/components/AppsDirectoryModal';"
        in src
    )
    # Listener on the custom event.
    assert "'paneltec:open-apps-directory'" in src
    # Modal rendered at the shell level with the toggled state.
    assert "<AppsDirectoryModal open={appsDirectoryOpen}" in src


def test_modal_layout_matches_spec():
    src = _read(MODAL)
    # Green header + tagline.
    assert 'apps-directory-modal-eyebrow' in src
    assert "Paneltec Group · Apps Directory" in src
    assert 'apps-directory-modal-tagline' in src
    assert "Every tool, one click away." in src
    # X close button + Escape-to-close listener.
    assert 'apps-directory-modal-close' in src
    assert "e.key === 'Escape'" in src
    # Backdrop dismissal — v58.13.132et refactored the raw
    # `onClose?.()` call to go through the stable `onCloseRef` so
    # the Escape listener no longer churns; either form is
    # acceptable here.
    assert (
        "if (e.target === e.currentTarget) onCloseRef.current?.()" in src
        or "if (e.target === e.currentTarget) onClose?.()" in src
    )


def test_modal_tiles_open_in_new_tab_safely():
    src = _read(MODAL)
    assert 'target="_blank"' in src
    assert 'rel="noopener noreferrer"' in src
    # Every launch link carries the individual tile testid.
    assert "apps-directory-modal-tile-launch-" in src


def test_modal_footer_hidden_count_and_show_manage():
    """v58.13.132eu — footer + per-user hidden-count feature REMOVED
    per Stephen. Users can't hide tiles anymore; visibility is
    controlled ONLY by the ON/OFF pill in the management table.
    Test flipped to assert the removal."""
    src = _read(MODAL)
    for tid in ("apps-directory-modal-footer",
                 "apps-directory-modal-hidden-count",
                 "apps-directory-modal-show-manage"):
        assert tid not in src, (
            f"testid {tid} was intentionally removed in .132eu — "
            f"users no longer hide tiles per-user")
    # And the localStorage key is no longer read/written.
    assert "apps_directory_hidden" not in src


# ── Item 2 — PIN drop ─────────────────────────────────────────────

def test_no_verify_admin_pin_endpoint():
    src = _read(AUTH_PY)
    assert "verify-admin-pin" not in src
    assert "_AdminPinIn" not in src
    assert "_ADMIN_PIN_ATTEMPTS" not in src


def test_live_verify_admin_pin_returns_404():
    """Endpoint must not exist on the running backend."""
    r = requests.post(f"{API}/auth/verify-admin-pin",
                       json={"pin": "3310"}, timeout=10)
    assert r.status_code == 404


def test_quick_links_section_pin_modal_removed():
    src = _read(QUICK_SECT)
    assert "PinPromptModal" not in src
    assert "apps-directory-pin-modal" not in src
    assert "apps_directory_unlocked_at" not in src
    assert "requestManagerOpen" not in src


def test_manage_tiles_opens_manager_directly():
    """Button must open the manager without any intermediate PIN gate.
    v58.13.132ex — click is now short-circuited when the user is
    non-admin (`if (isAdmin) setManagerOpen(true)`); admins still land
    directly on the manager. The critical property this test locks in
    is "no PIN gate" — the setManagerOpen call is unconditional at
    the state level."""
    src = _read(QUICK_SECT)
    # onClick appears before the testid in the JSX ordering, so grab
    # ~500 chars either side of the testid to catch it.
    idx = src.find('data-testid="org-quick-links-manage-btn"')
    assert idx > 0, "manage-btn testid not found"
    block = src[max(0, idx - 500):idx + 500]
    assert "setManagerOpen(true)" in block
    # No PIN-lock indirection re-introduced by later ships.
    assert "requestManagerOpen" not in block
    assert "apps-directory-pin-modal" not in block


# ── Version-sync ──────────────────────────────────────────────────

def test_version_pinned_to_132es_or_higher():
    v = _read(VERSION_JS)
    sw = _read(SW)
    m_v = re.search(r"RUNNING_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", v)
    m_sw = re.search(r"CACHE_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", sw)
    assert m_v and m_v.group(1) >= "es", f"RUNNING_VERSION suffix must be >= 132es, got {m_v and m_v.group(1)}"
    assert m_sw and m_sw.group(1) >= "es", f"CACHE_VERSION suffix must be >= 132es, got {m_sw and m_sw.group(1)}"

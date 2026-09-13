"""v58.13.132et — AppsDirectoryModal close-fix + UX consolidation.

Fix 1: Escape / X / backdrop close on `<AppsDirectoryModal />`
       stopped working in `.132es`. Root causes:
         · Escape listener re-attached every parent render because
           `onClose` was in the effect dep array (new lambda each
           render).
         · A bubbling `keydown` from a descendant (e.g. dropdown)
           could swallow the event before `window` fired.
         · The X button called the stale `onClose` reference.
       Fix: stabilise via `onCloseRef = useRef(onClose)`, attach the
       listener on `document` in the CAPTURE phase, keep the effect
       dep list at just `[open]`.

Fix 2: Consolidate access to the tile feature. Remove the standalone
       "Quick Links" sidebar entry (from `.132eq`), keep only the
       Apps Directory entry (from `.132es`). Legacy `/app/quick-links`
       route now `<Navigate to="/app/dashboard?open=apps-directory"
       replace />` so old bookmarks land on the modal. AppShell
       reads `?open=apps-directory` on mount and toggles the modal
       open. Org Settings section title renamed to "Apps Directory ·
       Tile management" for consistency. Modal empty state points
       admins there verbatim.
"""
from __future__ import annotations

import re
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[2]
FE = APP_ROOT / "frontend" / "src"

MODAL = FE / "components" / "AppsDirectoryModal.jsx"
APPSHELL = FE / "components" / "layout" / "AppShell.jsx"
QUICK_SECT = FE / "components" / "QuickLinksSection.jsx"
APP_JS = FE / "App.js"
VERSION_JS = FE / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


# ── Fix 1 — Modal close paths ─────────────────────────────────────

def test_modal_uses_stable_onclose_ref():
    src = _read(MODAL)
    assert "const onCloseRef = React.useRef(onClose);" in src
    # Ref is kept in sync via a dedicated effect.
    assert "onCloseRef.current = onClose;" in src


def test_escape_listener_attaches_on_document_capture_phase():
    """Root cause of the .132es bug — `window` + bubble phase could
    be swallowed by a descendant `stopPropagation`. Fix uses
    `document` + capture phase."""
    src = _read(MODAL)
    assert "document.addEventListener('keydown', handler, true)" in src
    assert (
        "document.removeEventListener('keydown', handler, true)"
        in src
    )
    # And is bound only on `open` transitions — NOT on `[open, onClose]`.
    # Locate the Escape useEffect and confirm its dep array is `[open]`.
    m = re.search(
        r"document\.addEventListener\('keydown'[\s\S]{0,400}?\}, \[([^\]]*)\]\);",
        src)
    assert m, "Escape effect dep array not found"
    assert m.group(1).strip() == "open", (
        f"Escape effect dep array must be `[open]` (stable via onCloseRef), "
        f"got `[{m.group(1)}]`")


def test_escape_handler_calls_ref_not_prop():
    src = _read(MODAL)
    # The keydown handler goes through the ref, not the raw prop.
    handler_block = re.search(
        r"const handler = \(e\) => \{([\s\S]+?)\};",
        src)
    assert handler_block, "keydown handler not found"
    body = handler_block.group(1)
    assert "onCloseRef.current" in body


def test_close_button_uses_ref():
    src = _read(MODAL)
    assert "onClick={() => onCloseRef.current?.()}" in src


def test_backdrop_click_uses_ref_and_stops_propagation_inside_panel():
    src = _read(MODAL)
    # Backdrop dismissal goes through the ref.
    assert "if (e.target === e.currentTarget) onCloseRef.current?.()" in src
    # Modal content panel stops propagation so inner clicks don't
    # bubble up to the backdrop's dismiss handler.
    assert "onClick={(e) => e.stopPropagation()}" in src


# ── Fix 2 — Sidebar + route consolidation ─────────────────────────

def test_sidebar_no_longer_has_quick_links_entry():
    """The standalone "Quick Links" NAV entry from `.132eq` was
    removed to eliminate Stephen's discoverability confusion. Apps
    Directory is now the single access point."""
    src = _read(APPSHELL)
    # Sidebar entry testid must be gone.
    assert "'nav-quick-links'" not in src
    # And no `to: '/app/quick-links'` NAV entry.
    assert "to: '/app/quick-links'" not in src
    # Apps Directory NAV entry still present.
    assert "'nav-apps-directory'" in src


def test_quick_links_route_redirects_to_apps_directory():
    src = _read(APP_JS)
    assert (
        '<Route path="quick-links" element={<Navigate to="/app/dashboard?open=apps-directory" replace />} />'
        in src
    )


def test_appshell_auto_opens_modal_from_query_param():
    src = _read(APPSHELL)
    assert "new URLSearchParams(location.search)" in src
    assert "params.get('open') === 'apps-directory'" in src
    assert "setAppsDirectoryOpen(true)" in src


def test_org_settings_section_title_renamed():
    src = _read(QUICK_SECT)
    assert "Apps Directory · Tile management" in src
    # Old plain "Quick Links" heading gone (the string still appears
    # elsewhere in code comments; check just the <h3> block for the
    # new copy).
    assert (
        '<h3 className="font-display font-semibold text-base text-slate-800">Apps Directory · Tile management</h3>'
        in src
    )


def test_modal_empty_state_points_to_new_section_title():
    src = _read(MODAL)
    assert (
        "No tiles yet — Admin can add them in Settings → Organisation → Apps Directory · Tile management."
        in src
    )


# ── Version-sync ──────────────────────────────────────────────────

def test_version_pinned_to_132et_or_higher():
    v = _read(VERSION_JS)
    sw = _read(SW)
    m_v = re.search(r"RUNNING_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", v)
    m_sw = re.search(r"CACHE_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", sw)
    assert m_v and m_v.group(1) >= "et", f"RUNNING_VERSION suffix must be >= 132et, got {m_v and m_v.group(1)}"
    assert m_sw and m_sw.group(1) >= "et", f"CACHE_VERSION suffix must be >= 132et, got {m_sw and m_sw.group(1)}"

"""v58.13.132eq — Read-only Quick Links sidebar page.

  · Sidebar NAV entry ("Quick Links") added to the Overview section
    at the TOP of the sidebar (above the Settings section).
  · New route /app/quick-links → <QuickLinks /> — read-only tile grid.
  · Backend `GET /url-tiles` opened up to ANY authenticated user;
    mutations (POST/PATCH/DELETE/reorder) + /fetch-icon stay admin-only.
  · Admin sees a "Manage tiles →" link that deep-links to Org Settings.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest
import requests

from tests.conftest import API, EPHEMERAL_PWD

pytestmark = pytest.mark.live_db_writes

APP_ROOT = Path(__file__).resolve().parents[2]
BACKEND = APP_ROOT / "backend"
FE = APP_ROOT / "frontend" / "src"

MODULE = BACKEND / "org_url_tiles.py"
APP_JS = FE / "App.js"
APPSHELL = FE / "components" / "layout" / "AppShell.jsx"
PAGE = FE / "pages" / "QuickLinks.jsx"
VERSION_JS = FE / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def _admin_hdr():
    r = requests.post(f"{API}/auth/login",
                       json={"email": "stephen@paneltec.com.au",
                             "password": "Mcgstephen50#"}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"admin login unavailable: {r.status_code}")
    t = r.json().get("access_token") or r.json().get("token")
    return {"Authorization": f"Bearer {t}"}


def _hseq_hdr(ephemeral_users):
    email = ephemeral_users["hseq_lead"]
    r = requests.post(f"{API}/auth/login",
                       json={"email": email, "password": EPHEMERAL_PWD},
                       timeout=30)
    if r.status_code == 429:
        pytest.skip("rate-limited by auth throttle")
    assert r.status_code == 200
    t = r.json().get("access_token") or r.json().get("token")
    return {"Authorization": f"Bearer {t}"}


# ── Backend — GET open to authed users, mutations still admin ──────

def test_list_tiles_handler_has_no_admin_gate():
    """v58.13.132eq — list_tiles must NOT call `_admin(user)` so
    non-admin authenticated users can render the Quick Links page."""
    src = _read(MODULE)
    # Slice from `async def list_tiles(` up to the NEXT `async def` /
    # `@router.` / top-level `def ` so we scope strictly to this handler.
    start = src.index("async def list_tiles(")
    tail = src[start:]
    end_candidates = [i for i in (tail.find("\n@router."),
                                    tail.find("\nasync def ",
                                              len("async def list_tiles(")),
                                    tail.find("\ndef "))
                       if i > 0]
    end = min(end_candidates) if end_candidates else len(tail)
    body = tail[:end]
    assert "_admin(user)" not in body, (
        "list_tiles must NOT invoke _admin(user) — GET is open to any "
        "authenticated user in v58.13.132eq")


def test_mutations_still_admin_gated():
    src = _read(MODULE)
    for handler in ("create_tile", "update_tile", "delete_tile",
                     "reorder_tiles", "fetch_icon"):
        m = re.search(rf"async def {handler}\(.*?\n((?:    .*\n)+)", src,
                       flags=re.DOTALL)
        assert m, f"{handler} not found"
        assert "_admin(user)" in m.group(1), (
            f"{handler} must still invoke _admin(user)")


def test_live_get_is_open_to_non_admin(ephemeral_users):
    hdr = _hseq_hdr(ephemeral_users)
    r = requests.get(f"{API}/org/url-tiles", headers=hdr, timeout=30)
    assert r.status_code == 200, f"non-admin GET should be 200, got {r.status_code}"
    body = r.json()
    assert "tiles" in body and isinstance(body["tiles"], list)


def test_live_non_admin_still_blocked_from_mutations(ephemeral_users):
    hdr = _hseq_hdr(ephemeral_users)
    r_create = requests.post(f"{API}/org/url-tiles",
                              json={"url": "https://example.com", "label": "x"},
                              headers=hdr, timeout=30)
    assert r_create.status_code == 403
    r_patch = requests.patch(f"{API}/org/url-tiles/anything",
                              json={"label": "x"}, headers=hdr, timeout=30)
    assert r_patch.status_code == 403
    r_del = requests.delete(f"{API}/org/url-tiles/anything",
                             headers=hdr, timeout=30)
    assert r_del.status_code == 403
    r_reord = requests.post(f"{API}/org/url-tiles/reorder",
                             json={"tiles": []}, headers=hdr, timeout=30)
    assert r_reord.status_code == 403
    r_fetch = requests.post(f"{API}/org/url-tiles/fetch-icon",
                             json={"url": "https://www.google.com/"},
                             headers=hdr, timeout=30)
    assert r_fetch.status_code == 403


# ── FE page + wiring ──────────────────────────────────────────────

def test_quick_links_page_exists():
    src = _read(PAGE)
    assert "export default function QuickLinks" in src
    assert 'data-testid="quick-links-page"' in src


def test_quick_links_page_uses_api_list_endpoint():
    src = _read(PAGE)
    assert "api.get('/org/url-tiles')" in src


def test_quick_links_page_grid_and_empty_state_testids():
    src = _read(PAGE)
    for tid in ("quick-links-grid", "quick-links-empty",
                 "quick-links-loading"):
        assert tid in src, f"missing testid {tid}"


def test_quick_links_tiles_open_in_new_tab_safely():
    src = _read(PAGE)
    assert 'target="_blank"' in src
    assert 'rel="noopener noreferrer"' in src


def test_quick_links_admin_sees_manage_link_non_admin_does_not():
    src = _read(PAGE)
    # Admin-only surface — gated on isAdmin
    assert "isAdmin ? (" in src
    assert 'data-testid="quick-links-manage-link"' in src
    # Deep-links to Org Settings management surface.
    assert '"/app/settings/org"' in src or "'/app/settings/org'" in src


def test_quick_links_tile_renders_remote_icon_with_fallback():
    src = _read(PAGE)
    assert "tile.remote_icon_url" in src
    assert "onError={() => setImgError(true)}" in src


def test_app_js_registers_quick_links_route():
    """v58.13.132et — Route now redirects to the dashboard with
    `?open=apps-directory` so old bookmarks auto-open the modal
    instead of rendering the standalone Quick Links page. The
    QuickLinks page import is retained (harmless legacy)."""
    src = _read(APP_JS)
    assert (
        '<Route path="quick-links" element={<Navigate to="/app/dashboard?open=apps-directory" replace />} />'
        in src
    )


def test_sidebar_has_quick_links_nav_entry_in_overview():
    """v58.13.132et — Quick Links sidebar entry REMOVED to consolidate
    on the Apps Directory modal (single access point). Apps Directory
    entry remains. Legacy `/app/quick-links` route redirects to the
    dashboard with `?open=apps-directory` (verified by the .132et
    test suite).
    """
    src = _read(APPSHELL)
    # Quick Links sidebar entry intentionally removed.
    assert "'nav-quick-links'" not in src
    assert "to: '/app/quick-links'" not in src
    # Apps Directory entry (the replacement) is still there.
    assert "'nav-apps-directory'" in src


def test_sidebar_quick_links_has_no_permission_gate():
    """v58.13.132et — Historical `.132eq` invariant: the Quick Links
    entry carried no `requiresCan` gate. Entry removed in `.132et`;
    this test now asserts the removal is complete."""
    src = _read(APPSHELL)
    assert "'/app/quick-links'" not in src or (
        # Only allowed reference is the route redirect string in the
        # legacy comment, not a NAV entry.
        "label: 'Quick Links'" not in src
    )


# ── Version-sync ──────────────────────────────────────────────────

def test_version_pinned_to_132eq_or_higher():
    v = _read(VERSION_JS)
    sw = _read(SW)
    m_v = re.search(r"RUNNING_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", v)
    m_sw = re.search(r"CACHE_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", sw)
    assert m_v and m_v.group(1) >= "eq", f"RUNNING_VERSION suffix must be >= 132eq, got {m_v and m_v.group(1)}"
    assert m_sw and m_sw.group(1) >= "eq", f"CACHE_VERSION suffix must be >= 132eq, got {m_sw and m_sw.group(1)}"

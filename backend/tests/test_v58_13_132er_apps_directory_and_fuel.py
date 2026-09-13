"""v58.13.132er — Apps Directory redesign + fuel toggle stick fix.

Item 1: `<QuickLinksSection />` manager redesigned to the "Paneltec
        Group Portal · APPS DIRECTORY · QUICK TOOLS" table style.
        New fields `enabled` + `color` on `org_url_tiles`; ?include_disabled
        surfaces hidden tiles for admins only. Idempotent defaults —
        pre-.132er rows read `enabled=True, color="#1d6fb8"`.
Item 2: FuelReporting `override_mode` toggle stick fix — split
        `Promise.all([settings, history])` so a history-side failure
        no longer masks the persisted mode; and the SmartFill
        "selected" comparison uses `=== 'smartfill_with_fallback'`
        rather than `!== 'provisional_all'`.
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

MODULE = BACKEND / "org_url_tiles.py"
SECT = FE / "components" / "QuickLinksSection.jsx"
PAGE = FE / "pages" / "QuickLinks.jsx"
FUEL = FE / "pages" / "FuelReporting.jsx"
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


# ── Item 1: backend model + endpoints ─────────────────────────────

def test_tile_model_has_enabled_and_color():
    src = _read(MODULE)
    assert "enabled: Optional[bool]" in src
    assert "color: Optional[str]" in src
    # `_out` projects both with idempotent defaults.
    assert 'bool(doc.get("enabled", True))' in src
    # v58.13.132ew — `_out` no longer returns the sentinel default
    # directly. Empty / sentinel colours are hash-swapped through the
    # auto palette (`_auto_color_for`). Manual picks pass through
    # untouched. The sentinel constant is still declared so the
    # `_out` swap logic can recognise it.
    assert 'stored_color == _DEFAULT_TILE_COLOR' in src
    assert '_auto_color_for(doc.get("label")' in src
    assert '_DEFAULT_TILE_COLOR = "#1d6fb8"' in src


def test_list_endpoint_filters_disabled_by_default():
    src = _read(MODULE)
    assert 'include_disabled: bool = False' in src
    # Filter branch — non-management view excludes `enabled: False`.
    assert '"enabled": {"$ne": False}' in src


def test_color_sanitiser_rejects_non_hex():
    src = _read(MODULE)
    assert "_HEX_COLOR_RE = re.compile" in src
    assert "Color must be a `#rrggbb` hex code" in src


def test_live_create_with_enabled_and_color():
    hdr = _admin_hdr()
    r = requests.post(f"{API}/org/url-tiles",
                       json={"url": "https://example.com",
                             "label": "Ex (pytest .132er)",
                             "color": "#ff5722", "enabled": True},
                       headers=hdr, timeout=30)
    assert r.status_code == 200, r.text
    tile = r.json()
    tid = tile["id"]
    try:
        assert tile["color"] == "#ff5722"
        assert tile["enabled"] is True
        # Bad color rejected
        r_bad = requests.post(f"{API}/org/url-tiles",
                                json={"url": "https://a.com", "label": "x",
                                      "color": "red"},
                                headers=hdr, timeout=30)
        assert r_bad.status_code == 400
        # Toggle off
        r_off = requests.patch(f"{API}/org/url-tiles/{tid}",
                                 json={"enabled": False},
                                 headers=hdr, timeout=30)
        assert r_off.status_code == 200
        assert r_off.json()["enabled"] is False
        # Default GET hides disabled tile
        r_list = requests.get(f"{API}/org/url-tiles", headers=hdr, timeout=30)
        ids = [t["id"] for t in r_list.json()["tiles"]]
        assert tid not in ids
        # include_disabled=true surfaces it back
        r_all = requests.get(f"{API}/org/url-tiles?include_disabled=true",
                               headers=hdr, timeout=30)
        ids_all = [t["id"] for t in r_all.json()["tiles"]]
        assert tid in ids_all
    finally:
        requests.delete(f"{API}/org/url-tiles/{tid}", headers=hdr, timeout=30)


# ── Item 1: FE Apps Directory table + read-only accent ───────────

def test_apps_directory_table_has_seven_columns_in_order():
    src = _read(SECT)
    # 7 <Th> headers in the specified order.
    m = re.search(r"<thead[\s\S]+?</thead>", src)
    assert m, "thead block not found"
    thead = m.group(0)
    for label in ("On", "Icon", "Name", "Login URL (where the tile takes you)",
                   "Description", "Color", "Actions"):
        assert f">{label}<" in thead, f"header '{label}' missing"


def test_apps_directory_manager_has_dark_navy_header_and_yellow_hint_bar():
    src = _read(SECT)
    # Dark navy header carries rocket icon + APPS DIRECTORY title testid.
    assert 'data-testid="apps-directory-title"' in src
    assert "Apps Directory · Quick Tools" in src
    # Yellow-lit hint bar at the bottom.
    assert 'data-testid="apps-directory-hint-bar"' in src
    assert "ON/OFF pill hides a tile without deleting" in src or \
           "hides a tile without deleting" in src


def test_inline_add_tile_row_and_on_pill():
    src = _read(SECT)
    for tid in ("apps-directory-add-row",
                 "apps-directory-add-on-pill",
                 "apps-directory-add-name",
                 "apps-directory-add-url",
                 "apps-directory-add-description",
                 "apps-directory-add-color",
                 "apps-directory-add-btn",
                 "apps-directory-add-icon"):
        assert tid in src, f"missing testid {tid}"


def test_on_pill_wired_to_patch_enabled():
    src = _read(SECT)
    assert "toggleEnabled" in src
    assert "{ enabled: !tile.enabled }" in src


def test_manager_uses_include_disabled_flag():
    src = _read(SECT)
    assert "/org/url-tiles?include_disabled=true" in src


def test_readonly_page_uses_color_accent():
    src = _read(PAGE)
    assert "tile.color || " in src or "tile.color ||" in src
    assert "borderLeftColor" in src


def test_apps_directory_dropped_dnd_kit_dependencies():
    """The redesigned manager is a plain table — drag-reorder was
    dropped per Stephen's reference design. Confirm no dnd-kit
    imports remain."""
    src = _read(SECT)
    assert "@dnd-kit/core" not in src
    assert "@dnd-kit/sortable" not in src


# ── Item 2: Fuel toggle stick fix ─────────────────────────────────

def test_fuel_price_settings_load_uses_independent_try_catch():
    """`loadPriceSettings` must NOT use `Promise.all` — history-side
    failure would otherwise silently mask the price-settings hydration
    (root cause of Stephen's "toggle reverts, doesn't stick" symptom).
    """
    src = _read(FUEL)
    m = re.search(r"const loadPriceSettings = useCallback\(([\s\S]+?)\}, \[\]\);",
                   src)
    assert m, "loadPriceSettings block not found"
    body = m.group(1)
    assert "await Promise.all" not in body, (
        "loadPriceSettings must not use Promise.all — history-side "
        "failure would silently mask price-settings hydration")
    # Two independent try/catch blocks:
    assert body.count("try {") >= 2
    assert "api.get('/fleet/fuel/price-settings')" in body
    assert "api.get('/fleet/fuel/price-history')" in body


def test_smartfill_tab_uses_explicit_equality():
    """The SmartFill "selected" comparison must be
    `=== 'smartfill_with_fallback'` (explicit) rather than
    `!== 'provisional_all'` (defaults truthy on any undefined /
    partial state), matching the tighter hydration semantics."""
    src = _read(FUEL)
    # Look for the button block by testid.
    m = re.search(
        r'data-testid="fuel-price-source-smartfill"([\s\S]{0,600})',
        src)
    assert m, "SmartFill button not found"
    block = m.group(1)
    assert "priceSettings.override_mode === 'smartfill_with_fallback'" in block
    assert "!== 'provisional_all'" not in block


def test_live_fuel_override_mode_sticks(monkeypatch=None):
    """Round-trip flip via the live API — confirms the backend end
    honours `override_mode` transitions independent of any FE code
    path. This is the ground-truth stickiness lock."""
    hdr = _admin_hdr()
    # Snapshot current mode, flip, verify, revert.
    r0 = requests.get(f"{API}/fleet/fuel/price-settings", headers=hdr,
                       timeout=30)
    assert r0.status_code == 200
    prev = r0.json()["override_mode"]
    target = ("smartfill_with_fallback" if prev == "provisional_all"
              else "provisional_all")
    try:
        r_put = requests.put(f"{API}/fleet/fuel/price-settings",
                              json={"override_mode": target},
                              headers=hdr, timeout=30)
        assert r_put.status_code == 200
        assert r_put.json()["override_mode"] == target
        r_get = requests.get(f"{API}/fleet/fuel/price-settings",
                              headers=hdr, timeout=30)
        assert r_get.status_code == 200
        assert r_get.json()["override_mode"] == target, (
            "override_mode must stick across GET-PUT-GET")
    finally:
        requests.put(f"{API}/fleet/fuel/price-settings",
                      json={"override_mode": prev},
                      headers=hdr, timeout=30)


# ── Version-sync ──────────────────────────────────────────────────

def test_version_pinned_to_132er_or_higher():
    v = _read(VERSION_JS)
    sw = _read(SW)
    m_v = re.search(r"RUNNING_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", v)
    m_sw = re.search(r"CACHE_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", sw)
    assert m_v and m_v.group(1) >= "er", f"RUNNING_VERSION suffix must be >= 132er, got {m_v and m_v.group(1)}"
    assert m_sw and m_sw.group(1) >= "er", f"CACHE_VERSION suffix must be >= 132er, got {m_sw and m_sw.group(1)}"

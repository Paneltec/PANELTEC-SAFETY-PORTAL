"""v58.13.132fa — Positive-framing wording + inline approved-users list.

Copy pass on top of `.132ez`:
  · "Restrict access to specific users" → "Approved users only"
  · Amber "Restricted" tile pill → "Approved · N users"
  · Manage tiles table now renders a second row per restricted
    tile with a chip strip of the approved user names.

Backend API contract is unchanged from `.132ez`. This suite
source-pins the new wording, guards against the old strings coming
back, and re-verifies the API shape is intact.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest
import requests

from tests.conftest import ADMIN_EMAIL, ADMIN_PWD, API

pytestmark = pytest.mark.live_db_writes

APP_ROOT = Path(__file__).resolve().parents[2]
FE = APP_ROOT / "frontend" / "src"
QLS = FE / "components" / "QuickLinksSection.jsx"
USERS_PAGE = FE / "pages" / "UsersManagement.jsx"
VERSION_JS = FE / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def _admin_hdr():
    r = requests.post(f"{API}/auth/login",
                       json={"email": ADMIN_EMAIL, "password": ADMIN_PWD},
                       timeout=30)
    if r.status_code == 429:
        pytest.skip("rate-limited by auth throttle — retry later")
    assert r.status_code == 200, r.text
    tok = r.json().get("access_token") or r.json().get("token")
    return {"Authorization": f"Bearer {tok}"}


# ── FE source-pins (positive wording present) ─────────────────────

def test_tile_editor_uses_positive_wording():
    src = _read(QLS)
    # v58.13.132fe — Radio-group replaced the .132fa toggle. Keep
    # the picker hint copy assertion; drop the toggle label.
    assert "Who can see this tile?" in src
    assert "Tick everyone who should have access" in src
    assert "Approved users" in src  # picker heading
    assert "approved" in src  # selected count phrasing


def test_tile_row_pill_reads_approved_n_users():
    """v58.13.132fe — Pill re-labelled from 'Approved · N users' to
    'Private · N people' with a rose (red-tinted) accent. Testid
    preserved for backwards-compat with earlier ships'
    source-pins."""
    src = _read(QLS)
    # Pill body renders the new copy.
    assert "Private ·" in src, "pill must read 'Private · N people'"
    assert re.search(r"Private · \{allowed\.length\}", src), (
        "pill must interpolate `allowed.length`")
    # Rose palette (red-tinted) replaces the .132fa amber.
    assert re.search(r"text-rose-700[\s\S]{0,120}bg-rose-50", src)
    # Testid preserved (backwards-compat with .132ey source-pin).
    assert "apps-directory-row-restricted-" in src


def test_permissions_panel_uses_positive_wording():
    src = _read(USERS_PAGE)
    # Panel copy dropped the "Restrict" verb.
    assert "Tick the tiles this user should see" in src
    # Pill body for restricted tiles now reads "Approved" not
    # "Restricted".
    assert re.search(r">\s*Approved\s*</span>", src), (
        "restricted pill in the panel must read 'Approved'")
    # Old pill text gone from the panel scope.
    panel_start = src.find("UserApprovedTilesPanel")
    panel_end = src.find("function SavePresetModal", panel_start)
    assert panel_start > 0 and panel_end > panel_start
    panel_slice = src[panel_start:panel_end]
    assert re.search(r">\s*Restricted\s*</span>", panel_slice) is None, (
        "old 'Restricted' pill wording must be gone from the panel")


# ── FE source-pins (old wording gone) ──────────────────────────────

def test_old_restrict_wording_removed_from_editor():
    src = _read(QLS)
    # Old toggle label + helper are gone. Variable names like
    # `restrict` / `setRestrict` are code, not user-facing copy —
    # those may stay. Test only pins user-visible strings.
    for banned in (
        "Restrict access to specific users",
        "When off, every user in your organisation sees this tile.",
        "Only ticked users will see this tile",
        "If you want yourself to see it, tick your own name",
    ):
        assert banned not in src, (
            f"old wording still present in QuickLinksSection.jsx: {banned!r}")


# ── FE source-pins (inline chip row wiring) ────────────────────────

def test_manage_table_has_inline_approved_users_row():
    """`TileRow` renders a second `<tr>` with the approved-user chip
    strip for restricted tiles. Manager caches eligible-users at
    scope so the chips don't N+1 fetch."""
    src = _read(QLS)
    # Manager-scope cache + hydration.
    assert "usersById" in src
    assert "/org/url-tiles/eligible-users" in src
    # TileRow accepts the cache prop.
    assert re.search(r"function TileRow\(\{ tile, zebra, usersById,", src)
    # Fragment with the second-row chip strip.
    assert "apps-directory-row-approved-users-" in src
    assert "apps-directory-row-approved-users-list-" in src
    assert "apps-directory-row-approved-chip-" in src
    # +N more overflow toggle.
    assert "apps-directory-row-approved-more-" in src
    # Sorted alphabetically.
    assert "a.name.localeCompare(b.name)" in src


# ── BE contract unchanged from .132ez ──────────────────────────────

def test_backend_contract_unchanged_from_132ez():
    """`GET /api/org/url-tiles` still returns `allowed_user_ids` +
    `approved_for_me` per tile; `GET /eligible-users` still returns
    `[{id,name,email,is_admin}]`. No wording ship should change the
    API surface."""
    hdr = _admin_hdr()
    r_tiles = requests.get(f"{API}/org/url-tiles?include_disabled=true",
                            headers=hdr, timeout=30)
    assert r_tiles.status_code == 200, r_tiles.text
    tiles = r_tiles.json().get("tiles", [])
    if tiles:
        sample = tiles[0]
        for k in ("id", "label", "url", "allowed_user_ids",
                    "approved_for_me", "color", "enabled"):
            assert k in sample, (
                f"tile response missing `{k}` — API contract regression")
    r_users = requests.get(f"{API}/org/url-tiles/eligible-users",
                            headers=hdr, timeout=30)
    assert r_users.status_code == 200, r_users.text
    users = r_users.json().get("users", [])
    assert users, "eligible-users must not be empty on a real org"
    row = users[0]
    for k in ("id", "name", "email", "is_admin"):
        assert k in row, (
            f"eligible-users row missing `{k}` — API contract regression")


# ── Version pin ────────────────────────────────────────────────────

def test_version_pinned_to_132fa_or_higher():
    v = _read(VERSION_JS)
    sw = _read(SW)
    m_v = re.search(r"RUNNING_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", v)
    m_ex = re.search(r"EXPECTED_CACHE_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", v)
    m_sw = re.search(r"CACHE_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", sw)
    for name, m in (("RUNNING_VERSION", m_v),
                     ("EXPECTED_CACHE_VERSION", m_ex),
                     ("CACHE_VERSION", m_sw)):
        assert m and m.group(1) >= "fa", (
            f"{name} suffix must be >= 132fa, got {m and m.group(1)}")

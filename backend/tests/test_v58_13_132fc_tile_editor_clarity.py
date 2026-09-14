"""v58.13.132fc — Tile editor UX clarity pass.

Stephen's confusion: he was editing the Credential Vault section
thinking it controlled who could see the tile, and the "Approved
users only" toggle was still OFF. This ship makes the two
responsibilities visually and textually unambiguous, and reworks
the approvals picker for small-team ergonomics.

All changes are source-pin verifiable — no API contract change.
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


# ── FE source-pins: clarifier banners ────────────────────────────

def test_credentials_clarifier_banner_present():
    """Credentials sub-editor now shows a subdued banner making it
    explicit the section is personal-only. Grep for a distinctive
    phrase from the copy (case-insensitive)."""
    src = _read(QLS)
    assert re.search(r"encrypted just for you", src, re.IGNORECASE), (
        "credentials clarifier copy missing")
    assert re.search(r"Nobody else on the team can see it", src, re.IGNORECASE)
    assert "credential-sub-editor-clarifier" in src


def test_approvals_clarifier_banner_present():
    src = _read(QLS)
    assert re.search(r"nothing to do with your personal credentials",
                       src, re.IGNORECASE), (
        "approvals clarifier copy missing")
    assert "org-quick-links-editor-approvals-clarifier" in src


# ── FE source-pins: button labels ────────────────────────────────

def test_save_buttons_disambiguated():
    src = _read(QLS)
    # Credentials save button — Lock icon + new copy + tooltip.
    assert "Save my login only" in src
    assert re.search(
        r'title="Saves only your personal password for this tile — does not save tile settings or approvals\."',
        src)
    # Main tile-form save button — new copy + tooltip.
    assert "'Save tile'" in src, (
        "main save button must read 'Save tile'")
    assert re.search(
        r'title="Saves the tile settings including approved users\."',
        src)
    # Old copy gone.
    assert "'Save credentials'" not in src
    assert "> Save<" not in src  # bare-word "Save" no longer used


# ── FE source-pins: picker rework (bulk buttons + role groups) ───
# NOTE: superseded in v58.13.132fg. The picker is now a single flat
# alphabetical list with "Select everyone" + "Clear all". The
# "Select all admins" affordance and the admins/users role grouping
# were removed because Paneltec Civil's web portal is admin-only —
# every user is an admin, so the grouping was noise. See
# test_v58_13_132fg_picker_flatten.

def test_picker_has_bulk_buttons_legacy_gone():
    src = _read(QLS)
    # Old testids MUST be gone.
    assert "org-quick-links-editor-select-all-admins" not in src
    # Old copy "Select all admins" must be gone.
    assert "Select all admins" not in src
    # Old "Select all" testid gone (replaced by "-select-everyone").
    assert 'data-testid="org-quick-links-editor-select-all"' not in src
    # Clear all still present.
    assert "org-quick-links-editor-clear-all" in src


def test_picker_no_longer_groups_users_by_role():
    src = _read(QLS)
    # Role-group testids GONE.
    assert "org-quick-links-editor-group-admins" not in src
    assert "org-quick-links-editor-group-users" not in src
    # Old split predicates GONE.
    assert "sorted.filter((u) => u.is_admin)" not in src
    assert "sorted.filter((u) => !u.is_admin)" not in src


def test_picker_search_hidden_below_twenty_users():
    src = _read(QLS)
    # Search is now conditional on `showSearch` which is true only
    # when the org has > 20 eligible users.
    assert "const showSearch = sorted.length > 20" in src
    assert "{showSearch && (" in src


# ── FE source-pins: preflight warnings ───────────────────────────

def test_empty_selection_warning_present():
    src = _read(QLS)
    assert re.search(r"hidden from everyone \(including you\)",
                       src, re.IGNORECASE), (
        "empty-selection warning copy missing")
    assert "org-quick-links-editor-empty-warning" in src


def test_self_missing_hint_present():
    src = _read(QLS)
    assert re.search(r"you haven't ticked yourself",
                       src, re.IGNORECASE)
    assert "org-quick-links-editor-self-missing-hint" in src
    # Uses current user id derived from /auth/me on editor mount.
    assert "api.get('/auth/me')" in src
    assert "currentUserId" in src


# ── BE contract sanity ───────────────────────────────────────────

def test_eligible_users_endpoint_shape_unchanged():
    """Sanity check the picker feed hasn't drifted. Same contract
    as `.132ey` / `.132fa`."""
    hdr = _admin_hdr()
    r = requests.get(f"{API}/org/url-tiles/eligible-users",
                      headers=hdr, timeout=30)
    assert r.status_code == 200, r.text
    users = r.json().get("users") or []
    assert users, "eligible-users must not be empty on a real org"
    row = users[0]
    for k in ("id", "name", "email", "is_admin"):
        assert k in row, f"eligible-users row missing `{k}`"


# ── Version pin ──────────────────────────────────────────────────

def test_version_pinned_to_132fc_or_higher():
    v = _read(VERSION_JS)
    sw = _read(SW)
    m_v = re.search(r"RUNNING_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", v)
    m_ex = re.search(r"EXPECTED_CACHE_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", v)
    m_sw = re.search(r"CACHE_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", sw)
    for name, m in (("RUNNING_VERSION", m_v),
                     ("EXPECTED_CACHE_VERSION", m_ex),
                     ("CACHE_VERSION", m_sw)):
        assert m and m.group(1) >= "fc", (
            f"{name} suffix must be >= 132fc, got {m and m.group(1)}")

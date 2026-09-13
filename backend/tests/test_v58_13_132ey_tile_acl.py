"""v58.13.132ey — Apps Directory per-tile ACL / whitelist.

Feature: admins can restrict a tile to a specific set of users via
`allowed_user_ids`. Empty / missing → public (default). Non-empty →
only listed `users.id` values see the tile. Strict admin rule:
admins are NOT bypassed — they must be on the list themselves.

Scope covered by this suite:
  · GET / server-side ACL filter (default public + restricted paths).
  · POST + PATCH admin write path persists `allowed_user_ids` (with
    silent-drop sanitisation for stale IDs).
  · GET /eligible-users admin-only picker feed.
  · FE lock: `TileEditor` Access section + TileRow "Restricted" pill.
"""
from __future__ import annotations

import re
import uuid
from pathlib import Path

import pytest
import requests

from tests.conftest import (
    ADMIN_EMAIL, ADMIN_PWD, API, EPHEMERAL_PWD,
)

pytestmark = pytest.mark.live_db_writes

APP_ROOT = Path(__file__).resolve().parents[2]
FE = APP_ROOT / "frontend" / "src"
BACKEND = APP_ROOT / "backend"
QLS = FE / "components" / "QuickLinksSection.jsx"
ORG_MOD = BACKEND / "org_url_tiles.py"
VERSION_JS = FE / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def _login(email: str, pwd: str):
    r = requests.post(f"{API}/auth/login",
                       json={"email": email, "password": pwd},
                       timeout=30)
    if r.status_code == 429:
        pytest.skip("rate-limited by auth throttle — retry later")
    assert r.status_code == 200, r.text
    tok = r.json().get("access_token") or r.json().get("token")
    return {"Authorization": f"Bearer {tok}"}


# v58.13.132ey — Module-scoped session caches so we don't slam the
# auth throttle by re-logging in ~8 admin + 2 non-admin sessions
# across the suite. The upstream throttle rejects rapid repeats
# with a 429 and my `_login` helper skips on 429, which was
# silently masking most of the ACL suite.
@pytest.fixture(scope="module")
def admin_hdr():
    return _login(ADMIN_EMAIL, ADMIN_PWD)


@pytest.fixture(scope="module")
def worker_hdr(ephemeral_users):
    return _login(ephemeral_users["worker"], EPHEMERAL_PWD)


@pytest.fixture(scope="module")
def hseq_lead_hdr(ephemeral_users):
    return _login(ephemeral_users["hseq_lead"], EPHEMERAL_PWD)


def _me(hdr):
    r = requests.get(f"{API}/auth/me", headers=hdr, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def _lookup_user_id(_mongo, email: str) -> str:
    doc = _mongo.users.find_one({"email": email}, {"_id": 0, "id": 1})
    assert doc, f"user {email} not found"
    return doc["id"]


def _create_tile(hdr, *, label: str, allowed=None):
    body = {"url": "https://example.com/", "label": label}
    if allowed is not None:
        body["allowed_user_ids"] = allowed
    r = requests.post(f"{API}/org/url-tiles", json=body, headers=hdr,
                       timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def _delete_tile(hdr, tile_id: str):
    requests.delete(f"{API}/org/url-tiles/{tile_id}", headers=hdr,
                     timeout=30)


def _list_ids(hdr) -> set[str]:
    r = requests.get(f"{API}/org/url-tiles", headers=hdr, timeout=30)
    assert r.status_code == 200, r.text
    return {t["id"] for t in r.json()["tiles"]}


# ── FE source-pins ────────────────────────────────────────────────

def test_frontend_editor_has_access_section():
    """TileEditor exposes the ACL toggle + picker with the required
    testids and helper hint copy."""
    src = _read(QLS)
    # Toggle + picker container.
    assert 'org-quick-links-editor-access-section' in src
    assert 'org-quick-links-editor-restrict-toggle' in src
    assert 'org-quick-links-editor-access-picker' in src
    assert 'org-quick-links-editor-user-search' in src
    assert 'org-quick-links-editor-user-list' in src
    # Helper hint copy per spec.
    assert "Only ticked users will see this tile" in src
    assert "If you want yourself to see it, tick your own name" in src
    # State + payload wiring.
    assert "restrict ? allowedUserIds : []" in src
    assert "eligible-users" in src


def test_frontend_manage_row_shows_lock_badge_when_restricted():
    """TileRow renders a lock badge next to the label when the tile
    has a non-empty `allowed_user_ids`."""
    src = _read(QLS)
    assert "apps-directory-row-restricted-" in src
    assert "Array.isArray(tile.allowed_user_ids) && tile.allowed_user_ids.length > 0" in src
    # Lock icon imported from lucide-react.
    assert re.search(r"from 'lucide-react';[\s\S]{0,200}\bLock\b", src) or \
           "Lock,\n" in src or "Lock } from 'lucide-react'" in src


# ── BE — default public path ──────────────────────────────────────

def test_default_tile_is_public_visible_to_admin_and_non_admin(admin_hdr, worker_hdr):
    """No `allowed_user_ids` → public → both admin and worker see it."""
    admin = admin_hdr
    worker = worker_hdr
    tile = _create_tile(admin, label=".132ey public probe")
    try:
        assert tile["allowed_user_ids"] == []
        assert tile["id"] in _list_ids(admin)
        assert tile["id"] in _list_ids(worker)
    finally:
        _delete_tile(admin, tile["id"])


# ── BE — restricted path (strict admin rule) ──────────────────────

def test_restricted_tile_only_shown_to_listed_users(admin_hdr, worker_hdr, hseq_lead_hdr, ephemeral_users, _mongo):
    """Restricted to Amanda (worker) — worker sees it; hseq_lead
    doesn't; admin (Stephen) NOT on the list also doesn't see it
    (strict admin rule)."""
    admin = admin_hdr
    other_hdr = hseq_lead_hdr
    worker_id = _lookup_user_id(_mongo, ephemeral_users["worker"])
    tile = _create_tile(admin, label=".132ey restricted probe",
                          allowed=[worker_id])
    try:
        assert tile["allowed_user_ids"] == [worker_id]
        # Listed user sees the tile through the public list view.
        assert tile["id"] in _list_ids(worker_hdr)
        # Non-listed non-admin does NOT.
        assert tile["id"] not in _list_ids(other_hdr)
        # Non-listed admin ALSO does not (strict admin rule).
        assert tile["id"] not in _list_ids(admin)
    finally:
        _delete_tile(admin, tile["id"])


def test_restricted_tile_shown_to_listed_admin(admin_hdr, _mongo):
    """When an admin IS on the list they DO see the tile."""
    admin = admin_hdr
    admin_id = _lookup_user_id(_mongo, ADMIN_EMAIL)
    tile = _create_tile(admin, label=".132ey admin-listed probe",
                          allowed=[admin_id])
    try:
        assert tile["allowed_user_ids"] == [admin_id]
        assert tile["id"] in _list_ids(admin)
    finally:
        _delete_tile(admin, tile["id"])


# ── BE — PATCH updates ACL ────────────────────────────────────────

def test_admin_patch_can_update_allowed_user_ids(admin_hdr, ephemeral_users, _mongo):
    """PATCH persists a whole-list replace of `allowed_user_ids`."""
    admin = admin_hdr
    worker_id = _lookup_user_id(_mongo, ephemeral_users["worker"])
    admin_id = _lookup_user_id(_mongo, ADMIN_EMAIL)
    tile = _create_tile(admin, label=".132ey patch probe")
    try:
        # Restrict → [worker, admin]
        r = requests.patch(f"{API}/org/url-tiles/{tile['id']}",
                            json={"allowed_user_ids": [worker_id, admin_id]},
                            headers=admin, timeout=30)
        assert r.status_code == 200, r.text
        assert set(r.json()["allowed_user_ids"]) == {worker_id, admin_id}
        # Unrestrict back → []
        r2 = requests.patch(f"{API}/org/url-tiles/{tile['id']}",
                             json={"allowed_user_ids": []},
                             headers=admin, timeout=30)
        assert r2.status_code == 200, r2.text
        assert r2.json()["allowed_user_ids"] == []
    finally:
        _delete_tile(admin, tile["id"])


def test_non_admin_patch_forbidden_reasserts_132ex(admin_hdr, worker_hdr):
    """Non-admin PATCH → 403. Re-asserts the `.132ex` gate for the
    ACL path so the mutation surface stays admin-only."""
    admin = admin_hdr
    tile = _create_tile(admin, label=".132ey non-admin patch probe")
    try:
        r = requests.patch(f"{API}/org/url-tiles/{tile['id']}",
                            json={"allowed_user_ids": []},
                            headers=worker_hdr, timeout=30)
        assert r.status_code == 403, r.text
    finally:
        _delete_tile(admin, tile["id"])


# ── BE — POST with ACL on create ──────────────────────────────────

def test_admin_post_can_create_with_allowed_user_ids(admin_hdr, ephemeral_users, _mongo):
    """POST accepts `allowed_user_ids` on the create call itself."""
    admin = admin_hdr
    worker_id = _lookup_user_id(_mongo, ephemeral_users["worker"])
    tile = _create_tile(admin, label=".132ey post probe",
                          allowed=[worker_id])
    try:
        assert tile["allowed_user_ids"] == [worker_id]
        r = requests.get(f"{API}/org/url-tiles?include_disabled=true",
                          headers=admin, timeout=30)
        matched = next((t for t in r.json()["tiles"]
                          if t["id"] == tile["id"]), None)
        assert matched is not None
        assert matched["allowed_user_ids"] == [worker_id]
    finally:
        _delete_tile(admin, tile["id"])


# ── BE — eligible-users picker feed ───────────────────────────────

def test_eligible_users_admin_only(admin_hdr, worker_hdr):
    """`GET /org/url-tiles/eligible-users` — admin 200 with list,
    non-admin 403."""
    admin = admin_hdr
    r_admin = requests.get(f"{API}/org/url-tiles/eligible-users",
                            headers=admin, timeout=30)
    assert r_admin.status_code == 200, r_admin.text
    users = r_admin.json()["users"]
    assert isinstance(users, list)
    assert users, "picker feed must not be empty for a real org"
    # Shape check on the first row.
    row = users[0]
    for k in ("id", "name", "email", "is_admin"):
        assert k in row, f"eligible-users payload missing '{k}'"
    # Sorted by name (case-insensitive).
    names = [(u["name"] or "").lower() for u in users]
    assert names == sorted(names), "eligible-users must sort by name"
    # Non-admin gets 403.
    r_worker = requests.get(f"{API}/org/url-tiles/eligible-users",
                             headers=worker_hdr, timeout=30)
    assert r_worker.status_code == 403, r_worker.text
    assert "Tile management is admin-only." in r_worker.text


# ── BE — invalid IDs silently dropped ─────────────────────────────

def test_invalid_user_ids_are_silently_dropped(admin_hdr, ephemeral_users, _mongo):
    """Stale / bogus / cross-org IDs are dropped by the sanitiser.
    Save succeeds; the persisted list only carries the intersection
    with the active users of the caller's org. Documented behaviour
    (chosen over 400 for admin resilience against stale IDs after
    soft-deletes)."""
    admin = admin_hdr
    worker_id = _lookup_user_id(_mongo, ephemeral_users["worker"])
    bogus = f"stale-{uuid.uuid4()}"
    tile = _create_tile(admin, label=".132ey stale-id probe",
                          allowed=[worker_id, bogus, ""])
    try:
        assert tile["allowed_user_ids"] == [worker_id], (
            f"stale IDs must be silently dropped, got {tile['allowed_user_ids']}")
    finally:
        _delete_tile(admin, tile["id"])


# ── Version pin ────────────────────────────────────────────────────

def test_version_pinned_to_132ey_or_higher():
    v = _read(VERSION_JS)
    sw = _read(SW)
    m_v = re.search(r"RUNNING_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", v)
    m_ex = re.search(r"EXPECTED_CACHE_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", v)
    m_sw = re.search(r"CACHE_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", sw)
    for name, m in (("RUNNING_VERSION", m_v),
                     ("EXPECTED_CACHE_VERSION", m_ex),
                     ("CACHE_VERSION", m_sw)):
        assert m and m.group(1) >= "ey", (
            f"{name} suffix must be >= 132ey, got {m and m.group(1)}")

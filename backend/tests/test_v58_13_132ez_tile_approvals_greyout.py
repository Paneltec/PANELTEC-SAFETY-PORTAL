"""v58.13.132ez — Apps Directory approvals: grey-out + Permissions-page editor.

Softens the `.132ey` hide-behaviour to grey-out. Every authenticated
user in the org sees every tile; the payload carries
`approved_for_me` per viewer and `url` is redacted for un-approved
viewers. Credential-vault endpoints also refuse un-approved
callers with `"Not approved for this tile."`. A new batch
`PATCH /api/org/url-tiles/user-approvals` powers the Permissions-page
Approved-tiles panel; a `GET /api/org/url-tiles/user-approvals`
helper feeds the same panel with current state.
"""
from __future__ import annotations

import re
import uuid
from pathlib import Path

import pytest
import requests

from tests.conftest import ADMIN_EMAIL, ADMIN_PWD, API, EPHEMERAL_PWD

pytestmark = pytest.mark.live_db_writes

APP_ROOT = Path(__file__).resolve().parents[2]
FE = APP_ROOT / "frontend" / "src"
BACKEND = APP_ROOT / "backend"
QLS = FE / "components" / "QuickLinksSection.jsx"
HUB = FE / "components" / "AppsDirectoryModal.jsx"
USERS_PAGE = FE / "pages" / "UsersManagement.jsx"
ORG_MOD = BACKEND / "org_url_tiles.py"
TC_MOD = BACKEND / "tile_credentials.py"
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


@pytest.fixture(scope="module")
def admin_hdr():
    return _login(ADMIN_EMAIL, ADMIN_PWD)


@pytest.fixture(scope="module")
def worker_hdr(ephemeral_users):
    return _login(ephemeral_users["worker"], EPHEMERAL_PWD)


@pytest.fixture(scope="module")
def hseq_lead_hdr(ephemeral_users):
    return _login(ephemeral_users["hseq_lead"], EPHEMERAL_PWD)


def _lookup_user_id(_mongo, email: str) -> str:
    doc = _mongo.users.find_one({"email": email}, {"_id": 0, "id": 1})
    assert doc, f"user {email} not found"
    return doc["id"]


def _create_tile(hdr, *, label, allowed=None, url="https://example.com/"):
    body = {"url": url, "label": label}
    if allowed is not None:
        body["allowed_user_ids"] = allowed
    r = requests.post(f"{API}/org/url-tiles", json=body, headers=hdr,
                       timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def _delete_tile(hdr, tid):
    requests.delete(f"{API}/org/url-tiles/{tid}", headers=hdr, timeout=30)


def _tile_from_list(hdr, tid, params=""):
    r = requests.get(f"{API}/org/url-tiles{params}", headers=hdr, timeout=30)
    assert r.status_code == 200, r.text
    return next((t for t in r.json()["tiles"] if t["id"] == tid), None)


# ── FE source-pins ────────────────────────────────────────────────

def test_frontend_grey_out_wired_across_tile_surfaces():
    """All three tile-rendering components short-circuit interaction
    and swap to a greyed style when `approved_for_me === false`."""
    for path in (QLS, HUB, FE / "pages" / "AppsDirectory.jsx",
                  FE / "pages" / "QuickLinks.jsx"):
        src = _read(path)
        assert "approved_for_me" in src, f"{path.name}: approved flag not wired"
        assert "opacity-40" in src and "grayscale" in src, (
            f"{path.name}: greyed-out visual classes missing")
        assert "Not approved" in src, (
            f"{path.name}: 'Not approved' copy missing")


def test_permissions_page_has_approved_tiles_panel():
    src = _read(USERS_PAGE)
    assert "UserApprovedTilesPanel" in src
    assert "user-approved-tiles-panel" in src
    assert "user-approved-tiles-save" in src
    assert "user-approved-tiles-list" in src
    # Public tiles rendered checked-and-disabled with helper hint.
    assert "Public — everyone" in src
    assert "Paneltec Group · Apps Directory" in src
    # Batch endpoint wired.
    assert "/org/url-tiles/user-approvals" in src


# ── BE — approved_for_me + URL redaction ──────────────────────────

def test_public_tile_approved_for_everyone(admin_hdr, worker_hdr):
    admin_probe = _create_tile(admin_hdr, label=".132ez public probe")
    try:
        for hdr in (admin_hdr, worker_hdr):
            t = _tile_from_list(hdr, admin_probe["id"])
            assert t is not None
            assert t["approved_for_me"] is True
            assert t["url"] == "https://example.com/"
    finally:
        _delete_tile(admin_hdr, admin_probe["id"])


def test_restricted_tile_listed_user_approved(admin_hdr, worker_hdr, _mongo, ephemeral_users):
    worker_id = _lookup_user_id(_mongo, ephemeral_users["worker"])
    tile = _create_tile(admin_hdr, label=".132ez restricted listed",
                          allowed=[worker_id])
    try:
        # Worker (listed) — visible with full URL.
        seen = _tile_from_list(worker_hdr, tile["id"])
        assert seen is not None
        assert seen["approved_for_me"] is True
        assert seen["url"] == "https://example.com/"
    finally:
        _delete_tile(admin_hdr, tile["id"])


def test_restricted_tile_unlisted_user_greyed_and_redacted(admin_hdr, hseq_lead_hdr, _mongo, ephemeral_users):
    """Un-approved user sees the tile in the response with
    `approved_for_me=False` and the `url` redacted to empty."""
    worker_id = _lookup_user_id(_mongo, ephemeral_users["worker"])
    tile = _create_tile(admin_hdr, label=".132ez restricted unlisted",
                          allowed=[worker_id])
    try:
        seen = _tile_from_list(hseq_lead_hdr, tile["id"])
        assert seen is not None, (
            "un-approved viewer must STILL see the tile (grey-out UX)")
        assert seen["approved_for_me"] is False
        assert seen["url"] == "", (
            f"un-approved viewer must get redacted URL, got {seen['url']!r}")
    finally:
        _delete_tile(admin_hdr, tile["id"])


def test_strict_admin_rule_admin_off_list_is_unapproved(admin_hdr, _mongo, ephemeral_users):
    """Admin off-list gets `approved_for_me=False` too. Include URL
    redaction check on the regular list; admin Manage view
    (`include_disabled=true`) MUST still return full URL for editing."""
    worker_id = _lookup_user_id(_mongo, ephemeral_users["worker"])
    tile = _create_tile(admin_hdr, label=".132ez strict admin",
                          allowed=[worker_id])
    try:
        # Regular list — admin off-list, greyed + redacted.
        seen = _tile_from_list(admin_hdr, tile["id"])
        assert seen is not None
        assert seen["approved_for_me"] is False
        assert seen["url"] == ""
        # Manage view — admin sees full detail regardless of ACL.
        managed = _tile_from_list(admin_hdr, tile["id"],
                                    params="?include_disabled=true")
        assert managed is not None
        assert managed["approved_for_me"] is False, (
            "flag must still tell the truth in Manage view")
        assert managed["url"] == "https://example.com/", (
            "Manage view MUST NOT redact URL — admins need to edit")
    finally:
        _delete_tile(admin_hdr, tile["id"])


# ── BE — credential-vault approval gate ───────────────────────────

def test_credential_vault_blocked_when_admin_off_list(admin_hdr, _mongo, ephemeral_users):
    """`.132ev` credential vault refuses reveal / copy-field / GET /
    PUT / DELETE when the admin is not on the tile's ACL. Public
    tiles skip the check (public = approved)."""
    worker_id = _lookup_user_id(_mongo, ephemeral_users["worker"])
    tile = _create_tile(admin_hdr, label=".132ez vault gate probe",
                          allowed=[worker_id])
    try:
        endpoints = [
            ("GET", f"{API}/tile-credentials/{tile['id']}", None),
            ("PUT", f"{API}/tile-credentials/{tile['id']}",
             {"username": "x", "password": "y"}),
            ("DELETE", f"{API}/tile-credentials/{tile['id']}", None),
            ("POST", f"{API}/tile-credentials/{tile['id']}/reveal", None),
            ("POST", f"{API}/tile-credentials/{tile['id']}/copy-field",
             {"field": "password"}),
        ]
        for method, url, body in endpoints:
            r = requests.request(method, url, json=body,
                                   headers=admin_hdr, timeout=30)
            assert r.status_code == 403, (
                f"{method} {url} expected 403, got {r.status_code}: {r.text}")
            assert "Not approved for this tile." in r.text, (
                f"{method} {url} detail mismatch: {r.text}")
    finally:
        _delete_tile(admin_hdr, tile["id"])


def test_credential_vault_allowed_when_admin_on_list(admin_hdr, _mongo):
    """Same endpoints work 2xx once the admin adds themselves to the
    ACL — proves the gate is per-tile, not blanket."""
    admin_id = _lookup_user_id(_mongo, ADMIN_EMAIL)
    tile = _create_tile(admin_hdr, label=".132ez vault admin-on-list",
                          allowed=[admin_id])
    try:
        r = requests.put(f"{API}/tile-credentials/{tile['id']}",
                          json={"username": "u", "password": "p"},
                          headers=admin_hdr, timeout=30)
        assert r.status_code == 200, r.text
        r2 = requests.post(f"{API}/tile-credentials/{tile['id']}/reveal",
                            headers=admin_hdr, timeout=30)
        assert r2.status_code == 200, r2.text
        assert r2.json()["password"] == "p"
        requests.delete(f"{API}/tile-credentials/{tile['id']}",
                          headers=admin_hdr, timeout=30)
    finally:
        _delete_tile(admin_hdr, tile["id"])


# ── BE — user-approvals GET/PATCH ─────────────────────────────────

def test_user_approvals_get_admin_only(admin_hdr, worker_hdr, _mongo, ephemeral_users):
    worker_id = _lookup_user_id(_mongo, ephemeral_users["worker"])
    admin_id = _lookup_user_id(_mongo, ADMIN_EMAIL)
    pub = _create_tile(admin_hdr, label=".132ez ua-pub")
    priv = _create_tile(admin_hdr, label=".132ez ua-priv",
                          allowed=[worker_id, admin_id])
    try:
        # Admin 200 with correct breakdown.
        r = requests.get(f"{API}/org/url-tiles/user-approvals?user_id={worker_id}",
                          headers=admin_hdr, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["user_id"] == worker_id
        assert pub["id"] in body["public_tile_ids"]
        assert priv["id"] in body["approved_tile_ids"]
        # Non-admin 403.
        r2 = requests.get(f"{API}/org/url-tiles/user-approvals?user_id={worker_id}",
                           headers=worker_hdr, timeout=30)
        assert r2.status_code == 403, r2.text
        assert "Tile management is admin-only." in r2.text
    finally:
        _delete_tile(admin_hdr, pub["id"])
        _delete_tile(admin_hdr, priv["id"])


def test_user_approvals_patch_semantics(admin_hdr, _mongo, ephemeral_users):
    """PATCH batches the admin's changes: adds to restricted tiles
    that are in the batch, removes from restricted tiles that are
    NOT in the batch, and NO-OPs public tiles regardless of the
    batch's contents."""
    worker_id = _lookup_user_id(_mongo, ephemeral_users["worker"])
    admin_id = _lookup_user_id(_mongo, ADMIN_EMAIL)
    pub = _create_tile(admin_hdr, label=".132ez batch pub")
    # Start restricted-to-admin only — worker NOT on list.
    add_tile = _create_tile(admin_hdr, label=".132ez batch add",
                              allowed=[admin_id])
    # Start restricted-to-worker — should get removed.
    remove_tile = _create_tile(admin_hdr, label=".132ez batch remove",
                                 allowed=[worker_id, admin_id])
    try:
        r = requests.patch(f"{API}/org/url-tiles/user-approvals",
                            json={"user_id": worker_id,
                                  "approved_tile_ids": [pub["id"],
                                                          add_tile["id"]]},
                            headers=admin_hdr, timeout=30)
        assert r.status_code == 200, r.text
        summary = {row["tile_id"]: row for row in r.json()["tiles"]}
        # Public tile still public (batch never restricts a public).
        assert summary[pub["id"]]["is_public"] is True
        assert summary[pub["id"]]["allowed_user_ids"] == []
        # add_tile now includes worker.
        assert worker_id in summary[add_tile["id"]]["allowed_user_ids"]
        assert admin_id in summary[add_tile["id"]]["allowed_user_ids"]
        # remove_tile no longer includes worker.
        assert worker_id not in summary[remove_tile["id"]]["allowed_user_ids"]
        # admin still on remove_tile — batch pivots on worker only.
        assert admin_id in summary[remove_tile["id"]]["allowed_user_ids"]
    finally:
        for t in (pub, add_tile, remove_tile):
            _delete_tile(admin_hdr, t["id"])


def test_user_approvals_patch_forbidden_for_non_admin(admin_hdr, worker_hdr, _mongo, ephemeral_users):
    worker_id = _lookup_user_id(_mongo, ephemeral_users["worker"])
    r = requests.patch(f"{API}/org/url-tiles/user-approvals",
                        json={"user_id": worker_id,
                              "approved_tile_ids": []},
                        headers=worker_hdr, timeout=30)
    assert r.status_code == 403, r.text
    assert "Tile management is admin-only." in r.text


# ── BE — two editors stay in sync ─────────────────────────────────

def test_tile_editor_and_permissions_editor_stay_in_sync(admin_hdr, _mongo, ephemeral_users):
    """Save through the tile editor (`PATCH /url-tiles/{id}` with
    `allowed_user_ids`) and confirm the Permissions batch GET
    reflects it. Then save through the batch and confirm the tile
    GET reflects it."""
    worker_id = _lookup_user_id(_mongo, ephemeral_users["worker"])
    tile = _create_tile(admin_hdr, label=".132ez sync probe")
    try:
        # Editor → restrict to worker.
        r = requests.patch(f"{API}/org/url-tiles/{tile['id']}",
                            json={"allowed_user_ids": [worker_id]},
                            headers=admin_hdr, timeout=30)
        assert r.status_code == 200, r.text
        # Permissions batch sees it.
        r2 = requests.get(f"{API}/org/url-tiles/user-approvals?user_id={worker_id}",
                           headers=admin_hdr, timeout=30)
        assert r2.status_code == 200, r2.text
        assert tile["id"] in r2.json()["approved_tile_ids"]
        # Batch → remove worker (empty batch).
        r3 = requests.patch(f"{API}/org/url-tiles/user-approvals",
                             json={"user_id": worker_id,
                                   "approved_tile_ids": []},
                             headers=admin_hdr, timeout=30)
        assert r3.status_code == 200, r3.text
        # Tile GET reflects it (worker removed → empty ACL → public).
        seen = _tile_from_list(admin_hdr, tile["id"],
                                 params="?include_disabled=true")
        assert seen["allowed_user_ids"] == []
    finally:
        _delete_tile(admin_hdr, tile["id"])


# ── Version pin ────────────────────────────────────────────────────

def test_version_pinned_to_132ez_or_higher():
    v = _read(VERSION_JS)
    sw = _read(SW)
    m_v = re.search(r"RUNNING_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", v)
    m_ex = re.search(r"EXPECTED_CACHE_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", v)
    m_sw = re.search(r"CACHE_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", sw)
    for name, m in (("RUNNING_VERSION", m_v),
                     ("EXPECTED_CACHE_VERSION", m_ex),
                     ("CACHE_VERSION", m_sw)):
        assert m and m.group(1) >= "ez", (
            f"{name} suffix must be >= 132ez, got {m and m.group(1)}")

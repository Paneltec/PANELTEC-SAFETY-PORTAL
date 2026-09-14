"""v58.13.132fe — Hotfix + Approvals rework.

Fixes two shipped-but-broken things:
  1. `.132fd` slider CSS collision + preview not updating.
  2. `.132fc` bulk buttons (already had onClick+type=button; kept
     under the new radio path and re-verified with wiring pins).

Reworks the approvals UX:
  · Checkbox "Approved users only" → radio "Who can see this
    tile?" with `Everyone in the organisation` / `Only selected
    people`.
  · TileRow pill copy `Approved · N users` (amber) →
    `Private · N people` (rose).
  · UsersManagement panel heading `Approved tiles` → `Private
    tiles`.
  · New per-row Quick-lock button pre-fills the editor with
    private + only current admin ticked.

Suite covers both source-pin wiring assertions AND live-API
end-to-end approvals round-trips.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest
import requests

from tests.conftest import ADMIN_EMAIL, ADMIN_PWD, API, EPHEMERAL_PWD

pytestmark = pytest.mark.live_db_writes

APP_ROOT = Path(__file__).resolve().parents[2]
FE = APP_ROOT / "frontend" / "src"
QLS = FE / "components" / "QuickLinksSection.jsx"
WORKERS_PAGE = FE / "pages" / "Workers.jsx"
USERS_PAGE = FE / "pages" / "UsersManagement.jsx"
VERSION_JS = FE / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def _login(email, pwd):
    r = requests.post(f"{API}/auth/login",
                       json={"email": email, "password": pwd},
                       timeout=30)
    if r.status_code == 429:
        pytest.skip("rate-limited")
    assert r.status_code == 200, r.text
    tok = r.json().get("access_token") or r.json().get("token")
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def admin_hdr():
    return _login(ADMIN_EMAIL, ADMIN_PWD)


@pytest.fixture(scope="module")
def worker_hdr(ephemeral_users):
    return _login(ephemeral_users["worker"], EPHEMERAL_PWD)


def _uid(_mongo, email):
    doc = _mongo.users.find_one({"email": email}, {"_id": 0, "id": 1})
    return doc and doc["id"]


def _tile(hdr, tid, params=""):
    r = requests.get(f"{API}/org/url-tiles{params}", headers=hdr, timeout=30)
    assert r.status_code == 200, r.text
    return next((t for t in r.json()["tiles"] if t["id"] == tid), None)


# ── FE wiring: slider fix ─────────────────────────────────────────

def test_slider_wiring_and_layout():
    src = _read(WORKERS_PAGE)
    # onChange handler references the state setter — NOT a no-op.
    assert re.search(r'type="range"[\s\S]{0,400}onChange=\{\(e\) => onChangeOffsetY\(Number\(e\.target\.value\)\)\}', src), (
        "range input must be wired to onChangeOffsetY setter")
    # objectPosition is dynamic (template string interpolating the state var).
    assert 'objectPosition: `50% ${effectiveOffset}%`' in src
    # Label + Reset row uses proper flex layout with gap — no
    # collision. `whitespace-nowrap` on both prevents text
    # collapsing into a blob.
    assert re.search(
        r'<div className="flex items-center justify-between gap-3">[\s\S]{0,400}Vertical alignment[\s\S]{0,400}Reset to centre',
        src), "label + Reset row must be a flex row with gap"
    # No conflicting `object-center` / `object-top` class on the
    # edit-form img.
    edit_img_block = src[src.find('data-testid="worker-edit-photo"') - 400
                          :src.find('data-testid="worker-edit-photo"') + 200]
    assert "object-center" not in edit_img_block
    assert "object-top" not in edit_img_block


# ── FE wiring: bulk buttons fix ───────────────────────────────────

def test_bulk_buttons_have_type_button_and_onclick():
    """v58.13.132fg supersedes the .132fe admins/users bulk-button
    contract. Now: `Select everyone` + `Clear all`. Both must be
    `type="button"` (never accidentally submitting the enclosing
    form) AND wired to a real setter."""
    src = _read(QLS)
    for tid, handler in (
        ("org-quick-links-editor-select-everyone", "selectEveryone"),
        ("org-quick-links-editor-clear-all", "clearAll"),
    ):
        m = re.search(
            r'<button[^>]*type="button"[^>]*onClick=\{(' + re.escape(handler) + r')\}[^>]*data-testid="' + re.escape(tid) + r'"',
            src, re.DOTALL)
        assert m, (f"button with testid {tid!r} must be a "
                    f"type=button with onClick={{{handler}}}")
    # Handlers are real functions setting the selection state.
    assert re.search(r"const selectEveryone = \(\) => setAllowedUserIds", src)
    assert re.search(r"const clearAll = \(\) => setAllowedUserIds\(\[\]\)", src)
    # Old handlers MUST be gone.
    assert "selectAllAdmins" not in src
    assert "const selectAll = " not in src


# ── FE wiring: radio replaces the checkbox ────────────────────────

def test_radio_replaces_checkbox_toggle():
    src = _read(QLS)
    assert "Who can see this tile?" in src
    # Old checkbox toggle testid gone.
    assert "org-quick-links-editor-restrict-toggle" not in src
    # Two radios sharing the same `name`, wired to `setRestrict`.
    assert re.search(
        r'<input type="radio"\s*name="access-mode"\s*value="public"\s*checked=\{!restrict\}',
        src)
    assert re.search(
        r'<input type="radio"\s*name="access-mode"\s*value="private"\s*checked=\{restrict\}',
        src)
    assert "org-quick-links-editor-access-public" in src
    assert "org-quick-links-editor-access-private" in src


# ── FE wiring: pill re-labelled + quick-lock button ───────────────

def test_pill_renamed_private_and_quick_lock_button_present():
    src = _read(QLS)
    # Private pill (rose) present; "Approved · " gone from
    # the TileRow area.
    assert "Private ·" in src
    # Old amber `Approved · N users` gone.
    assert "Approved · " not in src
    # Quick-lock button testid + tooltip + type=button.
    assert "apps-directory-quick-lock-" in src
    assert "Lock down — restrict this tile to just you" in src
    # Handler mounts editor with `allowed_user_ids: [cuid]`.
    assert re.search(
        r"onQuickLock=\{\(cuid\) => setEditorTile\(\{\s*mode: 'edit',\s*tile: \{ \.\.\.t, allowed_user_ids: \[cuid\] \},",
        src)


def test_permissions_panel_renamed_private_tiles():
    src = _read(USERS_PAGE)
    assert "Private tiles" in src
    # Old heading gone.
    assert re.search(r">\s*Approved tiles\s*<", src) is None


# ── BE — end-to-end approvals round-trips ─────────────────────────

def test_e2e_public_then_private_then_grant_via_batch(admin_hdr, worker_hdr, ephemeral_users, _mongo):
    """Full round-trip: public → private → grant via batch →
    revoke via batch. Verifies both PATCH surfaces write the same
    field."""
    worker_id = _uid(_mongo, ephemeral_users["worker"])
    admin_id = _uid(_mongo, ADMIN_EMAIL)
    # 1) Public.
    r = requests.post(f"{API}/org/url-tiles",
                       json={"url": "https://example.com/",
                             "label": ".132fe e2e"},
                       headers=admin_hdr, timeout=30)
    assert r.status_code == 200, r.text
    tile = r.json()
    try:
        assert tile["allowed_user_ids"] == []
        # Non-admin sees it as approved.
        seen_worker = _tile(worker_hdr, tile["id"])
        assert seen_worker and seen_worker["approved_for_me"] is True

        # 2) PATCH to private → only admin listed.
        # v58.13.132ff: access_mode is authoritative — must be sent
        # explicitly alongside allowed_user_ids for the tile to
        # actually flip to private.
        r2 = requests.patch(f"{API}/org/url-tiles/{tile['id']}",
                             json={"access_mode": "private",
                                   "allowed_user_ids": [admin_id]},
                             headers=admin_hdr, timeout=30)
        assert r2.status_code == 200
        # Worker sees it greyed + URL redacted.
        seen_worker = _tile(worker_hdr, tile["id"])
        assert seen_worker and seen_worker["approved_for_me"] is False
        assert seen_worker["url"] == ""

        # 3) Batch grant Amanda.
        r3 = requests.patch(f"{API}/org/url-tiles/user-approvals",
                             json={"user_id": worker_id,
                                   "approved_tile_ids": [tile["id"]]},
                             headers=admin_hdr, timeout=30)
        assert r3.status_code == 200
        seen_worker = _tile(worker_hdr, tile["id"])
        assert seen_worker and seen_worker["approved_for_me"] is True

        # 4) Batch revoke.
        r4 = requests.patch(f"{API}/org/url-tiles/user-approvals",
                             json={"user_id": worker_id,
                                   "approved_tile_ids": []},
                             headers=admin_hdr, timeout=30)
        assert r4.status_code == 200
        seen_worker = _tile(worker_hdr, tile["id"])
        assert seen_worker and seen_worker["approved_for_me"] is False

        # 5) Public tile no-op — batch never restricts a public.
        pub = requests.post(f"{API}/org/url-tiles",
                             json={"url": "https://example.com/pub",
                                   "label": ".132fe pub"},
                             headers=admin_hdr, timeout=30).json()
        try:
            r5 = requests.patch(f"{API}/org/url-tiles/user-approvals",
                                 json={"user_id": worker_id,
                                       "approved_tile_ids": [pub["id"]]},
                                 headers=admin_hdr, timeout=30)
            assert r5.status_code == 200
            got = _tile(admin_hdr, pub["id"],
                          params="?include_disabled=true")
            assert got["allowed_user_ids"] == [], (
                "batch must NOT restrict a public tile")
        finally:
            requests.delete(f"{API}/org/url-tiles/{pub['id']}",
                              headers=admin_hdr, timeout=30)

        # 6) Strict admin off-list — remove admin from ACL, admin's
        # own list-tiles now shows approved_for_me=false. Send
        # access_mode explicitly per .132ff.
        r6 = requests.patch(f"{API}/org/url-tiles/{tile['id']}",
                             json={"access_mode": "private",
                                   "allowed_user_ids": [worker_id]},
                             headers=admin_hdr, timeout=30)
        assert r6.status_code == 200
        admin_view = _tile(admin_hdr, tile["id"])
        assert admin_view and admin_view["approved_for_me"] is False
    finally:
        requests.delete(f"{API}/org/url-tiles/{tile['id']}",
                          headers=admin_hdr, timeout=30)


# ── Version pin ───────────────────────────────────────────────────

def test_version_pinned_to_132fe_or_higher():
    v = _read(VERSION_JS)
    sw = _read(SW)
    m_v = re.search(r"RUNNING_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", v)
    m_ex = re.search(r"EXPECTED_CACHE_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", v)
    m_sw = re.search(r"CACHE_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", sw)
    for name, m in (("RUNNING_VERSION", m_v),
                     ("EXPECTED_CACHE_VERSION", m_ex),
                     ("CACHE_VERSION", m_sw)):
        assert m and m.group(1) >= "fe", (
            f"{name} suffix must be >= 132fe, got {m and m.group(1)}")

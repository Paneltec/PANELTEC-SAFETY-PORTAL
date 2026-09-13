"""v58.13.132ex — Apps Directory · Tile Management admin-gate.

Bug (Stephen): Amanda (non-admin) reached "Manage tiles" through Org
Settings → Apps Directory · Tile management with no visible gate.

Scope:
  · FE: the "Manage tiles" button in `QuickLinksSection.jsx` is
    greyed-out + `disabled` + tooltip "Admin only" + click is a
    no-op for non-admins. Admins see it live and clickable.
  · BE: mutating endpoints in `org_url_tiles.py` and
    `tile_credentials.py` refuse non-admin with HTTP 403 + detail
    "Tile management is admin-only." (defense-in-depth — was
    already `_admin(user)`-guarded, just tightened wording).
  · Read endpoints stay open to any authenticated user.
"""
from __future__ import annotations

from pathlib import Path

import pytest
import requests

from tests.conftest import API, EPHEMERAL_PWD

pytestmark = pytest.mark.live_db_writes

APP_ROOT = Path(__file__).resolve().parents[2]
FE = APP_ROOT / "frontend" / "src"
BACKEND = APP_ROOT / "backend"

QLS = FE / "components" / "QuickLinksSection.jsx"
ORG_MOD = BACKEND / "org_url_tiles.py"
TC_MOD = BACKEND / "tile_credentials.py"
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


def _non_admin_hdr(ephemeral_users, role: str = "worker"):
    """Log in as an ephemeral non-admin (worker by default — closest
    parity with Amanda). Skip on rate-limit."""
    email = ephemeral_users[role]
    r = requests.post(f"{API}/auth/login",
                       json={"email": email, "password": EPHEMERAL_PWD},
                       timeout=30)
    if r.status_code == 429:
        pytest.skip("rate-limited by auth throttle — retry later")
    assert r.status_code == 200, r.text
    t = r.json().get("access_token") or r.json().get("token")
    return {"Authorization": f"Bearer {t}"}


# ── FE source-pins ────────────────────────────────────────────────

def test_manage_tiles_button_is_admin_gated_in_source():
    """The FE Manage-tiles button must be `disabled` + carry
    "Admin only" tooltip + `pointer-events-none` for non-admins.
    Also gates the manager modal so a rogue state can't bypass."""
    src = _read(QLS)
    # Permission hook wired.
    assert "useCan" in src
    assert "can('users', 'edit')" in src or 'can("users", "edit")' in src
    # Button attributes: disabled + aria-disabled + tooltip.
    assert "disabled={!isAdmin}" in src
    assert 'aria-disabled={!isAdmin}' in src
    assert "'Admin only'" in src or '"Admin only"' in src
    # Visual greyed-out class combo when non-admin.
    assert "opacity-50" in src
    assert "cursor-not-allowed" in src
    assert "pointer-events-none" in src
    # data-testid preserved for click-through smoke.
    assert 'data-testid="org-quick-links-manage-btn"' in src
    # Manager modal only mounts when isAdmin.
    assert "isAdmin && managerOpen" in src
    # Click handler short-circuits for non-admins.
    assert "if (isAdmin) setManagerOpen(true)" in src


# ── BE guard detail strings ────────────────────────────────────────

def test_backend_admin_guards_use_clear_detail():
    for module in (ORG_MOD, TC_MOD):
        src = _read(module)
        assert 'detail="Tile management is admin-only."' in src, (
            f"{module.name}: `_admin` must raise the shared clear "
            f"detail string.")


# ── BE live 403s for non-admin ────────────────────────────────────

def test_non_admin_403_on_url_tiles_writes(ephemeral_users):
    """Non-admin (worker) receives 403 on every write endpoint."""
    hdr = _non_admin_hdr(ephemeral_users)
    r_create = requests.post(f"{API}/org/url-tiles",
                              json={"url": "https://example.com",
                                    "label": "amanda-probe"},
                              headers=hdr, timeout=30)
    assert r_create.status_code == 403, r_create.text
    assert "Tile management is admin-only." in r_create.text
    r_patch = requests.patch(f"{API}/org/url-tiles/does-not-matter",
                              json={"label": "nope"},
                              headers=hdr, timeout=30)
    assert r_patch.status_code == 403, r_patch.text
    r_del = requests.delete(f"{API}/org/url-tiles/does-not-matter",
                             headers=hdr, timeout=30)
    assert r_del.status_code == 403, r_del.text
    r_reorder = requests.post(f"{API}/org/url-tiles/reorder",
                               json={"tiles": []},
                               headers=hdr, timeout=30)
    assert r_reorder.status_code == 403, r_reorder.text
    r_icon = requests.post(f"{API}/org/url-tiles/fetch-icon",
                            json={"url": "https://example.com"},
                            headers=hdr, timeout=30)
    assert r_icon.status_code == 403, r_icon.text


def test_non_admin_403_on_tile_credentials_writes(ephemeral_users):
    """Non-admin (worker) receives 403 on every credential-vault
    write endpoint."""
    hdr = _non_admin_hdr(ephemeral_users)
    tile_id = "unused-tile-id-because-guard-fires-first"
    r_get = requests.get(f"{API}/tile-credentials/{tile_id}",
                          headers=hdr, timeout=30)
    assert r_get.status_code == 403, r_get.text
    r_put = requests.put(f"{API}/tile-credentials/{tile_id}",
                          json={"username": "u", "password": "p"},
                          headers=hdr, timeout=30)
    assert r_put.status_code == 403, r_put.text
    r_del = requests.delete(f"{API}/tile-credentials/{tile_id}",
                             headers=hdr, timeout=30)
    assert r_del.status_code == 403, r_del.text
    r_reveal = requests.post(f"{API}/tile-credentials/{tile_id}/reveal",
                              headers=hdr, timeout=30)
    assert r_reveal.status_code == 403, r_reveal.text
    r_copy = requests.post(f"{API}/tile-credentials/{tile_id}/copy-field",
                            json={"field": "password"},
                            headers=hdr, timeout=30)
    assert r_copy.status_code == 403, r_copy.text


def test_non_admin_200_on_url_tiles_list(ephemeral_users):
    """Read/list endpoint stays open to any authenticated user."""
    hdr = _non_admin_hdr(ephemeral_users)
    r = requests.get(f"{API}/org/url-tiles", headers=hdr, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "tiles" in body and isinstance(body["tiles"], list)


def test_admin_200_on_url_tiles_writes():
    """Full admin write smoke — create → patch → delete round-trip
    to prove the tightened detail string didn't break the happy
    path."""
    hdr = _admin_hdr()
    r_create = requests.post(f"{API}/org/url-tiles",
                              json={"url": "https://example.com/",
                                    "label": ".132ex admin probe"},
                              headers=hdr, timeout=30)
    assert r_create.status_code == 200, r_create.text
    tile = r_create.json()
    tid = tile["id"]
    try:
        r_patch = requests.patch(f"{API}/org/url-tiles/{tid}",
                                  json={"label": ".132ex admin probe (renamed)"},
                                  headers=hdr, timeout=30)
        assert r_patch.status_code == 200, r_patch.text
        assert r_patch.json()["label"].endswith("(renamed)")
    finally:
        r_del = requests.delete(f"{API}/org/url-tiles/{tid}",
                                 headers=hdr, timeout=30)
        assert r_del.status_code == 200, r_del.text


# ── Version-sync ──────────────────────────────────────────────────

def test_version_pinned_to_132ex_or_higher():
    import re
    v = _read(VERSION_JS)
    sw = _read(SW)
    m_v = re.search(r"RUNNING_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", v)
    m_ex = re.search(r"EXPECTED_CACHE_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", v)
    m_sw = re.search(r"CACHE_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", sw)
    assert m_v and m_v.group(1) >= "ex", (
        f"RUNNING_VERSION suffix must be >= 132ex, got {m_v and m_v.group(1)}")
    assert m_ex and m_ex.group(1) >= "ex", (
        f"EXPECTED_CACHE_VERSION suffix must be >= 132ex, got {m_ex and m_ex.group(1)}")
    assert m_sw and m_sw.group(1) >= "ex", (
        f"CACHE_VERSION suffix must be >= 132ex, got {m_sw and m_sw.group(1)}")

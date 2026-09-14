"""v58.13.132ff — Eligible-users error-state hotfix + explicit
`access_mode` on tiles.

Two things being locked here:

1. **Frontend error state** on the TileEditor's user-picker.
   The `.132ez` picker fetches `/org/url-tiles/eligible-users`. When
   the request never resolves (dev-tunnel hang, ingress drop, or
   backend hiccup), the modal previously stayed forever on
   "Loading users…" with no way out. `.132ff` adds a 10s timeout,
   a copy-friendly error line ("Couldn't load user list.") and a
   Retry button that resets `eligibleUsers` + `eligibleError` so
   the effect re-fires.

2. **Backend `access_mode` field** on `org_url_tiles`. Previously
   the tile's public-vs-private semantics were INFERRED at read
   time from `len(allowed_user_ids)`. That meant a private tile
   with an intentionally empty ACL ("hide from everyone until I
   pick") had no way to persist. `.132ff` introduces an explicit
   `"public" | "private"` field driven by the new radio group, with
   backwards-compat inference for pre-.132ff rows.
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
BE_TILES = APP_ROOT / "backend" / "org_url_tiles.py"
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


# ── FE source-pins: timeout + retry + error copy ─────────────────

def test_editor_has_10s_timeout_guard():
    src = _read(QLS)
    # setTimeout guarding the eligible-users fetch.
    m = re.search(
        r"const timeoutId = setTimeout\(\(\) => \{[\s\S]{0,300}"
        r"setEligibleError\('Timed out loading users\.'\)"
        r"[\s\S]{0,200}\}, 10000\);",
        src)
    assert m, "TileEditor must arm a 10s timeout that flips picker to error state"
    # Timeout cleared in both success and cancel paths.
    assert src.count("clearTimeout(timeoutId)") >= 2, (
        "clearTimeout must fire on success AND on cleanup/cancel")


def test_editor_has_retry_button():
    src = _read(QLS)
    # Retry button testid.
    assert "org-quick-links-editor-users-retry" in src
    # Handler resets state slots AND bumps retryTick so the effect
    # re-fires even when the previous run left eligibleUsers empty.
    assert re.search(
        r"onClick=\{\(\) => \{\s*setEligibleUsers\(\[\]\);\s*"
        r"setEligibleError\(null\);\s*setRetryTick\(\(n\) => n \+ 1\);\s*\}\}",
        src), "Retry click must clear state AND bump retryTick"


def test_effect_deps_omit_eligibleLoading():
    """v58.13.132ff root cause: the eligible-users effect had
    `eligibleLoading` in its dependency array. The very act of
    calling `setEligibleLoading(true)` inside the effect triggered
    a cleanup → cancelled=true → the fetch resolved but the state
    updater bailed out via `if (cancelled) return;`. Result: the
    picker sat forever on "Loading users…" for admins on the fixed
    (Cloudflare-tunnelled) preview host. Fix: drop `eligibleLoading`
    from the deps, add a `retryTick` counter for the Retry button
    to re-fire the effect explicitly.
    """
    src = _read(QLS)
    # retryTick state declared.
    assert re.search(r"const \[retryTick, setRetryTick\] = useState\(0\);", src)
    # Effect deps: `[restrict, eligibleUsers.length, retryTick]`
    # — `eligibleLoading` must NOT be in there.
    m = re.search(
        r"\}, \[restrict, eligibleUsers\.length, retryTick\]\);",
        src)
    assert m, "effect deps must be [restrict, eligibleUsers.length, retryTick]"
    # Sanity: `eligibleLoading` no longer appears in the effect's
    # dep array anywhere.
    for m2 in re.finditer(r"\}, \[[^\]]*\]\);", src):
        assert "eligibleLoading" not in m2.group(0), (
            f"dep array {m2.group(0)!r} must not include eligibleLoading")


def test_editor_error_copy_is_user_friendly():
    src = _read(QLS)
    # New copy line present verbatim.
    assert "Couldn't load user list." in src
    # `apiError() || "Couldn't load user list."` fallback.
    assert re.search(
        r"apiError\(err\)\s*\|\|\s*\"Couldn't load user list\.\"",
        src), "catch handler must fall back to friendly copy"


# ── FE source-pins: access_mode wiring ───────────────────────────

def test_editor_initial_state_prefers_access_mode_over_inference():
    src = _read(QLS)
    # `restrict` initial state honours tile.access_mode when present,
    # falling back to len(allowed) inference.
    assert re.search(
        r"useState\(\s*tile\?\.access_mode\s*\?\s*"
        r"tile\.access_mode === 'private'\s*:\s*"
        r"initialAllowed\.length > 0\)",
        src), ("initial restrict state must prefer access_mode "
                "over ACL-length inference")


def test_editor_save_payload_includes_access_mode():
    src = _read(QLS)
    # Save payload carries an explicit access_mode.
    assert re.search(
        r"access_mode:\s*restrict\s*\?\s*'private'\s*:\s*'public'",
        src), "save payload must carry access_mode driven by restrict flag"


# ── BE source-pins: model + response + writer ─────────────────────

def test_tilein_and_tilepatch_accept_access_mode():
    src = _read(BE_TILES)
    # Both request models expose Optional[str] access_mode.
    assert re.search(
        r"class TileIn\(BaseModel\):[\s\S]{0,800}"
        r"access_mode:\s*Optional\[str\]\s*=\s*None",
        src), "TileIn must accept optional access_mode"
    assert re.search(
        r"class TilePatch\(BaseModel\):[\s\S]{0,800}"
        r"access_mode:\s*Optional\[str\]\s*=\s*None",
        src), "TilePatch must accept optional access_mode"


def test_out_projection_includes_access_mode_with_bc_inference():
    src = _read(BE_TILES)
    # Backwards-compat inference: missing stored mode → private if
    # ACL non-empty, else public.
    assert re.search(
        r"stored_mode = doc\.get\(\"access_mode\"\)[\s\S]{0,200}"
        r"stored_mode = \"private\" if allowed else \"public\"",
        src), "_out must infer access_mode for pre-.132ff rows"
    # approved_for_me now keyed off stored_mode == "public" instead
    # of empty-ACL implication.
    assert re.search(
        r"approved = \(stored_mode == \"public\"\) or \(viewer_id in allowed\)",
        src)
    # Response body carries access_mode.
    assert re.search(
        r"\"access_mode\":\s*stored_mode", src)


def test_create_and_update_accept_access_mode():
    src = _read(BE_TILES)
    # POST /url-tiles path writes access_mode with enum-guard.
    assert re.search(
        r"body\.access_mode\s*if\s*body\.access_mode\s*in\s*"
        r"\(\"public\",\s*\"private\"\)\s*else\s*"
        r"\(\"private\" if body\.allowed_user_ids else \"public\"\)",
        src), "create_tile must accept + guard access_mode"
    # PATCH path also accepts access_mode.
    assert re.search(
        r"if body\.access_mode is not None:[\s\S]{0,200}"
        r"updates\[\"access_mode\"\] = body\.access_mode",
        src), "update_tile must accept access_mode"


# ── BE behavioural round-trip via live API ────────────────────────

def test_e2e_access_mode_round_trip(admin_hdr):
    """Create a tile, PATCH access_mode → private + empty ACL,
    verify it persists (this was the pre-.132ff broken case where
    empty-ACL private couldn't be distinguished from public)."""
    r = requests.post(f"{API}/org/url-tiles",
                       json={"url": "https://example.com/.132ff",
                             "label": ".132ff e2e",
                             "access_mode": "private",
                             "allowed_user_ids": []},
                       headers=admin_hdr, timeout=30)
    assert r.status_code == 200, r.text
    tile = r.json()
    tid = tile["id"]
    try:
        # Create honoured access_mode.
        assert tile["access_mode"] == "private", tile
        assert tile["allowed_user_ids"] == []
        # PATCH back to public.
        r2 = requests.patch(f"{API}/org/url-tiles/{tid}",
                             json={"access_mode": "public"},
                             headers=admin_hdr, timeout=30)
        assert r2.status_code == 200
        assert r2.json()["access_mode"] == "public"
        # PATCH to private with a valid ACL.
        r3 = requests.patch(f"{API}/org/url-tiles/{tid}",
                             json={"access_mode": "private",
                                   "allowed_user_ids": []},
                             headers=admin_hdr, timeout=30)
        assert r3.status_code == 200
        assert r3.json()["access_mode"] == "private"
    finally:
        requests.delete(f"{API}/org/url-tiles/{tid}",
                          headers=admin_hdr, timeout=30)


def test_eligible_users_endpoint_reachable(admin_hdr):
    """Basic smoke — the endpoint the picker calls must return a
    non-empty user list for an admin caller in a seeded org."""
    r = requests.get(f"{API}/org/url-tiles/eligible-users",
                       headers=admin_hdr, timeout=15)
    assert r.status_code == 200, r.text
    users = r.json().get("users") or []
    assert isinstance(users, list) and len(users) > 0
    # Every entry carries the shape the picker expects.
    for u in users[:5]:
        assert set(("id", "name", "email", "is_admin")).issubset(u.keys())


# ── Version pin ───────────────────────────────────────────────────

def test_version_pinned_to_132ff_or_higher():
    v = _read(VERSION_JS)
    sw = _read(SW)
    m_v = re.search(r"RUNNING_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", v)
    m_ex = re.search(r"EXPECTED_CACHE_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", v)
    m_sw = re.search(r"CACHE_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", sw)
    for name, m in (("RUNNING_VERSION", m_v),
                     ("EXPECTED_CACHE_VERSION", m_ex),
                     ("CACHE_VERSION", m_sw)):
        assert m and m.group(1) >= "ff", (
            f"{name} suffix must be >= 132ff, got {m and m.group(1)}")

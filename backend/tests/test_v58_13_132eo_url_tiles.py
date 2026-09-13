"""v58.13.132eo — Admin-managed URL tiles (Quick Links) on Org Settings.

Backend contract:
  · Router mounted at /api/org/url-tiles.
  · 5 endpoints (GET / POST / PATCH / DELETE / POST reorder).
  · Admin-only (403 for non-admin).
  · URL validation rejects non-http/https schemes.
  · Reorder persists new order rank.

Frontend contract:
  · <QuickLinksSection /> imported + admin-gated on Org Settings.
  · "Manage tiles" button opens popup.
  · Popup renders grid + Add tile + per-tile edit/delete.
  · Preview tiles use target="_blank" rel="noopener noreferrer".
  · Drag-to-reorder wired to /reorder endpoint via dnd-kit.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest
import requests

from tests.conftest import API, EPHEMERAL_EMAIL_PREFIX, EPHEMERAL_PWD

pytestmark = pytest.mark.live_db_writes


def _admin_hdr():
    r = requests.post(f"{API}/auth/login",
                       json={"email": "stephen@paneltec.com.au",
                             "password": "Mcgstephen50#"}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"admin login unavailable: {r.status_code} {r.text[:200]}")
    t = r.json().get("access_token") or r.json().get("token")
    return {"Authorization": f"Bearer {t}"}


def _hseq_hdr(ephemeral_users):
    """Log in as the ephemeral hseq_lead user (non-admin, seeded by
    conftest.ephemeral_users). Skip on rate-limit."""
    email = ephemeral_users["hseq_lead"]
    r = requests.post(f"{API}/auth/login",
                       json={"email": email, "password": EPHEMERAL_PWD},
                       timeout=30)
    if r.status_code == 429:
        pytest.skip("rate-limited by auth throttle — retry later")
    assert r.status_code == 200, r.text
    t = r.json().get("access_token") or r.json().get("token")
    return {"Authorization": f"Bearer {t}"}

APP_ROOT = Path(__file__).resolve().parents[2]
FE = APP_ROOT / "frontend" / "src"
BACKEND = APP_ROOT / "backend"

MODULE = BACKEND / "org_url_tiles.py"
SERVER = BACKEND / "server.py"
QLS = FE / "components" / "QuickLinksSection.jsx"
ORGP = FE / "pages" / "OrgSettings.jsx"
VERSION_JS = FE / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


# ── Backend module + wiring ───────────────────────────────────────

def test_backend_module_exists_with_prefix():
    src = _read(MODULE)
    assert 'router = APIRouter(prefix="/org/url-tiles"' in src


def test_backend_server_mounts_router():
    src = _read(SERVER)
    assert "from org_url_tiles import router as org_url_tiles_router" in src
    assert "api.include_router(org_url_tiles_router)" in src


def test_backend_defines_all_five_endpoints():
    src = _read(MODULE)
    # GET list
    assert '@router.get("")' in src
    # POST create
    assert '@router.post("")' in src
    # PATCH update
    assert '@router.patch("/{tile_id}")' in src
    # DELETE hard delete
    assert '@router.delete("/{tile_id}")' in src
    # POST reorder
    assert '@router.post("/reorder")' in src


def test_backend_admin_guard_helper_present():
    src = _read(MODULE)
    assert "_admin(user)" in src
    # Verify each MUTATING endpoint handler contains an `_admin(user)`
    # call inside its own scope. v58.13.132eq — `list_tiles` is
    # intentionally OPEN to any authenticated user so the read-only
    # Quick Links sidebar page can render for all roles; only
    # mutations remain admin-only.
    parts = re.split(r"\nasync def ", src)
    handler_map = {p.split("(", 1)[0]: p for p in parts if p and "(" in p}
    for handler in ("create_tile", "update_tile",
                     "delete_tile", "reorder_tiles"):
        assert handler in handler_map, f"{handler} not found in module"
        body = handler_map[handler]
        assert "_admin(user)" in body, (
            f"{handler} must invoke _admin(user) somewhere in its body")


def test_backend_url_validator_rejects_non_http_schemes():
    src = _read(MODULE)
    assert "_ALLOWED_SCHEMES = {\"http\", \"https\"}" in src
    assert "URL scheme must be http or https" in src


# ── Live API smoke: CRUD + admin-guard + URL validation ──────────

def test_live_api_crud_roundtrip():
    """Full CRUD lifecycle against the live backend using Stephen's
    admin token. Idempotent — cleans up its own tile at the end."""
    hdr = _admin_hdr()
    # Create
    payload = {
        "url": "https://banking.westpac.com.au/wbc/banking/handler?TAM_OP=login",
        "label": "Westpac Banking (pytest)",
        "icon": "🏦",
        "description": "Test tile — safe to delete",
    }
    r = requests.post(f"{API}/org/url-tiles", json=payload, headers=hdr,
                       timeout=30)
    assert r.status_code == 200, r.text
    tile = r.json()
    tile_id = tile["id"]
    assert tile["url"].startswith("https://banking.westpac.com.au")
    assert tile["label"] == "Westpac Banking (pytest)"
    assert tile["icon"] == "🏦"
    try:
        # List includes it
        r2 = requests.get(f"{API}/org/url-tiles", headers=hdr, timeout=30)
        assert r2.status_code == 200
        ids = [t["id"] for t in r2.json()["tiles"]]
        assert tile_id in ids
        # Patch
        r3 = requests.patch(f"{API}/org/url-tiles/{tile_id}",
                             json={"label": "Renamed (pytest)"},
                             headers=hdr, timeout=30)
        assert r3.status_code == 200
        assert r3.json()["label"] == "Renamed (pytest)"
        # Reorder — bump this tile to a high order rank
        r4 = requests.post(f"{API}/org/url-tiles/reorder",
                            json={"tiles": [{"tile_id": tile_id, "order": 42}]},
                            headers=hdr, timeout=30)
        assert r4.status_code == 200
        assert r4.json()["ok"] is True
        assert r4.json()["updated"] >= 1
        # Confirm order landed
        r5 = requests.get(f"{API}/org/url-tiles", headers=hdr, timeout=30)
        row = next((t for t in r5.json()["tiles"] if t["id"] == tile_id), None)
        assert row and row["order"] == 42
    finally:
        # Clean up
        rd = requests.delete(f"{API}/org/url-tiles/{tile_id}", headers=hdr,
                              timeout=30)
        assert rd.status_code == 200


def test_live_api_url_validator_rejects_javascript():
    hdr = _admin_hdr()
    r = requests.post(f"{API}/org/url-tiles",
                       json={"url": "javascript:alert(1)", "label": "XSS"},
                       headers=hdr, timeout=30)
    assert r.status_code == 400
    assert "http or https" in r.text.lower()


def test_live_api_url_validator_rejects_file_scheme():
    hdr = _admin_hdr()
    r = requests.post(f"{API}/org/url-tiles",
                       json={"url": "file:///etc/passwd", "label": "pw"},
                       headers=hdr, timeout=30)
    assert r.status_code == 400


def test_live_api_url_validator_rejects_missing_scheme():
    hdr = _admin_hdr()
    r = requests.post(f"{API}/org/url-tiles",
                       json={"url": "notaurl", "label": "bad"},
                       headers=hdr, timeout=30)
    assert r.status_code == 400


def test_live_api_admin_only_guard(ephemeral_users):
    """Non-admin (hseq_lead) receives 403 on all MUTATING endpoints.
    v58.13.132eq — GET /url-tiles is now readable by any authenticated
    user so the Quick Links sidebar page can render for everyone.
    Mutations (POST / PATCH / DELETE / reorder) stay admin-only."""
    hdr = _hseq_hdr(ephemeral_users)
    # GET is now 200 for non-admin (v58.13.132eq).
    r_list = requests.get(f"{API}/org/url-tiles", headers=hdr, timeout=30)
    assert r_list.status_code == 200, f"list should be 200 for authed user, got {r_list.status_code}"
    r_create = requests.post(
        f"{API}/org/url-tiles",
        json={"url": "https://example.com", "label": "x"},
        headers=hdr, timeout=30)
    assert r_create.status_code == 403, f"create should 403, got {r_create.status_code}"
    r_patch = requests.patch(f"{API}/org/url-tiles/anything",
                               json={"label": "x"}, headers=hdr, timeout=30)
    assert r_patch.status_code == 403, f"patch should 403, got {r_patch.status_code}"
    r_del = requests.delete(f"{API}/org/url-tiles/anything",
                              headers=hdr, timeout=30)
    assert r_del.status_code == 403, f"delete should 403, got {r_del.status_code}"
    r_reord = requests.post(f"{API}/org/url-tiles/reorder",
                              json={"tiles": []}, headers=hdr, timeout=30)
    assert r_reord.status_code == 403, f"reorder should 403, got {r_reord.status_code}"


# ── Frontend component source-pins ────────────────────────────────

def test_quick_links_component_exists():
    src = _read(QLS)
    assert "export default function QuickLinksSection" in src


def test_quick_links_renders_section_and_manage_button():
    src = _read(QLS)
    assert 'data-testid="org-quick-links-section"' in src
    assert 'data-testid="org-quick-links-manage-btn"' in src
    # Preview grid renders when tiles exist.
    assert 'data-testid="org-quick-links-preview-grid"' in src


def test_preview_tiles_open_in_new_window_safely():
    """Every tile <a> must carry target=_blank AND rel=noopener noreferrer."""
    src = _read(QLS)
    assert 'target="_blank"' in src
    assert 'rel="noopener noreferrer"' in src


def test_manager_popup_has_add_edit_delete_testids():
    src = _read(QLS)
    for tid in (
        "org-quick-links-manager",
        # v58.13.132er — "Add tile" button replaced with the inline
        # Apps Directory add row + `apps-directory-add-btn`.
        "apps-directory-add-btn",
        "org-quick-links-editor-${mode}",
        "org-quick-links-editor-url",
        "org-quick-links-editor-label",
        "org-quick-links-editor-icon",
        "org-quick-links-editor-description",
        "org-quick-links-editor-save",
        "org-quick-links-editor-cancel",
        "org-quick-links-delete-confirm",
        "org-quick-links-delete-confirm-btn",
        "org-quick-links-delete-cancel",
    ):
        assert tid in src, f"missing testid {tid}"


def test_manager_uses_dnd_kit_and_wires_reorder_endpoint():
    """v58.13.132er — Manager redesigned to the Apps Directory table
    (Stephen's reference had no reorder column). Drag-reorder
    intentionally dropped in the redesign; the reorder API endpoint
    remains on the backend for future use but is not wired from the
    FE. This test now asserts the intentional removal."""
    src = _read(QLS)
    assert "@dnd-kit" not in src, (
        "dnd-kit was removed in .132er redesign; must not be re-added "
        "without a design update")
    # The `/reorder` endpoint stays on the server but is no longer
    # called from the manager surface.
    assert "'/org/url-tiles/reorder'" not in src


def test_editor_validates_http_https_client_side():
    src = _read(QLS)
    assert "const CLIENT_URL_RE = /^https?:\\/\\//i" in src
    assert "URL must start with http:// or https://" in src


def test_org_settings_imports_and_mounts_admin_gated():
    src = _read(ORGP)
    assert (
        "import QuickLinksSection from '../components/QuickLinksSection';"
        in src
    )
    assert "{isAdmin && <QuickLinksSection />}" in src


# ── Version-sync ──────────────────────────────────────────────────

def test_version_pinned_to_132eo_or_higher():
    v = _read(VERSION_JS)
    sw = _read(SW)
    m_v = re.search(r"RUNNING_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", v)
    m_sw = re.search(r"CACHE_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", sw)
    assert m_v and m_v.group(1) >= "eo", f"RUNNING_VERSION suffix must be >= 132eo, got {m_v and m_v.group(1)}"
    assert m_sw and m_sw.group(1) >= "eo", f"CACHE_VERSION suffix must be >= 132eo, got {m_sw and m_sw.group(1)}"

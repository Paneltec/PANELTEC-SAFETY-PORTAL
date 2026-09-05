"""v58.13.120c — Fleet & Service Register Phase 3 (frontend page).

Locks the Phase 3 contract as REVISED by v58.13.120f (Option A remount).

  · `pages/FleetRegister.jsx` exists and exports a default component.
  · `App.js` registers the `/app/fleet` route under `MustChangePasswordGuard`
    → `AppShell`.
  · `AppShell.jsx` sidebar carries a "Fleet & Service Register" entry
    gated by `resource: 'assets'` so admins see it during rollout.
  · The page probes `/api/fleet/categories` on mount and shows a
    "coming soon" panel on 404 (feature flag off default).
  · The page composes: FilterTree, RegisterTable, SearchBar.
    v58.13.120f — the inline `FleetDrawer` + `LogServiceModal`
    components were retired; the page now mounts the shared
    `<AssetDrawer />` (7 tabs) instead. Photo upload, Notes autosave,
    and emergent-badge-safe live inside AssetDrawer.jsx now.
  · Reuses `useDeepLinkOpen` from .119 for `?open=<asset_id>`.
  · Print labels still uses the .120a bulk endpoint.
  · Version bumps meet `.120c` in all three canonical files.
"""
from __future__ import annotations
import re
from pathlib import Path

APP_JS = Path("/app/frontend/src/App.js").read_text()
SHELL = Path("/app/frontend/src/components/layout/AppShell.jsx").read_text()
PAGE = Path("/app/frontend/src/pages/FleetRegister.jsx").read_text()
# v58.13.120f — photo / notes / badge-safe contracts moved here.
ASSET_DRAWER = Path("/app/frontend/src/components/AssetDrawer.jsx").read_text()


# ── Route + sidebar wiring ────────────────────────────────────────
def test_app_js_registers_fleet_route():
    assert "import FleetRegister from '@/pages/FleetRegister';" in APP_JS
    assert '<Route path="fleet" element={<FleetRegister />} />' in APP_JS


def test_sidebar_has_fleet_entry_gated_on_assets():
    assert "to: '/app/fleet'" in SHELL
    assert "testid: 'nav-fleet'" in SHELL
    # Uses the shared `resource: 'assets'` gate so the sidebar entry
    # respects the existing view permission during rollout.
    m = re.search(r"to: '/app/fleet'[^}]+resource: 'assets'", SHELL, re.DOTALL)
    assert m, "Fleet sidebar entry missing `resource: 'assets'` gate"


# ── Page structure ────────────────────────────────────────────────
def test_page_probes_categories_and_falls_back_on_404():
    assert "api.get('/fleet/categories')" in PAGE
    # 404 → coming-soon panel; anything else surfaces a toast.
    assert "e?.response?.status === 404" in PAGE
    assert 'data-testid="fleet-coming-soon"' in PAGE


def test_page_composes_expected_subcomponents():
    # v58.13.120f — `FleetDrawer` + `LogServiceModal` retired
    # (superseded by AssetDrawer remount). The three shared page-shell
    # helpers remain in-tree.
    for token in (
        'function FilterTree',
        'function RegisterTable',
        'function SearchBar',
    ):
        assert token in PAGE, f"missing subcomponent: {token}"
    # And AssetDrawer is now imported at the top.
    assert "import AssetDrawer from '../components/AssetDrawer'" in PAGE


def test_page_has_expected_testids():
    # v58.13.120f — inline-drawer/modal testids retired with the
    # components; the shared page-shell testids are retained.
    for tid in (
        'fleet-register-page',
        'fleet-search-container',
        'fleet-search-input',
        'fleet-search-results',
        'fleet-filter-tree',
        'fleet-filter-kind-all',
        'fleet-register-table',
        'fleet-print-labels-btn',
    ):
        assert f'data-testid="{tid}"' in PAGE or f"data-testid={{`{tid}`}}" in PAGE \
            or f"data-testid={{'{tid}'}}" in PAGE, \
            f"missing testid: {tid}"


# ── Deep-link hook is reused (not duplicated) ─────────────────────
def test_page_reuses_use_deep_link_open():
    assert "import useDeepLinkOpen from '../lib/useDeepLinkOpen';" in PAGE
    assert 'useDeepLinkOpen({' in PAGE


# ── Log Service — v58.13.120f: retired inline modal ───────────────
def test_log_service_flow_retired_and_delegated_to_asset_drawer():
    """The inline `LogServiceModal` was retired in .120f. Service
    logging now flows through `AssetDrawer`'s `service_log` tab
    (backed by `AssetServiceTabs::ServiceLogTab`)."""
    assert "function LogServiceModal(" not in PAGE
    assert "function FleetDrawer(" not in PAGE
    assert "ServiceLogTab" in ASSET_DRAWER


# ── Photo upload — v58.13.120f: moved to AssetDrawer PhotoTab ─────
def test_photo_upload_uses_120a_endpoints_with_cap():
    assert 'api.post(`/assets/${asset.id}/photos`' in ASSET_DRAWER
    assert 'api.delete(`/assets/${asset.id}/photos/${photoId}`' in ASSET_DRAWER
    # 10 MB client-side guard.
    assert 'file.size > 10 * 1024 * 1024' in ASSET_DRAWER
    assert 'Image too large (max 10 MB)' in ASSET_DRAWER


# ── Notes — v58.13.120f: retired blur-autosave; AssetDrawer Notes ─
def test_notes_flow_retired_and_delegated_to_asset_drawer():
    """The .120c inline `saveNotes()` blur-autosave was retired in
    .120f alongside the FleetDrawer. AssetDrawer's Notes tab writes
    via the standard Save button (which PUTs the whole asset via
    `/assets/{id}`)."""
    assert "onBlur={saveNotes}" not in PAGE
    # AssetDrawer Save button uses PUT /assets/{id} on submit.
    assert "api.put(`/assets/${asset.id}`" in ASSET_DRAWER


# ── Emergent badge safe zones — v58.13.120f: inherited via shadcn ─
def test_emergent_badge_safe_inherited_via_asset_drawer():
    """The inline FleetDrawer's manual `emergent-badge-safe` opt-ins
    are retired. AssetDrawer + AssetServiceTabs sit inside shadcn
    Dialog/Sheet variants that inherit the safe zone via the .111
    global utility class."""
    # Not required on the retired inline drawer:
    assert PAGE.count('emergent-badge-safe') == 0
    # The utility class is still declared globally:
    assert 'emergent-badge-safe' in Path('/app/frontend/src/index.css').read_text()


# ── Print labels reuses .120a bulk endpoint ───────────────────────
def test_print_labels_calls_bulk_endpoint():
    assert "api.post('/assets/labels/bulk'" in PAGE
    assert "layout: 'avery_l7160'" in PAGE
    assert 'responseType: \'blob\'' in PAGE


# ── Kind pills for all 5 kinds ────────────────────────────────────
def test_kind_pill_covers_five_kinds():
    for k in ('vehicle', 'plant', 'trailer', 'tool', 'container'):
        assert f'{k}:' in PAGE, f"KIND_STYLES missing {k}"


# ── Feature flag default stays off ────────────────────────────────
def test_backend_env_no_longer_pins_flag_off():
    """v58.13.120d — Default flipped to True in the code path. The
    `.env` file no longer needs to carry `FLEET_REGISTER_ENABLED`
    at all (missing → True), though an explicit `false` for
    rollback would still win. Assert that the pre-.120d
    `FLEET_REGISTER_ENABLED=false` line is NOT present anymore."""
    env = Path("/app/backend/.env").read_text()
    assert 'FLEET_REGISTER_ENABLED=false' not in env, (
        ".env still forces the flag off — Phase 4 should have removed it"
    )


# ── Version sync pin ──────────────────────────────────────────────
_TAIL_RE = re.compile(r"paneltec-v[\d.]+\.58\.13\.(\d+)([a-z]?)")


def test_version_bumps_meet_120c():
    for label, path in (
        ("frontend/version.js", "/app/frontend/src/lib/version.js"),
        ("service-worker.js", "/app/frontend/public/service-worker.js"),
        ("mobile/version.ts", "/app/mobile/src/lib/version.ts"),
    ):
        blob = Path(path).read_text()
        tails = [(int(m.group(1)), m.group(2))
                 for m in _TAIL_RE.finditer(blob)]
        assert tails, f"{label} has no version tail"
        highest = max(tails)
        assert highest >= (120, "c"), f"{label} latest tail={highest} < (120, 'c')"

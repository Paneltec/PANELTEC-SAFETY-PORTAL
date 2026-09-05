"""v58.13.120g — Bundled Fleet Drawer punch-list fixes.

Locks the 9 items from the user's post-.120f punch-list:

  1. Drawer header no longer clipped (shrink-0 + explicit two-row layout).
  2. Overview inline edit permission-gated on assets.edit (Save button).
  3. Maintenance History row-click opens a nested sub-modal (z-[80]).
  4. sub_type normalisation script exists + is dry-run by default;
     frontend FilterTree normalises labels client-side.
  5. Explicit "Close" button in the drawer header actions row.
  6. Navixy-only filter checkbox in FilterTree + backend query param.
  7. Per-kind Add-asset "+" button (permission-gated on assets.create);
     row-hover Delete button (permission-gated on assets.delete) with a
     confirm modal.
  8. Tab labels renamed: "Service log" → "Service Log", "Maintenance
     history" → "Maintenance History" (Title Case for consistency).
  9. Photo upload: `Content-Type: multipart/form-data` header removed
     (axios sets the boundary); `<img src>` now carries `?token=<jwt>`
     so the GridFS stream endpoint's auth check passes.

Plus:
  · Version pin ≥ .120g across the 3 canonical version strings.
"""
from __future__ import annotations
import re
from pathlib import Path

FLEET_PAGE = Path("/app/frontend/src/pages/FleetRegister.jsx").read_text()
ASSET_DRAWER = Path("/app/frontend/src/components/AssetDrawer.jsx").read_text()
PMH = Path("/app/frontend/src/components/PlantMaintenanceHistory.jsx").read_text()
FLEET_PY = Path("/app/backend/fleet.py").read_text()
ASSETS_PY = Path("/app/backend/assets.py").read_text()
NORMALISE = Path("/app/backend/scripts/normalize_subtype_v58_13_120g.py").read_text()
VERSION_JS = Path("/app/frontend/src/lib/version.js").read_text()
VERSION_TS = Path("/app/mobile/src/lib/version.ts").read_text()
SERVICE_WORKER = Path("/app/frontend/public/service-worker.js").read_text()


# ── Item 1: header no-clip ────────────────────────────────────────
def test_asset_drawer_header_is_shrink_0():
    """Header must be shrink-0 so flex children below can't collapse it."""
    m = re.search(
        r'data-testid="asset-drawer-header"[^>]*',
        ASSET_DRAWER,
    )
    assert m, "asset-drawer-header testid missing"
    # The container wrapping the header carries shrink-0.
    ctx = ASSET_DRAWER[max(0, m.start() - 200):m.end() + 50]
    assert 'shrink-0' in ctx, "header container must be shrink-0"


def test_asset_drawer_title_uses_break_words_not_truncate():
    """Titles wrap instead of truncating with … so the eyebrow and
    title are never clipped."""
    m = re.search(r'<h2[^>]*font-display[^>]*>{current\?\.name', ASSET_DRAWER)
    assert m
    # No `truncate` on the header title anymore.
    assert 'break-words' in ASSET_DRAWER[m.start():m.start() + 200]


# ── Item 2: Overview inline edit permission-gated ─────────────────
def test_asset_drawer_save_button_permission_gated():
    m = re.search(
        r'<Can resource="assets" action="edit">\s*<button[^>]*data-testid="asset-save"',
        ASSET_DRAWER,
        re.DOTALL,
    )
    assert m, "Save button must be wrapped in <Can resource='assets' action='edit'>"


# ── Item 3: nested sub-modal in Maintenance History ───────────────
def test_maintenance_history_row_opens_sub_modal():
    assert 'pmh-detail-modal' in PMH
    assert 'pmh-detail-modal-close' in PMH
    assert 'pmh-detail-modal-back' in PMH
    # Sub-modal z-index must exceed the drawer's z-[70] so it stacks
    # on top. (className comes BEFORE testid in the JSX source.)
    m = re.search(r'z-\[80\][\s\S]{0,300}?pmh-detail-modal', PMH)
    assert m, "Sub-modal must sit at z-[80] above the drawer"


def test_maintenance_history_row_click_opens_modal_not_inline_expand():
    # `setSelected` replaces the retired `setExpanded`.
    assert 'setSelected' in PMH
    assert 'setExpanded' not in PMH


# ── Item 4: sub_type normalisation script ─────────────────────────
def test_normalise_script_dry_run_by_default():
    """`--commit` is required to write; default is dry-run."""
    assert '"--commit"' in NORMALISE
    assert 'action="store_true"' in NORMALISE
    # Reverse path is present too.
    assert '"--reverse"' in NORMALISE
    # Vac Truck → Vacuum Truck mapping (the user's specific callout).
    assert '"Vac Truck":     "Vacuum Truck"' in NORMALISE
    assert '"vacuum_truck":  "Vacuum Truck"' in NORMALISE


def test_normalise_script_stamps_audit_markers():
    for marker in (
        'sub_type_normalised_v120g',
        'sub_type_before_v120g',
        'sub_type_normalised_at',
    ):
        assert marker in NORMALISE, f"audit marker missing: {marker}"


def test_frontend_filter_tree_normalises_display_labels():
    assert '_SUBTYPE_CANONICAL_DISPLAY' in FLEET_PAGE
    assert 'displaySubtype' in FLEET_PAGE
    assert "'Vac Truck':     'Vacuum Truck'" in FLEET_PAGE


# ── Item 5: explicit Close button in header actions row ───────────
def test_drawer_header_has_explicit_close_back_button():
    assert 'asset-drawer-back' in ASSET_DRAWER
    # Old-style X close still present too (top-right).
    assert 'asset-drawer-close' in ASSET_DRAWER


def test_drawer_footer_carries_emergent_badge_safe():
    """Ensures the Save/Cancel row doesn't hide behind the Emergent
    branding badge."""
    m = re.search(r'emergent-badge-safe[\s\S]{0,300}?data-testid="asset-cancel"', ASSET_DRAWER)
    assert m, "Drawer footer must carry emergent-badge-safe"


# ── Item 6: Navixy-only filter ────────────────────────────────────
def test_fleet_filter_tree_has_navixy_only_checkbox():
    # v58.13.125 — Navixy checkbox superseded by the Data-source
    # radio (Option B from the .125 audit). Testids are constructed
    # via template literal `fleet-filter-source-${opt.key}` so we
    # look for the base pattern instead of a fully-formed testid.
    assert 'fleet-filter-source-${opt.key}' in FLEET_PAGE
    assert 'navixy_only' in FLEET_PAGE


def test_backend_register_accepts_navixy_only_query():
    assert 'navixy_only: bool = Query(False)' in FLEET_PY
    # Applied to the Mongo filter.
    assert '"navixy_device_id"] = {"$nin": [None, ""]}' in FLEET_PY


# ── Item 7: per-kind Add + row-hover Delete ───────────────────────
def test_fleet_filter_add_button_permission_gated():
    assert 'fleet-filter-add-' in FLEET_PAGE
    # `useCan()('assets', 'edit')` gates rendering. There is no
    # `create` action in the permission catalogue — `edit` is what
    # `POST /assets` actually enforces server-side (see
    # `backend/assets.py::create_asset`).
    assert "useCan()('assets', 'edit')" in FLEET_PAGE


def test_fleet_register_delete_button_permission_gated():
    assert 'fleet-register-delete-' in FLEET_PAGE
    assert "useCan()('assets', 'delete')" in FLEET_PAGE
    # Confirm modal wired.
    assert 'fleet-delete-confirm' in FLEET_PAGE
    assert 'fleet-delete-confirm-btn' in FLEET_PAGE
    assert 'fleet-delete-cancel' in FLEET_PAGE
    # Uses the existing DELETE /assets/{id} endpoint.
    assert 'api.delete(`/assets/${pendingDelete.id}`)' in FLEET_PAGE


def test_backend_asset_delete_endpoint_still_registered():
    assert '@router.delete("/{asset_id}"' in ASSETS_PY


# ── Item 8: tab labels renamed ────────────────────────────────────
def test_tab_labels_use_title_case():
    m = re.search(r"key: 'service_log', label: 'Service Log'", ASSET_DRAWER)
    assert m
    m = re.search(r"key: 'maintenance_history', label: 'Maintenance History'", ASSET_DRAWER)
    assert m


# ── Item 9: photo upload fix ──────────────────────────────────────
def test_photo_upload_does_not_set_multipart_content_type():
    """axios adds the boundary; setting it manually strips it."""
    # The old header line must be gone; only the FormData call remains.
    assert "'Content-Type': 'multipart/form-data'" not in ASSET_DRAWER
    # POST call is still present.
    assert 'api.post(`/assets/${asset.id}/photos`, fd)' in ASSET_DRAWER


def test_photo_img_src_appends_token_for_auth():
    assert '_authedSrc' in ASSET_DRAWER
    # <img> uses the authed src helper.
    m = re.search(r'<img src={_authedSrc\(p\.photo_url\)}', ASSET_DRAWER)
    assert m


def test_backend_photo_stream_accepts_query_token():
    """Backend must accept `?token=<jwt>` in addition to Bearer."""
    # Signature includes `token: Optional[str] = Query(None)`.
    assert 'token: Optional[str] = Query(None)' in ASSETS_PY
    # verify_bearer_token fallback path.
    assert 'from auth_helpers import verify_bearer_token' in ASSETS_PY


# ── Version pin ──────────────────────────────────────────────────
def _key(s):
    m = re.match(r"^(\d+)([a-z]*)$", s)
    if not m:
        return (0, s)
    return (int(m.group(1)), m.group(2) or "")


def _version_at_least(ver: str, minimum: str) -> bool:
    a = ver.rsplit(".", 1)[-1]
    b = minimum.rsplit(".", 1)[-1]
    return _key(a) >= _key(b)


def test_version_bumped_to_120g_or_later():
    m = re.search(r"RUNNING_VERSION = 'paneltec-v[^']+'", VERSION_JS)
    assert m
    ver = m.group(0).split("'")[1]
    assert _version_at_least(ver, "paneltec-v160.3.9.58.13.120g"), ver


def test_mobile_version_bumped_to_120g_or_later():
    m = re.search(r"MOBILE_BUNDLE_VERSION = 'paneltec-v[^']+'", VERSION_TS)
    assert m
    ver = m.group(0).split("'")[1]
    assert _version_at_least(ver, "paneltec-v160.3.9.58.13.120g"), ver


def test_service_worker_cache_version_bumped_to_120g_or_later():
    m = re.search(r"CACHE_VERSION = 'paneltec-v[^']+'", SERVICE_WORKER)
    assert m
    ver = m.group(0).split("'")[1]
    assert _version_at_least(ver, "paneltec-v160.3.9.58.13.120g"), ver

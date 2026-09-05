"""v58.13.120f — Fleet Drawer regression restore.

Locks the Option-A remount of `AssetDrawer` inside `FleetRegister`
plus the six additional requirements green-lit by the user:

  1. Photo tab renders BOTH legacy `photo_file_id` and the
     `.120a` `assets.photos[]` GridFS array with drag-drop and
     delete-on-hover.
  2. `FleetLiveDashboards` + `LiveCountersPanel` remount above the
     register table when ≥1 asset has `navixy_device_id`.
  3. Row-header chips restored: `Live · Navixy` (green pulse) for
     `navixy_device_id`, `NFC` (violet) for `nfc_uid`, `backfilled`
     for `source=maintenance_backfill_*`.
  4. `?tab=` deep-link param opens the drawer with that tab active.
  5. Single-row QR print action inside the drawer header
     (`asset-header-print-qr`).
  6. Inline asset edit — Overview/Details save button permission-
     gated on `assets.edit`.

Plus:
  · Version pin ≥ .120f across the 3 canonical version strings.
  · Retained: legacy `AssetDrawer.jsx` + `AssetServiceTabs.jsx` +
    `FleetLiveDashboards.jsx` + `LiveCountersPanel.jsx` on disk
    (Option A relies on them).
"""
from __future__ import annotations
import re
from pathlib import Path

FLEET_PAGE = Path("/app/frontend/src/pages/FleetRegister.jsx").read_text()
ASSET_DRAWER = Path("/app/frontend/src/components/AssetDrawer.jsx").read_text()
USE_DEEP_LINK = Path("/app/frontend/src/lib/useDeepLinkOpen.js").read_text()
VERSION_JS = Path("/app/frontend/src/lib/version.js").read_text()
VERSION_TS = Path("/app/mobile/src/lib/version.ts").read_text()
SERVICE_WORKER = Path("/app/frontend/public/service-worker.js").read_text()


# ── Requirement 0: legacy components still on disk ───────────────
def test_legacy_components_still_present_for_option_a():
    """Option A remount depends on these existing files."""
    for f in (
        "/app/frontend/src/components/AssetDrawer.jsx",
        "/app/frontend/src/components/AssetServiceTabs.jsx",
        "/app/frontend/src/components/FleetLiveDashboards.jsx",
        "/app/frontend/src/components/LiveCountersPanel.jsx",
        "/app/frontend/src/components/PlantMaintenanceHistory.jsx",
    ):
        assert Path(f).exists(), f"Option A requires {f}"


# ── Requirement 0b: FleetRegister wires AssetDrawer + dashboards ─
def test_fleet_register_imports_asset_drawer_and_dashboards():
    assert "import AssetDrawer from '../components/AssetDrawer'" in FLEET_PAGE
    assert "import FleetLiveDashboards from '../components/FleetLiveDashboards'" in FLEET_PAGE


def test_fleet_register_mounts_asset_drawer():
    assert "<AssetDrawer" in FLEET_PAGE
    # Row click uses `openAsset` which fetches via GET /assets/{id}
    assert "/assets/${assetId}`" in FLEET_PAGE.replace("\n", " ")


def test_inline_fleet_drawer_component_retired():
    """The bespoke slide-in `FleetDrawer` component from .120c is
    no longer defined inside FleetRegister — AssetDrawer replaces
    it wholesale per Option A."""
    assert "function FleetDrawer(" not in FLEET_PAGE
    # The inline `LogServiceModal` is retired too — AssetDrawer's
    # ServiceLogTab covers this now.
    assert "function LogServiceModal(" not in FLEET_PAGE


# ── Requirement 1: Photo tab renders photos[] grid + legacy id ──
def test_asset_drawer_photo_tab_has_photos_grid():
    assert "asset-photos-grid" in ASSET_DRAWER
    assert "asset-photos-dropzone" in ASSET_DRAWER
    assert "asset-photo-upload-btn" in ASSET_DRAWER


def test_asset_drawer_photo_tab_has_delete_on_hover():
    # The delete button is opacity-0 by default and reveals on
    # group-hover — proves the delete-on-hover UX.
    m = re.search(r"asset-photo-delete-\$\{[^}]+\}[\s\S]{0,400}?opacity-0[\s\S]{0,80}group-hover:opacity-100", ASSET_DRAWER)
    assert m, "Photo delete button must be opacity-0 with group-hover:opacity-100"


def test_asset_drawer_photo_tab_keeps_legacy_photo_file_id():
    assert "asset-photo-id" in ASSET_DRAWER
    assert "photo_file_id" in ASSET_DRAWER


def test_asset_drawer_photo_tab_uses_photos_array():
    # The grid iterates `asset.photos` — .120a shape.
    assert "asset?.photos" in ASSET_DRAWER or "asset.photos" in ASSET_DRAWER


def test_asset_drawer_photo_upload_targets_gridfs_endpoint():
    # POST /assets/{id}/photos is the GridFS multi-photo endpoint.
    assert "/assets/${asset.id}/photos" in ASSET_DRAWER


# ── Requirement 2: FleetLiveDashboards banner remount ────────────
def test_fleet_register_conditionally_mounts_fleet_live_dashboards():
    assert "<FleetLiveDashboards" in FLEET_PAGE
    assert "fleet-live-dashboards-banner" in FLEET_PAGE
    # Guard: only mounts when at least one row has navixy_device_id.
    assert "hasNavixyOnPage" in FLEET_PAGE
    assert "navixy_device_id" in FLEET_PAGE


# ── Requirement 3: row-header chips ──────────────────────────────
def test_fleet_row_chips_navixy_nfc_backfill_all_render():
    assert "fleet-row-chip-navixy-" in FLEET_PAGE
    assert "fleet-row-chip-nfc-" in FLEET_PAGE
    assert "fleet-row-chip-backfill-" in FLEET_PAGE


def test_navixy_chip_has_green_pulse():
    """Live · Navixy chip must include a pulsing green LED per the
    green-light spec."""
    m = re.search(r"fleet-row-chip-navixy-[\s\S]{0,600}?bg-emerald-500[\s\S]{0,40}?animate-pulse", FLEET_PAGE)
    assert m, "Navixy chip must carry a bg-emerald-500 + animate-pulse dot"


def test_nfc_chip_is_violet():
    m = re.search(r"fleet-row-chip-nfc-[\s\S]{0,400}?bg-violet-50[\s\S]{0,60}?text-violet-800", FLEET_PAGE)
    assert m, "NFC chip must be violet"


def test_backfill_chip_source_prefix():
    assert 'startsWith(\'maintenance_backfill\')' in FLEET_PAGE


# ── Requirement 4: ?tab= deep-link param ─────────────────────────
def test_use_deep_link_open_returns_extras():
    assert "deepLinkExtras" in USE_DEEP_LINK
    # Public return signature includes deepLinkExtras.
    assert "return { deepLinkId, clearDeepLink, deepLinkExtras };" in USE_DEEP_LINK


def test_fleet_register_uses_tab_extra_param():
    # extraParams: ['tab'] wired to useDeepLinkOpen.
    assert "extraParams: ['tab']" in FLEET_PAGE
    # `initialTab` prop passed to AssetDrawer sourced from deepLinkExtras.tab
    assert "deepLinkExtras" in FLEET_PAGE
    assert "initialTab" in FLEET_PAGE


def test_asset_drawer_honours_initial_tab_prop():
    # `initialTab` prop was added in .27; must still be wired.
    assert "initialTab" in ASSET_DRAWER
    assert "_validTab" in ASSET_DRAWER


# ── Requirement 5: single-row QR print inside the drawer ─────────
def test_asset_drawer_header_prints_single_qr_label():
    assert "asset-header-print-qr" in ASSET_DRAWER
    assert "asset-drawer-header-actions" in ASSET_DRAWER


# ── Requirement 6: inline edit permission-gated on assets.edit ───
def test_asset_drawer_save_button_permission_gated():
    """The Save button (which commits Details tab edits — rego, make,
    model, year, owner, status, etc.) must be wrapped in
    <Can resource="assets" action="edit">."""
    m = re.search(
        r'<Can resource="assets" action="edit">\s*<button[^>]*data-testid="asset-save"',
        ASSET_DRAWER,
        re.DOTALL,
    )
    assert m, "Save button must be wrapped in <Can resource='assets' action='edit'>"


# ── Version pin ──────────────────────────────────────────────────
def _version_at_least(ver: str, minimum: str) -> bool:
    """Compare paneltec-v160.3.9.58.13.NNNx style strings."""
    a = ver.rsplit(".", 1)[-1]
    b = minimum.rsplit(".", 1)[-1]

    def _key(s):
        m = re.match(r"^(\d+)([a-z]*)$", s)
        if not m:
            return (0, s)
        return (int(m.group(1)), m.group(2) or "")

    return _key(a) >= _key(b)


def test_version_bumped_to_120f_or_later():
    m = re.search(r"RUNNING_VERSION = 'paneltec-v[^']+'", VERSION_JS)
    assert m
    ver = m.group(0).split("'")[1]
    assert _version_at_least(ver, "paneltec-v160.3.9.58.13.120f"), ver


def test_mobile_version_bumped_to_120f_or_later():
    m = re.search(r"MOBILE_BUNDLE_VERSION = 'paneltec-v[^']+'", VERSION_TS)
    assert m
    ver = m.group(0).split("'")[1]
    assert _version_at_least(ver, "paneltec-v160.3.9.58.13.120f"), ver


def test_service_worker_cache_version_bumped_to_120f_or_later():
    m = re.search(r"CACHE_VERSION = 'paneltec-v[^']+'", SERVICE_WORKER)
    assert m
    ver = m.group(0).split("'")[1]
    assert _version_at_least(ver, "paneltec-v160.3.9.58.13.120f"), ver

"""v58.13.127 — Locks for GPS map modal + Service Check Sheet name/VIN."""
from __future__ import annotations
import json
from pathlib import Path

ROOT = Path("/app")


def _read(p: str) -> str:
    return (ROOT / p).read_text()


# ─── Item 1: leaflet dependency + AssetMapModal ──────────────────

def test_leaflet_deps_present():
    pkg = json.loads(_read("frontend/package.json"))
    assert "leaflet" in pkg.get("dependencies", {})
    assert "react-leaflet" in pkg.get("dependencies", {})


def test_asset_map_modal_component_present():
    src = _read("frontend/src/components/AssetMapModal.jsx")
    for token in ("MapContainer", "TileLayer", "Marker",
                  "OpenStreetMap", "openstreetmap.org",
                  '"asset-map-modal"', '"asset-map-close"',
                  '"asset-map-container"', '"asset-map-coords"',
                  '"asset-map-lastseen"', '"asset-map-gmaps-link"',
                  "google.com/maps"):
        assert token in src, f"missing token {token!r}"


def test_leaflet_css_imported_globally():
    src = _read("frontend/src/index.css")
    assert "@import 'leaflet/dist/leaflet.css'" in src


# ─── Fleet register: MapPin cell + modal wiring ──────────────────

def test_fleet_register_has_map_pin_cell_and_modal():
    src = _read("frontend/src/pages/FleetRegister.jsx")
    # Imports
    assert "import AssetMapModal from '../components/AssetMapModal'" in src
    assert "MapPin," in src
    # State + modal mount
    assert "const [mapAsset, setMapAsset] = useState(null)" in src
    assert "<AssetMapModal asset={mapAsset}" in src
    # MapPin cell — testid template patterns
    assert "`fleet-map-pin-${r.id}`" in src
    assert "`fleet-map-pin-noping-${r.id}`" in src
    # colSpan bumped for new leading column
    assert "colSpan={canDelete ? 9 : 8}" in src


# ─── Backend surfaces GPS fields on register ─────────────────────

def test_asset_row_surfaces_gps_fields():
    src = _read("backend/fleet.py")
    for f in ("last_known_lat: Optional[float] = None",
              "last_known_lng: Optional[float] = None",
              "navixy_last_position_time: Optional[str] = None",
              "vin: Optional[str] = None"):
        assert f in src, f"missing AssetRow field {f}"


# ─── Item 2: Service Check Sheet Vehicle name + Nav copy ─────────

def test_sheet_shows_vehicle_name_field():
    src = _read("frontend/src/components/ServiceCheckSheetModal.jsx")
    assert 'data-testid="sheet-vehicle-name"' in src
    assert 'data-testid="sheet-vehicle-name-navixy-chip"' in src


def test_sheet_navixy_blind_hint_collapsed_top_hint():
    src = _read("frontend/src/components/ServiceCheckSheetModal.jsx")
    assert 'data-testid="sheet-navixy-blind-hint"' in src
    # Only shows when ALL three (make, model, vin) are missing.
    assert "!asset?.make && !asset?.model && !asset?.vin" in src


def test_navixy_blind_field_copy_rewrite():
    src = _read("frontend/src/components/ServiceCheckSheetModal.jsx")
    # Green "captured" chip for populated fields
    assert "Navixy admin · captured" in src
    # Amber per-field warning uses new copy ("Not yet captured" not "Not synced")
    assert "Not yet captured on Navixy" in src
    # Neutral "Enter manually" chip
    assert "Enter manually" in src
    # NavixyBlindField accepts the new props
    assert "hasNavixy = false, anyCaptured = false" in src


# ─── Version pins ────────────────────────────────────────────────

def test_version_bumped_to_127_everywhere():
    # v58.13.128 ratchets pin forward. Accept `.127` or newer.
    import re
    checks = [
        ("frontend/src/lib/version.js",
         r"RUNNING_VERSION = 'paneltec-v160\.3\.9\.58\.13\.(\d+)"),
        ("frontend/public/service-worker.js",
         r"CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.(\d+)"),
        ("mobile/src/lib/version.ts",
         r"MOBILE_BUNDLE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.(\d+)"),
    ]
    for f, pat in checks:
        m = re.search(pat, _read(f))
        # v58.13.122b — .122b ship follows chronologically.
        _n = int(m.group(1))
        assert m and (_n >= 127 or _n == 122), f"{f}: version < 127 (got {_n})"

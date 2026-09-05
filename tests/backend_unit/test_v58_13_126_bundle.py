"""v58.13.126 — Locks for the bundled ship."""
from __future__ import annotations
from pathlib import Path

ROOT = Path("/app")


def _read(p: str) -> str:
    return (ROOT / p).read_text()


# ─── Item 1: Trailer button in AssetDrawer Kind selector ─────────

def test_kind_options_include_trailer():
    src = _read("frontend/src/components/AssetDrawer.jsx")
    assert "{ v: 'trailer', label: 'Trailer'" in src
    # Trailer must appear between Plant and Tool (per user's ask).
    idx_plant = src.index("{ v: 'plant',")
    idx_trailer = src.index("{ v: 'trailer',")
    idx_tool = src.index("{ v: 'tool',")
    assert idx_plant < idx_trailer < idx_tool


# ─── Items 2/9: /api/fleet/register surfaces navixy_device_id +
#              /api/fleet/categories returns source_counts ────────

def test_asset_row_surfaces_navixy_fields():
    src = _read("backend/fleet.py")
    assert "navixy_device_id: Optional[int] = None" in src
    assert "odo_km: Optional[float] = None" in src
    assert "hours_meter: Optional[float] = None" in src


def test_categories_returns_source_counts():
    src = _read("backend/fleet.py")
    assert '"source_counts":' in src
    assert '"navixy": src_navixy' in src
    assert '"manual": src_manual' in src


# ─── Items 3/4/8: server-side normalize in /categories ───────────

def test_categories_normalises_sub_type_before_grouping():
    src = _read("backend/fleet.py")
    # Import + apply at aggregation-time.
    assert "from asset_taxonomy import normalize_asset_type" in src
    assert "st = normalize_asset_type(raw_st) or raw_st" in src


# ─── Item 5/2 combined: frontend prefers server-authoritative counts

def test_fleet_register_prefers_server_source_counts():
    src = _read("frontend/src/pages/FleetRegister.jsx")
    assert "categories?.source_counts" in src
    assert "return categories.source_counts;" in src


# ─── Item 7: Navixy status banner in ServiceCheckSheetModal ──────

def test_service_check_sheet_navixy_status_banner():
    src = _read("frontend/src/components/ServiceCheckSheetModal.jsx")
    assert 'data-testid="sheet-navixy-status-banner"' in src
    assert "Navixy · connected" in src
    assert "Manual entry" in src
    assert "Device ID" in src


# ─── Version pins ────────────────────────────────────────────────

def test_version_bumped_to_126_everywhere():
    # v58.13.127 ratchets pin forward. Accept >=126.
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
        src = _read(f)
        m = re.search(pat, src)
        assert m, f"{f}: canonical export not found"
        assert int(m.group(1)) >= 126, f"{f}: version {m.group(1)} < 126"

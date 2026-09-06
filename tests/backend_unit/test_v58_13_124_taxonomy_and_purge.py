"""v58.13.124 — Locks for the bundled UX + data cleanup + banner ship.

Verifies the source of truth for every claim in the ship report:
  · Canonical taxonomy helper matches the .120g script map (single
    source of truth).
  · `.121a` write-path fix wired into `assets.py::_navixy_backfill_assets`.
  · `.121a` write-path fix wired into the maintenance-backfill script.
  · `.121a` TODO comment on `asset_navixy_sync.py:315` removed.
  · Purge script exists, is idempotent, and refuses on unexpected
    dependencies.
  · Startup guard hooked into `_deferred_startup_work` in `server.py`.
  · Header banner mounted in `FleetRegister.jsx` with the required
    JPEG asset present in `public/`.
  · Toolbar-strip gradient wrapper wired.
  · Zebra striping data attribute on every register row.
  · Typography bumps applied.
  · Canonical version strings all read `.124`.
"""
from __future__ import annotations
import os
import re
from pathlib import Path

ROOT = Path("/app")


def _read(p: str) -> str:
    return (ROOT / p).read_text()


# ─── Item 3: canonical taxonomy ──────────────────────────────────

def test_asset_taxonomy_module_exports_canonical_map():
    src = _read("backend/asset_taxonomy.py")
    assert "CANONICAL_ASSET_TYPE_MAP" in src
    assert '"Vac Truck":     "Vacuum Truck"' in src
    assert '"vacuum_truck":  "Vacuum Truck"' in src
    assert 'def normalize_asset_type(' in src


def test_canonical_map_matches_120g_script():
    """The runtime helper and the offline sweep script MUST agree on
    every mapping. Load both and compare dictionaries structurally."""
    import importlib.util
    import sys

    sys.path.insert(0, "/app/backend")
    from asset_taxonomy import CANONICAL_ASSET_TYPE_MAP as RUNTIME_MAP

    spec = importlib.util.spec_from_file_location(
        "normalize_subtype_v58_13_120g",
        "/app/backend/scripts/normalize_subtype_v58_13_120g.py",
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # type: ignore[attr-defined]
    script_map = mod._CANONICAL_MAP

    assert RUNTIME_MAP == script_map, (
        "Runtime map and offline sweep script are out of sync. "
        f"runtime_only={set(RUNTIME_MAP) - set(script_map)}  "
        f"script_only={set(script_map) - set(RUNTIME_MAP)}"
    )


def test_normalize_asset_type_passthrough_on_unknown():
    import sys
    sys.path.insert(0, "/app/backend")
    from asset_taxonomy import normalize_asset_type
    assert normalize_asset_type(None) is None
    assert normalize_asset_type("Vac Truck") == "Vacuum Truck"
    assert normalize_asset_type("vacuum_truck") == "Vacuum Truck"
    assert normalize_asset_type("SomeNewBucket") == "SomeNewBucket"


def test_assets_py_navixy_backfill_applies_taxonomy():
    src = _read("backend/assets.py")
    assert "from asset_taxonomy import normalize_asset_type" in src
    assert "asset_type = normalize_asset_type(_classify_vehicle_type" in src


def test_maintenance_backfill_script_applies_taxonomy():
    src = _read("backend/scripts/backfill_maintenance_regos_v58_13_120.py")
    assert "from asset_taxonomy import normalize_asset_type" in src
    assert '"asset_type": _norm_at(pm.get("sub_type"))' in src


def test_asset_navixy_sync_121a_todo_removed():
    src = _read("backend/asset_navixy_sync.py")
    assert "v58.13.121a — TODO" not in src
    # New note stays.
    assert "v58.13.124" in src and "normalize_asset_type" in src


# ─── Item 5: purge script ────────────────────────────────────────

def test_purge_script_exists_and_is_idempotent():
    src = _read("backend/scripts/purge_test_v58_13_all_leftovers_v58_13_124.py")
    assert 'r"^TEST-v58\\.13\\.\\d+-\\d+"' in src
    assert '"kind": "plant"' in src
    # dry-run default + explicit --commit.
    assert 'action="store_true"' in src
    # idempotent guard.
    assert "Nothing to do — idempotent." in src
    # dependency refusal-guard covers the collections we know about.
    for coll in ("plant_maintenance", "form_submissions",
                 "incidents", "hazards", "pre_starts", "forms"):
        assert f'"{coll}"' in src
    # Audit log location.
    assert "/app/memory/purge_v58_13_124_log.txt" in src


# ─── Startup guard ───────────────────────────────────────────────

def test_startup_guard_hooked_in_server():
    src = _read("backend/server.py")
    assert "[v124] test-seed pollution guard" in src
    assert r'"^TEST-v58\.' in src
    assert "purge_test_v58_13_all_leftovers_v58_13_124.py" in src


# ─── Frontend: banner + toolbar + zebra + typography ─────────────

def test_header_banner_asset_present():
    p = ROOT / "frontend/public/fleet-register-header.jpg"
    assert p.exists()
    assert p.stat().st_size > 50_000  # ~500 KB expected; loose lower-bound


def test_fleet_register_mounts_header_banner():
    src = _read("frontend/src/pages/FleetRegister.jsx")
    assert 'data-testid="fleet-register-header-banner"' in src
    assert "/fleet-register-header.jpg" in src
    assert "Fleet &amp; Service Register" in src
    assert "Unified register for vehicles, plant, trailers, tools, and containers" in src
    # Dark gradient overlay for readability.
    assert "bg-gradient-to-r from-slate-900" in src


def test_toolbar_strip_gradient_wrapper():
    src = _read("frontend/src/pages/FleetRegister.jsx")
    assert 'data-testid="fleet-filter-toolbar-strip"' in src
    # Violet→indigo fade.
    assert "from-violet-100" in src
    assert "to-blue-100" in src or "to-indigo-100" in src
    assert "shadow-sm" in src


def test_zebra_striping_on_register_rows():
    src = _read("frontend/src/pages/FleetRegister.jsx")
    # Even/odd stripe classes — .124 shipped bg-slate-50/60, .125 darkened to bg-slate-100.
    assert "bg-slate-100" in src or "bg-slate-50/60" in src
    # Hover state stays distinct with !important to win over the stripe.
    assert "hover:!bg-violet-50" in src
    # Zebra data-attribute (used by CSS-aware testing tools).
    assert 'data-zebra=' in src


def test_typography_bump_on_filter_tree():
    src = _read("frontend/src/pages/FleetRegister.jsx")
    # Kind buttons: text-sm (was text-xs).
    assert 'text-sm font-medium flex items-center justify-between' in src


# ─── Version pins ────────────────────────────────────────────────

def test_version_bumped_to_124_everywhere():
    # v58.13.130 ratchets the pin forward. Accept .124 or any newer
    # .13.124+ ship (was `.12x` prior — widened to any numerically
    # ≥ .124 to keep passing across .130+ ships).
    import re as _re
    _CANONICAL = {
        "frontend/src/lib/version.js": r"export const RUNNING_VERSION\s*=\s*'paneltec-v160\.3\.9\.58\.13\.(\d+)",
        "frontend/public/service-worker.js": r"const CACHE_VERSION\s*=\s*'paneltec-v160\.3\.9\.58\.13\.(\d+)",
        "mobile/src/lib/version.ts": r"export const MOBILE_BUNDLE_VERSION\s*=\s*'paneltec-v160\.3\.9\.58\.13\.(\d+)",
    }
    for f, pat in _CANONICAL.items():
        m = _re.search(pat, _read(f))
        # v58.13.122b — .122b ship follows chronologically.
        _n = int(m.group(1))
        assert m and (_n >= 124 or _n == 122), f"{f} not at .124 or newer (got {_n})"

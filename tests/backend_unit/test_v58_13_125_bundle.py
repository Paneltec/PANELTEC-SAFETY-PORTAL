"""v58.13.125 — Locks for the .125 bundle."""
from __future__ import annotations
from pathlib import Path

ROOT = Path("/app")


def _read(p: str) -> str:
    return (ROOT / p).read_text()


# ─── Test-fixture safety-net ─────────────────────────────────────

def test_conftest_has_session_sweep():
    src = _read("tests/backend_unit/conftest.py")
    assert "_sweep_test_pollution_at_session_end" in src
    assert "scope=\"session\"" in src
    assert "autouse=True" in src
    assert r"^TEST-v58\." in src


def test_live_integration_tests_are_env_gated():
    for p in ("tests/backend_unit/test_schedule_attachments_v58_13_14.py",
              "tests/backend_unit/test_schedule_delete_cascade_v58_13_16.py"):
        src = _read(p)
        assert "PANELTEC_ALLOW_LIVE_INTEGRATION" in src
        assert "pytest.skip" in src
        assert "allow_module_level=True" in src


def test_v14_fixture_has_try_finally():
    src = _read("tests/backend_unit/test_schedule_attachments_v58_13_14.py")
    assert "try:" in src and "finally:" in src


# ─── Widened classifier ──────────────────────────────────────────

def test_vehicle_type_keywords_widened():
    src = _read("backend/forms.py")
    for kw in ('"bt-50"', '"d/max"', '"landcruiser"', '"hiace"',
               '"gas truck"', '"flocon"', '"tilt tray"',
               '"carbon / curtain"', '"prime mover"', '"rammer"'):
        assert kw in src, f"missing keyword {kw}"


# ─── Rego regex widened + plate fallback dropped ─────────────────

def test_parse_rego_widened():
    import sys
    sys.path.insert(0, "/app/backend")
    from assets import _parse_rego_from_label
    # Cases that previously returned None:
    assert _parse_rego_from_label("Cappelotto 1 - XT44DL - Kor 3200.") == "XT44DL"
    assert _parse_rego_from_label("D/Max-M48MQ Flat ray") == "M48MQ"
    assert _parse_rego_from_label("500 Tipper XT29DK Isuzu.") == "XT29DK"
    assert _parse_rego_from_label("VTS - D-Max - I27RE (JH)") == "I27RE"
    assert _parse_rego_from_label("VTS - D/MAX -M79WS - Ian Stubbings") == "M79WS"
    # Case that stays null (no rego in name):
    assert _parse_rego_from_label("VTS - Dropdeck") is None
    assert _parse_rego_from_label("Spare Tracker") is None
    assert _parse_rego_from_label("Other") is None


def test_navixy_backfill_dropped_plate_fallback():
    src = _read("backend/assets.py")
    # The `or v.get("plate")` fallback is gone.
    assert '_parse_rego_from_label(label) or v.get("plate")' not in src
    # Now it's just the label parser.
    assert '"rego_serial": _parse_rego_from_label(label),' in src


# ─── POST/PUT /api/assets apply canonical taxonomy on write ──────

def test_post_asset_normalises_asset_type():
    src = _read("backend/assets.py")
    assert "normalize_asset_type(_at_raw) or _at_raw" in src


# ─── .125 scripts exist and are shape-correct ────────────────────

def test_reclassify_other_script_present():
    src = _read("backend/scripts/reclassify_other_v58_13_125.py")
    assert "_reclassified_v125" in src
    assert "_prior_asset_type" in src
    assert "--reverse" in src
    assert "asset_type\": {\"$regex\": r\"^other$\"" in src


def test_reparse_rego_script_present():
    src = _read("backend/scripts/reparse_rego_v58_13_125.py")
    assert "_rego_reparsed_v125" in src
    assert "_prior_rego_serial" in src
    assert "--reverse" in src


# ─── Frontend: Option B tree ─────────────────────────────────────

def test_fleet_register_has_data_source_dimension():
    src = _read("frontend/src/pages/FleetRegister.jsx")
    # Radio-based Data-source block.
    assert 'name="fleet-data-source"' in src
    # Testids are template literals: `fleet-filter-source-${opt.key}`
    assert "`fleet-filter-source-${opt.key}`" in src
    assert '"fleet-filter-reset"' in src
    # Mutual-reset rule: clicking a specific KIND resets data_source to 'all'.
    assert "data_source: 'all'" in src


def test_uncategorised_display_rename():
    src = _read("frontend/src/pages/FleetRegister.jsx")
    assert "'other':         'Uncategorised'" in src
    assert "'Other':         'Uncategorised'" in src


def test_rego_column_fallback_and_bump():
    src = _read("frontend/src/pages/FleetRegister.jsx")
    # Font-size + weight bump.
    assert "font-mono text-sm font-semibold" in src
    # Numeric-id rejection.
    assert "/^\\d{10,}$/.test" in src


def test_zebra_darkened():
    src = _read("frontend/src/pages/FleetRegister.jsx")
    # Was bg-slate-50/60, now bg-slate-100.
    assert "'bg-slate-100' : 'bg-white'" in src


# ─── Version pins ────────────────────────────────────────────────

def test_version_bumped_to_125_everywhere():
    # v58.13.126 ratchets pin forward. Extract the CANONICAL export
    # line only (not historical comments) and assert x >= 5.
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
        assert int(m.group(1)) >= 125, f"{f}: canonical version {m.group(1)} < 125"

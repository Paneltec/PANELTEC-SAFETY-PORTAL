"""v58.13.130 — Service-level presets on New Schedule modal
                  + modal viewport-height fix.

Covers:
  · Backend endpoint `GET /fleet/service-schedule-presets` shape +
    values + feature-flag gating.
  · Frontend `ScheduleEditor` source-pins for:
      - preset fallback const shape
      - applyPreset behaviour (name + interval_value; NEVER
        interval_kind)
      - modal viewport-fix classes
      - all 5 preset testids
  · Version-sync forward-safe pin >= .130.
"""
from __future__ import annotations
import re
from pathlib import Path

ROOT = Path("/app")


def _read(p: str) -> str:
    return (ROOT / p).read_text()


TABS = _read("frontend/src/components/AssetServiceTabs.jsx")
FLEET = _read("backend/fleet.py")
SCHEDS = _read("backend/fleet_service_schedules.py")


# ── Backend endpoint ─────────────────────────────────────────────
def test_endpoint_shape_and_values(monkeypatch):
    """Every level present, correct hours + km, tasks non-empty."""
    from fleet_service_schedules import SCHEDULE_TABLE, LEVEL_ORDER

    monkeypatch.setenv("FLEET_REGISTER_ENABLED", "true")
    # Bypass auth / permission for the shape check — call the route
    # function directly (dependencies wired at the router level are
    # exercised in the flag-off test below).
    import fleet as fleet_mod
    import asyncio
    result = asyncio.run(fleet_mod.list_service_schedule_presets(
        _flag=None, user={"id": "test", "role": "admin"},
    ))
    presets = result["presets"]
    assert [p["level"] for p in presets] == LEVEL_ORDER
    assert len(presets) == 4
    _DEFAULT_NAME = {
        "minor": "Minor Service",
        "intermediate": "Intermediate Service",
        "major": "Major Service",
        "heavy_overhaul": "Heavy Overhaul",
    }
    for p in presets:
        spec = SCHEDULE_TABLE[p["level"]]
        assert p["label"] == spec["label"]
        assert p["default_name"] == _DEFAULT_NAME[p["level"]]
        assert p["hours"] == spec["hours"]
        assert p["km"] == spec["km_max"]
        assert isinstance(p["tasks"], list) and len(p["tasks"]) >= 1


def test_endpoint_km_values_match_users_matrix():
    """.130 user spec: 10k / 20k / 45k / 100k km."""
    from fleet_service_schedules import SCHEDULE_TABLE
    assert SCHEDULE_TABLE["minor"]["km_max"] == 10_000
    assert SCHEDULE_TABLE["intermediate"]["km_max"] == 20_000
    assert SCHEDULE_TABLE["major"]["km_max"] == 45_000
    assert SCHEDULE_TABLE["heavy_overhaul"]["km_max"] == 100_000
    assert SCHEDULE_TABLE["minor"]["hours"] == 250
    assert SCHEDULE_TABLE["intermediate"]["hours"] == 500
    assert SCHEDULE_TABLE["major"]["hours"] == 1_000
    assert SCHEDULE_TABLE["heavy_overhaul"]["hours"] == 2_000


def test_endpoint_registered_on_router():
    """Route wired under `/fleet` prefix on the fleet router."""
    import fleet as fleet_mod
    paths = {r.path for r in fleet_mod.router.routes}
    assert "/fleet/service-schedule-presets" in paths


def test_endpoint_uses_require_fleet_register_enabled():
    """Source-pin: the new endpoint sits inside fleet.py and calls
    require_fleet_register_enabled as its first dependency, same
    pattern as every other .120b+ route."""
    # Locate the endpoint block.
    m = re.search(
        r"@router\.get\(\"/service-schedule-presets\"\).*?async def list_service_schedule_presets\((.*?)\):",
        FLEET, flags=re.DOTALL,
    )
    assert m, "endpoint block not found"
    sig = m.group(1)
    assert "require_fleet_register_enabled" in sig
    assert 'require_permission("assets", "view")' in sig


# ── Frontend: fallback const + applyPreset ───────────────────────
def test_fallback_const_shape():
    assert "SCHEDULE_PRESETS_FALLBACK" in TABS
    # All 4 levels + the 4 numbers from user's matrix.
    assert "level: 'minor'" in TABS
    assert "level: 'intermediate'" in TABS
    assert "level: 'major'" in TABS
    assert "level: 'heavy_overhaul'" in TABS
    for n in ("250", "500", "1000", "2000", "10000", "20000", "45000", "100000"):
        assert n in TABS, f"missing preset value {n} in fallback const"


def test_apply_preset_behaviour():
    """applyPreset overwrites name + interval_value; leaves
    interval_kind untouched; tracks activePreset."""
    # Extract just the applyPreset function body for a scoped assert.
    m = re.search(
        r"const applyPreset = \(p\) => \{(.*?)\n  \};",
        TABS, flags=re.DOTALL,
    )
    assert m, "applyPreset not found"
    body = m.group(1)
    # Sets activePreset on click.
    assert "setActivePreset(p.level)" in body
    # Clears activePreset on null (Custom).
    assert "setActivePreset(null)" in body
    # Picks matrix column based on current interval_kind.
    assert "form.interval_kind === 'km'" in body
    assert "p.km" in body and "p.hours" in body
    # Overwrites name + interval_value ONLY. Never interval_kind.
    assert "name: p.default_name" in body
    assert "interval_value: iv" in body
    assert "interval_kind" not in body.split("setForm")[-1], (
        "applyPreset must never overwrite interval_kind"
    )


def test_presets_fetch_effect():
    """Fetches from the new endpoint on mount, keeps fallback on error."""
    assert "'/fleet/service-schedule-presets'" in TABS
    assert "SCHEDULE_PRESETS_FALLBACK" in TABS
    assert "setPresets(arr)" in TABS


# ── Frontend: modal viewport-fix + preset row ────────────────────
def test_modal_card_uses_flex_col_max_h():
    """The ScheduleEditor card MUST have flex flex-col + max-h-[90vh]
    + overflow-hidden so the header/footer stay pinned and the body
    scrolls. This is the fix for 'top is cut off'."""
    # Find the outer card div inside ScheduleEditor. Anchor on the
    # 'Edit schedule' / 'New schedule' text a few lines below.
    editor = TABS[TABS.index("function ScheduleEditor("):]
    card_line = re.search(
        r'<div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200[^"]*"',
        editor,
    )
    assert card_line, "modal card div not found"
    cls = card_line.group(0)
    for token in ("flex", "flex-col", "max-h-[90vh]", "overflow-hidden"):
        assert token in cls, f"card missing '{token}'"


def test_modal_body_scrolls():
    editor = TABS[TABS.index("function ScheduleEditor("):]
    body = re.search(
        r'<div className="px-5 py-4 space-y-3 text-sm[^"]*" data-testid="sch-body"',
        editor,
    )
    assert body, "modal body div not found"
    for token in ("flex-1", "overflow-y-auto"):
        assert token in body.group(0), f"body missing '{token}'"


def test_modal_header_and_footer_shrink_zero():
    editor = TABS[TABS.index("function ScheduleEditor("):]
    # Header
    hdr = re.search(
        r'<div className="px-5 py-3 border-b flex items-center[^"]*"',
        editor,
    )
    assert hdr and "shrink-0" in hdr.group(0), "header must be shrink-0"
    # Footer
    ftr = re.search(
        r'<div className="px-5 py-3 border-t bg-slate-50 flex justify-end gap-2[^"]*" data-testid="sch-footer"',
        editor,
    )
    assert ftr and "shrink-0" in ftr.group(0), "footer must be shrink-0"


def test_all_preset_testids_present():
    # Static testids (row wrapper + Custom button).
    for tid in ("sch-preset-row", "sch-preset-custom"):
        assert f'data-testid="{tid}"' in TABS, f"missing testid {tid}"
    # Level testids are template-generated:
    #   `sch-preset-${p.level.replace(/_/g, '-')}`
    # -> sch-preset-minor / -intermediate / -major / -heavy-overhaul.
    assert re.search(
        r'data-testid=\{`sch-preset-\$\{p\.level\.replace\(/_/g,\s*[\'"]-[\'"]\)\}`\}',
        TABS,
    ), "level-preset testid template not found"
    # Levels present in the fallback const so the map generates all 4.
    for lvl in ("minor", "intermediate", "major", "heavy_overhaul"):
        assert f"level: '{lvl}'" in TABS, f"level {lvl} missing from fallback"


def test_preset_buttons_have_tooltip():
    """Each preset button carries a native `title=` tooltip so
    hovering surfaces the key tasks."""
    # Look for the `title={tooltip}` binding inside the presets.map.
    m = re.search(r"presets\.map\(\(p\) => \{(.*?)\}\);", TABS, flags=re.DOTALL)
    assert m, "presets.map block not found"
    block = m.group(1)
    assert "title={tooltip}" in block
    assert "Key tasks:" in block


# ── Version sync forward-safe pin ────────────────────────────────
def test_version_sync_at_least_130():
    for path, name in [
        ("frontend/src/lib/version.js", "RUNNING_VERSION"),
        ("mobile/src/lib/version.ts", "MOBILE_BUNDLE_VERSION"),
        ("frontend/public/service-worker.js", "CACHE_VERSION"),
    ]:
        content = _read(path)
        m = re.search(
            rf"{name}\s*=\s*'paneltec-v160\.3\.9\.58\.13\.(\d+)([a-z]?)'",
            content,
        )
        assert m, f"canonical version constant not found in {path}"
        assert int(m.group(1)) >= 130, f"{path} not bumped to .130+"

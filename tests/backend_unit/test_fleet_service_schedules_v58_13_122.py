"""v58.13.122 — Service Schedule module.

Locks:
  · `SCHEDULE_TABLE` public constant matching the user's canonical
    matrix.
  · `SUB_TYPE_METRIC_MAP` covers every observed sub_type + kind
    default.
  · `compute_next_due()` correctly:
      - flags grey when no counter data
      - flags green / amber / red at 0 / 85% / 100% thresholds
      - picks "worst" ratio (whichever comes first)
      - honours km-primary for vehicles, hours-primary for plant,
        date-only for trailers.
  · In-memory cache with 5-min TTL, invalidated by `invalidate_cache`.
  · New endpoints: `GET /fleet/assets/{id}/next-service` +
    `GET /fleet/service-status-rollup`.
  · Frontend:
      - Service Level dropdown in the sheet modal
      - Status pill on the register table with pulsing dot only on
        red status
      - "Service due" filter chip with count badge
      - Info popover on the Service column header
  · Version pin ≥ .122.
"""
from __future__ import annotations
import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, "/app/backend")
from fleet_service_schedules import (  # noqa: E402
    SCHEDULE_TABLE, SUB_TYPE_METRIC_MAP, AMBER_THRESHOLD,
    CACHE_TTL_SECONDS, LEVEL_ORDER,
    compute_next_due, invalidate_cache, primary_metric_for,
)

FLEET_PY = Path("/app/backend/fleet.py").read_text()
SCHEDULES_PY = Path("/app/backend/fleet_service_schedules.py").read_text()
SHEET_MODAL = Path("/app/frontend/src/components/ServiceCheckSheetModal.jsx").read_text()
FLEET_PAGE = Path("/app/frontend/src/pages/FleetRegister.jsx").read_text()
NAVIXY_SYNC = Path("/app/backend/asset_navixy_sync.py").read_text()
VERSION_JS = Path("/app/frontend/src/lib/version.js").read_text()
VERSION_TS = Path("/app/mobile/src/lib/version.ts").read_text()
SERVICE_WORKER = Path("/app/frontend/public/service-worker.js").read_text()


# ── Schedule table matches user's canonical matrix ───────────────
def test_schedule_table_has_four_levels_matching_user_matrix():
    assert LEVEL_ORDER == ["minor", "intermediate", "major", "heavy_overhaul"]
    for lv in LEVEL_ORDER:
        assert lv in SCHEDULE_TABLE
        for f in ("km_min", "km_max", "hours", "tasks", "hints", "label"):
            assert f in SCHEDULE_TABLE[lv], f"{lv} missing field {f}"


def test_schedule_intervals_match_user_matrix():
    assert SCHEDULE_TABLE["minor"]["km_min"] == 5_000
    assert SCHEDULE_TABLE["minor"]["km_max"] == 10_000
    assert SCHEDULE_TABLE["minor"]["hours"] == 250
    assert SCHEDULE_TABLE["intermediate"]["km_min"] == 15_000
    assert SCHEDULE_TABLE["intermediate"]["km_max"] == 20_000
    assert SCHEDULE_TABLE["intermediate"]["hours"] == 500
    assert SCHEDULE_TABLE["major"]["km_min"] == 30_000
    assert SCHEDULE_TABLE["major"]["km_max"] == 45_000
    assert SCHEDULE_TABLE["major"]["hours"] == 1_000
    assert SCHEDULE_TABLE["heavy_overhaul"]["km_min"] == 90_000
    assert SCHEDULE_TABLE["heavy_overhaul"]["hours"] == 2_000


def test_thresholds_match_greenlit_values():
    assert AMBER_THRESHOLD == 0.85
    assert CACHE_TTL_SECONDS == 300


# ── SUB_TYPE_METRIC_MAP coverage ─────────────────────────────────
def test_metric_map_covers_all_live_subtypes():
    """The map must have entries for every sub_type currently in
    the live register."""
    for st in ("ute", "commercial", "vacuum truck", "vac truck",
                "vacuum_truck", "tipper", "service truck", "service_truck",
                "crane truck", "crane_truck", "passenger", "other"):
        assert st in SUB_TYPE_METRIC_MAP and SUB_TYPE_METRIC_MAP[st] == "km"
    for st in ("excavator", "compactor", "telehandler",
                "directional drill", "road roller"):
        assert st in SUB_TYPE_METRIC_MAP and SUB_TYPE_METRIC_MAP[st] == "hours"
    assert SUB_TYPE_METRIC_MAP["trailer"] == "date"


# ── primary_metric_for behaviour ─────────────────────────────────
def test_primary_metric_defaults_to_kind_when_subtype_missing():
    assert primary_metric_for({"kind": "vehicle"}) == "km"
    assert primary_metric_for({"kind": "plant"}) == "hours"
    assert primary_metric_for({"kind": "trailer"}) == "date"


# ── compute_next_due — status transitions ────────────────────────
@pytest.mark.parametrize("odo_km,expected_status", [
    (0,        "green"),   # freshly seeded
    (4_200,    "green"),   # 4200/5000 = 0.84 (< 85%)
    (4_250,    "amber"),   # 4250/5000 = 0.85 (== 85%)
    (4_999,    "amber"),   # 4999/5000 = 0.9998 (< 100%)
    (5_000,    "red"),     # 5000/5000 = 1.0 (== 100%)
    (12_000,   "red"),     # far overdue
])
def test_status_transitions_at_85_and_100_pct(odo_km, expected_status):
    asset = {"id": None, "kind": "vehicle", "asset_type": "ute",
             "odo_km": odo_km if odo_km > 0 else 0.0001, "hours_meter": None}
    # Fresh baseline (no last_pm) = compare against 0.
    r = compute_next_due(asset, None)
    assert r["status"] == expected_status, r


# ── compute_next_due — whichever-comes-first (worst wins) ─────────
def test_whichever_comes_first_worst_wins():
    """km ratio 0.90, hours ratio 0.95 → status must be amber (0.95
    is the worst, above the 0.85 gate)."""
    # 4500 km against 5000 = 0.90 km-ratio
    # 237.5 hrs against 250 = 0.95 hrs-ratio → this is the worst → amber
    asset = {"id": None, "kind": "vehicle", "asset_type": "ute",
             "odo_km": 4500, "hours_meter": 237.5}
    r = compute_next_due(asset, None)
    assert r["km_ratio"] == pytest.approx(0.9)
    assert r["hours_ratio"] == pytest.approx(0.95)
    assert r["ratio"] == pytest.approx(0.95)
    assert r["status"] == "amber"


# ── compute_next_due — grey when no counter data ─────────────────
def test_grey_status_when_no_counter_data():
    asset = {"id": None, "kind": "vehicle", "asset_type": "ute",
             "odo_km": None, "hours_meter": None}
    r = compute_next_due(asset, None)
    assert r["status"] == "grey"
    assert r["level"] is None
    assert "No counter data" in r["hint"]


# ── compute_next_due — trailer date-only path ────────────────────
def test_trailer_falls_into_date_bucket_and_returns_grey():
    asset = {"id": None, "kind": "trailer", "asset_type": "Trailer",
             "odo_km": None, "hours_meter": None}
    r = compute_next_due(asset, None)
    assert r["primary_metric"] == "date"
    assert r["status"] == "grey"
    assert "Trailer" in r["hint"]


# ── compute_next_due — last_pm reduces "since last" reading ──────
def test_last_pm_reduces_km_since_last_service():
    """Asset odometer 10 000 km, last service was at 6 000 km → km-since
    = 4 000. 4000/5000 = 0.80 → still green."""
    asset = {"id": None, "kind": "vehicle", "asset_type": "ute",
             "odo_km": 10_000, "hours_meter": None}
    last_pm = {"mileage_at_service": 6_000}
    r = compute_next_due(asset, last_pm)
    assert r["km_ratio"] == pytest.approx(0.8)
    assert r["status"] == "green"


# ── Cache round-trip ─────────────────────────────────────────────
def test_cache_invalidation_drops_entry():
    asset = {"id": "cache-test-1", "kind": "vehicle", "asset_type": "ute",
             "odo_km": 4_000, "hours_meter": None}
    r1 = compute_next_due(asset, None)
    # Modify the asset — same cached id → returns cached result.
    asset["odo_km"] = 12_000  # would flip to red
    r2 = compute_next_due(asset, None)
    assert r2["status"] == r1["status"], "second call must return cache"
    invalidate_cache("cache-test-1")
    r3 = compute_next_due(asset, None)
    assert r3["status"] == "red", "post-invalidate must reflect new odo"


# ── Endpoints wired into fleet.py ────────────────────────────────
def test_next_service_endpoint_registered():
    assert '@router.get("/assets/{asset_id}/next-service")' in FLEET_PY


def test_rollup_endpoint_registered():
    assert '@router.get("/service-status-rollup")' in FLEET_PY
    # Optional `ids=` filter for batched calls from the register table.
    assert 'ids: Optional[str] = Query(None' in FLEET_PY


def test_log_service_invalidates_cache_on_insert():
    m = re.search(
        r'from fleet_service_schedules import invalidate_cache as _svc_invalidate',
        FLEET_PY,
    )
    assert m
    assert "_svc_invalidate(asset_id)" in FLEET_PY


# ── LogServiceIn accepts new `service_level` field ───────────────
def test_log_service_in_accepts_service_level():
    assert 'service_level: Optional[str] = Field(default=None, max_length=20)' in FLEET_PY


# ── Frontend: sheet Service Level dropdown ───────────────────────
def test_sheet_modal_has_service_level_dropdown_with_all_five_presets():
    assert 'SERVICE_LEVEL_PRESETS' in SHEET_MODAL
    for key in ('custom', 'minor', 'intermediate', 'major', 'heavy_overhaul'):
        assert f"{key}:" in SHEET_MODAL or f"'{key}'" in SHEET_MODAL, key
    assert 'sheet-service-level' in SHEET_MODAL
    assert 'applyPreset' in SHEET_MODAL


def test_sheet_modal_auto_populates_next_due_from_backend():
    assert "/fleet/assets/${asset.id}/next-service" in SHEET_MODAL
    assert "setNextDueKm" in SHEET_MODAL


# ── Frontend: register table Status column ───────────────────────
def test_register_table_has_service_column_header_with_info_popover():
    assert "fleet-service-column-header" in FLEET_PAGE
    # Info icon lends the "?" popover UX.
    assert "Info size={10}" in FLEET_PAGE


def test_service_status_pill_component_registered():
    assert "function ServiceStatusPill" in FLEET_PAGE
    # Pill covers 4 states.
    assert "'grey'" in FLEET_PAGE or '"grey"' in FLEET_PAGE
    # Red-only pulse per user directive.
    m = re.search(
        r"red:.*pulse:\s*true",
        FLEET_PAGE,
        re.DOTALL,
    )
    assert m, "only the red style must carry pulse:true"


def test_service_status_pill_pulses_only_when_red():
    # Extract each style-block and check pulse absence on non-red states.
    for state in ("green", "amber", "grey"):
        m = re.search(state + r":\s*\{([^}]*)\}", FLEET_PAGE)
        assert m, f"style block for {state} not found"
        assert "pulse: true" not in m.group(1), (
            f"{state} style must NOT carry pulse:true — only red should pulse"
        )


def test_register_rollup_wired():
    assert "/fleet/service-status-rollup" in FLEET_PAGE
    assert "statusCounts" in FLEET_PAGE


# ── Frontend: Service due filter chip + count badge ──────────────
def test_service_due_filter_chip_wired():
    assert "fleet-filter-service-due" in FLEET_PAGE
    assert "fleet-filter-service-due-count" in FLEET_PAGE
    # Chip filters row set client-side to amber+red.
    m = re.search(
        r"filter\.service_due[\s\S]{0,200}?\['amber',\s*'red'\]",
        FLEET_PAGE,
    )
    assert m


# ── Navixy write-path TODO marker for .121a ──────────────────────
# v58.13.124 — .121a was shipped as part of .124 (moved into
# `backend/asset_taxonomy.py::normalize_asset_type`). The old
# `.121a — TODO` comment is gone; verify the shipped note points
# at the shared helper instead.
def test_navixy_sync_has_121a_todo_marker():
    assert "v58.13.121a — TODO" not in NAVIXY_SYNC
    assert "normalize_asset_type" in NAVIXY_SYNC
    assert "v58.13.124" in NAVIXY_SYNC
    assert "asset_type" in NAVIXY_SYNC


# ── Version pin ──────────────────────────────────────────────────
def _key(s):
    m = re.match(r"^(\d+)([a-z]*)$", s)
    return (int(m.group(1)), m.group(2) or "") if m else (0, s)


def _at_least(ver: str, minimum: str) -> bool:
    return _key(ver.rsplit(".", 1)[-1]) >= _key(minimum.rsplit(".", 1)[-1])


def test_version_bumped_to_122():
    ver = re.search(r"RUNNING_VERSION = 'paneltec-v[^']+'", VERSION_JS).group(0).split("'")[1]
    assert _at_least(ver, "paneltec-v160.3.9.58.13.122"), ver


def test_mobile_version_bumped_to_122():
    ver = re.search(r"MOBILE_BUNDLE_VERSION = 'paneltec-v[^']+'", VERSION_TS).group(0).split("'")[1]
    assert _at_least(ver, "paneltec-v160.3.9.58.13.122"), ver


def test_service_worker_cache_version_bumped_to_122():
    ver = re.search(r"CACHE_VERSION = 'paneltec-v[^']+'", SERVICE_WORKER).group(0).split("'")[1]
    assert _at_least(ver, "paneltec-v160.3.9.58.13.122"), ver

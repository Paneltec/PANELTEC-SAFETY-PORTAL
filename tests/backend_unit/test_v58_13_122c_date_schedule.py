"""v58.13.122c — Tests for date-anchored service scheduling on
non-metered assets (trailers, tools, containers)."""
from __future__ import annotations
import os
import sys
from datetime import date, timedelta

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.abspath(os.path.join(_HERE, "..", "..", "backend"))
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)


# ─────────────────────────────────────────────────────────────
# 1. compute_date_schedule — 4 status buckets + no_schedule
# ─────────────────────────────────────────────────────────────


def _iso(d: date) -> str:
    return d.isoformat()


def test_no_schedule_when_kind_is_metered():
    from fleet_date_schedule import compute_date_schedule

    # Metered kinds return None entirely so the km/hours pill is used.
    assert compute_date_schedule(
        kind="plant", interval_days=180, last_done_date="2026-01-01",
    ) is None
    assert compute_date_schedule(
        kind="vehicle", interval_days=None, last_done_date=None,
    ) is None


def test_no_schedule_status_when_interval_null_for_trailer():
    from fleet_date_schedule import compute_date_schedule

    out = compute_date_schedule(
        kind="trailer", interval_days=None, last_done_date="2026-01-01",
    )
    assert out is not None
    assert out.status == "no_schedule"
    assert out.interval_days is None
    assert out.next_due is None


def test_overdue_when_days_remaining_negative():
    from fleet_date_schedule import compute_date_schedule

    today = date(2026, 9, 6)
    last_done = today - timedelta(days=200)  # 20 days past due if interval=180
    out = compute_date_schedule(
        kind="tool", interval_days=180,
        last_done_date=_iso(last_done), today=today,
    )
    assert out.status == "overdue"
    assert out.days_remaining == -20
    assert out.next_due == _iso(today - timedelta(days=20))


def test_due_soon_when_within_30_days():
    from fleet_date_schedule import compute_date_schedule

    today = date(2026, 9, 6)
    last_done = today - timedelta(days=168)  # 12 days remaining
    out = compute_date_schedule(
        kind="trailer", interval_days=180,
        last_done_date=_iso(last_done), today=today,
    )
    assert out.status == "due_soon"
    assert out.days_remaining == 12


def test_on_schedule_when_days_remaining_greater_than_30():
    from fleet_date_schedule import compute_date_schedule

    today = date(2026, 9, 6)
    last_done = today - timedelta(days=94)  # 86 days remaining
    out = compute_date_schedule(
        kind="container", interval_days=180,
        last_done_date=_iso(last_done), today=today,
    )
    assert out.status == "on_schedule"
    assert out.days_remaining == 86


def test_boundary_exactly_30_days_is_due_soon():
    from fleet_date_schedule import compute_date_schedule

    today = date(2026, 9, 6)
    last_done = today - timedelta(days=150)  # 30 days remaining
    out = compute_date_schedule(
        kind="trailer", interval_days=180,
        last_done_date=_iso(last_done), today=today,
    )
    assert out.status == "due_soon"
    assert out.days_remaining == 30


def test_boundary_31_days_is_on_schedule():
    from fleet_date_schedule import compute_date_schedule

    today = date(2026, 9, 6)
    last_done = today - timedelta(days=149)  # 31 days remaining
    out = compute_date_schedule(
        kind="trailer", interval_days=180,
        last_done_date=_iso(last_done), today=today,
    )
    assert out.status == "on_schedule"
    assert out.days_remaining == 31


def test_overdue_when_interval_set_but_no_pm_recorded():
    """Never-serviced asset with a schedule should show as overdue."""
    from fleet_date_schedule import compute_date_schedule

    out = compute_date_schedule(
        kind="trailer", interval_days=180, last_done_date=None,
    )
    assert out.status == "overdue"
    assert out.next_due is None


def test_bad_date_string_is_treated_as_no_pm():
    from fleet_date_schedule import compute_date_schedule

    out = compute_date_schedule(
        kind="trailer", interval_days=180,
        last_done_date="not-a-date",
    )
    assert out.status == "overdue"


def test_is_date_anchor_kind_predicate():
    from fleet_date_schedule import is_date_anchor_kind
    assert is_date_anchor_kind("trailer") is True
    assert is_date_anchor_kind("tool") is True
    assert is_date_anchor_kind("container") is True
    assert is_date_anchor_kind("plant") is False
    assert is_date_anchor_kind("vehicle") is False
    assert is_date_anchor_kind(None) is False


# ─────────────────────────────────────────────────────────────
# 2. Register hydration — mixed fleet returns correct pills per kind
# ─────────────────────────────────────────────────────────────


def test_attach_date_schedule_mixed_fleet():
    """Simulate the register hydration path — every trailer/tool/
    container gets a `date_schedule` block; metered rows get None."""
    from fleet import _attach_date_schedule

    today = date.today()
    items = [
        {  # metered — should stay None
            "id": "a1", "kind": "plant",
            "service_interval_days": 180,
            "service_last_done_date": _iso(today - timedelta(days=200)),
        },
        {  # trailer overdue
            "id": "a2", "kind": "trailer",
            "service_interval_days": 180,
            "service_last_done_date": _iso(today - timedelta(days=200)),
        },
        {  # tool due_soon
            "id": "a3", "kind": "tool",
            "service_interval_days": 180,
            "service_last_done_date": _iso(today - timedelta(days=168)),
        },
        {  # container on_schedule
            "id": "a4", "kind": "container",
            "service_interval_days": 180,
            "service_last_done_date": _iso(today - timedelta(days=94)),
        },
        {  # trailer no_schedule
            "id": "a5", "kind": "trailer",
            "service_interval_days": None,
            "service_last_done_date": None,
        },
    ]
    _attach_date_schedule(items)

    assert items[0]["date_schedule"] is None  # metered
    assert items[1]["date_schedule"]["status"] == "overdue"
    assert items[2]["date_schedule"]["status"] == "due_soon"
    assert items[3]["date_schedule"]["status"] == "on_schedule"
    assert items[4]["date_schedule"]["status"] == "no_schedule"


# ─────────────────────────────────────────────────────────────
# 3. log_service — bumps `service_last_done_date` for date-anchored
#    assets when the new PM date is more recent than the stored one.
# ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_log_service_bumps_last_done_date_for_trailer(monkeypatch):
    """POST /fleet/assets/{id}/services on a trailer should set
    `assets.service_last_done_date` to the PM's date_completed when
    it is later than the stored value."""
    import fleet as fleet_mod
    from test_fuel_csv_import import _FakeDB

    fake = _FakeDB()
    fake.plant_maintenance = fake.fuel_import_batches.__class__()
    # Seed a trailer asset.
    trailer = {
        "id": "trailer-1", "org_id": "ORG", "kind": "trailer",
        "name": "Site trailer", "rego_serial": "T-99",
        "service_interval_days": 180,
        "service_last_done_date": "2026-04-01",
        "deleted_at": None,
    }
    await fake.assets.insert_one(trailer)
    monkeypatch.setattr(fleet_mod, "db", fake)

    class _Body:
        date_completed = "2026-09-05"
        maintenance_type = "6-monthly inspection"
        cost = 250.0
        description = "Brake test, tyre check"
        performed_by = None
        company = None
        notes = None
        next_due_date = None
        sheet_template_version = None  # short-form log
        checklist_items = None
        advisory_comments = None
        next_service_due_km = None
        next_service_due_hours = None
        mileage_at_service = None
        hours_at_service = None
        technician_user_id = None
        technician_name = None
        technician_signature_data_url = None
        customer_signature_data_url = None
        vin_captured = None
        make_model_captured = None
        service_level = None
        tread_depth_readings = None
        consumables_used = None
        next_inspection_due_date = None
        save_to_asset_record = True

    user = {"id": "u1", "org_id": "ORG"}
    res = await fleet_mod.log_service(
        "trailer-1", _Body(), _flag=None, user=user,
    )
    assert "id" in res or res.get("ok") is True

    # Asset row should now carry the fresher last_done_date.
    a = await fake.assets.find_one({"id": "trailer-1"})
    assert a["service_last_done_date"] == "2026-09-05"


@pytest.mark.asyncio
async def test_log_service_preserves_last_done_when_older_pm(monkeypatch):
    """An older PM MUST NOT overwrite the newer stored date."""
    import fleet as fleet_mod
    from test_fuel_csv_import import _FakeDB

    fake = _FakeDB()
    fake.plant_maintenance = fake.fuel_import_batches.__class__()
    await fake.assets.insert_one({
        "id": "trailer-2", "org_id": "ORG", "kind": "trailer",
        "name": "Yard trailer",
        "service_interval_days": 180,
        "service_last_done_date": "2026-08-15",
        "deleted_at": None,
    })
    monkeypatch.setattr(fleet_mod, "db", fake)

    class _Body:
        date_completed = "2026-04-01"  # older
        maintenance_type = "Ad-hoc repair"
        cost = 50.0
        description = "Replaced light"
        performed_by = None
        company = None
        notes = None
        next_due_date = None
        sheet_template_version = None
        checklist_items = None
        advisory_comments = None
        next_service_due_km = None
        next_service_due_hours = None
        mileage_at_service = None
        hours_at_service = None
        technician_user_id = None
        technician_name = None
        technician_signature_data_url = None
        customer_signature_data_url = None
        vin_captured = None
        make_model_captured = None
        service_level = None
        tread_depth_readings = None
        consumables_used = None
        next_inspection_due_date = None
        save_to_asset_record = True

    user = {"id": "u1", "org_id": "ORG"}
    await fleet_mod.log_service(
        "trailer-2", _Body(), _flag=None, user=user,
    )
    a = await fake.assets.find_one({"id": "trailer-2"})
    # Preserved.
    assert a["service_last_done_date"] == "2026-08-15"


@pytest.mark.asyncio
async def test_log_service_does_not_bump_metered_asset(monkeypatch):
    """Vehicles / plant should NOT have `service_last_done_date`
    touched by the log-service handler — that's date-anchor only."""
    import fleet as fleet_mod
    from test_fuel_csv_import import _FakeDB

    fake = _FakeDB()
    fake.plant_maintenance = fake.fuel_import_batches.__class__()
    await fake.assets.insert_one({
        "id": "veh-1", "org_id": "ORG", "kind": "vehicle",
        "name": "Truck",
        "service_last_done_date": None,
        "deleted_at": None,
    })
    monkeypatch.setattr(fleet_mod, "db", fake)

    class _Body:
        date_completed = "2026-09-05"
        maintenance_type = "Service"
        cost = 500
        description = "Oil + filters"
        performed_by = None
        company = None
        notes = None
        next_due_date = None
        sheet_template_version = None
        checklist_items = None
        advisory_comments = None
        next_service_due_km = None
        next_service_due_hours = None
        mileage_at_service = None
        hours_at_service = None
        technician_user_id = None
        technician_name = None
        technician_signature_data_url = None
        customer_signature_data_url = None
        vin_captured = None
        make_model_captured = None
        service_level = None
        tread_depth_readings = None
        consumables_used = None
        next_inspection_due_date = None
        save_to_asset_record = True

    user = {"id": "u1", "org_id": "ORG"}
    await fleet_mod.log_service(
        "veh-1", _Body(), _flag=None, user=user,
    )
    a = await fake.assets.find_one({"id": "veh-1"})
    # Untouched — still None for metered kinds.
    assert a.get("service_last_done_date") is None

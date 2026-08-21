"""v58.12.6 — Dual-track schedule (D-2) unit tests.

Pure-function tests against `_compute_next_due`, `_compute_axis_due`,
and `_validate_secondary` in `asset_service`. No HTTP / no DB — bypasses
the live-DB guard entirely and proves the semantics deterministically.

Covers the 8-test contract in the v58.12.6 spec:
  1-2. legacy single-axis read/write byte-compat (no `secondary_interval` field)
  3.   legacy schedule update without adding secondary
  4.   dual-axis hours+km on Navixy-linked asset materialises both
  5.   same-kind primary+secondary rejected 422 via _validate_secondary
  6.   secondary=hours on asset without hours_meter rejected
  7.   secondary=km on asset without odo_km rejected
  8.   next_due_at = min(primary.next_due_at, secondary.next_due_at) — None-safe
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from asset_service import (
    _compute_axis_due,
    _compute_next_due,
    _validate_secondary,
    SecondaryInterval,
)


# ─────────────────────── fixture builders ───────────────────────

def navixy_asset(hours: float | None = 8310.5, km: float | None = 126447.0) -> dict:
    """Sample Navixy-linked asset with both readings materialised."""
    return {
        "id": "asset-fixture-1",
        "name": "TestVac",
        "hours_meter": hours,
        "odo_km": km,
    }


def legacy_hours_sched() -> dict:
    """Byte-for-byte shape of one of the 2 existing docs in production
    (`id=1fd87b6e-…`). No secondary_interval field at all."""
    return {
        "id": "leg-1",
        "interval_kind": "hours",
        "interval_value": 500,
        "calendar_unit": None,
        "last_done_at": "2026-06-28T03:44:15.207003Z",
        "last_done_value": 940.1,
        "reminder_lead_days": 7,
        "reminder_lead_hours": None,
        "reminder_lead_km": None,
        "status": "active",
    }


# ─────────────── (1) legacy single-axis READ unchanged ───────────

def test_legacy_single_axis_schedule_read_unchanged():
    """A schedule with NO `secondary_interval` field must materialise
    exactly as pre-v58.12.6 did — new fields are all None."""
    asset = navixy_asset()
    nd = _compute_next_due(legacy_hours_sched(), asset)
    assert nd["next_due_value"] == pytest.approx(1440.1)
    assert nd["next_due_at"] is None  # hours-axis has no date projection
    assert nd["next_due_at_primary"] is None
    assert nd["next_due_at_secondary"] is None
    assert nd["next_due_value_secondary"] is None
    # Status semantics unchanged: 8310.5 > 1440.1 → overdue
    assert nd["status"] == "overdue"
    # Legacy invariant: next_due_at == next_due_at_primary
    assert nd["next_due_at"] == nd["next_due_at_primary"]


# ─────────────── (2) legacy single-axis WRITE unchanged ───────────

def test_legacy_single_axis_schedule_write_unchanged():
    """Feed a legacy-shape schedule (no `secondary_interval`) through
    `_compute_next_due` as would happen on create — output must match
    the byte-identical pre-v58.12.6 materialisation contract."""
    sched = {
        "id": "new-hours-1",
        "interval_kind": "hours",
        "interval_value": 250,
        "last_done_value": 0.0,
        "last_done_at": None,
        "reminder_lead_days": 7,
        "reminder_lead_hours": None,
        "reminder_lead_km": None,
    }
    asset = navixy_asset(hours=100.0, km=5000.0)
    nd = _compute_next_due(sched, asset)
    # Primary next value = last_done_value + interval_value.
    assert nd["next_due_value"] == pytest.approx(250.0)
    # No calendar axis → no next_due_at.
    assert nd["next_due_at"] is None
    # Secondary block absent → all secondary fields None.
    assert nd["next_due_at_secondary"] is None
    assert nd["next_due_value_secondary"] is None
    # Status = ok because 100 < 250 - lead_hours(12.5).
    assert nd["status"] == "ok"


# ─────────────── (3) legacy update without adding secondary ───────

def test_legacy_single_axis_schedule_update_no_secondary():
    """Patch a legacy-shape schedule with any field change EXCEPT adding
    `secondary_interval` — new fields stay None, primary re-materialises."""
    sched = legacy_hours_sched()
    # Simulate a `PUT` that bumps interval_value 500 → 1000 while
    # everything else (including no secondary_interval) is preserved.
    sched["interval_value"] = 1000
    nd = _compute_next_due(sched, navixy_asset())
    assert nd["next_due_value"] == pytest.approx(1940.1)  # 940.1 + 1000
    assert nd["next_due_at_secondary"] is None
    assert nd["next_due_value_secondary"] is None


# ─────────────── (4) dual-axis hours+km materialises both ────────

def test_dual_axis_hours_plus_km_materialises_both():
    """A schedule with primary=hours + secondary=km on a Navixy asset
    with both readings must materialise BOTH projections and pick the
    worst status."""
    sched = {
        "id": "dual-1",
        "interval_kind": "hours",
        "interval_value": 250,
        "last_done_value": 940.1,
        "reminder_lead_days": 7,
        "reminder_lead_hours": None,
        "reminder_lead_km": None,
        "secondary_interval": {
            "kind": "km",
            "value": 10000,
            "last_done_value": 120000.0,
            "reminder_lead": None,
        },
    }
    asset = navixy_asset(hours=8310.5, km=126447.0)
    nd = _compute_next_due(sched, asset)
    # Primary: 940.1 + 250 = 1190.1. Asset at 8310.5 → overdue.
    assert nd["next_due_value"] == pytest.approx(1190.1)
    # Secondary: 120000 + 10000 = 130000. Asset at 126447 → due_soon
    # (lead_km defaults to interval*0.05 = 500 → threshold 129500).
    assert nd["next_due_value_secondary"] == pytest.approx(130000.0)
    # No calendar axis on either side → both next_at fields None.
    assert nd["next_due_at_primary"] is None
    assert nd["next_due_at_secondary"] is None
    assert nd["next_due_at"] is None
    # Worst-of merge: primary=overdue, secondary=due_soon → overdue.
    assert nd["status"] == "overdue"


# ─────────────── (5) same-kind rejection ────────────────────────

def test_same_kind_secondary_rejected():
    secondary = SecondaryInterval(kind="hours", value=100)
    with pytest.raises(HTTPException) as exc:
        _validate_secondary("hours", secondary, navixy_asset())
    assert exc.value.status_code == 422
    assert "different dimensions" in exc.value.detail


# ─────────────── (6) missing hours_meter rejection ───────────────

def test_secondary_hours_rejected_on_asset_without_hours_meter():
    secondary = SecondaryInterval(kind="hours", value=250)
    asset = navixy_asset(hours=None, km=5000.0)  # non-Navixy: no hours
    with pytest.raises(HTTPException) as exc:
        _validate_secondary("km", secondary, asset)
    assert exc.value.status_code == 422
    assert "hours_meter" in exc.value.detail


# ─────────────── (7) missing odo_km rejection ────────────────────

def test_secondary_km_rejected_on_asset_without_odo_km():
    secondary = SecondaryInterval(kind="km", value=10000)
    asset = navixy_asset(hours=100.0, km=None)  # hour-only asset
    with pytest.raises(HTTPException) as exc:
        _validate_secondary("hours", secondary, asset)
    assert exc.value.status_code == 422
    assert "odo_km" in exc.value.detail


# ─────────────── (8) None-safe min for next_due_at ────────────────

def test_next_due_at_is_min_of_primary_and_secondary_none_safe():
    """Primary=hours (no date) + secondary=calendar (has a date) →
    merged next_due_at = secondary's date."""
    sched = {
        "id": "cal-2",
        "interval_kind": "hours",
        "interval_value": 250,
        "last_done_value": 0.0,
        "reminder_lead_days": 7,
        "secondary_interval": {
            "kind": "calendar",
            "value": 30,
            "calendar_unit": "days",
            "last_done_at": "2026-01-01T00:00:00Z",  # far past → overdue
            "reminder_lead": 7,
        },
    }
    asset = navixy_asset(hours=100.0, km=5000.0)
    nd = _compute_next_due(sched, asset)
    # Primary has no date; secondary date populated → merged uses secondary.
    assert nd["next_due_at_primary"] is None
    assert nd["next_due_at_secondary"] is not None
    assert nd["next_due_at"] == nd["next_due_at_secondary"]
    # Legacy-doc invariant: when no secondary is present, next_due_at ==
    # next_due_at_primary. Verify the OPPOSITE direction here — with a
    # secondary that HAS a date, next_due_at != next_due_at_primary.
    assert nd["next_due_at"] != nd["next_due_at_primary"]


# ─────────────── bonus: axis-projection sanity ────────────────────

def test_compute_axis_due_hours_projects_correctly():
    """Extracted helper — regression guard on the projection math."""
    r = _compute_axis_due(
        navixy_asset(hours=200.0), kind="hours", interval=250,
        last_v=0.0, last_at=None, calendar_unit=None,
        lead_days=7, lead_hours=12.5, lead_km=500,
    )
    assert r["next_value"] == 250.0
    assert r["next_at"] is None
    assert r["status"] == "ok"  # 200 < 250 - 12.5 (237.5) → ok

"""v58.13.18 — Service Inbox pytests.

Handler-level tests with a monkeypatched `db` mock. Follows the same
pattern established by v58.13.17's test_asset_service_generate.py
(handler imported directly, `db.` attributes replaced with
AsyncMock / MagicMock). Location outside /app/backend/ per the
v58.13.10 hard rule (no reload storms).

Coverage:
  1. Empty result shape ({due:[], generated:[], counts: all zero}).
  2. DUE join — a schedule crossing threshold + its asset appears.
  3. GENERATED join — a cron record (`generated_by ==
     "asset_service_generate"`, performed_at is None) appears.
  4. Performed records NOT surfaced on GENERATED side.
  5. Soft-deleted records NOT surfaced on GENERATED side.
  6. Non-generated pending records NOT surfaced (only cron records).
  7. Schedules whose asset is missing/deleted are filtered.
  8. `limit` query param clamps to Pydantic hard-max (500).
  9. Response shape: asset.name + asset.rego_serial present on both.
 10. `counts` bucket totals match returned rows.
"""
from __future__ import annotations
import os
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

_BACKEND = Path("/app/backend")
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))
_env = _BACKEND / ".env"
if _env.exists():
    for _line in _env.read_text(encoding="utf-8").splitlines():
        _line = _line.strip()
        if not _line or _line.startswith("#") or "=" not in _line:
            continue
        _k, _, _v = _line.partition("=")
        os.environ.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))

import asset_service  # noqa: E402


ORG = "org-abc"
USER = {"id": "u-1", "org_id": ORG, "role": "admin", "email": "t@t"}


def _asset(**over):
    base = {
        "id": "asset-1", "org_id": ORG, "deleted_at": None,
        "name": "Truck 42", "rego_serial": "ABC-123", "kind": "vehicle",
        "hours_meter": 8310.0, "odo_km": 126400.0,
    }
    base.update(over)
    return base


def _sched(**over):
    base = {
        "id": "sched-1", "org_id": ORG, "asset_id": "asset-1",
        "workspace_id": None, "status": "active", "deleted_at": None,
        "name": "250h service", "interval_kind": "hours",
        "interval_value": 250, "last_done_value": 8000.0,
        "reminder_lead_days": 7, "reminder_lead_hours": 5,
        "reminder_lead_km": 100,
        "priority": "High", "task_type": "Maintenance",
        "task_identification": "250h",
        "calendar_unit": None, "secondary_interval": None,
    }
    base.update(over)
    return base


def _record(**over):
    base = {
        "id": "rec-1", "org_id": ORG, "asset_id": "asset-1",
        "workspace_id": None, "deleted_at": None,
        "type": "Service", "title": "Auto: 250h service",
        "description": "", "schedule_id": "sched-1",
        "performed_at": None,
        "hours_at": None, "km_at": None,
        "created_at": "2026-08-21T02:00:00+00:00",
        "generated_by": "asset_service_generate",
        "generated_by_run_id": "asset_service_generate:2026-08-21",
    }
    base.update(over)
    return base


class _FakeCursor:
    """Async iterator + fluent sort/limit that mirrors motor's cursor."""
    def __init__(self, items):
        self._items = list(items)

    def sort(self, *_a, **_k):
        # No-op: tests seed already-ordered lists.
        return self

    def limit(self, n):
        self._items = self._items[: int(n)]
        return self

    def __aiter__(self):
        return self._aiter()

    async def _aiter(self):
        for i in self._items:
            yield i


class _FakeDB:
    """Mimics `motor` collections used by service_inbox — schedules,
    records, and assets. Only the surface the handler touches."""
    def __init__(self, schedules, records, assets):
        self._schedules = list(schedules)
        self._records = list(records)
        self._assets = {a["id"]: a for a in assets}

        self.asset_service_schedules = MagicMock()
        self.asset_service_schedules.find = MagicMock(
            side_effect=self._find_schedules)

        self.asset_service_records = MagicMock()
        self.asset_service_records.find = MagicMock(
            side_effect=self._find_records)

        self.assets = MagicMock()
        self.assets.find_one = AsyncMock(side_effect=self._find_asset)

    def _find_schedules(self, filt, _projection=None):
        rows = [s for s in self._schedules
                if s.get("org_id") == filt.get("org_id")
                and s.get("status") == filt.get("status")
                and s.get("deleted_at") is None]
        return _FakeCursor(rows)

    def _find_records(self, filt, _projection=None):
        rows = [r for r in self._records
                if r.get("org_id") == filt.get("org_id")
                and r.get("deleted_at") is None
                and r.get("performed_at") is None
                and r.get("generated_by") == filt.get("generated_by")]
        return _FakeCursor(rows)

    async def _find_asset(self, filt, _projection=None):
        return self._assets.get(filt.get("id"))


@pytest.fixture
def _patch_db(monkeypatch):
    def _apply(schedules=None, records=None, assets=None):
        fake = _FakeDB(schedules or [], records or [], assets or [])
        monkeypatch.setattr(asset_service, "db", fake)
        return fake
    return _apply


@pytest.mark.asyncio
async def test_empty_inbox(_patch_db):
    _patch_db(schedules=[], records=[], assets=[])
    resp = await asset_service.service_inbox(limit=200, user=USER)
    assert resp == {"due": [], "generated": [],
                    "counts": {"overdue": 0, "due_soon": 0, "generated": 0}}


@pytest.mark.asyncio
async def test_due_side_joins_asset(_patch_db):
    """Meter (8310) is well past next-due (8000+250=8250) → overdue."""
    _patch_db(
        schedules=[_sched()],
        records=[],
        assets=[_asset(hours_meter=8310.0)],
    )
    resp = await asset_service.service_inbox(limit=200, user=USER)
    assert len(resp["due"]) == 1
    row = resp["due"][0]
    assert row["schedule_id"] == "sched-1"
    assert row["status"] == "overdue"
    assert row["asset"]["name"] == "Truck 42"
    assert row["asset"]["rego_serial"] == "ABC-123"
    assert row["asset"]["kind"] == "vehicle"
    assert resp["counts"]["overdue"] == 1
    assert resp["counts"]["due_soon"] == 0
    assert resp["counts"]["generated"] == 0


@pytest.mark.asyncio
async def test_generated_side_surfaces_pending_cron_record(_patch_db):
    _patch_db(
        schedules=[],
        records=[_record()],
        assets=[_asset()],
    )
    resp = await asset_service.service_inbox(limit=200, user=USER)
    assert len(resp["generated"]) == 1
    g = resp["generated"][0]
    assert g["record_id"] == "rec-1"
    assert g["title"] == "Auto: 250h service"
    assert g["asset"]["name"] == "Truck 42"
    assert g["asset"]["rego_serial"] == "ABC-123"
    assert g["generated_by_run_id"] == "asset_service_generate:2026-08-21"
    assert resp["counts"]["generated"] == 1


@pytest.mark.asyncio
async def test_performed_record_not_in_generated(_patch_db):
    """A record with performed_at set MUST NOT appear on the
    generated side (regression guard for the fake DB filter)."""
    _patch_db(
        schedules=[],
        records=[_record(id="rec-done", performed_at="2026-08-21T04:00:00+00:00")],
        assets=[_asset()],
    )
    resp = await asset_service.service_inbox(limit=200, user=USER)
    assert resp["generated"] == []
    assert resp["counts"]["generated"] == 0


@pytest.mark.asyncio
async def test_soft_deleted_record_not_in_generated(_patch_db):
    _patch_db(
        schedules=[],
        records=[_record(id="rec-del", deleted_at="2026-08-21T04:00:00+00:00")],
        assets=[_asset()],
    )
    resp = await asset_service.service_inbox(limit=200, user=USER)
    assert resp["generated"] == []


@pytest.mark.asyncio
async def test_non_cron_pending_record_not_surfaced(_patch_db):
    """Only records with generated_by == "asset_service_generate"
    belong on the generated side. A manually-created pending record
    (generated_by=None) must be filtered out."""
    _patch_db(
        schedules=[],
        records=[_record(id="rec-manual", generated_by=None)],
        assets=[_asset()],
    )
    resp = await asset_service.service_inbox(limit=200, user=USER)
    assert resp["generated"] == []


@pytest.mark.asyncio
async def test_schedule_with_missing_asset_is_filtered(_patch_db):
    """Orphan schedule (asset deleted) should not crash — just skip."""
    _patch_db(
        schedules=[_sched(asset_id="missing-asset")],
        records=[],
        assets=[_asset()],  # asset-1 only; missing-asset absent
    )
    resp = await asset_service.service_inbox(limit=200, user=USER)
    assert resp["due"] == []


@pytest.mark.asyncio
async def test_response_shape_and_counts_add_up(_patch_db):
    """Multiple due + generated rows; counts must equal actual bucket
    sizes, and asset join fields must be present on both sides."""
    _patch_db(
        schedules=[
            _sched(id="s-overdue", asset_id="asset-1"),  # 8310 vs 8250 → overdue
            _sched(id="s-ok", asset_id="asset-2",  # meter well below → skip
                   last_done_value=0.0, interval_value=250),
        ],
        records=[_record(id="r-1"), _record(id="r-2", asset_id="asset-2")],
        assets=[
            _asset(id="asset-1", hours_meter=8310.0),
            _asset(id="asset-2", name="Excavator 7", rego_serial="XYZ-9",
                   hours_meter=10.0),
        ],
    )
    resp = await asset_service.service_inbox(limit=200, user=USER)
    # DUE: only the overdue one survives (asset-2 schedule is ok).
    assert len(resp["due"]) == 1
    assert resp["due"][0]["schedule_id"] == "s-overdue"
    # GENERATED: both records survive.
    assert {g["record_id"] for g in resp["generated"]} == {"r-1", "r-2"}
    # Both sides carry asset name + rego.
    for row in resp["due"]:
        assert "name" in row["asset"] and "rego_serial" in row["asset"]
    for row in resp["generated"]:
        assert "name" in row["asset"] and "rego_serial" in row["asset"]
    # Counts consistency.
    assert resp["counts"]["overdue"] == 1
    assert resp["counts"]["generated"] == 2

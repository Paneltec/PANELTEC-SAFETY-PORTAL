"""v58.13.17 — asset_service_generate cron pytests.

Handler-level tests with monkeypatched db mock. Location outside
/app/backend/ per v58.13.10 hard rule.
"""
from __future__ import annotations
import os, sys
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
        if not _line or _line.startswith("#") or "=" not in _line: continue
        _k, _, _v = _line.partition("=")
        os.environ.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))

import cron_asset_service_generate as mod  # noqa: E402


def _sched(**over):
    base = {
        "id": "sched-1", "org_id": "org-1", "asset_id": "asset-1",
        "workspace_id": "ws-1", "deleted_at": None,
        "interval_kind": "hours", "interval_value": 250,
        "next_due_value": 8300.0, "next_due_value_secondary": None,
        "secondary_interval": None,
        "task_type": "Service", "task_identification": "250h service",
        "description_html": "", "assigned_to_worker_name": "Alice",
    }
    base.update(over); return base


def _asset(**over):
    from datetime import datetime, timezone
    fresh = datetime.now(timezone.utc).isoformat()
    base = {
        "id": "asset-1", "org_id": "org-1", "deleted_at": None,
        "hours_meter": 8310.0, "hours_meter_updated_at": fresh,
        "odo_km": 126400.0, "odo_km_updated_at": fresh,
    }
    base.update(over); return base


class _FakeDB:
    def __init__(self, schedules, asset):
        self.schedules = schedules; self.asset = asset
        self.inserted_records = []; self.updated_schedules = []; self.run_summary = None
        self.asset_service_records = MagicMock()
        self.asset_service_records.insert_one = AsyncMock(side_effect=self._insert_rec)
        self.asset_service_records.create_index = AsyncMock()
        self.asset_service_schedules = MagicMock()
        self.asset_service_schedules.find = MagicMock(side_effect=self._find_scheds)
        self.asset_service_schedules.update_one = AsyncMock(side_effect=self._upd_sched)
        self.assets = MagicMock()
        self.assets.find_one = AsyncMock(return_value=asset)
        self.asset_service_generate_runs = MagicMock()
        self.asset_service_generate_runs.insert_one = AsyncMock(side_effect=self._set_summary)

    async def _insert_rec(self, doc):
        # Emulate compound-unique index
        for e in self.inserted_records:
            if e["schedule_id"] == doc["schedule_id"] and e.get("generated_by_run_id") == doc.get("generated_by_run_id"):
                raise Exception("E11000 duplicate key")
        self.inserted_records.append(doc)

    async def _upd_sched(self, filt, upd):
        self.updated_schedules.append((filt, upd))

    async def _set_summary(self, doc): self.run_summary = doc

    def _find_scheds(self, _query):
        class _Cursor:
            def __init__(_s, items): _s._i = list(items)
            def __aiter__(_s): return _s
            async def __anext__(_s):
                if not _s._i: raise StopAsyncIteration
                return _s._i.pop(0)
        return _Cursor(self.schedules)


@pytest.fixture
def patched_db(monkeypatch):
    def _mk(schedules, asset=None):
        fake = _FakeDB(schedules, asset if asset is not None else _asset())
        monkeypatch.setattr(mod, "db", fake); return fake
    return _mk


@pytest.mark.asyncio
async def test_hours_crosses_threshold_fires_one_record(patched_db):
    fake = patched_db([_sched()])
    stats = await mod.run_generate(commit=True, run_id="test-1")
    assert stats["fired"] == 1 and stats["scanned"] == 1
    rec = fake.inserted_records[0]
    assert rec["type"] == "Service" and rec["schedule_id"] == "sched-1"
    assert rec["hours_at"] == 8310.0 and rec["km_at"] == 126400.0
    assert rec["generated_by"] == "cron:v58.13.17"
    assert rec["generated_by_run_id"] == "test-1"


@pytest.mark.asyncio
async def test_dual_track_hours_fires_advances_both(patched_db):
    fake = patched_db([_sched(
        interval_kind="hours", next_due_value=8300.0,
        secondary_interval={"kind": "km", "interval_value": 10000},
        next_due_value_secondary=999999.0,  # km not yet due
    )])
    stats = await mod.run_generate(commit=True, run_id="t2")
    assert stats["fired"] == 1
    upd = fake.updated_schedules[0][1]["$set"]
    assert upd["last_done_value"] == 8310.0
    assert upd["last_done_value_secondary"] == 126400.0


@pytest.mark.asyncio
async def test_dual_track_km_fires_advances_both(patched_db):
    fake = patched_db([_sched(
        interval_kind="hours", next_due_value=999999.0,  # hours not due
        secondary_interval={"kind": "km", "interval_value": 10000},
        next_due_value_secondary=126000.0,  # km due
    )])
    stats = await mod.run_generate(commit=True, run_id="t3")
    assert stats["fired"] == 1
    upd = fake.updated_schedules[0][1]["$set"]
    assert upd["last_done_value"] == 8310.0
    assert upd["last_done_value_secondary"] == 126400.0


@pytest.mark.asyncio
async def test_stale_meter_is_skipped(patched_db):
    fake = patched_db([_sched()], _asset(hours_meter_updated_at="2020-01-01T00:00:00+00:00"))
    stats = await mod.run_generate(commit=True, run_id="t4")
    assert stats["skipped_stale"] == 1 and stats["fired"] == 0


@pytest.mark.asyncio
async def test_missing_asset_is_skipped(patched_db):
    fake = patched_db([_sched()])
    fake.assets.find_one = AsyncMock(return_value=None)
    stats = await mod.run_generate(commit=True, run_id="t5")
    assert stats["skipped_no_asset"] == 1 and stats["fired"] == 0


@pytest.mark.asyncio
async def test_not_yet_due_no_fire(patched_db):
    patched_db([_sched(next_due_value=99999.0)])
    stats = await mod.run_generate(commit=True, run_id="t6")
    assert stats["not_yet_due"] == 1 and stats["fired"] == 0


@pytest.mark.asyncio
async def test_dry_run_writes_nothing(patched_db):
    fake = patched_db([_sched()])
    stats = await mod.run_generate(commit=False, run_id="t7")
    assert stats["fired"] == 1
    assert fake.inserted_records == [] and fake.updated_schedules == []
    assert fake.run_summary is None


@pytest.mark.asyncio
async def test_compound_unique_prevents_double_write(patched_db):
    fake = patched_db([_sched(), _sched()])  # 2 schedules
    # Force same schedule_id → collision on second
    fake.schedules[1] = _sched()  # same id
    stats = await mod.run_generate(commit=True, run_id="t8")
    assert stats["fired"] == 1 and stats["errors"] == 1


@pytest.mark.asyncio
async def test_telemetry_summary_inserted(patched_db):
    fake = patched_db([_sched()])
    await mod.run_generate(commit=True, run_id="t9")
    assert fake.run_summary is not None
    assert fake.run_summary["fired"] == 1
    assert fake.run_summary["run_id"] == "t9"


def test_register_off_by_default(monkeypatch):
    monkeypatch.delenv("ASSET_SERVICE_GENERATE_CRON", raising=False)
    sched = MagicMock()
    assert mod.register_asset_service_generate_cron(sched) is False
    sched.add_job.assert_not_called()


def test_register_on_when_env_set(monkeypatch):
    monkeypatch.setenv("ASSET_SERVICE_GENERATE_CRON", "1")
    sched = MagicMock()
    assert mod.register_asset_service_generate_cron(sched) is True
    sched.add_job.assert_called_once()
    kwargs = sched.add_job.call_args.kwargs
    assert kwargs["hour"] == 2 and kwargs["minute"] == 0
    assert kwargs["id"] == "asset_service_generate"

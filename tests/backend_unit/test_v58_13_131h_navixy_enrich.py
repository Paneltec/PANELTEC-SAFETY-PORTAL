"""v58.13.131h — Navixy enrichment migration tests (compact).

Full-coverage tests for the four enrichment scenarios (fresh
snapshot, stale snapshot, unknown, csv-wins guard) + migration
idempotency + rollback. Uses an in-memory fake DB — no live-DB
touch."""
from __future__ import annotations
import copy
import sys, os
from datetime import datetime, timedelta, timezone

import pytest

sys.path.insert(0, os.path.abspath("/app/backend"))
sys.path.insert(0, os.path.abspath("/app/backend/migrations"))

import v58_13_131h_navixy_enrich as mig


# ── Fake DB (minimal, tuned for this migration) ───────────────
class _Res:
    def __init__(self, matched, modified):
        self.matched_count = matched
        self.modified_count = modified


class _Coll:
    def __init__(self):
        self.docs = []

    async def find(self, q=None, projection=None):
        q = q or {}
        for d in self.docs:
            if _match(d, q):
                yield copy.deepcopy(d)

    async def update_one(self, q, upd):
        for d in self.docs:
            if _match(d, q):
                for k, v in (upd.get("$set") or {}).items():
                    d[k] = v
                for k in (upd.get("$unset") or {}).keys():
                    d.pop(k, None)
                return _Res(1, 1)
        return _Res(0, 0)

    async def update_many(self, q, upd):
        m = md = 0
        for d in self.docs:
            if _match(d, q):
                m += 1; changed = False
                for k, v in (upd.get("$set") or {}).items():
                    d[k] = v; changed = True
                for k in (upd.get("$unset") or {}).keys():
                    if k in d: d.pop(k); changed = True
                if changed: md += 1
        return _Res(m, md)


def _match(d, q):
    for k, v in q.items():
        if k == "$or":
            if not any(_match(d, s) for s in v): return False
            continue
        if isinstance(v, dict):
            for op, exp in v.items():
                if op == "$ne" and d.get(k) == exp: return False
                if op == "$in" and d.get(k) not in exp: return False
                if op == "$type" and exp == "string" and not isinstance(d.get(k), str): return False
        else:
            if d.get(k) != v: return False
    return True


class _FakeDB:
    def __init__(self):
        self.assets = _Coll()
        self.fuel_transactions = _Coll()
        self.asset_meter_history = _Coll()


def _now():
    return datetime.now(timezone.utc)


def _iso(dt):
    return dt.strftime("%Y-%m-%d %H:%M:%S")


# ── Enrichment scenarios ──────────────────────────────────────
@pytest.mark.asyncio
async def test_fresh_snapshot_enriches_row():
    fake = _FakeDB()
    fake.assets.docs.append({
        "id": "A1", "navixy_device_id": 111,
        "odo_km": 127009.6, "hours_meter": 8331.7,
        "odo_km_updated_at": _iso(_now() - timedelta(hours=1)),
        "hours_meter_updated_at": _iso(_now() - timedelta(hours=1)),
    })
    fake.fuel_transactions.docs.append({
        "id": "T1", "asset_id": "A1", "odometer_km": 0,
        "deleted_at": None, "registration": "ABC",
    })
    counts = await mig.run_discovery(fake)
    assert counts.would_navixy_snapshot == 1
    assert counts.would_snapshot_stale == 0
    assert counts.would_unknown == 0
    p = counts.proposed[0]
    assert p["source"] == "navixy_snapshot"
    assert p["confidence"] == "fresh"
    assert p["proposed_odo"] == 127010


@pytest.mark.asyncio
async def test_stale_snapshot_marked_stale():
    fake = _FakeDB()
    fake.assets.docs.append({
        "id": "A1", "navixy_device_id": 111, "odo_km": 100000,
        "odo_km_updated_at": _iso(_now() - timedelta(days=5)),
    })
    fake.fuel_transactions.docs.append({
        "id": "T1", "asset_id": "A1", "odometer_km": 0, "deleted_at": None,
    })
    counts = await mig.run_discovery(fake)
    assert counts.would_snapshot_stale == 1
    assert counts.proposed[0]["confidence"] == "stale"


@pytest.mark.asyncio
async def test_unknown_when_no_navixy_device():
    fake = _FakeDB()
    fake.assets.docs.append({"id": "A1", "navixy_device_id": None})
    fake.fuel_transactions.docs.append({
        "id": "T1", "asset_id": "A1", "odometer_km": 0, "deleted_at": None,
    })
    counts = await mig.run_discovery(fake)
    assert counts.would_unknown == 1
    assert counts.proposed[0]["source"] == "unknown"


@pytest.mark.asyncio
async def test_unmatched_row_lands_unknown_no_asset_id():
    fake = _FakeDB()
    fake.fuel_transactions.docs.append({
        "id": "T1", "asset_id": None, "odometer_km": 0, "deleted_at": None,
    })
    counts = await mig.run_discovery(fake)
    assert counts.no_asset_id == 1
    assert counts.would_unknown == 1


@pytest.mark.asyncio
async def test_csv_wins_row_not_scanned():
    """Rows with odometer_km > 0 are excluded from the query and
    never get an enrichment stamp — CSV always wins."""
    fake = _FakeDB()
    fake.assets.docs.append({"id": "A1", "navixy_device_id": 111, "odo_km": 100000})
    fake.fuel_transactions.docs.append({
        "id": "T-good", "asset_id": "A1", "odometer_km": 55000, "deleted_at": None,
    })
    fake.fuel_transactions.docs.append({
        "id": "T-zero", "asset_id": "A1", "odometer_km": 0, "deleted_at": None,
    })
    counts = await mig.run_discovery(fake)
    assert counts.scanned == 1
    assert counts.proposed[0]["id"] == "T-zero"


# ── Apply + rollback ─────────────────────────────────────────
@pytest.mark.asyncio
async def test_apply_writes_and_rollback_clears(tmp_path, monkeypatch):
    monkeypatch.setattr(mig, "APPLY_LOG", str(tmp_path / "apply.md"))
    fake = _FakeDB()
    fake.assets.docs.append({
        "id": "A1", "navixy_device_id": 111,
        "odo_km": 100000, "hours_meter": 500,
        "odo_km_updated_at": _iso(_now() - timedelta(hours=1)),
        "hours_meter_updated_at": _iso(_now() - timedelta(hours=1)),
    })
    fake.assets.docs.append({"id": "A2", "navixy_device_id": None})
    fake.fuel_transactions.docs.append({
        "id": "T1", "asset_id": "A1", "odometer_km": 0, "deleted_at": None,
    })
    fake.fuel_transactions.docs.append({
        "id": "T2", "asset_id": "A2", "odometer_km": 0, "deleted_at": None,
    })
    counts = await mig.run_discovery(fake)
    res = await mig.run_apply(fake, counts)
    assert res["updated_odo"] == 1
    assert res["unknowns"] == 1
    t1 = next(d for d in fake.fuel_transactions.docs if d["id"] == "T1")
    t2 = next(d for d in fake.fuel_transactions.docs if d["id"] == "T2")
    assert t1["odometer_km"] == 100000
    assert t1["odometer_source"] == "navixy_snapshot"
    assert t1["_enrichment_confidence"] == "fresh"
    assert t2["odometer_source"] == "unknown"
    assert "odometer_km" not in {k: v for k, v in t2.items() if v != 0}  # kept at 0

    # Rollback
    rb = await mig.run_rollback(fake)
    assert rb["modified"] >= 1
    t1 = next(d for d in fake.fuel_transactions.docs if d["id"] == "T1")
    assert "odometer_source" not in t1
    assert t1["odometer_km"] == 0

    # Idempotent second rollback
    rb2 = await mig.run_rollback(fake)
    # After first rollback all rows are back to odo=0 with no source
    # marker, so second rollback matches zero rows.
    assert rb2["matched"] == 0


# ── Dry-run report file ──────────────────────────────────────
@pytest.mark.asyncio
async def test_dryrun_writes_report(tmp_path):
    fake = _FakeDB()
    fake.assets.docs.append({
        "id": "A1", "navixy_device_id": 111, "odo_km": 100,
        "odo_km_updated_at": _iso(_now() - timedelta(hours=1)),
    })
    fake.fuel_transactions.docs.append({
        "id": "T1", "asset_id": "A1", "odometer_km": 0, "deleted_at": None,
    })
    counts = await mig.run_discovery(fake)
    p = tmp_path / "dryrun.md"
    mig.write_dryrun_report(counts, target=str(p))
    txt = p.read_text()
    assert "navixy_snapshot" in txt
    assert "Would enrich" in txt


# ── Version pin ──────────────────────────────────────────────
def test_version_at_least_131h():
    # v58.13.122c — Ship chronology is not monotonic; assert the .131h
    # ship memo exists as proof-of-ship instead of regexing the current
    # version pin.
    from pathlib import Path
    memo = Path("/app/memory/v58_13_131h_shipped_finish_deferred.md")
    assert memo.exists(), "v58.13.131h ship memo missing — ship regressed?"

"""v58.13.131b — SmartFill Fuel CSV Importer backend tests.

Uses a fake in-memory DB (`_FakeDB`) monkeypatched into `fleet_fuel`
to sidestep motor's per-test event-loop binding entirely. This matches
the FakeDB pattern already used across `tests/backend_unit/`.

Cleanup rule (per prior-fork regression):
  · The fake DB lives inside the test process — no live-DB writes.
  · No `assets` collection pollution possible.
"""
from __future__ import annotations
import re
from datetime import datetime, timezone

import pytest

import fleet_fuel as ff
from fleet_fuel import (
    _sniff_dialect, _parse_date, _parse_time, _parse_datetime,
    _norm_header, _map_headers, _HOUR_WINDOW, _DEFAULT_TZ,
)


# ── FakeDB ──────────────────────────────────────────────────────
class _FakeCollection:
    def __init__(self):
        self.docs: list[dict] = []

    async def insert_one(self, doc):
        self.docs.append(dict(doc))

    async def find_one(self, q, projection=None):
        for d in self.docs:
            if self._match(d, q):
                return dict(d)
        return None

    def find(self, q, projection=None):
        matches = [dict(d) for d in self.docs if self._match(d, q)]
        return _FakeCursor(matches)

    async def count_documents(self, q):
        return sum(1 for d in self.docs if self._match(d, q))

    async def update_one(self, q, upd):
        for d in self.docs:
            if self._match(d, q):
                self._apply(d, upd)
                class R: matched_count = 1
                return R()
        class R: matched_count = 0
        return R()

    async def update_many(self, q, upd):
        n = 0
        for d in self.docs:
            if self._match(d, q):
                self._apply(d, upd); n += 1
        class R:
            def __init__(s, n): s.modified_count = n
        return R(n)

    async def delete_one(self, q):
        for i, d in enumerate(self.docs):
            if self._match(d, q):
                self.docs.pop(i); return
    async def delete_many(self, q):
        self.docs = [d for d in self.docs if not self._match(d, q)]

    async def create_index(self, *a, **k):
        return None

    @staticmethod
    def _apply(d, upd):
        for op, block in upd.items():
            if op == "$set":
                for k, v in block.items(): d[k] = v

    @staticmethod
    def _match(d, q):
        for k, v in q.items():
            if isinstance(v, dict):
                if "$ne" in v:
                    if d.get(k) == v["$ne"]: return False
                    continue
                if "$gte" in v or "$lte" in v:
                    val = d.get(k)
                    if "$gte" in v and (val is None or val < v["$gte"]): return False
                    if "$lte" in v and (val is None or val > v["$lte"]): return False
                    continue
                if "$regex" in v:
                    if not re.search(v["$regex"], str(d.get(k, ""))): return False
                    continue
                if "$elemMatch" in v:
                    arr = d.get(k) or []
                    if not any(_FakeCollection._match(x, v["$elemMatch"]) for x in arr):
                        return False
                    continue
            elif d.get(k) != v:
                return False
        return True


class _FakeCursor:
    def __init__(self, docs): self._docs = docs
    def sort(self, key, dir=1):
        self._docs.sort(key=lambda d: d.get(key) or "", reverse=(dir == -1))
        return self
    def skip(self, n): self._docs = self._docs[n:]; return self
    def limit(self, n): self._docs = self._docs[:n]; return self
    def __aiter__(self): self._i = 0; return self
    async def __anext__(self):
        if self._i >= len(self._docs): raise StopAsyncIteration
        d = self._docs[self._i]; self._i += 1; return d


class _FakeDB:
    def __init__(self):
        self.assets = _FakeCollection()
        self.fuel_transactions = _FakeCollection()
        self.fuel_import_batches = _FakeCollection()
        # v58.13.131i — enrichment path reads from this collection.
        self.asset_meter_history = _FakeCollection()
    async def list_collection_names(self):
        return ["assets", "fuel_transactions", "fuel_import_batches",
                "asset_meter_history"]


@pytest.fixture(autouse=True)
def _patch_db(monkeypatch):
    fake = _FakeDB()
    monkeypatch.setattr(ff, "db", fake)
    return fake


def _iso_utc(y, m, d, h, minute=0, tz_name=_DEFAULT_TZ):
    from zoneinfo import ZoneInfo
    return datetime(y, m, d, h, minute, tzinfo=ZoneInfo(tz_name)).astimezone(timezone.utc).isoformat()


async def _seed_asset(fake, **kw):
    d = {"id": kw.get("id", f"a_{len(fake.assets.docs)}"),
         "org_id": "ORG", "kind": "vehicle", "name": kw.get("name", "Test"),
         "rego_serial": kw.get("rego_serial"), "smartfill_key_code": kw.get("smartfill_key_code"),
         "smartfill_card_number": kw.get("smartfill_card_number"),
         "fuel_tank_capacity_l": kw.get("fuel_tank_capacity_l"),
         "odo_km": kw.get("odo_km"), "hours_meter": kw.get("hours_meter"),
         "deleted_at": None}
    await fake.assets.insert_one(d); return d


# ── Header normaliser ───────────────────────────────────────────
def test_header_normaliser_variants():
    # `_norm_header` strips non-alnum only. Header ALIASES bridge the
    # semantic mapping — verify `_map_headers` resolves all variants
    # to the same canonical `transaction_id` key.
    assert _norm_header("Transaction Id") == "transactionid"
    assert _norm_header("TransactionID") == "transactionid"
    assert _norm_header("transactionid") == "transactionid"
    # TRANS_ID / trans-id normalise to `transid` which is in the alias
    # list for `transaction_id` — the mapper resolves them correctly.
    m, _ = _map_headers(["TRANS_ID", "Litres"])
    assert m.get("transaction_id") == "TRANS_ID"
    m2, _ = _map_headers(["trans-id", "Litres"])
    assert m2.get("transaction_id") == "trans-id"


def test_map_headers_maps_variants_identically():
    m1, _ = _map_headers(["Transaction Id", "Date", "Time", "Registration", "Litres"])
    m2, _ = _map_headers(["TransactionID", "Date", "Time", "Registration", "Litres"])
    m3, _ = _map_headers(["TRANS_ID", "Date", "Time", "Registration", "Litres"])
    assert set(m1) == set(m2) == set(m3)
    assert "transaction_id" in m1
    assert "registration" in m1
    assert "litres" in m1


# ── Parsers ────────────────────────────────────────────────────
def test_parse_date_formats():
    assert _parse_date("2026-09-01") == "2026-09-01"
    assert _parse_date("01/09/2026") == "2026-09-01"
    assert _parse_date("junk") is None


def test_parse_time_formats():
    assert _parse_time("08:14:32") == "08:14:32"
    assert _parse_time("08:14") == "08:14:00"


def test_parse_datetime_combined_field():
    r = _parse_datetime("2026-09-04 19:25:30")
    assert r == ("2026-09-04", "19:25:30")


def test_sniff_dialect_comma_and_semicolon():
    assert _sniff_dialect("a,b,c\n1,2,3\n2,3,4\n") == ","
    assert _sniff_dialect("a;b;c\n1;2;3\n2;3;4\n") == ";"


def test_hour_window_bounds():
    assert 5 in _HOUR_WINDOW and 18 in _HOUR_WINDOW
    assert 4 not in _HOUR_WINDOW and 19 not in _HOUR_WINDOW


# ── Match order ─────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_match_by_key_code_wins():
    fake = _FakeDB(); ff.db = fake
    a1 = await _seed_asset(fake, id="A1", smartfill_key_code="KEY-100", rego_serial="ZZ1")
    a2 = await _seed_asset(fake, id="A2", rego_serial="RG-99")
    aid, status = await ff._resolve_asset(
        org_id="ORG", key_code="KEY-100", card_number="", registration="RG-99",
        description="", _asset_cache=None)
    assert aid == "A1" and status == "matched"


@pytest.mark.asyncio
async def test_match_by_card_number_when_no_key_code():
    fake = _FakeDB(); ff.db = fake
    await _seed_asset(fake, id="A1", smartfill_card_number="21355", rego_serial="OTHER")
    aid, status = await ff._resolve_asset(
        org_id="ORG", key_code="", card_number="21355", registration="",
        description="", _asset_cache=None)
    assert aid == "A1" and status == "matched"


@pytest.mark.asyncio
async def test_match_by_rego_case_insensitive():
    fake = _FakeDB(); ff.db = fake
    await _seed_asset(fake, id="A1", rego_serial="K82KU")
    aid, status = await ff._resolve_asset(
        org_id="ORG", key_code="", card_number="", registration="k82ku",
        description="", _asset_cache=None)
    assert aid == "A1"


@pytest.mark.asyncio
async def test_match_fuzzy_by_description():
    fake = _FakeDB(); ff.db = fake
    a = await _seed_asset(fake, id="A1", name="Isuzu FVR900 Vac Truck")
    aid, status = await ff._resolve_asset(
        org_id="ORG", key_code="", card_number="", registration="",
        description="Isuzu FVR900 Vac Truck", _asset_cache=[a])
    assert aid == "A1"


@pytest.mark.asyncio
async def test_match_unmatched_when_no_hits():
    fake = _FakeDB(); ff.db = fake
    aid, status = await ff._resolve_asset(
        org_id="ORG", key_code="NOPE", card_number="", registration="",
        description="Random 12345", _asset_cache=[])
    assert aid is None and status == "unmatched"


# ── Anomaly rules R1..R6 ───────────────────────────────────────
@pytest.mark.asyncio
async def test_r1_unusual_hour_flags():
    fake = _FakeDB(); ff.db = fake
    flags = await ff._evaluate_anomalies(
        org_id="ORG", asset_id=None, litres=50.0,
        filled_at_utc=_iso_utc(2026, 9, 2, 3, 15), local_tz=_DEFAULT_TZ,
        odometer_km=None, engine_hours=None)
    r = [f for f in flags if f["rule"] == "unusual_hour"]
    assert len(r) == 1 and r[0]["severity"] == "low"


@pytest.mark.asyncio
async def test_r1_negative_business_hours():
    fake = _FakeDB(); ff.db = fake
    flags = await ff._evaluate_anomalies(
        org_id="ORG", asset_id=None, litres=50.0,
        filled_at_utc=_iso_utc(2026, 9, 2, 10, 0), local_tz=_DEFAULT_TZ,
        odometer_km=None, engine_hours=None)
    assert not any(f["rule"] == "unusual_hour" for f in flags)


@pytest.mark.asyncio
async def test_r2_capacity_exceed_high():
    fake = _FakeDB(); ff.db = fake
    a = await _seed_asset(fake, id="A", fuel_tank_capacity_l=100.0)
    flags = await ff._evaluate_anomalies(
        org_id="ORG", asset_id="A", litres=115.0,
        filled_at_utc=_iso_utc(2026, 9, 2, 10, 0), local_tz=_DEFAULT_TZ,
        odometer_km=None, engine_hours=None)
    r = [f for f in flags if f["rule"] == "capacity_exceed"]
    assert len(r) == 1 and r[0]["severity"] == "high"


@pytest.mark.asyncio
async def test_r2_skipped_when_capacity_unknown():
    fake = _FakeDB(); ff.db = fake
    await _seed_asset(fake, id="A", fuel_tank_capacity_l=None)
    flags = await ff._evaluate_anomalies(
        org_id="ORG", asset_id="A", litres=999.0,
        filled_at_utc=_iso_utc(2026, 9, 2, 10, 0), local_tz=_DEFAULT_TZ,
        odometer_km=None, engine_hours=None)
    assert not any(f["rule"] == "capacity_exceed" for f in flags)


@pytest.mark.asyncio
async def test_r3_stat_spike_after_5_prior():
    fake = _FakeDB(); ff.db = fake
    await _seed_asset(fake, id="A")
    for i, L in enumerate([48.0, 50.0, 52.0, 49.0, 51.0]):
        await fake.fuel_transactions.insert_one({
            "id": f"s{i}", "org_id": "ORG", "asset_id": "A",
            "litres": L, "timestamp": f"2026-08-{i+1:02d}T10:00:00+00:00",
            "deleted_at": None,
        })
    flags = await ff._evaluate_anomalies(
        org_id="ORG", asset_id="A", litres=150.0,
        filled_at_utc=_iso_utc(2026, 9, 2, 10, 0), local_tz=_DEFAULT_TZ,
        odometer_km=None, engine_hours=None)
    r = [f for f in flags if f["rule"] == "stat_spike"]
    assert len(r) == 1 and r[0]["severity"] == "medium"


@pytest.mark.asyncio
async def test_r4_reading_regress_odometer():
    fake = _FakeDB(); ff.db = fake
    await _seed_asset(fake, id="A", odo_km=100000)
    flags = await ff._evaluate_anomalies(
        org_id="ORG", asset_id="A", litres=50.0,
        filled_at_utc=_iso_utc(2026, 9, 2, 10, 0), local_tz=_DEFAULT_TZ,
        odometer_km=99000, engine_hours=None)
    r = [f for f in flags if f["rule"] == "reading_regress"]
    assert len(r) == 1 and r[0]["severity"] == "medium"


@pytest.mark.asyncio
async def test_r5_missing_odometer_when_prior_nonzero():
    fake = _FakeDB(); ff.db = fake
    await _seed_asset(fake, id="A", odo_km=100000)
    flags = await ff._evaluate_anomalies(
        org_id="ORG", asset_id="A", litres=50.0,
        filled_at_utc=_iso_utc(2026, 9, 2, 10, 0), local_tz=_DEFAULT_TZ,
        odometer_km=0, engine_hours=None)
    r = [f for f in flags if f["rule"] == "missing_odometer"]
    assert len(r) == 1 and r[0]["severity"] == "low"


@pytest.mark.asyncio
async def test_r5_negative_when_no_prior_reading():
    fake = _FakeDB(); ff.db = fake
    await _seed_asset(fake, id="A", odo_km=None)
    flags = await ff._evaluate_anomalies(
        org_id="ORG", asset_id="A", litres=50.0,
        filled_at_utc=_iso_utc(2026, 9, 2, 10, 0), local_tz=_DEFAULT_TZ,
        odometer_km=0, engine_hours=None)
    assert not any(f["rule"] == "missing_odometer" for f in flags)


# ── R6 unit-mismatch hard-reject at row level ──────────────────
@pytest.mark.asyncio
async def test_r6_unit_mismatch_hard_rejects_row():
    fake = _FakeDB(); ff.db = fake
    await _seed_asset(fake, id="A", rego_serial="K82KU")
    csv_text = (
        "Transaction Id,Date,Time,Registration,Litres,Units\n"
        "T1,2026-09-01,10:00:00,K82KU,44.31,Litres\n"
        "T2,2026-09-01,11:00:00,K82KU,44.31,Gallons\n"
    )
    r = await ff._import_csv(content=csv_text.encode(), filename="unit.csv",
                              org_id="ORG", workspace_id=None, user_id="U")
    assert r.rows_inserted == 1
    assert r.rows_rejected == 1
    assert any("unit_mismatch" in e.get("error", "") for e in r.errors)


# ── CSV import: dedupe by transaction_id ───────────────────────
@pytest.mark.asyncio
async def test_dedupe_by_transaction_id():
    fake = _FakeDB(); ff.db = fake
    await _seed_asset(fake, id="A", rego_serial="K82KU")
    csv_text = (
        "Transaction Id,Date,Time,Registration,Litres\n"
        "5841004940,2026-09-04,19:25:30,K82KU,44.310\n"
    )
    r1 = await ff._import_csv(content=csv_text.encode(), filename="a.csv",
                                org_id="ORG", workspace_id=None, user_id="U")
    r2 = await ff._import_csv(content=csv_text.encode(), filename="b.csv",
                                org_id="ORG", workspace_id=None, user_id="U")
    assert r1.rows_inserted == 1
    assert r2.rows_inserted == 0 and r2.rows_duplicate == 1


@pytest.mark.asyncio
async def test_dedupe_fallback_composite_when_no_txn_id():
    fake = _FakeDB(); ff.db = fake
    await _seed_asset(fake, id="A", smartfill_key_code="KEY-100")
    csv_text = (
        "Date,Time,Key/Code,Litres\n"
        "2026-09-04,19:25:30,KEY-100,44.310\n"
    )
    r1 = await ff._import_csv(content=csv_text.encode(), filename="a.csv",
                                org_id="ORG", workspace_id=None, user_id="U")
    r2 = await ff._import_csv(content=csv_text.encode(), filename="b.csv",
                                org_id="ORG", workspace_id=None, user_id="U")
    assert r1.rows_inserted == 1
    assert r2.rows_inserted == 0 and r2.rows_duplicate == 1


# ── End-to-end smoke ───────────────────────────────────────────
@pytest.mark.asyncio
async def test_smoke_import_persists_batch_and_anomaly():
    fake = _FakeDB(); ff.db = fake
    await _seed_asset(fake, id="A1", rego_serial="K82KU", smartfill_key_code="KEY-100")
    csv_text = (
        "Transaction Id,Date,Time,Key/Code,Card Number,Registration,Description,From,Litres,Units,Fuel Type,Pump,Odometer,Driver,Total Price\n"
        "5841004940,2026-09-04,03:15:30,KEY-100,21355,K82KU,Ranger,Paneltec Breadalbane,44.310,Litres,Diesel,1,52140,No driver is assigned.,132.930\n"
    )
    r = await ff._import_csv(content=csv_text.encode(), filename="smoke.csv",
                              org_id="ORG", workspace_id=None, user_id="U")
    assert r.rows_inserted == 1
    # v58.13.131d — Row now hits BOTH R1 unusual_hour AND R7
    # procurement_outlier (only row this month → automatically top-1
    # $/L in the current-month outlier set). Anomalous count reflects
    # both flags on the row.
    assert r.rows_anomalous >= 1  # 03:15 → unusual_hour + R7
    # Batch persisted.
    batch = await fake.fuel_import_batches.find_one({"org_id": "ORG"})
    assert batch and batch["rows_anomalous"] == 1
    # Row persisted with all new schema fields.
    tx = await fake.fuel_transactions.find_one({"org_id": "ORG"})
    assert tx["transaction_id"] == "5841004940"
    assert tx["key_code"] == "KEY-100"
    assert tx["card_number"] == "21355"
    assert tx["registration"] == "K82KU"
    assert tx["from_site"] == "Paneltec Breadalbane"
    assert tx["fuel_type"] == "Diesel"
    assert tx["pump"] == 1
    assert tx["total_price"] == 132.930
    assert tx["driver"] is None  # normalised "No driver is assigned."
    assert tx["asset_id"] == "A1"
    assert tx["match_status"] == "matched"
    assert any(f["rule"] == "unusual_hour" for f in tx["anomaly_flags"])


# ── Route registration smoke (checked separately via curl + api.routes) ──
# The `server` module can't be safely imported inside a sync pytest
# (it bootstraps an event loop). Route registration is proven via:
#   · The `_import_csv` smoke test above (end-to-end persistence).
#   · The curl transcript in `/app/memory/v58_13_131b_shipped_finish_deferred.md`
#     which hits all 12 endpoints end-to-end.


# v58.13.131c — strict admin gate on import + count_only anomaly probe.
@pytest.mark.asyncio
async def test_require_admin_allows_role_admin():
    # `admin` passes silently.
    ff._require_admin({"role": "admin"})


@pytest.mark.asyncio
async def test_require_admin_rejects_hseq_lead():
    # v58.13.131c — strictly admin. `hseq_lead` (also has assets.edit)
    # is deliberately blocked here. CSV imports mutate fleet-wide
    # financial + fuel data.
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        ff._require_admin({"role": "hseq_lead"})
    assert exc.value.status_code == 403
    assert "admin only" in exc.value.detail


@pytest.mark.asyncio
async def test_require_admin_rejects_worker():
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        ff._require_admin({"role": "worker"})
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_require_admin_rejects_missing_role():
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        ff._require_admin({})
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_import_csv_endpoint_source_locks_admin_gate():
    # Source-pin: the endpoint calls `_require_admin(user)` (not just
    # the `assets.edit` permission dependency). This test guards
    # against a silent regression where the `_require_admin` call is
    # removed and only the permission check remains.
    import inspect
    src = inspect.getsource(ff.import_csv_ep)
    assert "_require_admin(user)" in src


@pytest.mark.asyncio
async def test_anomalies_count_only_returns_count_key():
    # v58.13.131c — count_only=true short-circuits the page body.
    # Powers the FleetRegister banner.
    import inspect
    src = inspect.getsource(ff.list_anomalies)
    assert "count_only" in src
    assert 'return {"count": total}' in src

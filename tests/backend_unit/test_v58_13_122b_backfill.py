"""v58.13.122b — parser + migration tests.

Tests are ISOLATED — the runner uses a fresh in-memory fake DB per
test (no live-DB pollution). This fork intentionally avoids the
test-data leakage seen in previous forks.
"""
from __future__ import annotations
import copy
import re
from typing import Any

import pytest

# Ensure `backend/migrations/…` is importable.
import sys, os
sys.path.insert(0, os.path.abspath("/app/backend"))
sys.path.insert(0, os.path.abspath("/app/backend/migrations"))

import v58_13_122b_backfill_readings as mig
from v58_13_122b_backfill_readings import parse_reading, ParseResult


# ── Parser · explicit unit tokens ──────────────────────────────
def test_parse_km_comma_and_space():
    r = parse_reading("142,350 km")
    assert r.km == 142350 and r.hours is None
    assert r.confidence == "high"


def test_parse_km_no_space():
    r = parse_reading("142350km")
    assert r.km == 142350 and r.confidence == "high"


def test_parse_kkm_typo():
    # `kkm` is a well-documented typo in Australian civil-fleet notes.
    r = parse_reading("142.35 kkm")
    assert r.km == 142 and r.confidence == "high"


def test_parse_hours_hrs():
    r = parse_reading("3,215 hrs")
    assert r.hours == 3215 and r.km is None
    assert r.confidence == "high"


def test_parse_hours_h_suffix():
    r = parse_reading("3215h")
    assert r.hours == 3215 and r.confidence == "high"


def test_parse_hours_word_hours():
    r = parse_reading("3215 hours")
    assert r.hours == 3215 and r.confidence == "high"


def test_parse_both_slash():
    r = parse_reading("142000 km / 3215 hrs")
    assert r.km == 142000 and r.hours == 3215
    assert r.confidence == "high"


def test_parse_both_and():
    r = parse_reading("142000 km and 3215 hrs")
    assert r.km == 142000 and r.hours == 3215
    assert r.confidence == "high"


def test_parse_both_whitespace_only():
    r = parse_reading("12,345 KM 500 HRS")
    assert r.km == 12345 and r.hours == 500
    assert r.confidence == "high"


def test_parse_both_ampersand():
    r = parse_reading("50000 km & 1200 hours")
    assert r.km == 50000 and r.hours == 1200


# ── Parser · asset-kind heuristic ──────────────────────────────
def test_bare_number_plant_becomes_hours():
    r = parse_reading("3215", asset_kind="plant")
    assert r.hours == 3215 and r.km is None
    assert r.confidence == "medium"
    assert r.kind_heuristic_used is True


def test_bare_number_vehicle_becomes_km():
    r = parse_reading("189,517.00", asset_kind="vehicle")
    assert r.km == 189517 and r.hours is None
    assert r.confidence == "medium"
    assert r.kind_heuristic_used is True


def test_bare_number_trailer_becomes_km():
    # Spec: trailers are treated as `km` (odometer via tow-vehicle).
    r = parse_reading("6,326.00", asset_kind="trailer")
    assert r.km == 6326 and r.hours is None
    assert r.confidence == "medium"


def test_bare_number_no_kind_low_confidence():
    r = parse_reading("3215", asset_kind=None)
    assert r.km is None and r.hours is None
    assert r.confidence == "low"


def test_bare_number_unknown_kind_low():
    r = parse_reading("500", asset_kind="something_weird")
    assert r.km is None and r.hours is None
    assert r.confidence == "low"


# ── Parser · implausible values ────────────────────────────────
def test_implausible_km_rejected_high_path():
    r = parse_reading("9,000,000 km")
    assert r.km is None and r.hours is None
    assert r.confidence == "low"
    assert "unit_token_implausible" in r.reason


def test_implausible_hrs_rejected_high_path():
    r = parse_reading("999999 hrs")
    assert r.hours is None and r.confidence == "low"


def test_implausible_km_rejected_bare_vehicle():
    r = parse_reading("3000000", asset_kind="vehicle")
    assert r.km is None and r.hours is None
    assert r.confidence == "low"


def test_implausible_hrs_rejected_bare_plant():
    r = parse_reading("200000", asset_kind="plant")
    assert r.hours is None
    assert r.confidence == "low"


# ── Parser · edge cases ────────────────────────────────────────
def test_empty_string():
    assert parse_reading("", asset_kind="vehicle").confidence == "low"
    assert parse_reading("   ", asset_kind="plant").confidence == "low"


def test_none_input():
    assert parse_reading(None).confidence == "low"


def test_only_letters():
    r = parse_reading("N/A", asset_kind="vehicle")
    assert r.km is None and r.hours is None


def test_zero_bare_number_treated_as_low():
    r = parse_reading("0", asset_kind="vehicle")
    assert r.km is None
    # v > 0 rule → 0 rejected as implausible.
    assert r.confidence == "low"


def test_decimal_km_rounds():
    r = parse_reading("142350.7 km")
    assert r.km == 142351


def test_two_bare_numbers_vehicle_km_hours():
    r = parse_reading("142000 / 3215", asset_kind="vehicle")
    assert r.km == 142000 and r.hours == 3215
    assert r.confidence == "medium"


# ── In-memory fake DB helpers ──────────────────────────────────
class _FakeCollection:
    def __init__(self, name: str):
        self.name = name
        self.docs: list = []

    async def find(self, q: dict = None, projection: dict = None):
        q = q or {}
        for d in self.docs:
            if _match(d, q):
                yield copy.deepcopy(d)

    async def find_one(self, q: dict = None, projection: dict = None):
        q = q or {}
        for d in self.docs:
            if _match(d, q):
                return copy.deepcopy(d)
        return None

    async def count_documents(self, q: dict):
        return sum(1 for _ in filter(lambda d: _match(d, q), self.docs))

    async def update_one(self, q: dict, update: dict):
        for d in self.docs:
            if _match(d, q):
                for k, v in (update.get("$set") or {}).items():
                    d[k] = v
                for k in (update.get("$unset") or {}).keys():
                    d.pop(k, None)
                return _Res(1, 1)
        return _Res(0, 0)

    async def update_many(self, q: dict, update: dict):
        matched = modified = 0
        for d in self.docs:
            if _match(d, q):
                matched += 1
                changed = False
                for k, v in (update.get("$set") or {}).items():
                    d[k] = v; changed = True
                for k in (update.get("$unset") or {}).keys():
                    if k in d:
                        d.pop(k); changed = True
                if changed: modified += 1
        return _Res(matched, modified)

    async def aggregate(self, pipeline):
        # Minimal aggregation support for the pill-state test — we only
        # need $match + $group with our specific expressions.
        match_stage = next((s.get("$match") for s in pipeline if "$match" in s), {})
        group_stage = next((s.get("$group") for s in pipeline if "$group" in s), None)
        if group_stage is None:
            for d in self.docs:
                if _match(d, match_stage):
                    yield copy.deepcopy(d)
            return
        # Group by `_id` field expression: e.g. "$registration_no".
        key_expr = group_stage.get("_id")
        assert isinstance(key_expr, str) and key_expr.startswith("$")
        key_field = key_expr[1:]
        buckets: dict = {}
        for d in self.docs:
            if not _match(d, match_stage):
                continue
            k = d.get(key_field)
            b = buckets.setdefault(k, {"_id": k, "_rows": []})
            b["_rows"].append(d)
        # Apply $max/$cond expressions per bucket.
        for k, b in buckets.items():
            for out_field, expr in group_stage.items():
                if out_field == "_id":
                    continue
                # only $max(cond) supported here
                cond = expr.get("$max", {}).get("$cond")
                assert cond, "unsupported aggregation shape"
                true_branch = cond[1]
                max_val = 0
                for d in b["_rows"]:
                    if _eval_cond(cond[0], d):
                        v = true_branch
                        if isinstance(v, int) and v > max_val:
                            max_val = v
                b[out_field] = max_val
            b.pop("_rows", None)
            yield b


def _eval_cond(expr, doc: dict) -> bool:
    """Tiny evaluator for the Mongo aggregation expressions the pill
    state code uses ($eq, $ne, $and, $or, $cond). Just enough for
    our tests — not a general solution."""
    if isinstance(expr, dict):
        if "$eq" in expr:
            a, b = expr["$eq"]
            return _resolve(a, doc) == _resolve(b, doc)
        if "$ne" in expr:
            a, b = expr["$ne"]
            return _resolve(a, doc) != _resolve(b, doc)
        if "$and" in expr:
            return all(_eval_cond(x, doc) for x in expr["$and"])
        if "$or" in expr:
            return any(_eval_cond(x, doc) for x in expr["$or"])
    return bool(expr)


def _resolve(v, doc: dict):
    if isinstance(v, str) and v.startswith("$"):
        return doc.get(v[1:])
    return v


class _Res:
    def __init__(self, matched, modified):
        self.matched_count = matched
        self.modified_count = modified


def _match(d: dict, q: dict) -> bool:
    for k, v in q.items():
        if k == "$or":
            if not any(_match(d, sub) for sub in v):
                return False
            continue
        actual = d.get(k)
        if isinstance(v, dict):
            for op, expected in v.items():
                if op == "$type" and expected == "string":
                    if not isinstance(actual, str):
                        return False
                elif op == "$ne":
                    if actual == expected:
                        return False
                elif op == "$in":
                    if actual not in expected:
                        return False
                elif op == "$exists":
                    if (k in d) != expected:
                        return False
                elif op == "$eq":
                    if actual != expected:
                        return False
        else:
            if actual != v:
                return False
    return True


class _FakeDB:
    def __init__(self):
        self.plant_maintenance = _FakeCollection("plant_maintenance")
        self.assets = _FakeCollection("assets")


async def _mkfixture():
    fake = _FakeDB()
    # 3 assets — one of each kind.
    fake.assets.docs.extend([
        {"id": "A-veh", "rego_serial": "ABC123", "kind": "vehicle"},
        {"id": "A-pla", "rego_serial": "PLA-01", "kind": "plant"},
        {"id": "A-tra", "rego_serial": "TR-99",  "kind": "trailer"},
    ])
    fake.plant_maintenance.docs.extend([
        # 1. Vehicle bare number — should write km (medium).
        {"_id": "pm1", "id": "pm1",
         "registration_no": "ABC123", "latest_usage_reading": "189,517.00"},
        # 2. Plant bare number — should write hours (medium).
        {"_id": "pm2", "id": "pm2",
         "registration_no": "PLA-01", "latest_usage_reading": "3215"},
        # 3. Trailer bare — km (medium).
        {"_id": "pm3", "id": "pm3",
         "registration_no": "TR-99", "latest_usage_reading": "6,326.00"},
        # 4. Explicit unit high confidence — both km and hours.
        {"_id": "pm4", "id": "pm4",
         "registration_no": "ABC123",
         "latest_usage_reading": "142000 km / 3215 hrs"},
        # 5. Unknown rego → low confidence, skipped.
        {"_id": "pm5", "id": "pm5",
         "registration_no": "UNKNOWN", "latest_usage_reading": "500"},
        # 6. Implausible bare vehicle — skipped.
        {"_id": "pm6", "id": "pm6",
         "registration_no": "ABC123", "latest_usage_reading": "9999999"},
        # 7. Empty string ignored (doesn't match query, but the runner
        #    filters via `$type: string, $ne: ''`).
    ])
    return fake


# ── Runner · discovery ─────────────────────────────────────────
@pytest.mark.asyncio
async def test_discovery_counts():
    fake = await _mkfixture()
    counts = await mig.run_discovery(fake)
    assert counts.scanned == 6
    # pm1, pm2, pm3, pm4 → parseable something. pm4 both. pm5,pm6 → unparseable/low.
    assert counts.parseable_km == 3    # pm1, pm3, pm4
    assert counts.parseable_hrs == 2   # pm2, pm4
    assert counts.parseable_both == 1  # pm4
    # pm5 = bare_no_kind (parseable-ish but low), pm6 = implausible.
    # Both count as "unparseable" (km None and hours None in ParseResult).
    assert counts.unparseable == 2
    # Would-write breakdown:
    #   pm1 km-only, pm2 hours-only, pm3 km-only, pm4 both.
    assert counts.would_write_both == 1
    assert counts.would_write_km_only == 2
    assert counts.would_write_hrs_only == 1
    assert counts.would_skip_low >= 1       # pm5
    assert counts.would_skip_implausible >= 1  # pm6
    assert counts.kind_heuristic_hits == 3   # pm1, pm2, pm3 (pm4 = explicit unit)


# ── Runner · dry-run writes nothing ────────────────────────────
@pytest.mark.asyncio
async def test_dry_run_writes_nothing(tmp_path, monkeypatch):
    fake = await _mkfixture()
    # Snapshot every doc before.
    snap_before = copy.deepcopy(fake.plant_maintenance.docs)
    # Point the memory paths into tmp_path so we don't clobber real reports.
    monkeypatch.setattr(mig, "PATTERN_REPORT", str(tmp_path / "pattern.md"))
    monkeypatch.setattr(mig, "DRYRUN_DIFF",   str(tmp_path / "diff.md"))
    counts = await mig.run_discovery(fake)
    mig.write_pattern_report(counts)
    mig.write_dryrun_diff(counts)
    # DB unchanged.
    assert fake.plant_maintenance.docs == snap_before
    # Reports exist.
    assert (tmp_path / "pattern.md").exists()
    assert (tmp_path / "diff.md").exists()


# ── Runner · apply writes only high+medium ─────────────────────
@pytest.mark.asyncio
async def test_apply_writes_only_high_medium(tmp_path, monkeypatch):
    fake = await _mkfixture()
    monkeypatch.setattr(mig, "APPLY_LOG", str(tmp_path / "apply.md"))
    counts = await mig.run_discovery(fake)
    res = await mig.run_apply(fake, counts)

    # pm5 (low, no kind) and pm6 (implausible) must NOT have km/hours set.
    pm5 = next(d for d in fake.plant_maintenance.docs if d["_id"] == "pm5")
    pm6 = next(d for d in fake.plant_maintenance.docs if d["_id"] == "pm6")
    assert "mileage_at_service" not in pm5
    assert "hours_at_service" not in pm5
    assert "mileage_at_service" not in pm6

    # pm1 vehicle → km 189517, backfilled flag set.
    pm1 = next(d for d in fake.plant_maintenance.docs if d["_id"] == "pm1")
    assert pm1["mileage_at_service"] == 189517.0
    assert pm1["mileage_at_service_backfilled"] is True
    assert pm1["mileage_at_service_backfill_source"] == "189,517.00"

    # pm2 plant → hours 3215.
    pm2 = next(d for d in fake.plant_maintenance.docs if d["_id"] == "pm2")
    assert pm2["hours_at_service"] == 3215.0
    assert pm2["hours_at_service_backfilled"] is True

    # pm4 explicit high → BOTH km and hours set.
    pm4 = next(d for d in fake.plant_maintenance.docs if d["_id"] == "pm4")
    assert pm4["mileage_at_service"] == 142000.0
    assert pm4["hours_at_service"] == 3215.0
    assert pm4["mileage_at_service_backfilled"] is True
    assert pm4["hours_at_service_backfilled"] is True

    assert res["updated_km"] == 3   # pm1, pm3, pm4
    assert res["updated_hrs"] == 2  # pm2, pm4
    assert (tmp_path / "apply.md").exists()


# ── Runner · rollback ──────────────────────────────────────────
@pytest.mark.asyncio
async def test_rollback_clears_backfilled_rows(tmp_path, monkeypatch):
    fake = await _mkfixture()
    monkeypatch.setattr(mig, "APPLY_LOG", str(tmp_path / "apply.md"))
    counts = await mig.run_discovery(fake)
    await mig.run_apply(fake, counts)
    # After apply: pm1, pm2, pm3, pm4 all have backfilled flags.
    modified_before = sum(
        1 for d in fake.plant_maintenance.docs
        if d.get("mileage_at_service_backfilled") or d.get("hours_at_service_backfilled")
    )
    assert modified_before == 4

    res = await mig.run_rollback(fake)
    # All backfilled fields cleared.
    for d in fake.plant_maintenance.docs:
        assert "mileage_at_service" not in d
        assert "hours_at_service" not in d
        assert "mileage_at_service_backfilled" not in d
        assert "hours_at_service_backfilled" not in d
    assert res["matched"] == 4
    assert res["modified"] == 4

    # Rollback is idempotent — a second call should be a no-op.
    res2 = await mig.run_rollback(fake)
    assert res2["matched"] == 0


# ── Fixture-isolation guard ────────────────────────────────────
def test_fixture_isolation_no_shared_state():
    # Two independent `_FakeDB` instances must not share collection state.
    import asyncio
    async def _go():
        a = await _mkfixture()
        b = await _mkfixture()
        await a.plant_maintenance.update_one({"_id": "pm1"}, {"$set": {"marker": 42}})
        b_pm1 = next(d for d in b.plant_maintenance.docs if d["_id"] == "pm1")
        assert "marker" not in b_pm1
    asyncio.run(_go())


# ── Manual override path ───────────────────────────────────────
@pytest.mark.asyncio
async def test_override_writes_manual_correction(tmp_path, monkeypatch):
    """H01PZ override — the historical string is implausible, so the
    bulk pass skips it, but the override JSON supplies a corrected
    reading and the apply pass writes it with the manual-override
    audit flags."""
    fake = _FakeDB()
    fake.assets.docs.append({
        "id": "A-h01pz", "rego_serial": "H01PZ", "kind": "vehicle",
    })
    # 3 pm rows for H01PZ carrying the implausible source string.
    for i in range(3):
        fake.plant_maintenance.docs.append({
            "_id": f"pm-h{i}", "id": f"pm-h{i}",
            "registration_no": "H01PZ",
            "latest_usage_reading": "6,362,349.00",
            "deleted_at": None,
        })
    # Point override JSON at a tmp file.
    overrides_path = tmp_path / "overrides.json"
    overrides_path.write_text(
        '{"H01PZ": {"kind": "km", "value": 63623, '
        '"reason": "decimal-place error"}}'
    )
    monkeypatch.setattr(mig, "MANUAL_OVERRIDES_FILE", str(overrides_path))
    monkeypatch.setattr(mig, "APPLY_LOG", str(tmp_path / "apply.md"))
    counts = await mig.run_discovery(fake)
    # Bulk pass skips all 3 (implausible).
    assert counts.would_skip_implausible == 3
    res = await mig.run_apply(fake, counts)
    # Override wrote 3 rows.
    assert res["override_writes"] == 3
    for i in range(3):
        pm = next(d for d in fake.plant_maintenance.docs if d["_id"] == f"pm-h{i}")
        assert pm["mileage_at_service"] == 63623.0
        assert pm["mileage_at_service_backfilled"] is True
        assert pm["mileage_at_service_backfill_source"] == "manual_override"
        assert "decimal-place error" in pm["mileage_at_service_backfill_reason"]
        assert pm["_backfill_manual_override"] is True
        assert "decimal-place error" in pm["_backfill_manual_reason"]


@pytest.mark.asyncio
async def test_override_missing_json_file_is_no_op(tmp_path, monkeypatch):
    """Missing overrides file → empty map, not a crash."""
    fake = _FakeDB()
    fake.assets.docs.append(
        {"id": "A1", "rego_serial": "ABC123", "kind": "vehicle"},
    )
    fake.plant_maintenance.docs.append({
        "_id": "pm1", "id": "pm1", "registration_no": "ABC123",
        "latest_usage_reading": "12,345.00",
    })
    monkeypatch.setattr(
        mig, "MANUAL_OVERRIDES_FILE", str(tmp_path / "does_not_exist.json"),
    )
    monkeypatch.setattr(mig, "APPLY_LOG", str(tmp_path / "apply.md"))
    counts = await mig.run_discovery(fake)
    res = await mig.run_apply(fake, counts)
    # Bulk still ran.
    assert res["override_writes"] == 0
    pm1 = next(d for d in fake.plant_maintenance.docs if d["_id"] == "pm1")
    assert pm1["mileage_at_service"] == 12345.0
    assert pm1.get("_backfill_manual_override") is not True


# ── Rollback clears override rows too ──────────────────────────
@pytest.mark.asyncio
async def test_rollback_clears_bulk_and_override_rows(tmp_path, monkeypatch):
    """Rollback dry-run — proves both bulk + override rows roll back
    cleanly in the same call. Runs against a fresh fake DB fixture,
    NOT the live DB."""
    fake = _FakeDB()
    fake.assets.docs.extend([
        {"id": "A1", "rego_serial": "ABC123", "kind": "vehicle"},
        {"id": "A2", "rego_serial": "H01PZ", "kind": "vehicle"},
    ])
    fake.plant_maintenance.docs.extend([
        {"_id": "pm-bulk", "id": "pm-bulk",
         "registration_no": "ABC123", "latest_usage_reading": "12,345.00"},
        {"_id": "pm-over", "id": "pm-over",
         "registration_no": "H01PZ", "latest_usage_reading": "6,362,349.00"},
    ])
    overrides_path = tmp_path / "overrides.json"
    overrides_path.write_text(
        '{"H01PZ": {"kind":"km","value":63623,"reason":"corr"}}',
    )
    monkeypatch.setattr(mig, "MANUAL_OVERRIDES_FILE", str(overrides_path))
    monkeypatch.setattr(mig, "APPLY_LOG", str(tmp_path / "apply.md"))
    counts = await mig.run_discovery(fake)
    await mig.run_apply(fake, counts)
    # Both rows now have data.
    pm_bulk = next(d for d in fake.plant_maintenance.docs if d["_id"] == "pm-bulk")
    pm_over = next(d for d in fake.plant_maintenance.docs if d["_id"] == "pm-over")
    assert pm_bulk["mileage_at_service"] == 12345.0
    assert pm_over["mileage_at_service"] == 63623.0
    assert pm_over["_backfill_manual_override"] is True

    # Rollback wipes both.
    res = await mig.run_rollback(fake)
    assert res["matched"] == 2
    for d in fake.plant_maintenance.docs:
        assert "mileage_at_service" not in d
        assert "mileage_at_service_backfilled" not in d
        assert "_backfill_manual_override" not in d
        assert "_backfill_manual_reason" not in d
    # Idempotent.
    res2 = await mig.run_rollback(fake)
    assert res2["matched"] == 0


# ── Fleet Register `reading_review_state` pill logic ────────────
# The `_attach_reading_review_state` helper on `backend/fleet.py`
# computes a per-asset pill state via one plant_maintenance
# aggregation. These three tests source-import that helper and drive
# it against our in-memory fake DB.

@pytest.mark.asyncio
async def test_pill_state_corrected_when_manual_override(monkeypatch):
    """Rego with any PM row carrying `_backfill_manual_override=True`
    → state 'corrected' (highest priority, wins over needs_review)."""
    import importlib, sys
    # Load fleet module in a way that doesn't require the full server
    # bootstrap. We just need the helper function.
    sys.path.insert(0, os.path.abspath("/app/backend"))
    import fleet
    fake = _FakeDB()
    monkeypatch.setattr(fleet, "db", fake)
    fake.plant_maintenance.docs.extend([
        {"registration_no": "H01PZ", "org_id": "ORG",
         "latest_usage_reading": "6,362,349.00", "deleted_at": None,
         "_backfill_manual_override": True,
         "mileage_at_service": 63623.0, "mileage_at_service_backfilled": True},
    ])
    items = [{"id": "A1", "rego_serial": "H01PZ"}]
    await fleet._attach_reading_review_state(items, org_id="ORG")
    assert items[0]["reading_review_state"] == "corrected"


@pytest.mark.asyncio
async def test_pill_state_needs_review_when_source_but_no_write(monkeypatch):
    """Rego with PM rows carrying a source string BUT no write landed
    (implausible / low confidence) → state 'needs_review'."""
    import sys
    sys.path.insert(0, os.path.abspath("/app/backend"))
    import fleet
    fake = _FakeDB()
    monkeypatch.setattr(fleet, "db", fake)
    fake.plant_maintenance.docs.extend([
        {"registration_no": "BAD01", "org_id": "ORG",
         "latest_usage_reading": "9,999,999.00", "deleted_at": None},
    ])
    items = [{"id": "A2", "rego_serial": "BAD01"}]
    await fleet._attach_reading_review_state(items, org_id="ORG")
    assert items[0]["reading_review_state"] == "needs_review"


@pytest.mark.asyncio
async def test_pill_state_null_when_normal_write(monkeypatch):
    """Rego with PM rows successfully back-filled and NO override →
    state None (no pill)."""
    import sys
    sys.path.insert(0, os.path.abspath("/app/backend"))
    import fleet
    fake = _FakeDB()
    monkeypatch.setattr(fleet, "db", fake)
    fake.plant_maintenance.docs.extend([
        {"registration_no": "OK01", "org_id": "ORG",
         "latest_usage_reading": "142,350.00", "deleted_at": None,
         "mileage_at_service": 142350.0,
         "mileage_at_service_backfilled": True},
    ])
    items = [
        {"id": "A3", "rego_serial": "OK01"},
        {"id": "A4", "rego_serial": None},        # no rego → null
        {"id": "A5", "rego_serial": "UNKNOWN"},   # no PM rows → null
    ]
    await fleet._attach_reading_review_state(items, org_id="ORG")
    assert items[0]["reading_review_state"] is None
    assert items[1]["reading_review_state"] is None
    assert items[2]["reading_review_state"] is None

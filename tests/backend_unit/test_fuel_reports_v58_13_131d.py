"""v58.13.131d — Fuel Reports + R7 procurement_outlier + email endpoint.

Uses the same `_FakeDB` monkeypatch pattern as `test_fuel_csv_import.py`
so tests don't touch the live motor client. See that file for the
FakeDB implementation — imported here rather than duplicated.
"""
from __future__ import annotations
import re
import inspect
from datetime import datetime, timedelta, timezone

import pytest

import fleet_fuel as ff
import fleet_fuel_reports as ffr
from test_fuel_csv_import import _FakeDB, _seed_asset, _iso_utc  # noqa


@pytest.fixture(autouse=True)
def _patch_db(monkeypatch):
    fake = _FakeDB()
    # Both modules share the `db` symbol — patch each one.
    monkeypatch.setattr(ff, "db", fake)
    monkeypatch.setattr(ffr, "db", fake)
    # Ensure `fuel_report_emails_sent` collection exists on the fake.
    if not hasattr(fake, "fuel_report_emails_sent"):
        from test_fuel_csv_import import _FakeCollection
        fake.fuel_report_emails_sent = _FakeCollection()
        fake.comms_outbox_blocked = _FakeCollection()
        fake.outbound_emails = _FakeCollection()
        fake.org_settings = _FakeCollection()
        fake.integration_configs = _FakeCollection()
    # v58.13.131d fix — Patch the shared `db` in comms_safe_mode too,
    # otherwise `is_blocked()` reads through the live module reference.
    import comms_safe_mode as _csm
    monkeypatch.setattr(_csm, "db", fake)
    return fake


# ── R7 procurement_outlier ─────────────────────────────────────
def _now_month_prefix() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")


async def _seed_tx(fake, *, tid: str, asset_id: str, date_iso: str,
                   litres: float, total_price: float, timestamp: str = None):
    doc = {
        "id": tid,
        "org_id": "ORG",
        "asset_id": asset_id,
        "date_iso": date_iso,
        "timestamp": timestamp or f"{date_iso}T10:00:00+00:00",
        "litres": litres,
        "total_price": total_price,
        "anomaly_flags": [],
        "deleted_at": None,
    }
    await fake.fuel_transactions.insert_one(doc)


@pytest.mark.asyncio
async def test_r7_flags_top3_dpl_this_month(_patch_db):
    fake = _patch_db
    await _seed_asset(fake, id="A1")
    mp = _now_month_prefix()
    # 5 fills in the current month. Top-3 $/L should be flagged.
    await _seed_tx(fake, tid="T1", asset_id="A1", date_iso=f"{mp}-01",
                    litres=50, total_price=250.0)   # $5.00/L (top #1)
    await _seed_tx(fake, tid="T2", asset_id="A1", date_iso=f"{mp}-02",
                    litres=50, total_price=200.0)   # $4.00/L (top #2)
    await _seed_tx(fake, tid="T3", asset_id="A1", date_iso=f"{mp}-03",
                    litres=50, total_price=150.0)   # $3.00/L (top #3)
    await _seed_tx(fake, tid="T4", asset_id="A1", date_iso=f"{mp}-04",
                    litres=50, total_price=100.0)   # $2.00/L (not top)
    await _seed_tx(fake, tid="T5", asset_id="A1", date_iso=f"{mp}-05",
                    litres=50, total_price=50.0)    # $1.00/L (not top)

    fresh = await ff._reflag_procurement_outliers(org_id="ORG", local_tz="UTC")
    assert fresh == 3

    def _has_r7(tid):
        doc = next(d for d in fake.fuel_transactions.docs if d["id"] == tid)
        return any(f["rule"] == "procurement_outlier" for f in (doc.get("anomaly_flags") or []))

    assert _has_r7("T1") and _has_r7("T2") and _has_r7("T3")
    assert not _has_r7("T4") and not _has_r7("T5")

    # Detail carries rank + total N.
    t1 = next(d for d in fake.fuel_transactions.docs if d["id"] == "T1")
    r7 = next(f for f in t1["anomaly_flags"] if f["rule"] == "procurement_outlier")
    assert r7["severity"] == "medium"
    assert "rank #1 of 5" in r7["detail"]
    assert "5.000 $/L" in r7["detail"]


@pytest.mark.asyncio
async def test_r7_ignores_prior_month(_patch_db):
    fake = _patch_db
    await _seed_asset(fake, id="A1")
    mp = _now_month_prefix()
    # Prior month with much higher $/L than current month.
    prior = (datetime.now(timezone.utc).replace(day=1) - timedelta(days=1)).strftime("%Y-%m")
    await _seed_tx(fake, tid="OLD", asset_id="A1", date_iso=f"{prior}-15",
                    litres=10, total_price=999.0)  # $99.90/L in old month
    await _seed_tx(fake, tid="CUR", asset_id="A1", date_iso=f"{mp}-05",
                    litres=50, total_price=100.0)  # $2.00/L this month

    fresh = await ff._reflag_procurement_outliers(org_id="ORG", local_tz="UTC")
    assert fresh == 1
    old = next(d for d in fake.fuel_transactions.docs if d["id"] == "OLD")
    cur = next(d for d in fake.fuel_transactions.docs if d["id"] == "CUR")
    assert not any(f["rule"] == "procurement_outlier" for f in old["anomaly_flags"] or [])
    assert any(f["rule"] == "procurement_outlier" for f in cur["anomaly_flags"] or [])


@pytest.mark.asyncio
async def test_r7_idempotent_reshuffle(_patch_db):
    fake = _patch_db
    await _seed_asset(fake, id="A1")
    mp = _now_month_prefix()
    # First pass: T1/T2/T3 flagged.
    for i, price in enumerate([500.0, 400.0, 300.0, 200.0, 100.0], start=1):
        await _seed_tx(fake, tid=f"T{i}", asset_id="A1",
                        date_iso=f"{mp}-0{i}", litres=50, total_price=price)
    await ff._reflag_procurement_outliers(org_id="ORG", local_tz="UTC")

    # New expensive row lands — should evict T3 (was $3/L) from top-3
    # and demote it to no-R7.
    await _seed_tx(fake, tid="TX", asset_id="A1",
                    date_iso=f"{mp}-20", litres=50, total_price=550.0)  # $11/L
    fresh = await ff._reflag_procurement_outliers(org_id="ORG", local_tz="UTC")
    # TX gets fresh R7; T1 and T2 already had R7 (idempotent). T3 loses R7.
    assert fresh == 1

    def _has_r7(tid):
        d = next(x for x in fake.fuel_transactions.docs if x["id"] == tid)
        return any(f["rule"] == "procurement_outlier" for f in d["anomaly_flags"] or [])

    assert _has_r7("TX") and _has_r7("T1") and _has_r7("T2")
    assert not _has_r7("T3")


@pytest.mark.asyncio
async def test_r7_tie_break_earliest_timestamp(_patch_db):
    fake = _patch_db
    await _seed_asset(fake, id="A1")
    mp = _now_month_prefix()
    # 4 identical $/L. Only 3 win the top-3. Ties broken by earliest
    # timestamp (older = higher rank).
    for i, ts in enumerate([
        f"{mp}-05T14:00:00+00:00",
        f"{mp}-03T14:00:00+00:00",  # earliest → rank 1
        f"{mp}-04T14:00:00+00:00",
        f"{mp}-06T14:00:00+00:00",  # latest → left out
    ], start=1):
        await _seed_tx(fake, tid=f"T{i}", asset_id="A1",
                        date_iso=ts[:10], litres=50, total_price=250.0,
                        timestamp=ts)
    await ff._reflag_procurement_outliers(org_id="ORG", local_tz="UTC")

    def _has_r7(tid):
        d = next(x for x in fake.fuel_transactions.docs if x["id"] == tid)
        return any(f["rule"] == "procurement_outlier" for f in d["anomaly_flags"] or [])

    # T2 (earliest), T3, T1 win — T4 (latest) is out.
    assert _has_r7("T2") and _has_r7("T3") and _has_r7("T1")
    assert not _has_r7("T4")


# ── Reports aggregation ────────────────────────────────────────
@pytest.mark.asyncio
async def test_aggregate_shape_employee(_patch_db):
    fake = _patch_db
    await _seed_asset(fake, id="A1")
    await fake.fuel_transactions.insert_one({
        "id": "T1", "org_id": "ORG", "asset_id": "A1",
        "date_iso": "2026-09-01", "timestamp": "2026-09-01T10:00:00+00:00",
        "driver": "Alice", "litres": 40, "total_price": 120.0,
        "deleted_at": None,
    })
    await fake.fuel_transactions.insert_one({
        "id": "T2", "org_id": "ORG", "asset_id": "A1",
        "date_iso": "2026-09-02", "timestamp": "2026-09-02T10:00:00+00:00",
        "driver": "Bob", "litres": 60, "total_price": 240.0,
        "deleted_at": None,
    })
    data = await ffr._aggregate(org_id="ORG", scope="employee", period="monthly",
                                  from_date=None, to_date=None)
    assert data["totals"]["litres"] == 100.0
    assert data["totals"]["total_price"] == 360.0
    assert data["totals"]["fills"] == 2
    assert data["totals"]["unique_keys"] == 2
    keys = {r["key"] for r in data["rows"]}
    assert keys == {"Alice", "Bob"}
    # Bob paid more → row 0.
    assert data["rows"][0]["label"] == "Bob"


@pytest.mark.asyncio
async def test_aggregate_top5_outliers(_patch_db):
    fake = _patch_db
    await _seed_asset(fake, id="A1")
    # 6 fills with varying $/L — top-5 should surface, ordered highest.
    for i, (l, p) in enumerate([(50, 300), (50, 250), (50, 200), (50, 150),
                                 (50, 100), (50, 50)], start=1):
        await fake.fuel_transactions.insert_one({
            "id": f"T{i}", "org_id": "ORG", "asset_id": "A1",
            "date_iso": f"2026-09-0{i}", "timestamp": f"2026-09-0{i}T10:00:00+00:00",
            "driver": f"D{i}", "litres": l, "total_price": p, "deleted_at": None,
        })
    data = await ffr._aggregate(org_id="ORG", scope="employee", period="monthly",
                                  from_date=None, to_date=None)
    outliers = data["top_dpl_outliers"]
    assert len(outliers) == 5
    # Highest first — $6.00/L (T1), $5.00/L (T2), $4/L, $3/L, $2/L. T6 ($1/L) excluded.
    assert outliers[0]["dpl"] == 6.0
    assert outliers[-1]["dpl"] == 2.0


@pytest.mark.asyncio
async def test_leaderboards_shape(_patch_db):
    fake = _patch_db
    await _seed_asset(fake, id="A1")
    for i, (drv, l, p) in enumerate([
        ("Alice", 100, 400), ("Bob", 60, 300), ("Cara", 200, 500),
    ], start=1):
        await fake.fuel_transactions.insert_one({
            "id": f"T{i}", "org_id": "ORG", "asset_id": "A1",
            "date_iso": f"2026-09-0{i}", "timestamp": f"2026-09-0{i}T10:00:00+00:00",
            "driver": drv, "litres": l, "total_price": p, "deleted_at": None,
        })
    lb = await ffr._leaderboards(org_id="ORG", from_date=None, to_date=None)
    assert len(lb["top_by_cost"]) == 3
    assert len(lb["top_by_dpl"]) == 3
    assert len(lb["top_by_fills"]) == 3
    # Cara: 500. Alice: 400. Bob: 300.
    assert [r["label"] for r in lb["top_by_cost"]] == ["Cara", "Alice", "Bob"]
    # $/L: Bob=5, Alice=4, Cara=2.5.
    assert [r["label"] for r in lb["top_by_dpl"]] == ["Bob", "Alice", "Cara"]


# ── Email endpoint ─────────────────────────────────────────────
class _StubUser(dict):
    def __init__(self):
        super().__init__(
            id="U1", org_id="ORG", email="admin@example.com",
            role="admin",
        )


@pytest.mark.asyncio
async def test_email_safe_mode_on_records_intent_no_send(_patch_db, monkeypatch):
    fake = _patch_db
    # Force Safe Mode ON via env master switch.
    monkeypatch.setenv("COMMS_SAFE_MODE", "on")
    # Set a request context so queue_email_doc (if called) wouldn't
    # be blocked BEFORE Safe Mode check.
    from send_context import set_send_context
    set_send_context({"id": "U1", "org_id": "ORG", "email": "admin@example.com"})

    payload = ffr.EmailReportIn(
        to=["me@example.com"], cc=[], note="",
        scope="admin", period="monthly",
        from_date=None, to_date=None,
        include_pdf=True, include_csv=True,
    )
    r = await ffr.fuel_report_email(payload=payload, _flag=None, user=_StubUser())
    assert r["sent"] is False
    assert r["safe_mode"] is True
    assert r["would_have_sent_to"] == ["me@example.com"]

    audit = fake.fuel_report_emails_sent.docs
    assert len(audit) == 1
    row = audit[0]
    assert row["sent"] is False
    assert row["safe_mode"] is True
    assert row["sent_by"] == "U1"
    assert row["sent_to"] == ["me@example.com"]
    assert row["format"] == {"pdf": True, "csv": True}


@pytest.mark.asyncio
async def test_email_safe_mode_off_calls_m365(_patch_db, monkeypatch):
    fake = _patch_db
    monkeypatch.setenv("COMMS_SAFE_MODE", "off")
    from send_context import set_send_context
    set_send_context({"id": "U1", "org_id": "ORG", "email": "admin@example.com"})
    # Ensure org_settings has Safe Mode off so effective_mode returns "off".
    await fake.org_settings.insert_one({"org_id": "ORG", "comms_safe_mode": "off"})

    # Stub queue_email_doc to record the call.
    captured = {}

    async def _stub_queue(**kw):
        captured.update(kw)
        return {"id": "email-1", "status": "sent"}

    import email_outbox
    monkeypatch.setattr(email_outbox, "queue_email_doc", _stub_queue)

    payload = ffr.EmailReportIn(
        to=["me@example.com"], cc=["cc@example.com"], note="hello",
        scope="employee", period="weekly",
        from_date="2026-09-01", to_date="2026-09-07",
        include_pdf=True, include_csv=False,
    )
    r = await ffr.fuel_report_email(payload=payload, _flag=None, user=_StubUser())
    assert r["sent"] is True
    assert r["safe_mode"] is False
    assert r["message_id"] == "email-1"

    assert captured["to"] == ["me@example.com"]
    assert captured["cc"] == ["cc@example.com"]
    assert "Fuel Report" in captured["subject"]
    assert "hello" in captured["body_html"]
    # Only PDF attached (csv=False in payload).
    assert len(captured["attachments"]) == 1
    assert captured["attachments"][0]["filename"].endswith(".pdf")

    # Audit trail landed with sent=True.
    assert fake.fuel_report_emails_sent.docs[-1]["sent"] is True


@pytest.mark.asyncio
async def test_email_rate_limit_429(_patch_db, monkeypatch):
    fake = _patch_db
    monkeypatch.setenv("COMMS_SAFE_MODE", "on")
    from send_context import set_send_context
    set_send_context({"id": "U1", "org_id": "ORG", "email": "admin@example.com"})

    payload = ffr.EmailReportIn(
        to=["me@example.com"], cc=[], note="",
        scope="admin", period="monthly",
        from_date=None, to_date=None,
        include_pdf=False, include_csv=True,
    )
    # 5 sends succeed.
    for _ in range(5):
        r = await ffr.fuel_report_email(payload=payload, _flag=None, user=_StubUser())
        assert r["safe_mode"] is True
    # 6th send → 429.
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        await ffr.fuel_report_email(payload=payload, _flag=None, user=_StubUser())
    assert exc.value.status_code == 429
    assert "Rate limit" in exc.value.detail


@pytest.mark.asyncio
async def test_email_permission_gate_shape():
    # The endpoint's dependency is `require_permission("assets", "edit")`.
    # A user without `assets.edit` never reaches the endpoint body —
    # locked at the FastAPI dep layer. Source-pin the dep signature.
    src = inspect.getsource(ffr.fuel_report_email)
    assert 'require_permission("assets", "edit")' in src


@pytest.mark.asyncio
async def test_pdf_renders_non_empty():
    data = {
        "filters": {"scope": "admin", "period": "monthly", "from": "", "to": ""},
        "totals": {"litres": 100.0, "total_price": 400.0, "fills": 5, "unique_keys": 3},
        "top_dpl_outliers": [
            {"label": "Alice", "dpl": 5.0, "litres": 20, "total_price": 100, "date_iso": "2026-09-01"},
        ],
        "rows": [
            {"label": "Alice", "litres": 20, "total_price": 100, "fills": 2,
             "avg_fill_l": 10, "dpl": 5.0, "delta_dpl": None},
        ],
    }
    b = ffr._render_report_pdf(data)
    assert isinstance(b, bytes)
    assert len(b) > 500  # rough smoke check that PDF has some content
    assert b[:4] == b"%PDF"


@pytest.mark.asyncio
async def test_csv_renders_expected_header():
    data = {
        "filters": {"scope": "admin", "period": "monthly", "from": "", "to": ""},
        "rows": [
            {"label": "Alice", "litres": 20, "total_price": 100, "fills": 2,
             "avg_fill_l": 10, "dpl": 5.0, "delta_dpl": None},
        ],
    }
    b = ffr._render_report_csv_bytes(data)
    assert isinstance(b, bytes)
    text = b.decode("utf-8")
    assert "Label,Litres,Total price,Fills,Avg fill (L),$/L,Delta $/L (vs prev)" in text
    assert "Alice" in text


# ── Version pin ────────────────────────────────────────────────
def _read(rel):
    with open(f"/app/{rel}", "r") as fh:
        return fh.read()


def test_version_at_least_131d():
    # v58.13.131d — ship chain: `.131` → `.131b` → `.131e` → `.131c` → `.131d` → `.122b`.
    # Pin accepts the .131d label OR any suffix >= 'e' (chronology, not alphabet).
    # v58.13.122b widens further: the .122b ship (plant_maintenance
    # reading back-fill) is a legitimate follow-on ship, and the fuel
    # reporting endpoints it introduces are unaffected.
    # v58.13.131m widens the suffix pattern to accept multi-char
    # suffixes (`q1`, `q2`, `p_hotfix`) that landed after `.132p`.
    _CANONICAL = {
        "frontend/src/lib/version.js": r"export const RUNNING_VERSION\s*=\s*'paneltec-v160\.3\.9\.58\.13\.(\d+)([a-z0-9_]*)'",
        "frontend/public/service-worker.js": r"const CACHE_VERSION\s*=\s*'paneltec-v160\.3\.9\.58\.13\.(\d+)([a-z0-9_]*)'",
        "mobile/src/lib/version.ts": r"export const MOBILE_BUNDLE_VERSION\s*=\s*'paneltec-v160\.3\.9\.58\.13\.(\d+)([a-z0-9_]*)'",
    }
    for f, pat in _CANONICAL.items():
        m = re.search(pat, _read(f))
        assert m, f"canonical constant not found in {f}"
        num = int(m.group(1))
        suffix = m.group(2) or ""
        ok = (
            num > 131
            or (num == 131 and suffix == "d")
            or (num == 131 and suffix >= "e")
            or (num == 122 and suffix in {"b", "c"})  # v58.13.122b/.122c ships
        )
        assert ok, f"{f} not at .131d/.122b/.122c (got {num}{suffix})"

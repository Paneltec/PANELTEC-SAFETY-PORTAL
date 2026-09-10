"""v58.13.132dg — Fuel override toggle + worker phones in Ad-hoc Jobs.

Locks (Part 1 — Fuel override toggle):
  · `override_smartfill_real` field on `fuel_price_settings` +
    `PriceIn` payload (optional, preserves stored value when None).
  · `effective_total_price(tx, price, override_smartfill=False)`
    — 3-arg signature; when override=True, every row is re-priced
    at `litres * price` regardless of `price_source`.
  · `get_org_override_smartfill(org_id)` + `get_org_price_state(org_id)`
    helpers exported.
  · History log records BOTH price and override transitions.
  · End-to-end: override OFF matches .132df behaviour; override ON
    reprices real SmartFill rows (row C included). Stored
    `total_price` in Mongo untouched in both cases.
  · 3-way web-version sync at `.132dg` or later.

Locks (Part 2 — Worker phone tap-to-call):
  · `AdminAssignDailyJobs.jsx` renders `tel:` links on the worker
    row phone, header phone, AND every assignment list row phone.
  · Missing-phone graceful fallback (—).
  · Backend `admin_list_workers` still returns `phone` field.
  · Backend `admin_list_assignments` still enriches `worker_phone`.
"""
from __future__ import annotations

import os
import re
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path

import pytest
import requests
from pymongo import MongoClient

APP_ROOT = Path(__file__).resolve().parents[2]
PRICE_MOD  = APP_ROOT / "backend" / "fuel_price_settings.py"
FLEET_MOD  = APP_ROOT / "backend" / "fleet_fuel.py"
REPORTS_MOD = APP_ROOT / "backend" / "fleet_fuel_reports.py"
ASSIGN_JSX = APP_ROOT / "frontend" / "src" / "pages" / "AdminAssignDailyJobs.jsx"
FUEL_JSX   = APP_ROOT / "frontend" / "src" / "pages" / "FuelReporting.jsx"
VERSION_JS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW         = APP_ROOT / "frontend" / "public" / "service-worker.js"

API = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")


# ─── Part 1: Fuel override toggle — source guardrails ─────────

def test_effective_total_price_accepts_override():
    from fuel_price_settings import effective_total_price
    # Override OFF: real price protected (existing .132df behaviour).
    assert effective_total_price(
        {"litres": 10, "total_price": 15.0, "price_source": "smartfill_actual"},
        3.00, False,
    ) == pytest.approx(15.0)
    # Override ON: real price gets re-priced at litres × provisional.
    assert effective_total_price(
        {"litres": 10, "total_price": 15.0, "price_source": "smartfill_actual"},
        3.00, True,
    ) == pytest.approx(30.0)
    # Override ON still zero when litres <= 0.
    assert effective_total_price(
        {"litres": 0, "total_price": 15.0, "price_source": "smartfill_actual"},
        3.00, True,
    ) == pytest.approx(0.0)


def test_helpers_exported():
    src = PRICE_MOD.read_text(encoding="utf-8")
    assert "async def get_org_override_smartfill" in src
    assert "async def get_org_price_state" in src
    assert "override_smartfill_real" in src


def test_priceIn_has_optional_override():
    from fuel_price_settings import PriceIn
    # None (omitted) is valid — preserves stored value.
    p = PriceIn(provisional_price_per_litre=2.5)
    assert p.override_smartfill_real is None
    p2 = PriceIn(provisional_price_per_litre=2.5, override_smartfill_real=True)
    assert p2.override_smartfill_real is True


def test_history_records_override_transitions():
    src = PRICE_MOD.read_text(encoding="utf-8")
    assert '"old_override"' in src
    assert '"new_override"' in src
    # Audit fires on price OR override change.
    assert "price_changed" in src or "override_changed" in src


def test_reports_and_summaries_use_price_state():
    reports = REPORTS_MOD.read_text(encoding="utf-8")
    fleet   = FLEET_MOD.read_text(encoding="utf-8")
    assert "get_org_price_state" in reports
    assert "get_org_price_state" in fleet
    # 3-arg effective_total_price invocation in both.
    assert "override_smartfill" in reports
    assert "override_smartfill" in fleet


def test_frontend_override_ui_wired():
    """v58.13.132dg — override wired through the FE.
    v58.13.132dh — the modal checkbox was replaced by a header
    segmented control (see `test_frontend_header_segmented_control_wired`
    in the .132dh lock). We keep the .132dg guardrails here on the
    behaviours that survived the UX move."""
    src = FUEL_JSX.read_text(encoding="utf-8")
    assert "OVERRIDE ACTIVE" in src
    assert "override_smartfill_real" in src
    # v58.13.132dh — PUT payload now sends `override_mode` from the
    # header segmented control; the modal-checkbox path is gone.
    assert "override_mode:" in src


# ─── Part 1: end-to-end retroactive re-price ─────────────────

def _mongo():
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


@pytest.fixture
def seeded_txs():
    db = _mongo()
    u = db.users.find_one({"email": "stephen@paneltec.com.au"})
    if not u:
        pytest.skip("Stephen user not seeded")
    org_id = u["org_id"]
    tag = f"pytest-132dg-{uuid.uuid4().hex[:6]}"
    now = datetime.now(timezone.utc)
    d0 = (now - timedelta(days=1)).isoformat()
    d1 = (now - timedelta(hours=6)).isoformat()
    d2 = (now - timedelta(hours=2)).isoformat()
    docs = [
        {"id": f"{tag}-A", "org_id": org_id, "asset_id": tag,
         "registration": tag, "deleted_at": None,
         "date_iso": d0[:10], "timestamp": d0, "litres": 40.0,
         "total_price": 90.0, "price_source": "provisional_static_2.25",
         "driver": "Pytest Driver"},
        {"id": f"{tag}-B", "org_id": org_id, "asset_id": tag,
         "registration": tag, "deleted_at": None,
         "date_iso": d1[:10], "timestamp": d1, "litres": 10.0,
         "total_price": None, "price_source": None,
         "driver": "Pytest Driver"},
        # Row C — real-priced SmartFill @ 1.80/L. Toggle-tested.
        {"id": f"{tag}-C", "org_id": org_id, "asset_id": tag,
         "registration": tag, "deleted_at": None,
         "date_iso": d2[:10], "timestamp": d2, "litres": 20.0,
         "total_price": 36.0, "price_source": "smartfill_actual",
         "driver": "Pytest Driver"},
    ]
    db.fuel_transactions.insert_many(docs)
    yield {"org_id": org_id, "tag": tag}
    db.fuel_transactions.delete_many({"id": {"$in": [d["id"] for d in docs]}})


def _pin_login():
    r = requests.post(f"{API}/api/auth/mobile/pin-login",
                      json={"pin": "3310", "device_id": "pytest-132dg"})
    if r.status_code == 429 or r.status_code != 200:
        pytest.skip(f"PIN login unavailable ({r.status_code})")
    return {"Authorization": f"Bearer {r.json()['session_token']}"}


def _put(hdr, price, override=None):
    body = {"provisional_price_per_litre": price}
    if override is not None:
        body["override_smartfill_real"] = override
    r = requests.put(f"{API}/api/fleet/fuel/price-settings",
                     headers=hdr, json=body)
    assert r.status_code == 200, r.text
    return r.json()


def _row_for(rows, reg):
    return next((r for r in rows if reg in (r.get("label") or "")), None)


@pytest.mark.live_db_writes
def test_override_off_matches_132df_behaviour(seeded_txs):
    hdr = _pin_login()
    tag = seeded_txs["tag"]
    _put(hdr, 2.25, override=False)
    r = requests.get(f"{API}/api/fleet/fuel/reports",
                     headers=hdr,
                     params={"scope": "vehicle", "period": "monthly"})
    row = _row_for(r.json()["rows"], tag)
    assert row is not None
    # Row A + B repriced @ 2.25; Row C untouched @ 36.
    expected = 40 * 2.25 + 10 * 2.25 + 36.0
    assert abs(row["total_price"] - expected) < 0.01, (
        f"override-OFF row.total_price={row['total_price']} expected {expected}"
    )
    # Restore.
    _put(hdr, 2.25, override=False)


@pytest.mark.live_db_writes
def test_override_on_reprices_smartfill_real(seeded_txs):
    hdr = _pin_login()
    tag = seeded_txs["tag"]
    # Flip override ON at 3.00.
    settings = _put(hdr, 3.00, override=True)
    assert settings["override_smartfill_real"] is True
    r = requests.get(f"{API}/api/fleet/fuel/reports",
                     headers=hdr,
                     params={"scope": "vehicle", "period": "monthly"})
    row = _row_for(r.json()["rows"], tag)
    assert row is not None
    # ALL 70 L repriced @ 3.00 — real price row folded in.
    expected = (40 + 10 + 20) * 3.00
    assert abs(row["total_price"] - expected) < 0.01, (
        f"override-ON row.total_price={row['total_price']} expected {expected}"
    )
    # DB `total_price` on Row C must remain 36.0 (read-time only).
    db = _mongo()
    real_row = db.fuel_transactions.find_one({"id": f"{tag}-C"})
    assert abs(real_row["total_price"] - 36.0) < 1e-6, (
        f"row C was mutated: stored total_price={real_row['total_price']}"
    )
    # Now restore: override OFF at 2.25.
    _put(hdr, 2.25, override=False)


@pytest.mark.live_db_writes
def test_override_toggle_alone_bumps_history(seeded_txs):
    hdr = _pin_login()
    # Baseline: 2.25 / OFF.
    _put(hdr, 2.25, override=False)
    before = requests.get(f"{API}/api/fleet/fuel/price-history", headers=hdr).json()["history"]
    before_top_ts = before[0]["changed_at"] if before else ""
    # Toggle ON at the SAME price — must still append a history row.
    _put(hdr, 2.25, override=True)
    after = requests.get(f"{API}/api/fleet/fuel/price-history", headers=hdr).json()["history"]
    assert after, "no history rows after override toggle"
    top = after[0]
    # A brand new row appeared at the top of the audit trail.
    assert top["changed_at"] > before_top_ts, (
        f"no new history row: before_top={before_top_ts} after_top={top['changed_at']}"
    )
    assert top.get("old_override") is False
    assert top.get("new_override") is True
    assert abs(top.get("old_price", 0) - 2.25) < 1e-6
    assert abs(top.get("new_price", 0) - 2.25) < 1e-6
    # Restore.
    _put(hdr, 2.25, override=False)


# ─── Part 2: Worker phone tap-to-call ─────────────────────────

def test_admin_assign_page_has_tel_links():
    src = ASSIGN_JSX.read_text(encoding="utf-8")
    # 3 phone entry points, each with tap-to-call semantics.
    for testid in (
        "worker-header-phone",
        # Worker list rows are id-suffixed — regex-match one.
    ):
        assert f'data-testid="{testid}"' in src, f"missing testid {testid!r}"
    # Worker list row phone with dynamic id — regex.
    assert re.search(r'data-testid=\{[`"]worker-row-phone-\$', src), (
        "worker-row-phone-<id> testid missing"
    )
    # Assignment list phone with dynamic id.
    assert re.search(r'data-testid=\{[`"]assignment-phone-\$', src), (
        "assignment-phone-<id> testid missing"
    )
    # 3 tel: hrefs.
    tel_hits = re.findall(r'href=\{\`tel:', src)
    assert len(tel_hits) >= 3, f"expected ≥3 tel: links, found {len(tel_hits)}"
    # Missing-phone graceful fallback.
    assert 'no phone on record' in src
    assert '—' in src


def test_backend_admin_workers_returns_phone():
    hdr = _pin_login()
    r = requests.get(f"{API}/api/mobile/daily-jobs/admin/workers",
                     headers=hdr, params={"limit": 5})
    assert r.status_code == 200, r.text
    body = r.json()
    assert "rows" in body
    if body["rows"]:
        # Each row must at least carry a `phone` key (may be null).
        assert "phone" in body["rows"][0]


def test_backend_admin_assignments_carries_worker_phone():
    hdr = _pin_login()
    r = requests.get(f"{API}/api/mobile/daily-jobs/admin/assignments",
                     headers=hdr)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "rows" in body
    if body["rows"]:
        # Snapshot field present on every row (may be null on legacy).
        for row in body["rows"]:
            assert "worker_phone" in row, (
                f"worker_phone missing on assignment row: {row.get('id')}"
            )


# ─── Version sync ─────────────────────────────────────────────

def test_three_way_sync_at_132dg_or_later():
    running = re.search(r"RUNNING_VERSION = '([^']+)'",
                        VERSION_JS.read_text()).group(1)
    expected = re.search(r"EXPECTED_CACHE_VERSION = '([^']+)'",
                         VERSION_JS.read_text()).group(1)
    cache = re.search(r"^const CACHE_VERSION = '([^']+)'",
                      SW.read_text(), re.MULTILINE).group(1)
    assert running == expected == cache
    tail = re.search(r"132([a-z]+)", running).group(1)
    assert tail >= "dg"

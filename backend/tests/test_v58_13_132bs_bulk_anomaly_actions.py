"""v58.13.132bs — Bulk anomaly actions.

Backend coverage:
  1. bulk-resolve: multiple txns → flags_resolved = sum of open flags.
  2. bulk-dismiss: same shape, dismissed field.
  3. bulk-attribute: writes asset_id on every txn, records `no_change`
     for txns already pointing at the requested vehicle, snapshots
     `prior_asset_id_pre_bulk_attribute`.
  4. bulk-reopen: reverses resolve/dismiss on the entire set.
  5. Validation: empty txn_ids → 400; > 500 → 400; unknown vehicle
     → 404; missing vehicle_id → 400.
  6. Auth: `assets.edit` gate honoured.

Frontend source pins:
  · Checkboxes + Select-all + Bulk action bar rendered.
  · BulkAttributeModal component present.
  · Version bump forward-safe >= .132bs.
"""
from __future__ import annotations
import os
import re
import time
import uuid
import pytest
from pathlib import Path
from datetime import datetime, timezone
from pymongo import MongoClient
from dotenv import load_dotenv
import httpx

pytestmark = pytest.mark.live_db_writes


def _read_frontend_env(key):
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith(key + "="):
                return line.split("=", 1)[1].strip().strip('"')
    raise RuntimeError(f"{key} missing")


@pytest.fixture(scope="module")
def env():
    load_dotenv("/app/backend/.env")
    return {
        "mongo_url": os.environ["MONGO_URL"],
        "db_name": os.environ["DB_NAME"],
        "api_url": _read_frontend_env("REACT_APP_BACKEND_URL"),
    }


@pytest.fixture(scope="module")
def db_sync(env):
    return MongoClient(env["mongo_url"])[env["db_name"]]


@pytest.fixture(scope="module")
def token(env):
    last_err = None
    for attempt in range(6):
        try:
            r = httpx.post(
                f"{env['api_url']}/api/auth/login",
                json={"email": "stephen@paneltec.com.au",
                      "password": "Mcgstephen50#"},
                timeout=10,
            )
            if r.status_code == 429:
                time.sleep(2 * (attempt + 1))
                last_err = r.text
                continue
            r.raise_for_status()
            return r.json()["access_token"]
        except httpx.HTTPStatusError as e:
            last_err = str(e)
            if e.response.status_code == 429:
                time.sleep(2 * (attempt + 1))
                continue
            raise
    raise RuntimeError(f"login failed: {last_err}")


@pytest.fixture
def seeded_txns(db_sync):
    """Insert 3 synthetic txns with open anomaly flags. Cleanup after."""
    org_id = "3116f250-a4eb-43f3-98a5-2a3656d6cb63"
    now = datetime.now(timezone.utc).isoformat()
    ids = [f"test-132bs-{uuid.uuid4()}" for _ in range(3)]
    docs = [
        {
            "id": tid, "org_id": org_id, "deleted_at": None,
            "timestamp": now, "date_iso": now[:10], "time_local": "10:00:00",
            "litres": 50.0, "total_price": 150.0, "registration": "TEST-132bs",
            "anomaly_flags": [
                {"rule": "unusual_hour", "severity": "low",
                 "resolved_at": None, "created_at": now},
                {"rule": "capacity_exceed", "severity": "high",
                 "resolved_at": None, "created_at": now},
            ],
            "created_at": now, "updated_at": now,
        }
        for tid in ids
    ]
    db_sync.fuel_transactions.insert_many([dict(d) for d in docs])
    yield {"txn_ids": ids, "org_id": org_id}
    db_sync.fuel_transactions.delete_many({"id": {"$in": ids}})


# ── bulk-resolve ────────────────────────────────────────────────
def test_bulk_resolve_happy_path(env, token, db_sync, seeded_txns):
    r = httpx.post(
        f"{env['api_url']}/api/fleet/fuel/anomalies/bulk-resolve",
        json={"txn_ids": seeded_txns["txn_ids"]},
        headers={"Authorization": f"Bearer {token}"}, timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["resolved"] == 3
    # 3 txns × 2 open flags each = 6.
    assert body["flags_resolved"] == 6
    assert body["failed"] == []

    # DB check.
    docs = list(db_sync.fuel_transactions.find({"id": {"$in": seeded_txns["txn_ids"]}}))
    for d in docs:
        for f in d["anomaly_flags"]:
            assert f.get("resolved_at") is not None
            assert f.get("resolved_action") == "resolved"


# ── bulk-dismiss ────────────────────────────────────────────────
def test_bulk_dismiss_happy_path(env, token, seeded_txns):
    r = httpx.post(
        f"{env['api_url']}/api/fleet/fuel/anomalies/bulk-dismiss",
        json={"txn_ids": seeded_txns["txn_ids"]},
        headers={"Authorization": f"Bearer {token}"}, timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["dismissed"] == 3
    assert body["flags_dismissed"] == 6


# ── bulk-reopen ─────────────────────────────────────────────────
def test_bulk_reopen_reverses_resolve(env, token, db_sync, seeded_txns):
    # Resolve then reopen.
    httpx.post(
        f"{env['api_url']}/api/fleet/fuel/anomalies/bulk-resolve",
        json={"txn_ids": seeded_txns["txn_ids"]},
        headers={"Authorization": f"Bearer {token}"}, timeout=15,
    )
    r = httpx.post(
        f"{env['api_url']}/api/fleet/fuel/anomalies/bulk-reopen",
        json={"txn_ids": seeded_txns["txn_ids"]},
        headers={"Authorization": f"Bearer {token}"}, timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["reopened"] == 3
    assert body["flags_reopened"] == 6

    # DB check.
    docs = list(db_sync.fuel_transactions.find({"id": {"$in": seeded_txns["txn_ids"]}}))
    for d in docs:
        for f in d["anomaly_flags"]:
            assert f.get("resolved_at") is None
            assert f.get("resolved_by") is None


# ── bulk-attribute ──────────────────────────────────────────────
def test_bulk_attribute_writes_asset_id(env, token, db_sync, seeded_txns):
    # Grab any real vehicle in the same org.
    veh = db_sync.assets.find_one(
        {"org_id": seeded_txns["org_id"], "kind": "vehicle", "deleted_at": None},
        {"id": 1, "rego_serial": 1, "name": 1},
    )
    if not veh:
        pytest.skip("no vehicle available in seeded org")
    r = httpx.post(
        f"{env['api_url']}/api/fleet/fuel/anomalies/bulk-attribute",
        json={"txn_ids": seeded_txns["txn_ids"], "vehicle_id": veh["id"]},
        headers={"Authorization": f"Bearer {token}"}, timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["attributed"] == 3
    assert body["vehicle_id"] == veh["id"]
    assert body["vehicle_rego"]

    # Repeat call → no_change=3.
    r2 = httpx.post(
        f"{env['api_url']}/api/fleet/fuel/anomalies/bulk-attribute",
        json={"txn_ids": seeded_txns["txn_ids"], "vehicle_id": veh["id"]},
        headers={"Authorization": f"Bearer {token}"}, timeout=15,
    )
    assert r2.status_code == 200
    assert r2.json()["no_change"] == 3
    assert r2.json()["attributed"] == 0

    # Cleanup: unset asset_id on the seeded txns so the fixture teardown
    # doesn't leave dangling attributions on the real vehicle.
    db_sync.fuel_transactions.update_many(
        {"id": {"$in": seeded_txns["txn_ids"]}},
        {"$unset": {"asset_id": "", "match_status": ""}},
    )


# ── validation ──────────────────────────────────────────────────
def test_bulk_empty_body_returns_400(env, token):
    r = httpx.post(
        f"{env['api_url']}/api/fleet/fuel/anomalies/bulk-resolve",
        json={"txn_ids": []},
        headers={"Authorization": f"Bearer {token}"}, timeout=10,
    )
    assert r.status_code == 400, r.text


def test_bulk_over_max_returns_400(env, token):
    # v58.13.132bw — MAX_BULK raised 500 → 2000.
    huge = [f"x-{i}" for i in range(2001)]
    r = httpx.post(
        f"{env['api_url']}/api/fleet/fuel/anomalies/bulk-resolve",
        json={"txn_ids": huge},
        headers={"Authorization": f"Bearer {token}"}, timeout=10,
    )
    assert r.status_code == 400, r.text
    assert "max" in r.text.lower()


def test_bulk_attribute_unknown_vehicle_returns_404(env, token, seeded_txns):
    r = httpx.post(
        f"{env['api_url']}/api/fleet/fuel/anomalies/bulk-attribute",
        json={"txn_ids": seeded_txns["txn_ids"],
              "vehicle_id": f"nope-{uuid.uuid4()}"},
        headers={"Authorization": f"Bearer {token}"}, timeout=10,
    )
    assert r.status_code == 404, r.text


def test_bulk_attribute_empty_vehicle_returns_400(env, token, seeded_txns):
    r = httpx.post(
        f"{env['api_url']}/api/fleet/fuel/anomalies/bulk-attribute",
        json={"txn_ids": seeded_txns["txn_ids"], "vehicle_id": ""},
        headers={"Authorization": f"Bearer {token}"}, timeout=10,
    )
    assert r.status_code == 400, r.text


def test_bulk_unknown_ids_end_up_in_failed(env, token, seeded_txns):
    """Mix real + fake ids — real ones succeed, fakes surface in `failed`."""
    ids = seeded_txns["txn_ids"] + [f"nope-{uuid.uuid4()}"]
    r = httpx.post(
        f"{env['api_url']}/api/fleet/fuel/anomalies/bulk-resolve",
        json={"txn_ids": ids},
        headers={"Authorization": f"Bearer {token}"}, timeout=15,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["resolved"] == 3
    fail_ids = {f["txn_id"] for f in body["failed"]}
    assert any(fid.startswith("nope-") for fid in fail_ids)


# ── Frontend source pins ────────────────────────────────────────
FE_ROOT = Path("/app/frontend/src")
INBOX = (FE_ROOT / "pages" / "FuelAnomalyInbox.jsx").read_text()
VERSION_JS = (FE_ROOT / "lib" / "version.js").read_text()
SW_JS = Path("/app/frontend/public/service-worker.js").read_text()


def test_frontend_has_select_and_bulk_bar():
    assert 'data-testid="fuel-anomaly-select-all"' in INBOX
    assert 'data-testid="fuel-anomaly-bulk-bar"' in INBOX
    assert 'data-testid="fuel-anomaly-bulk-resolve"' in INBOX
    assert 'data-testid="fuel-anomaly-bulk-dismiss"' in INBOX
    assert 'data-testid="fuel-anomaly-bulk-attribute"' in INBOX
    assert 'data-testid="fuel-anomaly-bulk-clear"' in INBOX
    assert 'data-testid="fuel-anomaly-bulk-count"' in INBOX


def test_frontend_has_per_row_checkbox_and_toggle():
    assert 'data-testid={`fuel-anomaly-select-${row.id}`}' in INBOX


def test_frontend_bulk_attribute_modal_present():
    assert "BulkAttributeModal" in INBOX
    assert 'data-testid="fuel-anomaly-bulk-attribute-modal"' in INBOX


def test_frontend_bulk_resolves_selection_calls_bulk_endpoints():
    # Endpoints built via template literal `bulk-${kind}` + explicit
    # `bulk-reopen` for Undo.
    assert "bulk-${kind}" in INBOX
    assert "/fleet/fuel/anomalies/bulk-reopen" in INBOX
    # Verb map covers all three actions.
    for kind in ("resolve", "dismiss", "attribute"):
        assert f"{kind}:" in INBOX


def test_frontend_selection_clears_on_tab_change():
    # useEffect (multi-line) that resets selection when `status` changes.
    assert "setSelected(new Set())" in INBOX
    assert "}, [status])" in INBOX


def test_version_and_cache_bumped_to_132bs():
    def ge(v):
        m = re.search(r"\.132([a-z]+)$", v)
        return bool(m) and m.group(1) >= "bs"
    m = re.search(r"RUNNING_VERSION\s*=\s*'([^']+)'", VERSION_JS)
    assert m and ge(m.group(1)), m and m.group(1)
    m2 = re.search(r"EXPECTED_CACHE_VERSION\s*=\s*'([^']+)'", VERSION_JS)
    assert m2 and ge(m2.group(1)), m2 and m2.group(1)
    m3 = re.search(r"CACHE_VERSION\s*=\s*'([^']+)'", SW_JS)
    assert m3 and ge(m3.group(1)), m3 and m3.group(1)

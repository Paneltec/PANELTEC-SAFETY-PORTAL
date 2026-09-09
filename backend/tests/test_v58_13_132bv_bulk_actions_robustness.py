"""v58.13.132bv — Bulk actions robustness.

Regression-catcher for Stephen's report that bulk-dismiss / bulk-resolve
does not remove tagged rows from the Open filter.

Backend coverage:
  1. Reproducer: seed a txn with 3 open flags → bulk-resolve → ALL 3
     flags carry `resolved_at` + `resolved_action="resolved"`. Same
     for bulk-dismiss.
  2. bulk-dismiss additionally stamps `dismissed_at` on every touched
     flag (v58.13.132bv semantic split) — bulk-resolve does not.
  3. Post-bulk row correctly drops from `/anomalies?resolved=false`.

Frontend source pins:
  · Optimistic FE removal: bulkAction strips ids from `items` before
    reload.
  · reload is now awaited (no fire-and-forget race).
  · Skipped-count surfaces in the toast message.
  · Version pin forward-safe >= .132bv.
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
    last = None
    for attempt in range(6):
        try:
            r = httpx.post(
                f"{env['api_url']}/api/auth/login",
                json={"email": "stephen@paneltec.com.au",
                      "password": "Mcgstephen50#"}, timeout=10,
            )
            if r.status_code == 429:
                time.sleep(2 * (attempt + 1))
                last = r.text
                continue
            r.raise_for_status()
            return r.json()["access_token"]
        except httpx.HTTPStatusError as e:
            last = str(e)
            if e.response.status_code == 429:
                time.sleep(2 * (attempt + 1))
                continue
            raise
    raise RuntimeError(f"login failed: {last}")


@pytest.fixture
def three_flag_txn(db_sync):
    """Seed one synthetic txn with 3 open anomaly flags. Cleanup after."""
    org_id = "3116f250-a4eb-43f3-98a5-2a3656d6cb63"
    now = datetime.now(timezone.utc).isoformat()
    tid = f"test-132bv-{uuid.uuid4()}"
    db_sync.fuel_transactions.insert_one({
        "id": tid, "org_id": org_id, "deleted_at": None,
        "timestamp": now, "date_iso": now[:10], "time_local": "12:00:00",
        "litres": 50.0, "total_price": 150.0, "registration": "BUG-132bv",
        "anomaly_flags": [
            {"rule": "unusual_hour",    "severity": "low",  "resolved_at": None, "created_at": now},
            {"rule": "capacity_exceed", "severity": "high", "resolved_at": None, "created_at": now},
            {"rule": "no_odometer",     "severity": "low",  "resolved_at": None, "created_at": now},
        ],
        "created_at": now, "updated_at": now,
    })
    yield {"txn_id": tid, "org_id": org_id}
    db_sync.fuel_transactions.delete_one({"id": tid})


# ── The bug reproducer ─────────────────────────────────────────
def test_bulk_resolve_flips_all_open_flags(env, token, db_sync, three_flag_txn):
    r = httpx.post(
        f"{env['api_url']}/api/fleet/fuel/anomalies/bulk-resolve",
        json={"txn_ids": [three_flag_txn["txn_id"]]},
        headers={"Authorization": f"Bearer {token}"}, timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["resolved"] == 1
    assert body["flags_resolved"] == 3, \
        f"expected 3 flags resolved, got {body['flags_resolved']}"

    # DB check — every flag has resolved_at.
    doc = db_sync.fuel_transactions.find_one({"id": three_flag_txn["txn_id"]})
    assert all(f.get("resolved_at") for f in doc["anomaly_flags"]), \
        f"not every flag has resolved_at: {doc['anomaly_flags']}"
    assert all(f.get("resolved_action") == "resolved" for f in doc["anomaly_flags"])
    # bulk-resolve does NOT stamp dismissed_at.
    assert all(not f.get("dismissed_at") for f in doc["anomaly_flags"])


def test_bulk_dismiss_flips_all_open_flags_and_stamps_dismissed_at(env, token, db_sync, three_flag_txn):
    r = httpx.post(
        f"{env['api_url']}/api/fleet/fuel/anomalies/bulk-dismiss",
        json={"txn_ids": [three_flag_txn["txn_id"]]},
        headers={"Authorization": f"Bearer {token}"}, timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["dismissed"] == 1
    assert body["flags_dismissed"] == 3

    doc = db_sync.fuel_transactions.find_one({"id": three_flag_txn["txn_id"]})
    for f in doc["anomaly_flags"]:
        assert f.get("resolved_at"), f
        assert f.get("resolved_action") == "dismissed", f
        # v58.13.132bv — dismissed_at now stamped on every touched flag.
        assert f.get("dismissed_at"), f


def test_bulk_resolve_removes_row_from_open_list(env, token, three_flag_txn):
    """Reproduces Stephen's report: after bulk-resolve the row must
    drop from `/anomalies?resolved=false`."""
    httpx.post(
        f"{env['api_url']}/api/fleet/fuel/anomalies/bulk-resolve",
        json={"txn_ids": [three_flag_txn["txn_id"]]},
        headers={"Authorization": f"Bearer {token}"}, timeout=15,
    )
    # Full-list fetch (no rule filter) — request enough pages to
    # cover the possibility that the seeded txn shifted deep.
    seen = False
    for pg in range(1, 40):
        r = httpx.get(
            f"{env['api_url']}/api/fleet/fuel/anomalies",
            params={"resolved": "false", "size": 200, "page": pg},
            headers={"Authorization": f"Bearer {token}"}, timeout=15,
        )
        items = r.json().get("items") or []
        if not items:
            break
        if any(i.get("id") == three_flag_txn["txn_id"] for i in items):
            seen = True
            break
    assert not seen, "post-bulk row still shows in resolved=false list"


# ── Frontend source pins ────────────────────────────────────────
FE_ROOT = Path("/app/frontend/src")
INBOX = (FE_ROOT / "pages" / "FuelAnomalyInbox.jsx").read_text()
VERSION_JS = (FE_ROOT / "lib" / "version.js").read_text()
SW_JS = Path("/app/frontend/public/service-worker.js").read_text()


def test_fe_optimistic_removal_on_bulk_action():
    # Optimistic strip of actioned ids from `items`.
    assert "Optimistic FE removal" in INBOX
    assert "setItems((prev) => prev.filter" in INBOX
    assert "!selected.has(r.id)" in INBOX


def test_fe_reload_is_awaited():
    # `await reload()` inside bulkAction so a stale items array can't
    # win a race against the fresh fetch.
    assert "await reload()" in INBOX


def test_fe_toast_surfaces_skipped_count():
    # Success toast now includes `· N skipped` when the backend
    # response's `failed[]` is non-empty.
    assert "` · ${failed} skipped`" in INBOX


def test_version_and_cache_bumped_to_132bv():
    def ge(v):
        m = re.search(r"\.132([a-z]+)$", v)
        return bool(m) and m.group(1) >= "bv"
    m = re.search(r"RUNNING_VERSION\s*=\s*'([^']+)'", VERSION_JS)
    assert m and ge(m.group(1)), m and m.group(1)
    m2 = re.search(r"EXPECTED_CACHE_VERSION\s*=\s*'([^']+)'", VERSION_JS)
    assert m2 and ge(m2.group(1)), m2 and m2.group(1)
    m3 = re.search(r"CACHE_VERSION\s*=\s*'([^']+)'", SW_JS)
    assert m3 and ge(m3.group(1)), m3 and m3.group(1)

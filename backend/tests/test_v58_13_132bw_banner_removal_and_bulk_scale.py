"""v58.13.132bw — Banner removal + bulk scale + Select-all-matching.

Backend coverage:
  1. `GET /fleet/fuel/anomalies/matching-ids` — flat id list under
     the current filter set, capped at 2000.
     - happy path w/ resolved=false
     - `capped: true` flag when total > limit
     - rule + search + resolved filters honoured
  2. `MAX_BULK` raised to 2000 — 2000 valid ids accepted; 2001 rejected.

Frontend source pins:
  · `FuelAnomalyBanner` removed from FleetRegister imports + render.
  · "Select all N matching" affordance wired into the bulk bar.
  · `/matching-ids` call site present.
  · Version bump forward-safe >= .132bw.
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


# ── /matching-ids happy path ────────────────────────────────────
def test_matching_ids_returns_flat_list(env, token):
    r = httpx.get(
        f"{env['api_url']}/api/fleet/fuel/anomalies/matching-ids",
        params={"resolved": "false", "limit": 500},
        headers={"Authorization": f"Bearer {token}"}, timeout=25,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body.keys()) == {"ids", "total_matches", "capped", "limit"}
    assert isinstance(body["ids"], list)
    assert body["limit"] == 500
    assert body["total_matches"] >= len(body["ids"])
    # Every returned id is a non-empty string.
    for tid in body["ids"][:5]:
        assert isinstance(tid, str) and tid.strip()


def test_matching_ids_capped_flag(env, token):
    """When total_matches > limit, the response flags capped=True."""
    r = httpx.get(
        f"{env['api_url']}/api/fleet/fuel/anomalies/matching-ids",
        params={"resolved": "false", "limit": 5},  # deliberately tiny cap
        headers={"Authorization": f"Bearer {token}"}, timeout=25,
    )
    body = r.json()
    if body["total_matches"] > 5:
        assert body["capped"] is True
        assert len(body["ids"]) == 5
    else:
        assert body["capped"] is False


def test_matching_ids_rule_filter(env, token, db_sync):
    """Rule filter narrows the id list to txns that carry an open flag
    of that rule."""
    # Pick any rule that exists in open flags.
    doc = db_sync.fuel_transactions.find_one(
        {"anomaly_flags": {"$elemMatch": {"resolved_at": None}}},
        {"anomaly_flags": 1},
    )
    if not doc:
        pytest.skip("no open anomalies in DB")
    open_flag = next((f for f in doc["anomaly_flags"] if not f.get("resolved_at")), None)
    if not open_flag:
        pytest.skip("no truly open flag in seeded doc")
    rule = open_flag["rule"]
    r = httpx.get(
        f"{env['api_url']}/api/fleet/fuel/anomalies/matching-ids",
        params={"resolved": "false", "rule": rule, "limit": 20},
        headers={"Authorization": f"Bearer {token}"}, timeout=25,
    )
    assert r.status_code == 200, r.text
    ids = r.json()["ids"]
    # Spot check: at least one id in the response should have the rule
    # as an open flag in DB.
    if ids:
        row = db_sync.fuel_transactions.find_one({"id": ids[0]}, {"anomaly_flags": 1})
        rules_open = [f["rule"] for f in row["anomaly_flags"] if not f.get("resolved_at")]
        assert rule in rules_open


def test_matching_ids_search_filter(env, token, db_sync):
    """Search filter reduces the id list — pick a real registration
    string and confirm the response contains a subset."""
    doc = db_sync.fuel_transactions.find_one(
        {"registration": {"$nin": [None, ""]},
         "anomaly_flags": {"$elemMatch": {"resolved_at": None}}},
        {"registration": 1},
    )
    if not doc:
        pytest.skip("no open-flag row with a registration string")
    needle = doc["registration"]
    r_all = httpx.get(
        f"{env['api_url']}/api/fleet/fuel/anomalies/matching-ids",
        params={"resolved": "false", "limit": 2000},
        headers={"Authorization": f"Bearer {token}"}, timeout=25,
    )
    r_search = httpx.get(
        f"{env['api_url']}/api/fleet/fuel/anomalies/matching-ids",
        params={"resolved": "false", "search": needle, "limit": 2000},
        headers={"Authorization": f"Bearer {token}"}, timeout=25,
    )
    assert r_all.json()["total_matches"] >= r_search.json()["total_matches"]


# ── MAX_BULK raised to 2000 ──────────────────────────────────────
def test_bulk_cap_raised_to_2000(env, token):
    # 2000 valid-format ids → 200 (all "not found" in failed[], but
    # request itself accepted).
    ids = [str(uuid.uuid4()) for _ in range(2000)]
    r = httpx.post(
        f"{env['api_url']}/api/fleet/fuel/anomalies/bulk-resolve",
        json={"txn_ids": ids},
        headers={"Authorization": f"Bearer {token}"}, timeout=25,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["resolved"] == 0
    assert len(body["failed"]) == 2000  # all not found

    # 2001 → 400.
    ids2 = [str(uuid.uuid4()) for _ in range(2001)]
    r2 = httpx.post(
        f"{env['api_url']}/api/fleet/fuel/anomalies/bulk-resolve",
        json={"txn_ids": ids2},
        headers={"Authorization": f"Bearer {token}"}, timeout=15,
    )
    assert r2.status_code == 400, r2.text
    assert "max" in r2.text.lower()


# ── Frontend source pins ────────────────────────────────────────
FE_ROOT = Path("/app/frontend/src")
FLEET_REGISTER = (FE_ROOT / "pages" / "FleetRegister.jsx").read_text()
INBOX = (FE_ROOT / "pages" / "FuelAnomalyInbox.jsx").read_text()
VERSION_JS = (FE_ROOT / "lib" / "version.js").read_text()
SW_JS = Path("/app/frontend/public/service-worker.js").read_text()


def test_fleet_register_banner_removed():
    # Import gone.
    assert "import FuelAnomalyBanner from" not in FLEET_REGISTER
    # Render call gone.
    assert "<FuelAnomalyBanner" not in FLEET_REGISTER
    # Removal note explicit.
    assert "FuelAnomalyBanner removed" in FLEET_REGISTER


def test_inbox_has_select_all_matching():
    assert 'data-testid="fuel-anomaly-bulk-select-all-matching"' in INBOX
    assert "selectAllMatching" in INBOX
    assert "/fleet/fuel/anomalies/matching-ids" in INBOX
    # Capped-toast copy present.
    assert "Selected first" in INBOX
    assert "narrow filters" in INBOX


def test_version_and_cache_bumped_to_132bw():
    def ge(v):
        m = re.search(r"\.132([a-z]+)$", v)
        return bool(m) and m.group(1) >= "bw"
    m = re.search(r"RUNNING_VERSION\s*=\s*'([^']+)'", VERSION_JS)
    assert m and ge(m.group(1)), m and m.group(1)
    m2 = re.search(r"EXPECTED_CACHE_VERSION\s*=\s*'([^']+)'", VERSION_JS)
    assert m2 and ge(m2.group(1)), m2 and m2.group(1)
    m3 = re.search(r"CACHE_VERSION\s*=\s*'([^']+)'", SW_JS)
    assert m3 and ge(m3.group(1)), m3 and m3.group(1)

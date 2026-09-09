"""v58.13.132ca — Bulk action truncation fix (or rather: header
select-all now select-all-matching, not page-scoped).

Backend regression checks:
  1. bulk-resolve accepts a 300-txn batch, resolves all 300 flags in
     one call (no truncation).
  2. matching-ids returns all matches up to the 2000 cap (not page-
     scoped).

Frontend source pins:
  · togglePageAll now calls selectAllMatching when total > filtered.
  · Bulk bar shows a "cross-page" badge when selection exceeds the
    visible page.
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
    for a in range(6):
        r = httpx.post(f"{env['api_url']}/api/auth/login",
                       json={"email": "stephen@paneltec.com.au",
                             "password": "Mcgstephen50#"}, timeout=10)
        if r.status_code == 429:
            time.sleep(2 * (a + 1))
            continue
        r.raise_for_status()
        return r.json()["access_token"]
    raise RuntimeError("login failed")


def test_bulk_resolve_300_flags_no_truncation(env, token, db_sync):
    """Stephen's report: 'only 50 processed'. Reproducer: seed 300
    txns with one open flag each, bulk-resolve all 300 in one call,
    assert every single one has resolved_at set."""
    org = "3116f250-a4eb-43f3-98a5-2a3656d6cb63"
    now = datetime.now(timezone.utc).isoformat()
    ids = [f"test-132ca-{uuid.uuid4()}" for _ in range(300)]
    db_sync.fuel_transactions.insert_many([{
        "id": t, "org_id": org, "deleted_at": None,
        "timestamp": now, "date_iso": now[:10], "time_local": "10:00:00",
        "litres": 50.0, "total_price": 150.0, "registration": "BULK-300",
        "anomaly_flags": [{"rule": "unusual_hour", "severity": "low",
                            "resolved_at": None, "created_at": now}],
        "created_at": now, "updated_at": now,
    } for t in ids])
    try:
        r = httpx.post(
            f"{env['api_url']}/api/fleet/fuel/anomalies/bulk-resolve",
            json={"txn_ids": ids},
            headers={"Authorization": f"Bearer {token}"}, timeout=60,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["resolved"] == 300, f"resolved={body['resolved']}, expected 300"
        assert body["flags_resolved"] == 300
        # DB check: every one of the 300 has resolved_at set.
        with_resolved = db_sync.fuel_transactions.count_documents({
            "id": {"$in": ids},
            "anomaly_flags.resolved_at": {"$ne": None},
        })
        assert with_resolved == 300, f"only {with_resolved}/300 wrote resolved_at"
    finally:
        db_sync.fuel_transactions.delete_many({"id": {"$in": ids}})


def test_matching_ids_not_page_scoped(env, token, db_sync):
    """matching-ids must return the FULL match set (up to cap), not
    page-scoped 50."""
    r = httpx.get(
        f"{env['api_url']}/api/fleet/fuel/anomalies/matching-ids",
        params={"resolved": "false", "limit": 2000},
        headers={"Authorization": f"Bearer {token}"}, timeout=25,
    )
    assert r.status_code == 200
    body = r.json()
    # Whatever total_matches is — the ids list must equal min(total, 2000).
    expected_len = min(body["total_matches"], 2000)
    assert len(body["ids"]) == expected_len, (
        f"ids={len(body['ids'])} but total_matches={body['total_matches']}"
    )


# ── FE source pins ──────────────────────────────────────────────
INBOX = Path("/app/frontend/src/pages/FuelAnomalyInbox.jsx").read_text()
VERSION_JS = Path("/app/frontend/src/lib/version.js").read_text()
SW_JS = Path("/app/frontend/public/service-worker.js").read_text()


def test_header_select_all_promotes_to_matching():
    assert "if (total > filtered.length && !allOnPageSelected)" in INBOX
    assert "selectAllMatching();" in INBOX


def test_bulk_bar_shows_cross_page_badge():
    assert 'data-testid="fuel-anomaly-bulk-cross-page-badge"' in INBOX
    assert "selected.size > filtered.length" in INBOX


def test_version_and_cache_bumped_to_132ca():
    def ge(v):
        m = re.search(r"\.132([a-z]+)$", v)
        return bool(m) and m.group(1) >= "ca"
    for txt in (
        re.search(r"RUNNING_VERSION\s*=\s*'([^']+)'", VERSION_JS).group(1),
        re.search(r"EXPECTED_CACHE_VERSION\s*=\s*'([^']+)'", VERSION_JS).group(1),
        re.search(r"CACHE_VERSION\s*=\s*'([^']+)'", SW_JS).group(1),
    ):
        assert ge(txt), txt

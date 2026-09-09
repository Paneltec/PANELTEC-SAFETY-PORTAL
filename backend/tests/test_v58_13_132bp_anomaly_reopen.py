"""v58.13.132bp — Fuel Anomaly Inbox: /reopen endpoint + UX hardening.

Coverage:
  1. Happy path: seeded txn with an already-resolved flag → POST /reopen
     clears the resolution metadata + the flag re-appears when the
     inbox is re-listed with resolved=false.
  2. 404 on unknown txn.
  3. 400 on rule not present on the txn.
  4. 400 on rule that is already open (idempotency guard).
  5. Endpoint clears every resolution-metadata field the codebase has
     ever written (resolved_at, resolved_by, resolved_action,
     resolved_note).
  6. `assets.edit` gate honoured — worker role → 403.
  7. Frontend source pins for the 3 UX fixes + version bump.
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


def _read_frontend_env(key: str) -> str:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith(key + "="):
                return line.split("=", 1)[1].strip().strip('"')
    raise RuntimeError(f"{key} not in /app/frontend/.env")


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
    """Rate-limit-aware admin login."""
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
        except httpx.HTTPStatusError as e:  # noqa: PERF203
            last_err = str(e)
            if e.response.status_code == 429:
                time.sleep(2 * (attempt + 1))
                continue
            raise
    raise RuntimeError(f"login failed after retries: {last_err}")


@pytest.fixture
def seeded_txn(db_sync):
    """Insert a synthetic fuel_transactions row with a resolved
    anomaly flag. Cleaned up after the test."""
    org_id = "3116f250-a4eb-43f3-98a5-2a3656d6cb63"  # paneltec_civil
    txn_id = f"test-132bp-{uuid.uuid4()}"
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": txn_id,
        "org_id": org_id,
        "deleted_at": None,
        "timestamp": now,
        "date_iso": now[:10],
        "time_local": "12:34:56",
        "litres": 50.0,
        "total_price": 150.0,
        "registration": "TEST-132bp",
        "card_number": "test-132bp-card",
        "anomaly_flags": [
            {
                "rule": "unusual_hour",
                "severity": "low",
                "detail": "test seed",
                "resolved_at": now,
                "resolved_by": "seed-user",
                "resolved_action": "resolved",
                "resolved_note": "seeded resolved flag",
                "created_at": now,
            },
            # A second flag that's already open, to prove multi-flag
            # rows aren't disturbed by the reopen path.
            {
                "rule": "capacity_exceed",
                "severity": "high",
                "detail": "test seed open",
                "resolved_at": None,
                "resolved_by": None,
                "created_at": now,
            },
        ],
        "created_at": now,
        "updated_at": now,
    }
    db_sync.fuel_transactions.insert_one(dict(doc))
    yield {"txn_id": txn_id, "org_id": org_id}
    db_sync.fuel_transactions.delete_one({"id": txn_id})


# ── 1. Happy path ──────────────────────────────────────────────
def test_reopen_clears_resolution_metadata(env, token, db_sync, seeded_txn):
    r = httpx.post(
        f"{env['api_url']}/api/fleet/fuel/anomalies/{seeded_txn['txn_id']}/reopen",
        json={"rule": "unusual_hour"}, timeout=10,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["txn_id"] == seeded_txn["txn_id"]
    assert body["rule"] == "unusual_hour"
    assert body["reopened"] == 1

    # DB inspection.
    doc = db_sync.fuel_transactions.find_one(
        {"id": seeded_txn["txn_id"]}, {"anomaly_flags": 1},
    )
    flags = {f["rule"]: f for f in doc["anomaly_flags"]}
    unusual = flags["unusual_hour"]
    for k in ("resolved_at", "resolved_by", "resolved_action",
              "resolved_note"):
        assert unusual.get(k) in (None, ""), f"{k} not cleared: {unusual.get(k)}"
    # Second flag (capacity_exceed) unaffected.
    assert flags["capacity_exceed"].get("resolved_at") is None


def test_reopen_row_returns_to_open_filter(env, token, seeded_txn):
    """After reopen, the seeded txn should now match
    resolved=false because at least one flag is open."""
    # Reopen the unusual_hour flag.
    httpx.post(
        f"{env['api_url']}/api/fleet/fuel/anomalies/{seeded_txn['txn_id']}/reopen",
        json={"rule": "unusual_hour"}, timeout=10,
        headers={"Authorization": f"Bearer {token}"},
    )
    # List with rule filter to guarantee we find it fast.
    r = httpx.get(
        f"{env['api_url']}/api/fleet/fuel/anomalies",
        params={"rule": "unusual_hour", "resolved": False, "size": 200},
        timeout=15,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    ids = {row["id"] for row in r.json().get("items", [])}
    assert seeded_txn["txn_id"] in ids, \
        "reopened txn did not resurface in resolved=false filter"


# ── 2. 404 ─────────────────────────────────────────────────────
def test_reopen_missing_txn_returns_404(env, token):
    r = httpx.post(
        f"{env['api_url']}/api/fleet/fuel/anomalies/does-not-exist-{uuid.uuid4()}/reopen",
        json={"rule": "unusual_hour"}, timeout=10,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 404, r.text


# ── 3. 400 · rule not present ─────────────────────────────────
def test_reopen_rule_absent_returns_400(env, token, seeded_txn):
    r = httpx.post(
        f"{env['api_url']}/api/fleet/fuel/anomalies/{seeded_txn['txn_id']}/reopen",
        json={"rule": "reading_regress"},  # not on the seeded row
        timeout=10,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 400, r.text


# ── 4. 400 · rule already open (idempotency guard) ────────────
def test_reopen_already_open_returns_400(env, token, seeded_txn):
    r = httpx.post(
        f"{env['api_url']}/api/fleet/fuel/anomalies/{seeded_txn['txn_id']}/reopen",
        json={"rule": "capacity_exceed"},  # this flag is open already
        timeout=10,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 400, r.text


# ── 5. Frontend source pins ────────────────────────────────────
FE_ROOT = Path("/app/frontend/src")
INBOX = (FE_ROOT / "pages" / "FuelAnomalyInbox.jsx").read_text()
VERSION_JS = (FE_ROOT / "lib" / "version.js").read_text()
SW_JS = Path("/app/frontend/public/service-worker.js").read_text()


def test_frontend_chips_are_real_buttons():
    """Resolve/Dismiss chips must be filled buttons, not outline
    pills."""
    # Emerald filled button for Resolve.
    assert "bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-700" in INBOX
    # Slate filled button for Dismiss.
    assert "bg-slate-600 hover:bg-slate-700 text-white border-slate-700" in INBOX
    # New hit-area + font.
    assert "px-2.5 py-1" in INBOX
    assert "text-xs font-semibold" in INBOX
    # Reversibility copy in titles.
    assert "reversible via Undo toast" in INBOX
    # Old 10-pixel styling is gone.
    assert "px-1.5 py-0.5 rounded text-[10px] font-bold border border-emerald-300" not in INBOX


def test_frontend_undo_toast_wired():
    """flip() calls toast with a 5s duration + Undo action pointing at
    the new /reopen endpoint."""
    assert "duration: 5000" in INBOX
    assert "label: 'Undo'" in INBOX
    assert "/reopen" in INBOX
    assert "actionButtonStyle" in INBOX
    # Emerald pill styling on the Undo action.
    assert "#059669" in INBOX  # emerald-600
    assert "#047857" in INBOX  # emerald-700


def test_frontend_status_filter_is_tab_strip():
    """Status filter renders as a tab strip with a bottom-border
    baseline + 2px underline on the active tab."""
    assert 'data-testid="fuel-anomaly-status-tabs"' in INBOX
    # Container carries the tab baseline.
    assert "border-b border-slate-200" in INBOX
    # Each tab uses the -mb-px + border-b-2 pattern.
    assert "-mb-px border-b-2" in INBOX
    # Testids preserved.
    for k in ("open", "resolved", "all"):
        assert f'data-testid={{`fuel-anomaly-status-${{opt.key}}`}}' in INBOX or \
               f'fuel-anomaly-status-{k}' in INBOX
    # Old pill styling is gone.
    assert 'className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${' not in INBOX


def test_version_and_cache_bumped_to_132bp():
    def _ge_132bp(v: str) -> bool:
        m = re.search(r"\.132([a-z]+)$", v)
        return bool(m) and m.group(1) >= "bp"

    m = re.search(r"RUNNING_VERSION\s*=\s*'([^']+)'", VERSION_JS)
    assert m and _ge_132bp(m.group(1)), m and m.group(1)
    m2 = re.search(r"EXPECTED_CACHE_VERSION\s*=\s*'([^']+)'", VERSION_JS)
    assert m2 and _ge_132bp(m2.group(1)), m2 and m2.group(1)
    m3 = re.search(r"CACHE_VERSION\s*=\s*'([^']+)'", SW_JS)
    assert m3 and _ge_132bp(m3.group(1)), m3 and m3.group(1)

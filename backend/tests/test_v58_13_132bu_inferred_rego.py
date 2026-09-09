"""v58.13.132bu — Inferred rego cascade for SmartFill cards.

Coverage:
  1. `/fleet/fuel/reports` leaderboard rows now expose `inferred_rego`
     when the card has no formal `assets.smartfill_card_number` link
     but does have a majority `asset_id` across the last 90 days of
     fills.
  2. `linked_rego` takes precedence — `inferred_rego` is null when a
     formal link exists.
  3. Majority-vote rule: the most-common asset_id wins, and it must
     resolve to a live asset in the org.
  4. `/fleet/fuel/cards/{card}/summary` also carries `inferred_rego`
     + `inferred_asset_id` + `inferred_fill_count_90d` when no formal
     link is present.
  5. Frontend source pins: FuelReporting displayLabel cascade,
     SmartFillCardDrawer header consumes `summary.inferred_rego`,
     version bumped forward-safe.
"""
from __future__ import annotations
import os
import re
import time
import uuid
import pytest
from pathlib import Path
from collections import Counter
from datetime import datetime, timedelta, timezone
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


# ── Leaderboards carry inferred_rego ────────────────────────────
def test_leaderboard_rows_expose_inferred_rego(env, token):
    r = httpx.get(
        f"{env['api_url']}/api/fleet/fuel/reports",
        params={"scope": "admin", "period": "monthly"}, timeout=25,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    lb = r.json().get("leaderboards") or {}
    assert lb, "no leaderboards block"
    for board in ("top_by_cost", "top_by_dpl", "top_by_fills"):
        for row in lb.get(board) or []:
            assert "inferred_rego" in row, f"{board} row missing inferred_rego: {row}"
            v = row["inferred_rego"]
            assert v is None or (isinstance(v, str) and v.strip()), \
                f"inferred_rego must be None or non-empty string, got {v!r}"


def test_inferred_only_when_no_formal_link(env, token):
    r = httpx.get(
        f"{env['api_url']}/api/fleet/fuel/reports",
        params={"scope": "admin", "period": "monthly"}, timeout=25,
        headers={"Authorization": f"Bearer {token}"},
    )
    lb = r.json()["leaderboards"]
    for board in ("top_by_cost", "top_by_dpl", "top_by_fills"):
        for row in lb.get(board) or []:
            if row.get("linked_rego"):
                assert row.get("inferred_rego") is None, (
                    f"row has BOTH linked_rego and inferred_rego: {row}"
                )


def test_inferred_matches_majority_asset_id_in_db(env, token, db_sync):
    """For rows currently exposing inferred_rego, verify the value
    matches the majority-asset_id → rego lookup we'd compute
    independently against the DB."""
    r = httpx.get(
        f"{env['api_url']}/api/fleet/fuel/reports",
        params={"scope": "admin", "period": "monthly"}, timeout=25,
        headers={"Authorization": f"Bearer {token}"},
    )
    lb = r.json()["leaderboards"]
    cutoff = (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()
    ran = 0
    for board in ("top_by_cost", "top_by_dpl", "top_by_fills"):
        for row in lb.get(board) or []:
            if not row.get("inferred_rego"):
                continue
            cards = row.get("card_numbers") or []
            if len(cards) != 1:
                continue
            txns = list(db_sync.fuel_transactions.find(
                {"card_number": cards[0], "deleted_at": None,
                 "timestamp": {"$gte": cutoff},
                 "asset_id": {"$nin": [None, ""]}},
                {"asset_id": 1},
            ))
            if not txns:
                continue
            top_aid = Counter(t["asset_id"] for t in txns).most_common(1)[0][0]
            a = db_sync.assets.find_one({"id": top_aid, "deleted_at": None},
                                         {"rego_serial": 1, "name": 1})
            expected = a.get("rego_serial") or a.get("name") if a else None
            assert row["inferred_rego"] == expected, (
                f"card={cards[0]} row.inferred_rego={row['inferred_rego']!r} "
                f"but majority-vote asset resolves to {expected!r}"
            )
            ran += 1
            if ran >= 3:
                return
    if ran == 0:
        pytest.skip("no inferred-rego rows currently in leaderboards")


# ── /cards/{card}/summary carries inferred_rego ─────────────────
def test_card_summary_inferred_rego_present(env, token, db_sync):
    # Pick a card that likely has txns with asset_id but no formal link.
    row = db_sync.fuel_transactions.find_one(
        {"card_number": {"$nin": [None, ""]},
         "asset_id": {"$nin": [None, ""]}, "deleted_at": None},
        {"card_number": 1},
    )
    if not row:
        pytest.skip("no fuel txn with card_number + asset_id")
    card = row["card_number"]
    r = httpx.get(
        f"{env['api_url']}/api/fleet/fuel/cards/{card}/summary", timeout=15,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "inferred_rego" in body
    # Contract: when linked_vehicle is null AND we have txns, inferred_rego
    # should be a non-null string.
    if body.get("linked_vehicle") is None:
        # Only strict-assert when there ARE txns with asset_id in 90d.
        cutoff = (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()
        has_txn = db_sync.fuel_transactions.find_one({
            "card_number": card, "deleted_at": None,
            "timestamp": {"$gte": cutoff},
            "asset_id": {"$nin": [None, ""]},
        })
        if has_txn:
            assert body["inferred_rego"], \
                f"card {card} unlinked with 90d txns but inferred_rego is falsy: {body}"
            assert body.get("inferred_asset_id")
            assert body.get("inferred_fill_count_90d", 0) > 0


# ── Frontend source pins ────────────────────────────────────────
FE_ROOT = Path("/app/frontend/src")
FUEL_REPORTING = (FE_ROOT / "pages" / "FuelReporting.jsx").read_text()
DRAWER = (FE_ROOT / "components" / "fleet" / "SmartFillCardDrawer.jsx").read_text()
VERSION_JS = (FE_ROOT / "lib" / "version.js").read_text()
SW_JS = Path("/app/frontend/public/service-worker.js").read_text()


def test_fe_display_label_cascade():
    assert "inferred_rego" in FUEL_REPORTING
    assert "isInferred" in FUEL_REPORTING
    # `(inferred)` chip present with a testid suffix.
    assert 'inferred`}' in FUEL_REPORTING or "-inferred" in FUEL_REPORTING
    # Chip styling: violet.
    assert "bg-violet-100 text-violet-800" in FUEL_REPORTING


def test_drawer_header_consumes_inferred_rego():
    assert "summary?.inferred_rego" in DRAWER
    assert "smartfill-card-title-inferred" in DRAWER
    assert "text-violet-700" in DRAWER


def test_version_and_cache_bumped_to_132bu():
    def ge(v):
        m = re.search(r"\.132([a-z]+)$", v)
        return bool(m) and m.group(1) >= "bu"
    m = re.search(r"RUNNING_VERSION\s*=\s*'([^']+)'", VERSION_JS)
    assert m and ge(m.group(1)), m and m.group(1)
    m2 = re.search(r"EXPECTED_CACHE_VERSION\s*=\s*'([^']+)'", VERSION_JS)
    assert m2 and ge(m2.group(1)), m2 and m2.group(1)
    m3 = re.search(r"CACHE_VERSION\s*=\s*'([^']+)'", SW_JS)
    assert m3 and ge(m3.group(1)), m3 and m3.group(1)

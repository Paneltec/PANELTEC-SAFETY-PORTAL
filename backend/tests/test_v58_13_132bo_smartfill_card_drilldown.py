"""v58.13.132bo — SmartFill card drill-down guardrails.

Coverage:
  1. GET /fleet/fuel/cards/{card}/summary   — payload shape + cache TTL.
  2. GET /fleet/fuel/cards/{card}/transactions — pagination + `flagged_only`
     filter + `vehicle_rego` enrichment on linked cards.
  3. POST /fleet/fuel/cards/{card}/assign   — happy path, idempotent
     no_change, 409 on conflict with a different vehicle, 400 on empty
     body, 404 on unknown vehicle.
  4. Fuel Reports (`/fleet/fuel/reports`) — leaderboard rows now
     carry `card_numbers` (empty list minimum, never missing).
  5. Frontend source pins — `SmartFillCardDrawer` imported in
     `FuelReporting.jsx`; `handleLeaderboardClick` wired into every
     Leaderboard; `CardChooserDialog` component present; version
     bumped to `.132bo` on all three canonical strings.
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


# ── env / login fixtures (aligned with .132bi conftest pattern) ─
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


@pytest.fixture(scope="module")
def seeded_card(db_sync):
    """Pick any card number that has at least one non-deleted fuel
    transaction. Falls back to a card that shows up under an org."""
    tx = db_sync.fuel_transactions.find_one(
        {"card_number": {"$nin": [None, ""]}, "deleted_at": None},
        {"card_number": 1, "org_id": 1},
    )
    assert tx, "no card-tagged fuel transactions in DB — cannot seed test"
    return {"card_number": tx["card_number"], "org_id": tx["org_id"]}


# ── 1. /cards/{card}/summary shape + cache TTL ─────────────────
EXPECTED_SUMMARY_KEYS = {
    "card_number", "generated_at", "linked_vehicle",
    "all_time", "ytd", "fills_30d", "anomaly_count_90d",
    "top_driver_90d",
}


def test_card_summary_shape(env, token, seeded_card):
    r = httpx.get(
        f"{env['api_url']}/api/fleet/fuel/cards/{seeded_card['card_number']}/summary",
        headers={"Authorization": f"Bearer {token}"}, timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    missing = EXPECTED_SUMMARY_KEYS - set(body.keys())
    assert not missing, f"missing keys: {missing}"
    assert body["card_number"] == seeded_card["card_number"]
    assert isinstance(body["all_time"], dict)
    assert {"total_price", "total_litres", "fill_count",
            "avg_price_per_litre", "first_seen", "last_seen"} <= set(body["all_time"])
    assert isinstance(body["ytd"], dict)
    assert {"total_price", "total_litres", "fill_count"} <= set(body["ytd"])
    assert isinstance(body["fills_30d"], int)
    assert isinstance(body["anomaly_count_90d"], int)


def test_card_summary_cache_ttl(env, token, seeded_card):
    """Two rapid calls within the 60s TTL return the same
    `generated_at`."""
    url = (
        f"{env['api_url']}/api/fleet/fuel/cards/"
        f"{seeded_card['card_number']}/summary"
    )
    h = {"Authorization": f"Bearer {token}"}
    r1 = httpx.get(url, headers=h, timeout=15).json()
    r2 = httpx.get(url, headers=h, timeout=15).json()
    assert r1["generated_at"] == r2["generated_at"], \
        "summary cache TTL not honoured — second call re-generated"


# ── 2. /cards/{card}/transactions pagination + flagged_only ────
def test_card_transactions_pagination(env, token, seeded_card):
    r = httpx.get(
        f"{env['api_url']}/api/fleet/fuel/cards/{seeded_card['card_number']}/transactions",
        params={"limit": 5, "offset": 0}, timeout=15,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["card_number"] == seeded_card["card_number"]
    assert body["limit"] == 5
    assert body["offset"] == 0
    assert isinstance(body["total"], int)
    assert isinstance(body["rows"], list)
    assert len(body["rows"]) <= 5
    for row in body["rows"]:
        # vehicle_rego is always present (may be None on unlinked cards).
        assert "vehicle_rego" in row


def test_card_transactions_flagged_only(env, token, seeded_card):
    r = httpx.get(
        f"{env['api_url']}/api/fleet/fuel/cards/{seeded_card['card_number']}/transactions",
        params={"flagged_only": True, "limit": 20}, timeout=15,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    for row in body["rows"]:
        flags = row.get("anomaly_flags") or []
        assert flags, "flagged_only=true returned a row with no anomaly_flags"


# ── 3. /cards/{card}/assign contract ───────────────────────────
def test_card_assign_missing_vehicle_returns_404(env, token, seeded_card):
    r = httpx.post(
        f"{env['api_url']}/api/fleet/fuel/cards/{seeded_card['card_number']}/assign",
        json={"vehicle_id": f"does-not-exist-{uuid.uuid4()}"}, timeout=10,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 404, r.text


def test_card_assign_empty_body_returns_422_or_400(env, token, seeded_card):
    """Pydantic validation on `vehicle_id` returns 422; explicit empty
    string flows into the endpoint's own check which returns 400."""
    r = httpx.post(
        f"{env['api_url']}/api/fleet/fuel/cards/{seeded_card['card_number']}/assign",
        json={"vehicle_id": ""}, timeout=10,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code in (400, 422), r.text


def test_card_assign_idempotent(env, token, db_sync, seeded_card):
    """Assigning the same card to the same vehicle twice returns
    `no_change=True` on the second call."""
    # Find (or create) a spare vehicle we own in the same org that has
    # no smartfill_card_number set.
    org_id = seeded_card["org_id"]
    spare = db_sync.assets.find_one(
        {"org_id": org_id, "kind": "vehicle", "deleted_at": None,
         "smartfill_card_number": {"$in": [None, ""]}},
        {"id": 1},
    )
    if not spare:
        pytest.skip("no spare unlinked vehicle available in seeded org")
    vid = spare["id"]

    # Use a synthetic card number so we don't clobber a real link.
    test_card = f"TEST-{uuid.uuid4().hex[:8]}"
    url = f"{env['api_url']}/api/fleet/fuel/cards/{test_card}/assign"
    h = {"Authorization": f"Bearer {token}"}
    try:
        r1 = httpx.post(url, json={"vehicle_id": vid}, headers=h, timeout=15)
        assert r1.status_code == 200, r1.text
        assert r1.json()["no_change"] is False

        r2 = httpx.post(url, json={"vehicle_id": vid}, headers=h, timeout=15)
        assert r2.status_code == 200, r2.text
        assert r2.json()["no_change"] is True
    finally:
        # Cleanup: unlink the synthetic card so we leave the DB clean.
        db_sync.assets.update_one(
            {"id": vid, "smartfill_card_number": test_card},
            {"$unset": {"smartfill_card_number": ""}},
        )


def test_card_assign_conflict_returns_409(env, token, db_sync, seeded_card):
    """Assigning a card already linked to a different vehicle returns
    409."""
    org_id = seeded_card["org_id"]
    # Need two vehicles in the same org.
    twos = list(db_sync.assets.find(
        {"org_id": org_id, "kind": "vehicle", "deleted_at": None},
        {"id": 1},
    ).limit(2))
    if len(twos) < 2:
        pytest.skip("need at least 2 vehicles in seeded org")
    va, vb = twos[0]["id"], twos[1]["id"]

    test_card = f"CONFLICT-{uuid.uuid4().hex[:8]}"
    url = f"{env['api_url']}/api/fleet/fuel/cards/{test_card}/assign"
    h = {"Authorization": f"Bearer {token}"}
    try:
        # Link to A first.
        r1 = httpx.post(url, json={"vehicle_id": va}, headers=h, timeout=15)
        assert r1.status_code == 200, r1.text
        # Now try to link the same card to B → 409.
        r2 = httpx.post(url, json={"vehicle_id": vb}, headers=h, timeout=15)
        assert r2.status_code == 409, r2.text
    finally:
        db_sync.assets.update_many(
            {"smartfill_card_number": test_card},
            {"$unset": {"smartfill_card_number": ""}},
        )


# ── 4. /fleet/fuel/reports leaderboards carry card_numbers ──────
def test_leaderboard_rows_expose_card_numbers(env, token):
    r = httpx.get(
        f"{env['api_url']}/api/fleet/fuel/reports",
        params={"scope": "admin", "period": "monthly"}, timeout=20,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    lb = body.get("leaderboards") or {}
    assert lb, "no leaderboards block in /fleet/fuel/reports"
    # Every leaderboard row on every board must carry a card_numbers key.
    for board in ("top_by_cost", "top_by_dpl", "top_by_fills"):
        for row in lb.get(board) or []:
            assert "card_numbers" in row, (
                f"{board} row missing card_numbers: {row}"
            )
            assert isinstance(row["card_numbers"], list)


# ── 5. Frontend source pins ─────────────────────────────────────
FE_ROOT = Path("/app/frontend/src")
FUEL_REPORTING = (FE_ROOT / "pages" / "FuelReporting.jsx").read_text()
DRAWER = (FE_ROOT / "components" / "fleet" / "SmartFillCardDrawer.jsx").read_text()
VERSION_JS = (FE_ROOT / "lib" / "version.js").read_text()
SW_JS = Path("/app/frontend/public/service-worker.js").read_text()


def test_fuel_reporting_imports_drawer():
    assert "import SmartFillCardDrawer from '../components/fleet/SmartFillCardDrawer'" in FUEL_REPORTING


def test_fuel_reporting_wires_onrowclick():
    """Every one of the three Top-10 leaderboards must pass the
    click handler prop."""
    assert FUEL_REPORTING.count("onRowClick={handleLeaderboardClick}") >= 3
    assert "handleLeaderboardClick" in FUEL_REPORTING
    # Drawer + chooser mounted.
    assert "<SmartFillCardDrawer" in FUEL_REPORTING
    assert "CardChooserDialog" in FUEL_REPORTING


def test_leaderboard_component_uses_cursor_pointer():
    # Confirm the component actually reads the prop.
    assert "cursor-pointer hover:bg-blue-50/60" in FUEL_REPORTING
    assert "card_numbers" in FUEL_REPORTING


def test_drawer_component_uses_assets_key_fallback():
    """AssignVehicleDialog reads `r.data.assets` first (matches the
    real `/api/assets` response envelope)."""
    assert "r.data.assets" in DRAWER


def test_version_and_cache_bumped_to_132bo():
    # Forward-safe pin: accept .132bo OR any later suffix
    # (lexicographic comparison since the version string is a stable
    # ASCII sequence).
    def _ge_132bo(v: str) -> bool:
        m = re.search(r"\.132([a-z]+)$", v)
        return bool(m) and m.group(1) >= "bo"

    # RUNNING_VERSION.
    m = re.search(r"RUNNING_VERSION\s*=\s*'([^']+)'", VERSION_JS)
    assert m and _ge_132bo(m.group(1)), m and m.group(1)
    # EXPECTED_CACHE_VERSION.
    m2 = re.search(r"EXPECTED_CACHE_VERSION\s*=\s*'([^']+)'", VERSION_JS)
    assert m2 and _ge_132bo(m2.group(1)), m2 and m2.group(1)
    # service-worker CACHE_VERSION.
    m3 = re.search(r"CACHE_VERSION\s*=\s*'([^']+)'", SW_JS)
    assert m3 and _ge_132bo(m3.group(1)), m3 and m3.group(1)

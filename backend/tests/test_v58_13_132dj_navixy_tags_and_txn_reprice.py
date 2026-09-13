"""v58.13.132dj — Navixy Tag column + version pill lift + Fuel
Transaction Detail modal.

v58.13.132dy — INVERTED for the frozen-price architecture. The
detail endpoint now prefers the frozen snapshot fields
(`frozen_total_price`, `frozen_price_per_litre`,
`frozen_price_source`) when a row carries `frozen_at`. The legacy
`raw_total_price` / `raw_computed_price_per_litre` audit refs still
surface, but the FE modal now leads with the frozen chip
(`fuel-txn-detail-frozen-source-chip`); the legacy override pill
is a BC fallback for rows without a snapshot.
"""
from __future__ import annotations

import os
import re
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from unittest.mock import patch, AsyncMock

import pytest
import requests
from pymongo import MongoClient

# Shared session-scope event loop — prevents Motor "Event loop is
# closed" flakes when the .132dj async tests run before later .132d*
# suites in the same pytest session.
from tests.conftest import run_async  # noqa: E402

APP_ROOT = Path(__file__).resolve().parents[2]
TAGS_MOD = APP_ROOT / "backend" / "fleet_navixy_tags.py"
FLEET_MOD = APP_ROOT / "backend" / "fleet_fuel.py"
REGISTER_JSX = APP_ROOT / "frontend" / "src" / "pages" / "FleetRegister.jsx"
MODAL_JSX = APP_ROOT / "frontend" / "src" / "components" / "FuelTransactionDetailModal.jsx"
SHELL_JSX = APP_ROOT / "frontend" / "src" / "components" / "layout" / "AppShell.jsx"
VERSION_JS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"

API = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")


def _pin_login():
    r = requests.post(f"{API}/api/auth/mobile/pin-login",
                      json={"pin": "3310", "device_id": "pytest-132dj"})
    if r.status_code != 200:
        pytest.skip(f"PIN login unavailable ({r.status_code})")
    return {"Authorization": f"Bearer {r.json()['session_token']}"}


def _mongo():
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


# ─── Part 1: Navixy Tag endpoint ────────────────────────────────

def test_endpoint_registered_and_graceful():
    src = TAGS_MOD.read_text(encoding="utf-8")
    assert 'prefix="/fleet/navixy"' in src
    assert 'router.get("/tags")' in src
    # Graceful branches: missing cfg, incomplete cfg, fetch error.
    assert "_graceful_empty" in src
    assert "not connected" in src.lower() or "not connected" in src


def test_missing_navixy_key_returns_200_empty():
    hdr = _pin_login()
    # No mock — Stephen's org may or may not have Navixy connected.
    # Either way this endpoint must return 200 with a valid shape.
    r = requests.get(f"{API}/api/fleet/navixy/tags", headers=hdr)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "items" in body
    assert isinstance(body["items"], list)
    assert "connected" in body
    assert "distinct_tags" in body


def test_navixy_5xx_returns_graceful_empty():
    """Simulate a 5xx from Navixy → graceful HTTP 200 with error msg."""
    import sys
    sys.path.insert(0, str(APP_ROOT / "backend"))
    from fleet_navixy_tags import get_navixy_tags, _CACHE
    _CACHE.clear()  # start clean
    user = {"org_id": "test-org-5xx", "id": "test-user", "role_id": "admin"}
    fake_cfg = {"api_base_url": "https://navixy.example.com",
                "session_hash": "hash-x"}
    with patch("fleet_navixy_tags._navixy_cfg", new=AsyncMock(return_value=fake_cfg)), \
         patch("fleet_navixy_tags.httpx.AsyncClient") as mock_client:
        import httpx
        mock_client.return_value.__aenter__.return_value.post = AsyncMock(
            side_effect=httpx.HTTPError("boom")
        )
        out = run_async(get_navixy_tags(user=user))
    assert out["items"] == []
    assert out["connected"] is True
    assert out["error"] and "failed" in out["error"].lower()


@pytest.mark.live_db_writes
def test_happy_path_maps_trackers_to_vehicles_and_first_tag_wins(caplog):
    """Happy path: Navixy returns 3 trackers (one w/ 2 tags → first wins,
    one w/ 1 tag, one w/ no tags → omitted). Only linked trackers surface."""
    import sys
    sys.path.insert(0, str(APP_ROOT / "backend"))
    from fleet_navixy_tags import get_navixy_tags, _CACHE
    _CACHE.clear()

    # Seed 2 linked assets + 1 unlinked in a synthetic org.
    org_id = f"pytest-org-{uuid.uuid4().hex[:6]}"
    db_sync = _mongo()
    seeded = [
        {"id": f"asset-A-{org_id}", "org_id": org_id,
         "navixy_device_id": 1001, "name": "Truck A",
         "scan_token": f"scan-A-{org_id}"},
        {"id": f"asset-B-{org_id}", "org_id": org_id,
         "navixy_device_id": 1002, "name": "Truck B",
         "scan_token": f"scan-B-{org_id}"},
        {"id": f"asset-C-{org_id}", "org_id": org_id,
         "navixy_device_id": 1099, "name": "Truck C",
         "scan_token": f"scan-C-{org_id}"},  # tracker w/ no tag
    ]
    db_sync.assets.insert_many(seeded)
    try:
        fake_cfg = {"api_base_url": "https://navixy.example.com",
                    "session_hash": "hash-x"}
        tag_resp = type("R", (), {})()
        tag_resp.json = lambda: {"list": [
            {"id": 1, "name": "SITE:CBD"},
            {"id": 2, "name": "SITE:METRO"},
        ]}
        trk_resp = type("R", (), {})()
        trk_resp.json = lambda: {"list": [
            # Multi-tag: first wins.
            {"id": 1001, "tag_bindings": [1, 2]},
            # Single tag.
            {"id": 1002, "tag_bindings": [{"tag_id": 2}]},
            # No tags: omitted.
            {"id": 1099, "tag_bindings": []},
        ]}
        posts = [tag_resp, trk_resp]

        async def fake_post(*a, **k):
            return posts.pop(0)

        with patch("fleet_navixy_tags._navixy_cfg", new=AsyncMock(return_value=fake_cfg)), \
             patch("fleet_navixy_tags.httpx.AsyncClient") as mc:
            mc.return_value.__aenter__.return_value.post = fake_post
            user = {"org_id": org_id, "id": "u", "role_id": "admin"}
            out = run_async(get_navixy_tags(user=user))
        items = {i["vehicle_id"]: i["tag_label"] for i in out["items"]}
        assert items == {
            f"asset-A-{org_id}": "SITE:CBD",   # first tag wins
            f"asset-B-{org_id}": "SITE:METRO",
        }
        assert f"asset-C-{org_id}" not in items  # tracker w/ no tags omitted
        # v58.13.132dm — `distinct_tags` shape upgraded to
        # `[{label, count}]`. Both tags defined in Navixy surface here
        # even though only one linked vehicle carries each.
        by_label = {t["label"]: t["count"] for t in out["distinct_tags"]}
        assert set(by_label.keys()) == {"SITE:CBD", "SITE:METRO"}
        assert by_label["SITE:CBD"] == 1
        assert by_label["SITE:METRO"] == 1
        # And it logged a warning about the multi-tag tracker.
        assert any("multiple tags" in r.message for r in caplog.records)
    finally:
        db_sync.assets.delete_many({"org_id": org_id})


# ─── Part 2: Fleet Register FE (Tag column) ─────────────────────

def test_register_frontend_tag_column_wired():
    src = REGISTER_JSX.read_text(encoding="utf-8")
    # Kind column replaced by Tag.
    assert 'sortKey="tag"' in src or "sortKey='tag'" in src
    assert '"Tag"' in src or "'Tag'" in src
    # No leftover Kind header/sort.
    assert 'label="Kind"' not in src
    # Live fetch on mount.
    assert "/fleet/navixy/tags" in src
    # Filter dropdown wired.
    assert 'data-testid="fleet-tag-filter"' in src
    # Loading skeleton + empty fallback.
    assert 'fleet-tag-skeleton-' in src
    assert 'fleet-tag-empty-' in src
    # Admin-only error banner.
    assert 'fleet-tag-filter-error' in src
    # Legacy `?sort=kind:*` URLs fold into tag sort.
    assert 'legacyKind' in src or 'kind' in src.lower()


# ─── Part 3: Version pill lifted ────────────────────────────────

def test_version_pill_raised_by_20px():
    src = SHELL_JSX.read_text(encoding="utf-8")
    # Bottom-padding now pb-5 (~20px) — previously pb-1.
    assert "pb-5" in src
    # Explicit .132dj rationale in the comment so the next hand doesn't
    # accidentally revert.
    assert "132dj" in src and "Lifted" in src


# ─── Part 4: Fuel Transaction Detail modal (frozen model) ───────

def test_detail_endpoint_prefers_frozen_snapshot():
    """v58.13.132dy — `get_transaction` prefers the frozen snapshot
    fields when the row carries `frozen_at`. Raw refs remain for
    audit. Legacy `effective_total_price` fallback is retained
    for pre-migration rows only."""
    src = FLEET_MOD.read_text(encoding="utf-8")
    # Frozen prefer path — same shape as the list endpoint.
    assert 'doc.get("frozen_at")' in src
    assert 'doc.get("frozen_total_price")' in src
    assert 'doc.get("frozen_price_per_litre")' in src
    # Legacy audit refs still populated so the FE can render the
    # "SmartFill raw (reference)" row under provisional_override.
    assert 'raw_total_price' in src
    assert 'raw_computed_price_per_litre' in src
    # Effective toggle state still exposed for the segmented control.
    assert '"price_state":' in src
    # Legacy fallback for rows without a snapshot (defensive).
    assert "effective_total_price(doc, provisional_price, override_smartfill)" in src


def test_modal_frontend_surfaces_frozen_source():
    """v58.13.132dy — Modal leads with the frozen source chip
    (`fuel-txn-detail-frozen-source-chip`). Legacy override pill is
    retained as a BC fallback for rows without a snapshot."""
    src = MODAL_JSX.read_text(encoding="utf-8")
    # New frozen-source chip at the top of the modal.
    assert 'fuel-txn-detail-frozen-source-chip' in src
    assert 'price_source_snapshot' in src
    assert 'frozen_price_source' in src
    # All three canonical snapshot labels present.
    assert 'Provisional override (at import)' in src
    assert 'SmartFill real (at import)' in src
    assert 'Provisional fallback (at import)' in src
    # SmartFill raw reference row is now gated on the frozen source
    # tag (was `overrideActive` in .132dj).
    assert 'fuel-txn-detail-smartfill-raw' in src
    assert "price_source_snapshot === 'provisional_override'" in src
    # Legacy BC pill retained for pre-migration rows only.
    assert 'fuel-txn-detail-override-pill' in src


@pytest.mark.live_db_writes
def test_detail_endpoint_leaves_frozen_rows_unchanged():
    """v58.13.132dy — Once a row is stamped with `frozen_at`, flipping
    the org-wide toggle does NOT reprice it. The detail endpoint
    surfaces the frozen values verbatim."""
    hdr = _pin_login()
    db = _mongo()
    u = db.users.find_one({"email": "stephen@paneltec.com.au"})
    if not u:
        pytest.skip("Stephen user not seeded")
    org_id = u["org_id"]
    # Seed a synthetic tx frozen under SmartFill (real) at import.
    tag = f"pytest-132dy-{uuid.uuid4().hex[:6]}"
    now = datetime.now(timezone.utc)
    doc = {
        "id": f"{tag}-tx", "org_id": org_id, "asset_id": tag,
        "registration": tag, "deleted_at": None,
        "date_iso": "2025-01-01", "timestamp": "2025-01-01T00:00:00+00:00",
        "litres": 100.0, "total_price": 180.0,
        "computed_price_per_litre": 1.80,
        "price_source": "smartfill_actual",
        "frozen_at": now.isoformat(),
        "frozen_total_price": 180.0,
        "frozen_price_per_litre": 1.80,
        "frozen_price_source": "smartfill_real",
    }
    db.fuel_transactions.insert_one(doc)
    try:
        # OFF (smartfill_with_fallback) — snapshot flows through.
        requests.put(f"{API}/api/fleet/fuel/price-settings", headers=hdr,
                     json={"provisional_price_per_litre": 2.25,
                           "override_mode": "smartfill_with_fallback"})
        r = requests.get(f"{API}/api/fleet/fuel/transactions/{tag}-tx",
                         headers=hdr).json()
        assert abs(r["total_price"] - 180.0) < 0.01
        assert abs(r["computed_price_per_litre"] - 1.80) < 0.001
        assert r["price_state"]["override_mode"] == "smartfill_with_fallback"
        # Raw refs still surfaced from the stored fields.
        assert abs(r["raw_total_price"] - 180.0) < 0.01
        # ON (provisional_all) — frozen row STAYS at 180.0 @ 1.80.
        # (Pre-.132dy this would have repriced to 100 × 2.25 = 225.)
        requests.put(f"{API}/api/fleet/fuel/price-settings", headers=hdr,
                     json={"override_mode": "provisional_all"})
        r2 = requests.get(f"{API}/api/fleet/fuel/transactions/{tag}-tx",
                          headers=hdr).json()
        assert abs(r2["total_price"] - 180.0) < 0.01, (
            f"frozen row was repriced under provisional_all: "
            f"got total {r2['total_price']}, expected 180.0"
        )
        assert abs(r2["computed_price_per_litre"] - 1.80) < 0.001
        assert r2["price_state"]["override_mode"] == "provisional_all"
        # Raw refs untouched.
        assert abs(r2["raw_total_price"] - 180.0) < 0.01
        assert abs(r2["raw_computed_price_per_litre"] - 1.80) < 0.001
        # DB itself unchanged — nothing writes on read.
        stored = db.fuel_transactions.find_one({"id": f"{tag}-tx"})
        assert abs(stored["total_price"] - 180.0) < 1e-6
        assert abs(stored["frozen_total_price"] - 180.0) < 1e-6
        # Restore.
        requests.put(f"{API}/api/fleet/fuel/price-settings", headers=hdr,
                     json={"override_mode": "smartfill_with_fallback"})
    finally:
        db.fuel_transactions.delete_many({"id": f"{tag}-tx"})


# ─── Version sync ─────────────────────────────────────────────

def test_three_way_sync_at_132dy_or_later():
    running = re.search(r"^export const RUNNING_VERSION = '([^']+)'",
                        VERSION_JS.read_text(), re.MULTILINE).group(1)
    expected = re.search(r"^export const EXPECTED_CACHE_VERSION = '([^']+)'",
                         VERSION_JS.read_text(), re.MULTILINE).group(1)
    cache = re.search(r"^const CACHE_VERSION = '([^']+)'",
                      SW.read_text(), re.MULTILINE).group(1)
    assert running == expected == cache
    tail = re.search(r"132([a-z]+)", running).group(1)
    assert tail >= "dy"

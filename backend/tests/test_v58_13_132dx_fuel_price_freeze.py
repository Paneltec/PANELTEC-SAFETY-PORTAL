"""v58.13.132dx — Fuel pricing: stamp-at-import + frozen history.

Locks:
  1. `freeze_price_snapshot` helper computes the correct source
     tag + total/ppl for the three cases (provisional_override,
     smartfill_real, provisional_fallback).
  2. Migration script has the expected shape (idempotent, iterates
     all rows, groups by source).
  3. Import path stamps frozen fields at write time.
  4. list_transactions + get_transaction prefer frozen fields over
     recomputed-at-read `effective_total_price`.
  5. Behavioural: after the migration, every existing row on
     Stephen's org has `frozen_at` + `frozen_price_per_litre` +
     `frozen_total_price` + `frozen_price_source` +
     `frozen_by_price_setting_id` populated.
  6. Behavioural: `list_transactions` returns rows carrying the
     `price_source_snapshot` field surfaced from the frozen row.
  7. Three-way version pin at .132dx.
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

import pytest
import requests
from pymongo import MongoClient

APP_ROOT = Path(__file__).resolve().parents[2]
FUEL_MOD = APP_ROOT / "backend" / "fleet_fuel.py"
PRICE_MOD = APP_ROOT / "backend" / "fuel_price_settings.py"
MIGRATION = APP_ROOT / "backend" / "scripts" / "freeze_fuel_prices_v58_13_132dx.py"
VERSION_JS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"

API = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
ADMIN_EMAIL = "stephen@paneltec.com.au"
ADMIN_PWD = "Mcgstephen50#"


def _admin_headers():
    r = requests.post(f"{API}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PWD},
                      timeout=30)
    if r.status_code != 200:
        pytest.skip(f"admin login unavailable: {r.status_code}")
    tok = r.json().get("access_token") or r.json().get("token")
    return {"Authorization": f"Bearer {tok}"}


def _db():
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


# ─── Source pins ────────────────────────────────────────────────

def test_freeze_helper_present():
    src = PRICE_MOD.read_text(encoding="utf-8")
    assert "132dx" in src
    assert "def freeze_price_snapshot(" in src
    # Emits all 5 fields we persist on the txn.
    for f in ("frozen_price_per_litre", "frozen_total_price",
              "frozen_price_source", "frozen_at",
              "frozen_by_price_setting_id"):
        assert f in src, f"missing frozen field emit: {f}"
    # The three source tags.
    for tag in ("provisional_override", "smartfill_real",
                "provisional_fallback"):
        assert f'"{tag}"' in src


def test_freeze_helper_behaviour():
    """Direct unit test of `freeze_price_snapshot`. Doesn't touch
    the DB — verifies the three-branch classification."""
    sys.path.insert(0, str(APP_ROOT / "backend"))
    from fuel_price_settings import freeze_price_snapshot

    # Case 1 — override_all: force provisional price no matter what.
    snap = freeze_price_snapshot(
        {"litres": 100, "total_price": 220, "price_source": "smartfill"},
        provisional_price=2.5342, override_smartfill_real=True,
        price_setting_id="sid1",
    )
    assert snap["frozen_price_source"] == "provisional_override"
    assert snap["frozen_price_per_litre"] == pytest.approx(2.5342, rel=1e-4)
    assert snap["frozen_total_price"] == pytest.approx(253.42, rel=1e-4)
    assert snap["frozen_by_price_setting_id"] == "sid1"
    assert snap["frozen_at"]

    # Case 2 — smartfill_real (stored price present, no override).
    snap2 = freeze_price_snapshot(
        {"litres": 50, "total_price": 137.50, "price_source": "smartfill"},
        provisional_price=2.5342, override_smartfill_real=False,
    )
    assert snap2["frozen_price_source"] == "smartfill_real"
    assert snap2["frozen_total_price"] == 137.5
    assert snap2["frozen_price_per_litre"] == 2.75

    # Case 3 — provisional_fallback (no stored price, litres > 0).
    snap3 = freeze_price_snapshot(
        {"litres": 40, "total_price": 0, "price_source": "smartfill"},
        provisional_price=2.5342, override_smartfill_real=False,
    )
    assert snap3["frozen_price_source"] == "provisional_fallback"


def test_migration_script_shape():
    src = MIGRATION.read_text(encoding="utf-8")
    assert "132dx" in src
    # Idempotent skip via `frozen_at`.
    assert 'tx.get("frozen_at")' in src
    # Distribution per source.
    for tag in ("smartfill_real", "provisional_override",
                "provisional_fallback"):
        assert tag in src


def test_import_path_stamps_frozen():
    src = FUEL_MOD.read_text(encoding="utf-8")
    assert "132dx" in src
    # Import path pulls the batch price + settings id once.
    assert "_batch_provisional" in src
    assert "_batch_price_setting_id" in src
    # And stamps every doc via `_freeze(...)` before insert.
    assert "doc.update(_freeze(doc" in src


def test_read_path_prefers_frozen():
    src = FUEL_MOD.read_text(encoding="utf-8")
    # Both list + detail read paths prefer frozen_at when present.
    assert "it.get(\"frozen_at\")" in src
    assert "doc.get(\"frozen_at\")" in src
    # Frozen source surfaced on list items so the FE can render the chip.
    assert '"price_source_snapshot"' in src


def test_three_way_version_sync_at_132dx():
    running = re.search(r"^export const RUNNING_VERSION = '([^']+)'",
                        VERSION_JS.read_text(), re.MULTILINE).group(1)
    expected = re.search(r"^export const EXPECTED_CACHE_VERSION = '([^']+)'",
                         VERSION_JS.read_text(), re.MULTILINE).group(1)
    cache = re.search(r"^const CACHE_VERSION = '([^']+)'",
                      SW.read_text(), re.MULTILINE).group(1)
    assert running == expected == cache
    tail = re.search(r"132([a-z]+)", running).group(1)
    assert tail >= "dx"


# ─── Behavioural — post-migration state ─────────────────────────

def test_migration_applied_to_all_txns():
    """After running the .132dx migration, every fuel transaction on
    Stephen's org has the frozen snapshot fields populated."""
    db = _db()
    hdr = _admin_headers()
    me = requests.get(f"{API}/api/auth/me", headers=hdr, timeout=30).json()
    org_id = me.get("org_id")
    assert org_id
    total = db.fuel_transactions.count_documents({"org_id": org_id})
    with_frozen = db.fuel_transactions.count_documents({
        "org_id": org_id, "frozen_at": {"$exists": True, "$ne": None},
    })
    assert with_frozen == total, \
        f"{total - with_frozen} rows still missing frozen_at"
    # Every frozen row has a source tag from the closed set.
    bad = db.fuel_transactions.count_documents({
        "org_id": org_id, "frozen_at": {"$exists": True},
        "frozen_price_source": {"$nin": [
            "provisional_override", "smartfill_real", "provisional_fallback"]},
    })
    assert bad == 0


def test_list_transactions_uses_frozen():
    """Sanity: `list_transactions` returns items where
    `total_price` == `frozen_total_price` and `computed_price_per_litre`
    == `frozen_price_per_litre` (i.e. the read path is preferring
    frozen)."""
    hdr = _admin_headers()
    r = requests.get(f"{API}/api/fleet/fuel/transactions",
                     params={"page": 1, "size": 25},
                     headers=hdr, timeout=30)
    assert r.status_code == 200
    items = r.json().get("items") or []
    if not items:
        pytest.skip("no fuel transactions in this org")
    checked = 0
    for it in items:
        if not it.get("frozen_at"):
            continue
        assert it.get("total_price") == it.get("frozen_total_price"), it
        assert it.get("computed_price_per_litre") == it.get("frozen_price_per_litre"), it
        assert it.get("price_source_snapshot") == it.get("frozen_price_source")
        checked += 1
    assert checked > 0, "expected at least one frozen row in the sample"

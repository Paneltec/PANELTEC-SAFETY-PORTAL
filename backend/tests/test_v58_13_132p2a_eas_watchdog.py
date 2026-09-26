"""v58.13.132p2a — Tests for the EAS APK auto-ingest watchdog.

Covers all five behaviours:

  · Watchdog skips when `eas_watchdog_settings.enabled = False`.
  · Watchdog no-ops when the latest FINISHED build id already
    matches the current on-disk manifest (`same-build` action).
  · Watchdog runs the ingest when a newer FINISHED build exists
    (`ingested` action).
  · Missing EXPO_TOKEN → warning logged, tick returns
    `{"ok": False, ...}`, no crash.
  · Boot check runs exactly one iteration.

The `_ingest_latest_finished_android` function is monkeypatched so
we never actually hit EAS. Each test uses a FRESH Motor client on
a fresh event loop to sidestep Motor's per-loop client cache
collision (same trick the .132p0 tests use).
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv
load_dotenv(ROOT / ".env")


# All tests here must write the `eas_watchdog_settings` doc — that's
# the whole point of the watchdog. Opt into the repo's live-DB-write
# guard (see backend/tests/README_live_db_guard.md).
pytestmark = pytest.mark.live_db_writes


# ─────────────── Per-test event loop + Mongo client ───────────────

@pytest.fixture
def loop():
    """One fresh event loop per test."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    yield loop
    loop.close()


@pytest.fixture
def wd(loop, monkeypatch):
    """Fresh `eas_ingest_watchdog` module bound to a fresh Motor
    client on the current event loop. Reimports both `db` and
    `eas_ingest_watchdog` so the module-level `from db import db`
    binding picks up our per-test client."""
    from importlib import reload
    from motor.motor_asyncio import AsyncIOMotorClient

    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    dbh = client[os.environ["DB_NAME"]]

    import db as db_mod
    monkeypatch.setattr(db_mod, "db", dbh)

    import eas_ingest_watchdog
    reload(eas_ingest_watchdog)

    yield eas_ingest_watchdog

    client.close()


@pytest.fixture(autouse=True)
def _reset_settings(wd, loop):
    """Ensure the watchdog is ON + `last_tick_*` scratched between tests."""
    async def _pre():
        await wd.enable_watchdog(True)
        # Scratch stale last_tick_* fields.
        from db import db as _db
        await _db[wd._SETTINGS_COLLECTION].update_one(
            {"key": wd._SETTINGS_KEY},
            {"$set": {"enabled": True},
             "$unset": {"last_tick_at": "", "last_tick_source": "",
                        "last_tick_ok": "", "last_tick_action": "",
                        "last_tick_reason": "", "last_tick_build_id": "",
                        "last_tick_version": ""}},
            upsert=True,
        )
    loop.run_until_complete(_pre())
    yield


# ─────────────── Tests ───────────────

def test_watchdog_skipped_when_disabled(wd, loop):
    async def go():
        await wd.enable_watchdog(False)
        result = await wd.watchdog_tick(source="unit_test_disabled")
        assert result is None, f"expected None on disabled tick, got {result!r}"

        # Settings doc should NOT have last_tick_* fields written
        # — the guard short-circuits before _record_tick.
        from db import db as _db
        doc = await _db[wd._SETTINGS_COLLECTION].find_one(
            {"key": wd._SETTINGS_KEY}, {"_id": 0},
        )
        assert doc["enabled"] is False
        assert "last_tick_at" not in doc, \
            f"disabled tick must not record last_tick_* — got {doc!r}"

    loop.run_until_complete(go())


def test_watchdog_no_op_same_build(wd, loop, monkeypatch):
    """When _ingest_latest_finished_android returns action='same-build'
    the watchdog records the tick but doesn't call any download."""
    async def _fake_ingest(*, source, actor_user_id=None):
        return {
            "ok": True, "action": "same-build",
            "build_id": "cf70a770-…", "version": "1.0.48",
            "manifest": {"eas_build_id": "cf70a770-…",
                         "version": "1.0.48"},
            "message": "same-build no-op",
        }

    import mobile_downloads
    monkeypatch.setattr(mobile_downloads,
                        "_ingest_latest_finished_android", _fake_ingest)
    monkeypatch.setenv("EXPO_TOKEN", "unit-test-token")

    async def go():
        result = await wd.watchdog_tick(source="unit_test_same")
        assert result["ok"] is True
        assert result["action"] == "same-build"

        from db import db as _db
        doc = await _db[wd._SETTINGS_COLLECTION].find_one(
            {"key": wd._SETTINGS_KEY}, {"_id": 0},
        )
        assert doc["last_tick_ok"] is True
        assert doc["last_tick_action"] == "same-build"
        assert doc["last_tick_source"] == "unit_test_same"
        assert doc["last_tick_build_id"] == "cf70a770-…"

    loop.run_until_complete(go())


def test_watchdog_ingests_when_newer_build(wd, loop, monkeypatch):
    """When _ingest_latest_finished_android returns action='ingested'
    the watchdog logs the upgrade + records the outcome."""
    async def _fake_ingest(*, source, actor_user_id=None):
        assert source == "unit_test_ingest", \
            f"source should propagate; got {source!r}"
        return {
            "ok": True, "action": "ingested",
            "build_id": "9f9abe41-…", "version": "1.0.50",
            "manifest": {"eas_build_id": "9f9abe41-…",
                         "version": "1.0.50",
                         "version_code": 172,
                         "sha256": "deadbeef" * 8,
                         "synced_at": "2026-09-26T11:20:00+00:00",
                         "synced_by_source": "unit_test_ingest"},
            "message": "APK v1.0.50 ingested",
        }

    import mobile_downloads
    monkeypatch.setattr(mobile_downloads,
                        "_ingest_latest_finished_android", _fake_ingest)
    monkeypatch.setenv("EXPO_TOKEN", "unit-test-token")

    async def go():
        result = await wd.watchdog_tick(source="unit_test_ingest")
        assert result["ok"] is True
        assert result["action"] == "ingested"
        assert result["build_id"] == "9f9abe41-…"

        from db import db as _db
        doc = await _db[wd._SETTINGS_COLLECTION].find_one(
            {"key": wd._SETTINGS_KEY}, {"_id": 0},
        )
        assert doc["last_tick_action"] == "ingested"
        assert doc["last_tick_build_id"] == "9f9abe41-…"
        assert doc["last_tick_version"] == "1.0.50"

    loop.run_until_complete(go())


def test_watchdog_handles_missing_expo_token(wd, loop, monkeypatch):
    monkeypatch.delenv("EXPO_TOKEN", raising=False)

    async def go():
        result = await wd.watchdog_tick(source="unit_test_no_token")
        assert result["ok"] is False
        assert "EXPO_TOKEN" in (result.get("reason") or "")

        from db import db as _db
        doc = await _db[wd._SETTINGS_COLLECTION].find_one(
            {"key": wd._SETTINGS_KEY}, {"_id": 0},
        )
        assert doc["last_tick_ok"] is False
        assert "EXPO_TOKEN" in (doc["last_tick_reason"] or "")

    loop.run_until_complete(go())


def test_run_boot_check_invokes_one_tick(wd, loop, monkeypatch):
    """`run_boot_check()` MUST call `watchdog_tick(source="boot_check")`
    exactly once."""
    calls: list = []

    async def _fake_tick(*, source="watchdog"):
        calls.append(source)
        return {"ok": True, "action": "same-build",
                "build_id": "cf70a770-…", "version": "1.0.48"}

    monkeypatch.setattr(wd, "watchdog_tick", _fake_tick)

    async def go():
        result = await wd.run_boot_check()
        assert result["ok"] is True
        assert calls == ["boot_check"], f"expected one boot_check tick, got {calls!r}"

    loop.run_until_complete(go())


def test_enable_watchdog_persists(wd, loop):
    async def go():
        await wd.enable_watchdog(False)
        assert (await wd.watchdog_enabled()) is False
        await wd.enable_watchdog(True)
        assert (await wd.watchdog_enabled()) is True
    loop.run_until_complete(go())

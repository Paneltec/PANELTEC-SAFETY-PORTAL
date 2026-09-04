"""v58.13.98 — Deferred startup work; fast bootstrap only in on_startup.

Source-scan tests. Verifies the refactor structure so a future edit
that accidentally moves heavy work back into the synchronous startup
path fails CI. See ship report + preview log proof for the runtime
verification.
"""
from __future__ import annotations
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
MOBILE = ROOT / "mobile"

SERVER_PY = (BACKEND / "server.py").read_text(encoding="utf-8")
VERSION_JS = (FRONTEND / "src" / "lib" / "version.js").read_text(encoding="utf-8")
SW_JS = (FRONTEND / "public" / "service-worker.js").read_text(encoding="utf-8")
MOBILE_TS = (MOBILE / "src" / "lib" / "version.ts").read_text(encoding="utf-8")


def test_deferred_helper_defined_inside_on_startup():
    """on_startup contains an inner `async def _deferred_startup_work()`
    that wraps the heavy tail. Anchor is intentionally strict — if a
    refactor renames the helper, this test surfaces it."""
    m = re.search(
        r'@app\.on_event\("startup"\)\s*\n'
        r'async def on_startup\(\):[\s\S]+?'
        r'async def _deferred_startup_work\(\):',
        SERVER_PY,
    )
    assert m, "on_startup does not define an inner _deferred_startup_work coroutine"


def test_deferred_helper_scheduled_via_create_task():
    """The helper is dispatched via `asyncio.create_task()`, not
    `await`ed — so on_startup returns immediately."""
    m = re.search(
        r'_dsw_asyncio\.create_task\(\s*_deferred_startup_work\(\)\s*\)',
        SERVER_PY,
    )
    assert m, (
        "_deferred_startup_work is not scheduled via asyncio.create_task — "
        "if it's `await`ed the whole point of .98 is lost"
    )
    # And the "kicked off" log line follows the schedule call.
    assert "fast bootstrap complete — deferred work kicked off" in SERVER_PY


def test_heavy_migrations_run_inside_deferred_helper():
    """The specific heavy steps Emergent Support flagged all appear
    INSIDE the deferred helper's body (not before it)."""
    # Extract just the deferred helper's body up to its `done in %.2fs`
    # closing log line.
    m = re.search(
        r'async def _deferred_startup_work\(\):[\s\S]+?'
        r"deferred_startup_work: done in %\.2fs",
        SERVER_PY,
    )
    assert m, "deferred helper body not found"
    body = m.group(0)
    for anchor in (
        "run_v26_migrations",           # data migrations
        "run_v45_migration",
        "run_v46_migration",
        "seed_all",                     # dev seed
        "reconcile_all_orgs",           # role token reconcile
        "meter_history_backfill_30d",   # meter-history backfill
        "APScheduler started",          # scheduler start incl. navixy_sync_counters
        "bk_snapshots",                 # backup catch-up
    ):
        assert anchor in body, (
            f"heavy step {anchor!r} is NOT inside _deferred_startup_work — "
            f"if it moved back to synchronous startup this test surfaces it"
        )


def test_fast_bootstrap_kept_in_on_startup():
    """Fast/critical bootstrap MUST still run before the deferred
    schedule call, otherwise the first request will hit an unindexed
    collection or a role with no override."""
    m = re.search(
        r'async def on_startup\(\):([\s\S]+?)'
        r'async def _deferred_startup_work\(\):',
        SERVER_PY,
    )
    prelude = m.group(1)
    for anchor in (
        "ensure_indexes()",
        "session_history_ensure_indexes()",
        "ensure_stephen_can_toggle",
        "seed_system_roles",
        "master_risks_ensure_indexes",
    ):
        assert anchor in prelude, (
            f"fast bootstrap step {anchor!r} is missing from on_startup — "
            f"the first request may crash"
        )


# ── Version-sync forward-safe pin >= 98 ─────────────────────────

def _tail(text, name):
    m = re.search(rf"{name}\s*=\s*['\"]paneltec-v[\d.]+\.(\d+)[a-z]*['\"]", text)
    assert m
    return int(m.group(1))


def test_running_version_gte_98():
    assert _tail(VERSION_JS, "RUNNING_VERSION") >= 98


def test_cache_version_gte_98():
    assert _tail(SW_JS, "CACHE_VERSION") >= 98


def test_mobile_bundle_version_gte_98():
    assert _tail(MOBILE_TS, "MOBILE_BUNDLE_VERSION") >= 98

"""v58.13.15 — Shutdown-drain fix pytests.

Two flavours:
    1. Static-grep regression guards — confirm the existing v58.6-era
       to_thread wraps + VISION_CONCURRENCY semaphore stay in place,
       and the new yield-insurance + task-tracking helpers are wired
       correctly. Cheap, deterministic, catches accidental drops.
    2. Runtime shutdown-drain test — creates fake bulk_import tasks
       that spend most of their time inside `asyncio.to_thread`
       (simulating the real workload), calls
       `shutdown_bulk_import_jobs()`, asserts drain completes within
       the bounded budget (defaults to 25 s cap, we assert < 30 s
       wall clock).

Location: `/app/tests/backend_unit/` — outside `--reload-dir
/app/backend`, per the v58.13.10 hard rule.
"""
from __future__ import annotations

import asyncio
import re
import time
from pathlib import Path

import pytest

BULK = Path("/app/backend/bulk_import_prestarts.py")
SERVER = Path("/app/backend/server.py")


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


# ─── Static regression guards on the existing defences ────────────────

def test_existing_to_thread_wraps_still_present():
    src = _read(BULK)
    # v58.6-era wraps that must NOT regress. If any of these disappears
    # the event loop starts blocking again.
    for needle in (
        "asyncio.to_thread(_pdf_pages_png_b64, pdf_bytes)",
        "asyncio.to_thread(zipfile.ZipFile",
        "asyncio.to_thread(outer_zf.read",
    ):
        assert needle in src, (
            f"regression: {needle!r} missing from bulk_import_prestarts.py"
        )


def test_vision_concurrency_semaphore_still_declared():
    src = _read(BULK)
    assert 'VISION_CONCURRENCY = _env_int("BULK_IMPORT_VISION_CONCURRENCY"' in src
    # Producer/consumer wiring must still spin up VISION_CONCURRENCY
    # consumers.
    assert "for _ in range(VISION_CONCURRENCY)" in src


# ─── Static guards on the v58.13.15 additions ─────────────────────────

def test_v58_13_15_yield_insurance_wired():
    src = _read(BULK)
    assert "HOT_LOOP_YIELD_EVERY" in src, "yield-interval constant missing"
    # The yield must sit INSIDE the consumer body, not somewhere
    # decorative.
    consumer_body = src.split("async def consumer()", 1)[1].split("async def", 1)[0]
    assert "await asyncio.sleep(0)" in consumer_body, (
        "await asyncio.sleep(0) not found inside consumer() body"
    )
    assert "HOT_LOOP_YIELD_EVERY" in consumer_body


def test_v58_13_15_task_tracking_wired_at_every_seam():
    src = _read(BULK)
    # No bare `asyncio.create_task(_run_job(...))` may remain — every
    # seam must be wrapped in `_track_job_task(...)`.
    bare = re.findall(
        r"(?<!_track_job_task\()asyncio\.create_task\(_run_job\(",
        src,
    )
    assert not bare, (
        f"{len(bare)} unwrapped asyncio.create_task(_run_job(...)) "
        "seams remain — each one must be inside _track_job_task(...)."
    )
    # And every wrapped seam MUST call `_run_job` — regression guard
    # against the wrap being applied to the wrong target.
    wrapped = src.count("_track_job_task(asyncio.create_task(_run_job(")
    assert wrapped >= 5, (
        f"expected ≥5 tracked seams, found {wrapped}. New job seams "
        "must also register via _track_job_task."
    )


def test_v58_13_15_server_shutdown_hook_calls_bulk_teardown():
    src = _read(SERVER)
    assert "shutdown_bulk_import_jobs" in src, (
        "server.py's shutdown hook must call shutdown_bulk_import_jobs()"
    )
    # And import from the right module.
    assert "from bulk_import_prestarts import shutdown_bulk_import_jobs" in src


# ─── Runtime shutdown-drain test ──────────────────────────────────────

@pytest.mark.asyncio
async def test_shutdown_drain_completes_within_budget():
    """Simulate the real drain scenario: N background tasks each
    spending most of their time inside `asyncio.to_thread` (which
    can't be cancelled). Assert `shutdown_bulk_import_jobs()`
    completes within the bounded budget even so.

    Uses a monkeypatch on `SHUTDOWN_DRAIN_TIMEOUT_SEC` set to 5 s
    (tests must not take 25 s to run). Real drain in production
    uses the full 25 s default.
    """
    import bulk_import_prestarts as mod

    async def slow_task():
        # to_thread simulates the real PyMuPDF render — the OS
        # thread runs even after the awaiting coroutine is
        # cancelled.
        await asyncio.to_thread(time.sleep, 2.0)

    # Set a short drain budget so the test doesn't take 25 s.
    original_timeout = mod.SHUTDOWN_DRAIN_TIMEOUT_SEC
    mod.SHUTDOWN_DRAIN_TIMEOUT_SEC = 5
    try:
        # Launch 4 fake job tasks and track them just like real ones.
        tasks = [mod._track_job_task(asyncio.create_task(slow_task()))
                 for _ in range(4)]
        # Give them a moment to actually enter the to_thread call.
        await asyncio.sleep(0.1)
        assert len(mod._ACTIVE_JOB_TASKS) == 4, (
            "task tracking didn't register all 4 tasks"
        )
        # Now request shutdown and measure drain time.
        start = time.monotonic()
        await mod.shutdown_bulk_import_jobs()
        drain = time.monotonic() - start
    finally:
        mod.SHUTDOWN_DRAIN_TIMEOUT_SEC = original_timeout
        # Clean up any lingering tasks (they may still be running in
        # threads).
        for t in tasks:
            if not t.done():
                t.cancel()
        await asyncio.sleep(0)  # let cancellations propagate

    # Drain must complete within the budget PLUS a small overhead
    # (asyncio.wait_for gives up cleanly at the budget).
    assert drain < 7.0, (
        f"shutdown_bulk_import_jobs took {drain:.2f}s; budget was 5s. "
        "The bounded wait didn't trigger — check the timeout wrapping."
    )


@pytest.mark.asyncio
async def test_task_tracking_auto_removes_on_completion():
    """The `add_done_callback` on `_track_job_task` must auto-remove
    finished tasks so the set doesn't grow without bound."""
    import bulk_import_prestarts as mod

    async def quick():
        await asyncio.sleep(0)

    before = len(mod._ACTIVE_JOB_TASKS)
    t = mod._track_job_task(asyncio.create_task(quick()))
    assert len(mod._ACTIVE_JOB_TASKS) == before + 1
    await t
    # done-callback fires on the next event-loop iteration.
    await asyncio.sleep(0.01)
    assert len(mod._ACTIVE_JOB_TASKS) == before, (
        "completed task not removed from _ACTIVE_JOB_TASKS — set will "
        "leak."
    )

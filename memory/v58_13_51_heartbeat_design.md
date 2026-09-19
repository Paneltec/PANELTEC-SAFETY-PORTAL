# v58.13.51 (DRAFT — awaiting user green-light)
## Per-Claude-call heartbeat for bulk-import vision worker

**Status**: designed, NOT shipped. User has requested draft-only until v58.13.50's
30-minute cap has demonstrated it does or doesn't handle the recurring stall.

## Problem statement (from v58.13.50 forensics)

`bulk_import_jobs.14433131-...` has been auto-resumed **10 times** and consistently
stalls after ~13 minutes of healthy progress at the vision stage. The watchdog
(`last_progress_at` stale for >15 min) reaps it. v58.13.50 doubled the cap to
30 min, which will mask most stalls but not the underlying cause.

Investigation of the log around the stall point reveals a consistent pattern:
progress writes are healthy at ~1-3 s intervals right up until 07:40:09 then
FALL SILENT. That means one (or more) of the 4 concurrent vision workers hung
on a specific PDF for the full watchdog window while the OTHERS may or may not
have been healthy — but the batch counter didn't advance enough to trigger the
next `_flush_progress` write.

## Fix proposal

Add a **per-Claude-call heartbeat** that touches `last_progress_at` at the
start and end of each `_claude_call_with_backoff` invocation, regardless of
whether the call succeeds or how long the batch takes. Even a single healthy
worker among the 4 will keep the heartbeat fresh.

### Code change (single point of modification)

In `bulk_import_prestarts.py`, locate `_claude_call_with_backoff` (or the
equivalent per-record vision-call helper). Wrap the awaited Claude call with:

```python
async def _claude_call_with_backoff(job_id, pdf_bytes, ...):
    # v58.13.51 — heartbeat AT START. Any thread of execution that reaches
    # this point counts as "alive" for the watchdog. Fire-and-forget update
    # so a slow db.write doesn't back-pressure the Claude call.
    asyncio.create_task(_touch_heartbeat(job_id))
    try:
        result = await _call_claude(...)
    finally:
        # v58.13.51 — heartbeat AT END. Symmetric with start; ensures the
        # last successful record before a stall still bumps last_progress_at.
        asyncio.create_task(_touch_heartbeat(job_id))
    return result


async def _touch_heartbeat(job_id: str) -> None:
    """Fire-and-forget `last_progress_at` bump. Silent on failure —
    the watchdog will still reap on genuine stalls; the heartbeat just
    keeps healthy in-flight work from being falsely reaped."""
    try:
        await db.bulk_import_jobs.update_one(
            {"id": job_id, "state": {"$in": ["processing", "dry_run"]}},
            {"$set": {"last_progress_at": _now_iso()}},
        )
    except Exception:  # noqa: BLE001
        pass
```

### Watchdog cap can drop back to 15 min

Once the per-call heartbeat is in place, the 30-min cap from v58.13.50 becomes
overly generous. Revert `VISION_STALL_TIMEOUT_MIN` default to 15 (or 20 for
safety) — the heartbeat guarantees that a single stuck worker is the only way
to trip it, exactly the failure mode we WANT to catch.

### Tests

`tests/backend_unit/test_bulk_import_heartbeat_v58_13_51.py`:
- Mock `_call_claude` to sleep 25 seconds; assert `last_progress_at` is bumped
  before AND after via `asyncio.gather` on a mock db update spy.
- Mock `_call_claude` to raise; assert `last_progress_at` still bumped in the
  `finally` clause (i.e. failed record still counts as "recently alive").
- Verify `_touch_heartbeat` swallows db exceptions silently.

### Rollout plan

1. Ship v58.13.51 with heartbeat + `VISION_STALL_TIMEOUT_MIN=20` (compromise).
2. Watch for 5 days across `bulk_import_jobs.state='failed'` count.
3. If zero new vision-stall reaps, drop cap back to 15 min in v58.13.52.

### Guardrails

- No changes to the batch counter / `_flush_progress` cadence — those stay
  performance-optimal.
- Heartbeat runs as fire-and-forget `create_task`, so a slow Mongo write can't
  back-pressure the vision worker.
- The heartbeat still filters `state ∈ {processing, dry_run}` — no writes
  against completed/failed/cancelled jobs.
- The `id` field is scoped by the calling job's `job_id` — no cross-job
  contamination possible.
- No env changes needed; existing env keys stay functional.
- `/app/mobile/` NOT touched (per Track 2 rules).

## Deferred decisions (user to greenlight)

- [ ] Should the heartbeat run per-record or per-vision-call?
      Recommendation: per-vision-call (finer granularity).
- [ ] Should `VISION_STALL_TIMEOUT_MIN` drop back to 15 or stay at 20?
      Recommendation: 20 as compromise; drop to 15 in v58.13.52 after signal.
- [ ] Should the heartbeat also emit a `paneltec.bulk_import.heartbeat`
      log line? Useful for operational visibility but adds log volume.
      Recommendation: NO on the default path; add a debug-level line so
      operators can enable it if diagnosing.

# Paneltec Civil — Deferred backlog

Tracker for known-but-non-blocking bugs / minor followups that don't warrant an immediate ship.
Anything here is a candidate for a future patch label. Order is loose; feel free to reprioritise.

## Candidates for `.132ln`

### 1. Agent mDNS discovery — `zeroconf` API drift
**Filed:** 2026-09-23 (during `.132ll` operator verification)
**Where:** `scripts/paneltec_backup_agent.py::_mdns_discover` (the ThreadPoolExecutor-launched service-browser helper).
**Error observed in Stephen's UGREEN container log:**
```
TypeError: _mdns_discover.<locals>._on_change() got an unexpected keyword argument 'zeroconf'
```
**Cause:** upstream `zeroconf` library (Python) changed the `ServiceBrowser(handlers=[...])` callback signature. Older API called `_on_change(name, service_type, state_change)`; newer API calls `_on_change(zeroconf=..., service_type=..., name=..., state_change=...)` as kwargs. Our closure signature `_on_change(name, service_type, state_change)` doesn't accept the new `zeroconf=` kwarg.
**Fix (one-line):** change the closure signature to accept `**kwargs`, OR match the new positional pattern `(zc, service_type, name, state_change)`. The new pattern is preferred — it's stable across `zeroconf ≥ 0.132`.
**Impact:** Non-blocking. mDNS discovery is a nice-to-have for auto-detecting other agent hosts on the LAN; it does NOT gate any current workflow. Manifests only as a noisy `TypeError` in stderr every few minutes. All primary agent flows (poll, snapshot, HMAC ops, `fetch_and_put`) unaffected.
**Ship suggestion:** roll into whatever the next agent-touching ship is (probably `.132ln` — cutover or observability polish).
**Reference log:** Stephen's UGREEN restart 2026-09-23 ~09:07Z.

### 2. Agent `stat` ops silently stall in `in_flight` on the queue

**Filed:** 2026-09-23 (during `.132lm` real-run kickoff)
**Symptom:** 14 `stat` ops enqueued during the first migration run were all picked by the agent (`picked_at` set) but NONE ever POSTed a result to `/agent/nas-op-result`. Same pattern as the pre-`.132lk` `fetch_and_put` stall — agent claims the op, then nothing.
**Cause:** unknown. `fetch_and_put` works end-to-end (128 MB probe passed post-`.132ll`), but `stat` on non-existent paths (`dropbox/…` — none exist yet) is silently dropped.
**Workaround shipped in `.132lm` amend:** copy engine no longer does per-file `stat` idempotency checks. Relies on `.part`-then-atomic-rename + full re-download on resumed runs. Design side-steps the bug entirely for now.
**Impact:** blocking for pre-copy idempotency, non-blocking for the migration itself. Investigate before designing the resume-safe stat sweep for post-first-run reconciliation.
**Suggested fix path:** SSH into UGREEN agent, add `log.info("[nas-ops] executing stat path=%s", path)` inside the agent's `_nas_execute` stat branch, tail logs during a manual stat probe. Might be a `_nas_safe_path` boundary check that swallows the exception silently.

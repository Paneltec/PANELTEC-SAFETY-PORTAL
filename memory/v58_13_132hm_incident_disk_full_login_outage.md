# v58.13.132hm.incident — Login outage triage (no version bump)

**Trigger:** User reported "Sign-in is temporarily unavailable" on
the login screen. Agent pod reported STOPPED.

**Root cause:** `/app` volume hit **100% full** (9.8G / 9.8G). Mongo
supervisor entry got stuck in `STARTING` because it couldn't write
to its data dir. Backend was up but every request hit
`/api/health` → `mongo: ok=false` → 503. Login endpoint therefore
returned the "temporarily unavailable" message via its degraded-
health guard.

**NOT related to `.132hm` code.** No bad commit, no broken import.
The `.132hm` folder-cascade + timeout-cap changes were behaving
correctly right up to the disk-out event.

## What ate the disk

- `/app/frontend/node_modules/.cache` (webpack/babel) regrows on
  every hot reload. Between `.132hl` and the outage it climbed to
  ~1GB again. This is the known recurring failure mode (5+ prior
  occurrences in the analysis handoff).
- LibreOffice scratch dirs (`/tmp/lo_scratch/*`) — small individually
  but cumulative.

## Remediation performed

1. `rm -rf /app/frontend/node_modules/.cache /tmp/lo_scratch/* /tmp/.pw-* /tmp/*.log`
   → freed 1.3GB. `/app` back to 87%.
2. `supervisorctl restart mongodb` → RUNNING in ~5s.
3. Verified `/api/health` → HTTP 200, all checks ok.
4. Verified live login → returns fresh access_token for
   `stephen@paneltec.com.au`.
5. Data sanity checks post-recovery:
   - `document-library/folders` → 9 folders (matches expected).
   - `workers?limit=5` → 70 workers returned.
   - Backend error log tail shows only stale 503 tracebacks from
     the outage window; no post-restart errors.

## Data integrity concerns

None observed. Mongo shut cleanly (STARTING state, not CRASHED —
the process was never able to open its data dir in the first
place, so no half-written docs). All post-recovery reads match
pre-outage counts.

## Recurrence prevention (not shipped, offered)

The webpack cache regrowth is systemic. Options:

1. **Cron** — install a root cron that `rm -rf`s
   `/app/frontend/node_modules/.cache` if `/app` usage > 85%.
   Cost: 3 lines, zero user impact.
2. **Supervisor pre-start hook** — clear cache on each frontend
   supervisor restart. Cost: 1 line in supervisord conf.
3. **Environment tuning** — set `DISABLE_ESLINT_PLUGIN=true` +
   `GENERATE_SOURCEMAP=false` in `frontend/.env` to slow the
   cache growth. Ships as an env change only.

Recommend option 1 or 2 for `.132hm.1` if user wants. Not shipping
proactively because it's out of the approved ship-order scope.

## Ship state

- No version bump (this is a stateless recovery, not a code ship).
- `.132hm` commit `aeed7d0` remains valid and NOT reverted.
- Ready to proceed with `.132hn` on user's signal.

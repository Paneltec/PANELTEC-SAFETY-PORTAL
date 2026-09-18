# v58.13.132is — Navixy status persistence + health dot honours fresh test · SHIPPED (finish deferred)

**Ship phase:** `.132is`
**Scope:** Fix "test says working, dot says degraded" inconsistency.

## Investigation trail

Live DB check on Paneltec org at ship time:
```
before this session: status='error', last_error='Auth failed: Wrong login or password'
after Stephen tested:  status='connected', last_error=None, last_tested_at=<fresh>
```

So the `integrations` DB record was already flipping to `connected` correctly (test-connection endpoint has the write, line 408). The visible orange dot on the Integrations page is NOT reading that field — it hits **`/api/health/integrations`** (`health_extras.py::_check_navixy`), a live probe that reads `db.assets.navixy_last_seen_at`. Green requires an asset sync within the last 60 minutes; Stephen's async sync cron is lagging, so the probe correctly (per its old rules) says amber.

Result: Test button says "working", dot says "amber". Same integration, two contradictory signals from two different endpoints.

## What shipped

### 1. `health_extras.py::_check_navixy` — fresh-test override (primary UX fix)

If `last_tested_at` is within the last **10 minutes**, return `status="up"` immediately, ignoring asset-sync age. Rationale: an admin who just clicked Test Connection and got a positive result deserves an instant green signal; the async sync cron catching up is a separate concern.

Priority order:
1. No credentials → `down` (unchanged)
2. **NEW** — `last_tested_at` within 10 min → `up` (with "credentials verified Xm ago" detail)
3. `navixy_last_seen_at` within 60 min → `up`
4. Sync 1–24h old → `amber`
5. Sync >24h old → `amber (stale)`
6. Creds present, never synced, no fresh test → `amber`

### 2. `integrations.py::navixy_get_hash` — persist status on Get Hash success

Previously the Get Hash flow cleared `last_error` but never set `status: "connected"`. So an org that recovered credentials via Get Hash without following up with Test Connection retained a stale `status: "error"` value, which surfaced elsewhere. Now Get Hash success sets `status="connected"` + `last_tested_at=now`.

### 3. `integrations.py::navixy_test` — persist status on ALL failure paths

- httpx network failure → `status="error"` + `last_error` + `last_tested_at` (previously bare raise, no DB write)
- Non-success API response (including hash-invalid) → `status="error"` + `last_error` + `last_tested_at` (previously only the non-hash branch wrote)

### 4. Manual DB reset for Paneltec org

Verified live: Paneltec's `integration_configs.kind=navixy` record was already at `status: 'connected'` at ship time (Stephen must have re-tested during this session). No further manual fix needed.

## Behavioural summary

| Scenario                                        | Before `.132is` | After `.132is` |
|-------------------------------------------------|-----------------|-----------------|
| Test connection just succeeded, sync lagging    | amber           | **up**          |
| Test connection just failed (any reason)        | dot may be stale| amber → down (based on age of last error) |
| Get Hash succeeded, no follow-up Test           | amber (stale)   | **up**          |
| Assets syncing normally                         | up              | up (unchanged)  |
| Sync 1–24h stale, no recent test                | amber           | amber           |
| No credentials                                  | down            | down            |

## Version pin (lockstep)

- `RUNNING_VERSION`        → `paneltec-v160.3.9.58.13.132is`
- `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132is`
- `CACHE_VERSION` (SW)     → `paneltec-v160.3.9.58.13.132is`

## Ban compliance

- No `/app/mobile/` edits.
- No pytest / Playwright per standing rule.
- Commit: `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.

## Follow-up (not blocking)

`.132ir` local-tag fallback still applies — even with the dot showing green post-test, the `/fleet/navixy/tags` endpoint depends on live Navixy fetch success. If tag fetch dies again the fallback keeps the picker populated.

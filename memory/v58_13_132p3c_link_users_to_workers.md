# Ship `.132p3c` — Auto-link users to worker records by email

## Run results (2026-09-28)

| Metric | Count |
|--------|-------|
| Total users | 98 |
| Total workers | 74 |
| **Linked this run** | **3** |
| Already linked (no-op) | 67 |
| Unlinked users (no worker match) | 28 |
| Orphan workers (no user match) | 1 |

## Newly linked (this run)
- `amanda.guy@paneltec.com.au` (user bb1daa5e) -> worker f7e200f8
- `david@appzoola.com` (user c041c2be) -> worker 391c4d24
- `brock.w@hotmail.com` (user 538895e7) -> worker 6ab57db4

## Unlinked user emails (no matching worker — 28 total)
These are mostly test/fixture/demo accounts. Real users needing workers
should be added via HR import.

- `worker@paneltec.com` (test)
- `super@paneltec.com` (test)
- `audit@paneltec.com` (test)
- `worker_stephen@paneltec.com.au` (worker role — separate from admin)
- `demo@paneltec.com` (demo)
- `melinda@paneltec.com.au` (no worker record)
- `pending-activation-fixture@paneltec.com.au` (fixture)
- `hseq-lead-fixture@paneltec.com.au` (fixture)
- `contractor-rep-fixture@paneltec.com.au` (fixture)
- `worker-fixture@paneltec.com.au` (fixture)
- `admin@paneltec.com` (test)
- `testagent@example.com` (test)
- `tester_agent_123@example.com` (test)
- `testuser_whs_reg@example.com` (test)
- (no email) (1 user)
- 8x notification-fixture accounts (`nt-*@notifications-fixture.example.com`)

## Orphan workers (no matching user account — 1 total)
- `tw@example.com` — test worker, no real user account needed

## Re-run command
After HR adds new worker records, re-run to link them:
```bash
cd /app && python3 scripts/link_users_to_workers.py
```
Idempotent — safe to run multiple times.

## Files
- `scripts/link_users_to_workers.py` (new)
- `frontend/src/lib/version.js` (bump to v58.13.132p3c)
- `frontend/public/service-worker.js` (bump)

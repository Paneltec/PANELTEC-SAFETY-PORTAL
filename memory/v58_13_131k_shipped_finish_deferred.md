# v58.13.131k — SmartFill API re-probe · SHIPPED (finish deferred · discovery-only)

`finish` bypassed per standing rule.

## Correction acknowledged
`.131j` (Fuel Rate Book) is **CANCELLED** and off the roadmap. Not built, not queued.

## Ship label
`.131c → .131d → .122b → .131g → .131h → .131i → **.131k**` (`.131j` skipped intentionally).

## What shipped
Pure discovery. Zero DB writes, zero endpoint additions, zero UI changes.

- `/app/memory/v58_13_131k_smartfill_probe.md` — the full report.
- `/app/memory/v58_13_131k_probe_raw.json` — 39-method RPC sweep + 24-path REST sweep, raw JSON.
- `/app/scripts/probe_131k.py` — idempotent re-runner (safe to invoke any time).
- Version bump `.131i → .131k` on the 3 canonical files.

## Findings — headline

**Zero change vs the `.131` baseline.** SmartFill support has not enabled any additional methods on account `Paneltec4869` since the original probe on 2026-09-05T05:07:59Z. Same 1 available (`Tank:Level`), same 8 subscription-gated, same 30 not-implemented.

### Receipt path — infeasible on this tier
- All 7 `Receipt:*` / `Receipts:*` JSON-RPC variants return `code 5: no such method`
- All REST receipt-style paths (`/api/v1/receipts/{id}`, `/receipt/{id}.pdf`, `/api/v1/receipts/download-all`) 302 → 403 (portal login, not API)
- The receipt PDF the user shared is generated on-demand by the SmartFill web portal (browser session, not API)

### Recommended path forward
Keep the manual CSV import (`.131c → .131i` — currently in production). The `.131i` Navixy `navixy_live` enrichment already gets us odometer + L/100km automatically. If pricing is a hard requirement, the only path is a SmartFill support ticket asking them to unlock `Tank:Transactions` on client `Paneltec4869`.

## Rules obeyed
- No `e1_tester`.
- No `/app/mobile/` code — version bump only.
- No automated comms.
- No writes to live DB (zero Mongo operations in the probe script).
- No changes to `_import_csv` or any anomaly rule.
- No new endpoints, no UI.
- SmartFill secret never logged, never persisted, never in the report (redacted last-4 only).

## Full pytest suite
```
$ pytest tests/backend_unit/ -q --ignore=tests/backend_unit/test_v58_13_131_smartfill_probe.py --tb=no
24 failed, 1271 passed, 6 skipped, 18 warnings in 8.48s
```
Same 24 pre-existing baseline flakes, zero new tests (discovery-only ship), zero regressions.

## Version pins
```
frontend/src/lib/version.js#RUNNING_VERSION      = paneltec-v160.3.9.58.13.131k
mobile/src/lib/version.ts#MOBILE_BUNDLE_VERSION  = paneltec-v160.3.9.58.13.131k
frontend/public/service-worker.js#CACHE_VERSION  = paneltec-v160.3.9.58.13.131k
```

## Optional Section 7 (client stub)
Declined. No new working transaction endpoint was found. Writing a `SmartFillClient` wrapper would just re-implement what `integrations_smartfill.py` already covers for `Tank:Level` — no new shape to prove.

## Backlog (unchanged apart from `.131j` removal)
- Asset hygiene: 76 assets without Navixy plumbing (bulk-fix in AssetDrawer).
- `.122c`: Trailer date-anchor scheduling (P2).
- `v58.14.x`: Object-storage migration (clears 20 `ephemeral-upload-storage` warnings).
- SmartFill Tier upgrade: only viable path to programmatic price/transaction data — support ticket required.

## One-line verdict

> **`.131k` shipped clean. SmartFill API has not moved since `.131`; receipt-based enrichment is infeasible on the current tier; manual CSV + `.131i` Navixy enrichment remains the correct production path.**

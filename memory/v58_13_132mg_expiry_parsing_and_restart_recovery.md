# v58.13.132mg — SDS expiry parsing + migration picker fix + restart-recovery

**Ship date:** 2026-09-23 · **Author:** e1 · **Commit:** `<sha filled at finish>`

Three-part backend + frontend ship. No mobile.

## Part A — Migration picker fix (unblocks real migration)

**Bug (diagnosed this session):** `nas_client.fetch_and_put()` never forwarded `agent_id` to `enqueue_op()`. The Dropbox migration engine passed `agent_id="958bf283-..."` (ugreen-nas) but `enqueue_op` fell back to `_default_agent_id()` = most-recent poller = **Office Pi**. Office Pi (running old agent version, `capabilities: None` in `bk_agents`) picked the `fetch_and_put` op at 22:15:21 and never ack'd. Op sat `in_flight` for 12+ min until the backend restart killed it.

**Fix:** two-line signature change. `nas_client.fetch_and_put(agent_id=None)` param added and threaded to `enqueue_op(agent_id=...)`. `dropbox_bytes_copy._run_copy` passes its own `agent_id` down.

**Evidence:** `nas_ops` row `e157fafd-8e61-42fe-af00-7d06053d14c8` shows `agent_id: a6767aa4-...` (Office Pi) despite migration targeting `958bf283-...` (ugreen-nas).

## Part B — Restart-recovery scaffolding

**Systemic problem:** every ship (`.132mb`, `.132md`, `.132mf`, `.132mg`) requires a backend restart which kills any in-flight migration. The `.132mb` outer try/except doesn't fire on hard SIGTERM. State docs stay frozen at `state: running` = zombies.

**Fix:**
1. `sweep_zombie_migration_runs()` in `integrations_dropbox.py`, called from `server.on_startup`. Marks any `state=running` doc with `updated_at > 5min` old as `interrupted`, plus force-errors stale `in_flight` `nas_ops` rows on those runs.
2. `POST /api/dropbox/migration/{run_id}/resume` (admin only). Fires a fresh copy task with the original `agent_id`.
3. `_run_copy` walker now filters `copy_state != "copied"` on `dropbox_files_enum`. After each successful `fetch_and_put`, stamps `copy_state=copied`, `copied_at`, `copied_by_run_id`. Resume becomes truly idempotent — already-copied files skip on rescan.

## Part C — SDS filename expiry parsing

**Problem:** Users see noisy filenames like `Rage_Gold_3Exp1.8.24.pdf` in file lists. The `_3Exp1.8.24` encodes an expiry (1 Aug 2024, Australian DMY) that is WHS-critical but never surfaced as structured data.

**Two regex families:**
- **Dotted DMY** — `[_\- ]?(\d+)?Exp(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})`. Optional `_N` cycle-marker prefix. e.g. `_3Exp1.8.24`.
- **Compact** — `(QD)?EXP(\d{4,8})`. 4 digits = year-only (EoY fallback), 6 = MMYYYY, 8 = DDMMYYYY. Optional `QD` prefix.
- Sanity: reject dates >20 years past or future as garbled.

**12/12 unit tests pass** on the exact real filenames Stephen shared.

**New helpers:**
- `backend/filename_expiry.py` — `parse_filename_expiry(name)` → `{clean_name, expires_at, raw_code}`; `expiry_bucket(iso)` → `expired|expiring_soon|ok|unknown`
- `frontend/src/lib/filenameExpiry.js` — mirror parser + `resolveDisplay(file)` that prefers backend `display_name` + `expires_at` when present.
- `frontend/src/components/document-library/ExpiryBadge.jsx` — colour chip (green >6mo, amber ≤6mo, red past, grey unknown).

**Backend endpoint:** `GET /api/document-library/expiries?status={expired|expiring_soon|ok|unknown|all}` — admin only. Returns files bucketed for the future "SDS Expiring Soon" widget.

**Backfill script:** `scripts/backfill_filename_expiry.py`. Dry-run by default, `--run` to commit. Idempotent. Populates `display_name` + `expires_at` on `doc_files`. Reports scanned / matched / unparseable / already-backfilled counts.

**Frontend wiring:**
- `pages/DocumentLibrary.jsx` — main folder row filename now uses `resolveDisplay(f).name` and renders `<ExpiryBadge>` when a bucket resolves.
- `pages/SharedWithMe.jsx` — same treatment.
- Uses `data-testid="file-expiry-<id>"` and `shared-expiry-<id>` for testers.

## Files touched

### Backend
- `filename_expiry.py` (new, 165 LOC)
- `nas_client.py` (fetch_and_put signature + threaded agent_id)
- `dropbox_bytes_copy.py` (agent_id fwd + copy_state stamping + resume filter + get_run helper)
- `integrations_dropbox.py` (sweep_zombie_migration_runs + resume endpoint)
- `document_library_shares.py` (GET /expiries endpoint)
- `server.py` (startup hook)

### Frontend
- `lib/filenameExpiry.js` (new)
- `components/document-library/ExpiryBadge.jsx` (new)
- `pages/DocumentLibrary.jsx` (import + wire badge into main row)
- `pages/SharedWithMe.jsx` (import + wire badge into row)
- `lib/version.js` (RUNNING_VERSION + EXPECTED_CACHE_VERSION + changelog block)
- `public/service-worker.js` (CACHE_VERSION)

### Scripts
- `scripts/backfill_filename_expiry.py` (new)

### Memo
- `memory/v58_13_132mg_expiry_parsing_and_restart_recovery.md` (this file)

## Not shipped

- `.132me` — auth-lockout fix, parked.
- Mobile parity for `.132mf` + `.132mg` — deferred to `e1_expo_frontend_dev`.
- Expiry badge on non–Document-Library surfaces (SDS folder view, Pre-start / SWMS / Incident attachment lists, search results, delete-confirm modal) — scoped out this ship. `resolveDisplay` helper is ready for those.

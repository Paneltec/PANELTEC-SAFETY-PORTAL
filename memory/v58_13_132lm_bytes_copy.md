# v58.13.132lm — Phase 2b Ship 2: Dropbox → NAS bytes-copy engine

Ship label: `.132lm`
Ship date: 2026-09-23
Branch: main (no push)
Ship type: Feature. Pod-side only — reads the `.132lj` enum, calls the `.132lk`+`.132ll` resumable transport, drives the queue-and-drain harder via `limit=32`.

---

## Standing brief

`.132lj` shipped the file enum (145,035 rows, 265.6 GB in `dropbox_files_enum`). `.132lk` + `.132ll` hardened the transport (resumable Range downloads with HEAD support + sha-mismatch cooldown). The 128 MB streaming probe passed in 71 s post-`.132ll`. Stephen green-lit Ship 2 with locked-in exclusions + speed settings.

This ship is the actual bytes mover. **Nothing else moves without an explicit go-ahead from Stephen after reviewing the dry-run output** (the safety net in his brief).

---

## What shipped

### Copy engine — `backend/dropbox_bytes_copy.py` (NEW)

`run_copy_job(run_id, agent_id, dry_run)` — background entry point. Dispatches to `_run_dry` or `_run_copy`.

**`_run_dry(run_id)`** — counts what WOULD be copied:
- Walks `dropbox_files_enum` once, applies exclusion prefixes, tallies raw vs would_copy totals + per-exclusion `{files, bytes}` breakdown.
- Emits **sanity probes** to prove Stephen's locked-in KEEP rules survive:
  - `kept_pitt_sherry_swms_seen: bool` — the exact `SWMS/CCTV Survey - Safe Operation - Geotechnical Investigations - TERHAP - TWCDO - 30 06 2021.pdf` file made it through.
  - `kept_arthurs_lake_swms_seen: bool` — the exact `Safe Work Method Statement - Combination Vacuum Truck - CCTV Inspection - Flintstone Drive Arthurs Lake - 20 12 2022.pdf` made it through.
  - `swms_kept_count` + `swms_kept_paths[]` — every file whose enum-row `unresolved_wildcard != null` that we're NOT excluding. Should be 5 (Pitt & Sherry + Arthurs Lake).
  - `taswater_line_viewer_files_kept` — count of files under `/…/CCTV/Taswater …/DISK1/…`. Confirms Cutten St / Frankland St dumps survive.
  - `callibration_certificates_zip_bytes` — exact size of the 13.7 GB zip if it's in the "would copy" set (else `null`).
- Zero Dropbox API calls, zero NAS ops. Pure Mongo aggregation.

**`_run_copy(run_id, agent_id)`** — the real bytes mover:
- **Sort by size ASC**: small files land first. Gives Stephen visible progress within minutes and de-risks the run — if a bug crashes the engine on file 5,000, we've lost 5,000 tiny quick-wins, not the giant zip.
- **Idempotency**: `nas_client.stat(nas_path)` before each fetch. If `exists && size == expected`, skip. Dropbox `content_hash` is NOT sha256, so we can't sha-verify pre-existing files — but the agent's `.part`-then-atomic-rename discipline (from `.132lj`) guarantees any correctly-sized file on the NAS came from a completed successful write.
- **Dropbox temp link**: `dbx.files.get_temporary_link(path).link` — 4-hour direct-download URL. Consumed immediately.
- **Enqueue op**: `nas_client.fetch_and_put(nas_path, source_url, expected_sha256="", expected_size, meta={source, dropbox_id, dropbox_path, dropbox_rev, content_hash, bytes, migrated_at, run_id}, timeout_s=6*3600)`. Six-hour per-op timeout gives headroom for the 13.7 GB zip.
- **Per-file error handling**: caught + appended to `errors[-100:]`, run continues. No single bad file crashes the run.
- **Progress flush every ~2 s**: full status doc upserted to `dropbox_migration_run` with `{state, files_copied, files_skipped_existing, files_failed, bytes_transferred, current_file, throughput_files_per_hour, elapsed_s, errors, progress_files}`.

### Exclusion list (dir-boundary safe prefix match)

```python
EXCLUSION_PREFIXES = [
    ("Bevs PC Backup — Windows filesystem dump",
     "/Paneltec-General Administration/General Administration/"
     "Viatec Traffic Solutions/Bevs PC Backup June 2020"),
    ("Jago Crt CCTV — Line Viewer raw dumps",
     "/Paneltec-General Administration/CCTV/Jago Crt"),
    ("Scoyttsdale CCTV Investigation — 2-file folder",
     "/Paneltec-General Administration/Customers/TasWater CDO/"
     "Scoyttsdale CCTV Investigation10022025"),
]
```

Boundary check: `path == prefix OR path.startswith(prefix + "/")`. So `/…/Jago Crt Boulevard/foo.pdf` is NOT accidentally excluded by the `/…/Jago Crt` rule.

### NAS destination layout

Files land at `<NAS_ROOT>/paneltec-files/dropbox/<dropbox_path>`. So `/Paneltec-General Administration/Customers/foo.pdf` → `<NAS_ROOT>/paneltec-files/dropbox/Paneltec-General Administration/Customers/foo.pdf`. Preserves Dropbox layout 1:1. Sidecar `.meta.json` next to each file carries the reconciliation record.

### Throughput bump

`backend/backup_service.py:2422` — `next_ops_for_agent(agent["id"], limit=32)` (was 8 in `.132lj`).

- Agent's `_drain_nas_ops` chews claimed ops back-to-back within one `_one_pass`.
- With `limit=32` and the 71 s / 128 MB observed round-trip, a poll cycle can move ~32 small files per drain vs 8 → **4× raw throughput**.
- Large files still occupy one op slot for their full transfer time — the 13.7 GB zip will be one long-running slot regardless of `limit`.
- Poll cadence unchanged (60 s), no schema change, no agent-side change.

### Endpoints (`backend/integrations_dropbox.py`)

**`POST /api/dropbox/migration/start`** (admin):
- Body: `{"agent_id": str, "dry_run": bool = false}`.
- `agent_id` required for a real run; ignored for dry-run.
- Idempotency: returns the existing run doc if one is in-flight.

**`GET /api/dropbox/migration/status`** (admin):
- Latest doc from `dropbox_migration_run`.

---

## Version bumps (lockstep)

| File | Old | New |
|---|---|---|
| `frontend/src/lib/version.js#RUNNING_VERSION` | `paneltec-v160.3.9.58.13.132ll` | `paneltec-v160.3.9.58.13.132lm` |
| `frontend/src/lib/version.js#EXPECTED_CACHE_VERSION` | `paneltec-v160.3.9.58.13.132ll` | `paneltec-v160.3.9.58.13.132lm` |
| `frontend/public/service-worker.js#CACHE_VERSION` | `paneltec-v160.3.9.58.13.132ll` | `paneltec-v160.3.9.58.13.132lm` |

---

## Files touched

- `backend/dropbox_bytes_copy.py` (NEW, ~330 lines).
- `backend/integrations_dropbox.py` — `POST /migration/start` + `GET /migration/status` (~60 lines).
- `backend/backup_service.py` — `next_ops_for_agent(..., limit=32)` bump (~8 lines with comment).
- `frontend/src/lib/version.js` — bump + changelog block.
- `frontend/public/service-worker.js` — bump.
- `memory/v58_13_132lm_bytes_copy.md` — this memo.

## NOT touched

- HMAC canonicals — unchanged since `.132lj`.
- Enum engine + `dropbox_files_enum` collection — unchanged; still holds the 145,035-row snapshot.
- Snapshot / probe-blob endpoints — unchanged since `.132ll`.
- Agent code (`scripts/paneltec_backup_agent.py`) — unchanged since `.132ll`. This ship is pod-side only.
- `doc_files.storage_backend` — no cutover. That's a separate future ship after Stephen spot-checks mirrored bytes.
- `/app/mobile/` — untouched (ban).
- `MOBILE_BUNDLE_VERSION` — unchanged.

---

## Operator note — dry-run first

Stephen's brief was explicit: fire `POST /migration/start {"dry_run": true}` first and report the numbers back. Only fire a real run after his explicit go-ahead. The status endpoint reads whichever run doc was upserted most recently, so a real run following a dry-run will supersede the dry-run doc — no cleanup needed.

## Backlog forward-links

- Agent mDNS discovery `zeroconf` API drift — see `memory/backlog.md`. Candidate for `.132ln`.
- Cutover to NAS-backed `doc_files` — future ship, Stephen-gated.

# v58.13.132lj — Phase 2b Ship 1: streaming NAS transport + Dropbox file enumeration

Ship label: `.132lj`
Ship date: 2026-09-23
Branch: main (no push)
Ship type: Backend-only + one-line frontend piggyback. Streaming transport prereq + Dropbox enumeration engine + status endpoint. **No bytes copied.**

---

## Standing brief

Stephen green-lit Option A of the Dropbox → NAS migration plan:

1. **Ship 1 (this ship)** — streaming transport + file enumeration only. No bytes copied.
2. **Ship 2 (.132lk, deferred)** — bytes-copy engine with the exclusion list applied.
3. **Ship 3 (.132lm+, deferred)** — cutover: flip `doc_files.storage_backend` to NAS reads after human spot-checks.

Confirmed exclusion list from Stephen:
- (a) `Bevs PC Backup June 2020` (well-defined) — **auto-exclude**.
- (b) `Jago Crt CCTV` (wildcard) — **report-only** in Ship 1; Stephen confirms candidates before Ship 2.
- (c) `Taswater CCTV Investigation` (wildcard) — **report-only** in Ship 1; Stephen confirms candidates before Ship 2.

---

## What this ship delivers

### 1. Streaming NAS transport — the `fetch_and_put` op

Fixes the `.132lf` deferred blocker: *"Streaming body transfer for files > ~50 MB (current base64-in-JSON approach blows JSON parse memory on very large files). Phase 2b will need this before touching CCTV footage subtrees."*

**Design decision:** rather than chunked-HMAC over the queue (option A in the design conversation), or GridFS staging (option D), we implement the **direct-URL pull** approach (option C). The pod hands the agent a signed URL; the agent downloads bytes DIRECTLY from that URL, streaming to disk in 1 MB chunks, with no bytes ever traversing the JSON payload of the queue.

Chosen because for the actual Ship 2 use case (Dropbox → NAS), Dropbox already exposes `files.get_temporary_link()` which returns a direct-download URL. So the pod never has to buffer the bytes — it just:

1. Calls `dbx.files.get_temporary_link(path)` → gets a short-lived download URL.
2. Signs `path|source_url|expected_sha256|expected_size|enqueued_at` with `NAS_AGENT_SHARED_SECRET`.
3. Enqueues a `fetch_and_put` op with `meta={source_url, expected_sha256, expected_size}`.
4. Agent HMAC-verifies, downloads the URL directly, verifies sha, atomic-renames.

For this Ship 1's transport probe (no real Dropbox involved), we replicate the same shape with a synthetic 128 MB blob served from the pod at `GET /api/backup/agent/probe-blob/{id}?sig=…`. The endpoint streams deterministic pseudo-random bytes generated from a seed, so pod memory stays flat regardless of blob size.

**Files touched:**

- `backend/nas_ops_service.py`:
  - New `_canonical_fetch(path, source_url, expected_sha256, expected_size, enqueued_at)`.
  - `enqueue_op()` dispatches on `op` — `fetch_and_put` signs via the fetch canonical; all other ops still use the legacy `op|path|body_b64|enqueued_at`.

- `backend/nas_client.py`:
  - New `fetch_and_put(path, source_url, expected_sha256, expected_size, meta, timeout_s=30*60)` helper. Default timeout is 30 min (real Ship 2 calls will pass longer for multi-GB CCTV).

- `backend/backup_service.py`:
  - New `PUBLIC_HUB_URL_FOR_AGENTS` constant (resolves `PUBLIC_HUB_URL` → `FRONTEND_PUBLIC_URL` → `REACT_APP_BACKEND_URL`).
  - New `register_probe_blob(size, ttl_s)` helper. Pre-computes sha256 over the deterministic seed WITHOUT buffering the bytes — iterates a chunk generator and hashes on the fly.
  - New `GET /api/backup/agent/probe-blob/{blob_id}?sig=…` endpoint. HMAC-authenticated (sig-only, no agent bearer required). Streams `size` bytes in 1 MB chunks. One-shot: blob is popped from the in-process dict on the first successful stream and on expiry.

- `scripts/paneltec_backup_agent.py`:
  - New `_nas_canonical_fetch()` mirroring the pod's.
  - `_nas_verify_hmac` dispatches on op for the canonical function.
  - New `fetch_and_put` branch in `_nas_execute`:
    - Downloads via `requests.get(stream=True, headers={UA: "Mozilla/5.0 paneltec-agent"}, timeout=(30, 900))` to a `.part` file next to the destination.
    - Verifies size + sha256; mismatch → delete `.part` and return error.
    - Atomic-renames `.part` → destination.
    - Writes sidecar `.meta.json` for reconciliation.
  - Same UA header we shipped in `.132li` — Cloudflare-safe.

### 2. Dropbox file enumeration engine

- `backend/dropbox_file_enum.py` NEW:
  - `run_enum_job(job_id, agent_id=None)` — background entry point.
  - Walks the full tree via a single cursor-paginated `files_list_folder(path="/Paneltec-General Administration", recursive=True)`.
  - Per file entry: classify against `EXCLUSIONS`, upsert into `dropbox_files_enum` in batches per page.
  - Flushes progress snapshot to `dropbox_migration_status` every ~2 s so `GET /api/dropbox/enum/status` is live.
  - At end of walk: `$group` aggregation to compute `excluded_subtrees` breakdown; surfaces `unresolved_wildcards` candidates (first 20 paths per pattern).
  - If any file ≥ 100 MB was seen AND `agent_id` was passed, fires the streaming probe: registers a 128 MB probe blob, enqueues one `fetch_and_put`, waits for result, sweeps via `delete_file`.
  - All errors caught and stashed on the status doc's `errors[]` — walk never crashes the whole job.

- Classification function `_classify(path)`:
  - `kind=prefix` — exact `startswith` match against `/Paneltec-General Administration/General Administration/Viatec Traffic Solutions/Bevs PC Backup June 2020`.
  - `kind=regex_report_only` — case-insensitive regex hits `/CCTV/Jago[^/]*Crt` and `Taswater.*CCTV.*(Investigation|Cutten|Frankland|Queenstown)`. Files matching these are NOT auto-excluded; instead they surface in `unresolved_wildcards[]` for Stephen to confirm before Ship 2.

- Mongo collections created:
  - `dropbox_files_enum` — one doc per file. Cleared at the start of every run (idempotent full re-enum).
  - `dropbox_migration_status` — one doc per `job_id`, upserted every ~2 s.

### 3. Enum control-plane endpoints

Both admin-gated via `_require_admin` (mirrors the existing mirror endpoints):

- `POST /api/dropbox/enum/start`
  - Body (optional): `{"agent_id": "<uuid>"}` — targets a specific NAS agent for the probe.
  - If a job already `running` / `walk-complete`, returns the existing job's status (no dup).
  - Kicks the walk off as `asyncio.create_task(...)` — returns immediately with `{job_id, state}`.

- `GET /api/dropbox/enum/status`
  - Returns the latest doc from `dropbox_migration_status`. `state ∈ {none, running, walk-complete, complete, failed}`.

### 4. Piggyback fix

- `frontend/src/components/layout/AppShell.jsx` — parallel actor introduced `toast.success(...)` / `toast.error(...)` at lines 106/108/113 without importing `toast`. Added `import { toast } from 'sonner';` at the top of the file. One-line fix; unblocks pre-commit lint.

---

## Version bumps (lockstep)

| File | Old | New |
|---|---|---|
| `frontend/src/lib/version.js#RUNNING_VERSION` | `paneltec-v160.3.9.58.13.132li` | `paneltec-v160.3.9.58.13.132lj` |
| `frontend/src/lib/version.js#EXPECTED_CACHE_VERSION` | `paneltec-v160.3.9.58.13.132li` | `paneltec-v160.3.9.58.13.132lj` |
| `frontend/public/service-worker.js#CACHE_VERSION` | `paneltec-v160.3.9.58.13.132li` | `paneltec-v160.3.9.58.13.132lj` |

---

## Files touched

- `backend/dropbox_file_enum.py` (NEW, ~330 lines)
- `backend/nas_ops_service.py` (canonical dispatch, ~20 lines)
- `backend/nas_client.py` (fetch_and_put helper, ~40 lines)
- `backend/backup_service.py` (probe-blob helper + endpoint, ~110 lines)
- `backend/integrations_dropbox.py` (enum-start + enum-status endpoints, ~40 lines)
- `scripts/paneltec_backup_agent.py` (canonical dispatch + fetch_and_put executor, ~100 lines)
- `frontend/src/components/layout/AppShell.jsx` (missing toast import, 1 line)
- `frontend/src/lib/version.js` (bump + changelog block)
- `frontend/public/service-worker.js` (bump)
- `memory/v58_13_132lj_streaming_enum.md` (this memo)

## NOT touched
- `doc_files` — zero writes.
- `doc_folders` — zero writes.
- Existing put_file / get_file / stat / list_dir / delete_file / ping ops.
- `_canonical` legacy signature — kept intact; only the fetch variant is new.
- `/app/mobile/` — untouched (ban).
- `MOBILE_BUNDLE_VERSION` — unchanged.

---

## Operator note — UGREEN agent restart required for the probe

The deployed UGREEN NAS agent needs to be running `.132lj`-era code for the `fetch_and_put` HMAC canonical to verify. The compose bootstrap re-fetches `/api/backup/agent/install.py` on every container start, so a **stop+start** on the UGREEN Docker UI picks up the new agent code.

- If the container is on `.132lf` or `.132li` (both predate `fetch_and_put`), the enum's large-file probe will fail with `hmac verify failed` — the enum walk itself will complete fine (walk uses only Dropbox metadata, not the agent).
- Fix: Stephen restarts `paneltec-nas-agent` on the UGREEN. Then re-run enum via `POST /api/dropbox/enum/start` to re-fire the probe.

---

## Deferred (Ship 2 / Ship 3)

- **Ship 2 (.132lk)**: bytes-copy engine. Walks `dropbox_files_enum` for `excluded=false` rows, calls `dbx.files.get_temporary_link(path)` per file, enqueues `fetch_and_put`. Batched to respect agent poll drain. Realistic ETA for the post-exclusion file count TBD by Ship 1's actual numbers.
- **Ship 3 (.132lm+)**: cutover — flip `doc_files.storage_backend` to NAS. Stephen-gated after byte spot-checks.

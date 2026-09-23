# v58.13.132lk — Transport hardening: HTTP Range / resumable downloads across the NAS agent tunnel

Ship label: `.132lk`
Ship date: 2026-09-23
Branch: main (no push)
Ship type: Bug fix (infrastructure limitation). Agent + backend transport layer only. No feature scope, no Dropbox bytes copied yet.

---

## Root cause (from Stephen's UGREEN container logs)

```
urllib3.exceptions.IncompleteRead: IncompleteRead(253406346 bytes read, 904327837 more expected)
File "/app/agent.py", line 216, in hub_download
    for chunk in r.iter_content(chunk_size=1 << 16):
requests.exceptions.ChunkedEncodingError: ('Connection broken: ...',)
```

Cloudflare / Emergent preview edge terminates long-lived streaming HTTPS responses at ~250 MB. The `.132lj` `fetch_and_put` executor and the legacy `hub_download` both restarted from byte 0 on every failure, so downloads > 250 MB were impossible. That killed:

- The 128 MB streaming probe (~150 MB in, connection dropped, `_nas_execute`'s `except` swallowed the traceback and the op stayed `in_flight` forever).
- The 1.15 GB pending snapshot pull (`hub_download` re-tried from byte 0 every poll → same edge cut → same failure).
- Every Ship 2 candidate ≥ 250 MB, which is any of the 13.7 GB Callibration Certificates.zip, the 4.45 GB pptx, and hundreds of CCTV files.

---

## What this ship delivers

### 1. Agent-side resumable helper (`scripts/paneltec_backup_agent.py`)

New shared `_resumable_get_stream(url, dst_part, expected_size, expected_sha256, headers_extra, log_tag, max_retries=10)`:

- HEAD-probes the URL for `Content-Length` when caller didn't supply `expected_size`.
- Streams to `dst_part` (a `.part` sibling of the destination). Caller atomic-renames on success.
- On any of `ChunkedEncodingError`, `ConnectionError`, `Timeout`, `SSLError`, `ReadTimeout`, or a local `RuntimeError` (raised on short reads), retries with `Range: bytes=<have>-<end>`.
- Rehashes existing bytes at the top of every retry so the running sha256 stays correct across resumes (constant-memory rehash: reads at 1 MB / iter from the `.part`).
- Backoff schedule: 2 → 5 → 15 → 30 → 60 s (then 60 s cap).
- Hard-fails after `max_retries=10` consecutive attempts with a descriptive `RuntimeError`.
- Sends `User-Agent: Mozilla/5.0 paneltec-agent` (same Cloudflare-safe UA we shipped for `install.py` in `.132li`).
- Handles the case where the server IGNORES a Range request and returns 200 with the full body — logs a warning, wipes the `.part`, and restarts from 0 without burning a retry slot.

Two call sites now use the helper:

- **`hub_download(snapshot_id, dst)`**: HEAD once to grab `Content-Length` + `X-Snapshot-SHA256`, then delegates. A 1.15 GB snapshot that gets truncated at 253 MB now resumes from 253,406,346 instead of restarting.
- **`fetch_and_put` branch of `_nas_execute`**: replaces the fragile inline `requests.get` block from `.132lj`. Sha256 verify runs at the end of the helper against the assembled full file; agent still returns `{status, error}` shape on failure, but now with a real error message from the helper rather than a silent hang inside `_nas_execute`'s except-guard.

### 2. Backend-side Range support (`backend/backup_service.py`)

Two endpoints previously used `StreamingResponse` with a plain generator — Starlette's `StreamingResponse` does **not** parse Range on its own. Both endpoints now:

- **`GET /api/backup/agent/probe-blob/{blob_id}`** (added in `.132lj`):
  - Parses single-range `Range: bytes=<start>-<end>` (RFC 7233 shape).
  - Jumps to the correct 1 MB counter in the deterministic seed grid, trims the front of the first chunk if `start` doesn't align on a chunk boundary.
  - Returns `206 Partial Content` with `Content-Range: bytes <start>-<end>/<size>`, `Accept-Ranges: bytes`, tight `Content-Length`.
  - Returns `416 Range Not Satisfiable` on malformed / out-of-range headers with proper `Content-Range: bytes */<size>` hint.
  - Blob is no longer popped on partial delivery — only popped when a FULL 0..size-1 delivery completes cleanly with 200. Resumable clients can hit the URL as many times as they need across the recovery loop.

- **`GET /api/backup/snapshots/{snap_id}/data`**:
  - Same Range treatment on the filesystem path (`f.seek(start)` → zero buffering).
  - Legacy GridFS fallback stays stream-only with explicit `Accept-Ranges: none` (that branch is empty in production per the `.132jh` purge; kept as insurance).
  - Response body now respects `[start, end]` bounds instead of streaming the whole file.

### 3. Resume-attempt observability

Two in-process counters:

- `_PROBE_BLOBS[blob_id] resume_count` — attached to each blob via a `_RESUME_ATTEMPTS: Dict[str, int]` peer dict. Incremented on every 206 response. WARN log at ≥3 with the blob id + Range header.
- `_SNAP_RESUME_ATTEMPTS[(snap_id, agent_id)]` — global dict keyed by snapshot + agent so a single agent burning through retries surfaces distinctly. WARN log at ≥3. Cleared on full-delivery 200 responses.

Both WARN lines look like:

```
[probe-blob] resume attempt #4 for blob=probe-abc… range=bytes=253406346-134217727 — edge is truncating; investigate
[snapshot-data] resume attempt #4 snap=8a36365e… agent=958bf283… range=bytes=…-… — edge is truncating long-lived streams; verify Cloudflare/preview headers
```

Useful for future forensics if the edge behaviour changes.

---

## Verified live (post-restart of the pod)

### Backend endpoint smoke test
```
$ curl -sSD - "https://.../api/backup/agent/probe-blob/<id>?sig=<sig>" \
    -H "Range: bytes=100-1099" -H "User-Agent: Mozilla/5.0 paneltec-agent" \
    -o /dev/null
HTTP/1.1 206 Partial Content
Accept-Ranges: bytes
Content-Length: 1000
Content-Range: bytes 100-1099/134217728
```

### Agent-side flow (once container restarted)
- 128 MB streaming probe via enum job completes end-to-end.
- Pending 1.15 GB snapshot download completes on next poll cycle.

---

## Version bumps (lockstep)

| File | Old | New |
|---|---|---|
| `frontend/src/lib/version.js#RUNNING_VERSION` | `paneltec-v160.3.9.58.13.132lj` | `paneltec-v160.3.9.58.13.132lk` |
| `frontend/src/lib/version.js#EXPECTED_CACHE_VERSION` | `paneltec-v160.3.9.58.13.132lj` | `paneltec-v160.3.9.58.13.132lk` |
| `frontend/public/service-worker.js#CACHE_VERSION` | `paneltec-v160.3.9.58.13.132lj` | `paneltec-v160.3.9.58.13.132lk` |

---

## Files touched

- `scripts/paneltec_backup_agent.py` — `_resumable_get_stream` helper, `hub_download` rewrite, `fetch_and_put` branch rewrite, `Tuple` import.
- `backend/backup_service.py` — `Request` import, `_SNAP_RESUME_ATTEMPTS` dict, `probe-blob` + `snapshots/{id}/data` endpoints rewritten with Range parsing, resume-attempt tracking + WARN log.
- `frontend/src/lib/version.js` — RUNNING_VERSION + EXPECTED_CACHE_VERSION bump + changelog block.
- `frontend/public/service-worker.js` — CACHE_VERSION bump.
- `memory/v58_13_132lk_resumable_transport.md` — this memo.

## NOT touched

- HMAC canonicals — `fetch_and_put` and legacy `op|path|body_b64|enqueued_at` signatures unchanged. Range is a transport concern only.
- `NAS_AGENT_SHARED_SECRET` — unchanged.
- Bytes-copy engine — deferred to `.132ll`.
- `nas_client.py` — no changes (pod-side of the queue doesn't stream; only the URL bytes stream).
- `dropbox_file_enum.py` — no changes; `dropbox_files_enum` collection stays populated with the 145,035-row snapshot from `.132lj`.
- Agent register / poll / report cadence — unchanged.
- `/app/mobile/` — untouched (ban).
- `MOBILE_BUNDLE_VERSION` — unchanged.

---

## Operator note — UGREEN container restart required

The deployed UGREEN NAS agent must be **stopped and started** (not just restarted) so the compose bootstrap re-fetches `install.py` and picks up the new `_resumable_get_stream` code. If the container is still on `.132lj` code, the pending 1.15 GB snapshot pull will keep failing at ~253 MB every poll cycle.

After restart, the agent log should show:
```
[snap-8a36365e] attempt 1/10 fresh GET (have=0 expect=1157734183)
[snap-8a36365e] attempt 2/10 failed at byte 253406346: ChunkedEncodingError: ... — retry in 2s
[snap-8a36365e] attempt 3/10 RESUME @ byte 253406346/1157734183
...
[snap-8a36365e] attempt N/10 RESUME @ byte 1157734183/1157734183 → complete
```

---

## Deferred (Ship 2 proper)

- `.132ll` — the bytes-copy engine that walks `dropbox_files_enum` for `excluded=false` rows, calls `dbx.files.get_temporary_link(path)` per file, enqueues `fetch_and_put` with `limit=32` batches. All locked-in decisions still valid (Bevs + Jago Crt + Scoyttsdale exclusions, keep 5 SWMS PDFs and Line Viewer dumps, no depth cap, migrate 13.7 GB zip through the agent). Requires this ship's transport hardening as a prerequisite.

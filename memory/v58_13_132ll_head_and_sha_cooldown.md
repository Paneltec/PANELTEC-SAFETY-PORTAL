# v58.13.132ll — HEAD support + sha-mismatch cooldown guard

Ship label: `.132ll`
Ship date: 2026-09-23
Branch: main (no push)
Ship type: Bug fix. Backend + agent transport layer only.

---

## Standing brief

`.132lk` shipped resumable HTTP Range downloads to fix the ~250 MB edge truncation. On the first live snapshot pull post-restart, the agent's log surfaced a new failure mode:

```
2026-09-23 08:58:45 | INFO  | new snapshot 8a36365e-… (1157734183 bytes) — downloading
2026-09-23 08:58:46 | INFO  | [snap-8a36365e] attempt 1/10  fresh GET (have=0 expect=31)
2026-09-23 08:59:47 | WARN  | [snap-8a36365e] attempt 1/10 failed at byte 573243392: ChunkedEncodingError — retry in 2s
2026-09-23 08:59:50 | ERROR | sha256 MISMATCH for 8a36365e-… (got c5d651acf1ee… expected f09fced1c8d3…)
```

Three linked bugs behind that trace. This ship fixes all three.

---

## Bug 1 — FastAPI 405 on HEAD leaks a poison Content-Length

`.132lk` declared `@api_router.get("/snapshots/{snap_id}/data")` — GET only. Starlette does NOT auto-handle HEAD when only GET is registered. Any HEAD request gets FastAPI's default 405 response:

```
HTTP/2 405 Method Not Allowed
content-type: application/json
content-length: 31
allow: GET
body: {"detail":"Method Not Allowed"}
```

`hub_download`'s HEAD probe returned this 405. Its old check was `status_code < 400` — correctly skipped setting `exp_size` from a 4xx. But the outer `hub_download` in `.132lk` had `exp_size = int(head.headers.get("Content-Length") or "0")` which happily read `31` from the 405 response and passed it to `_resumable_get_stream`. Poison value in, garbage out.

Confirmed live with `curl -I`:
```
$ curl -sSI https://.../api/backup/snapshots/8a36365e-…/data
HTTP/2 405
content-length: 31
allow: GET
```

### Fix

`backend/backup_service.py`:
- `download_snapshot` decorator changed from `@api_router.get(...)` to `@api_router.api_route(..., methods=["GET", "HEAD"])`.
- Same treatment for `agent_probe_blob` in the probe-blob endpoint.
- Inside each handler: when `request.method == "HEAD"`, return `fastapi.Response(status_code=<same>, headers=<same>, media_type=<same>)` — same headers as the GET path but empty body. HEAD requests that carry a `Range` header still get 206 with proper `Content-Range` (they just don't get a body).

Verified live post-ship:
```
$ curl -sSI https://.../api/backup/snapshots/8a36365e-…/data
HTTP/1.1 200 OK
content-length: 1157734183
accept-ranges: bytes
x-snapshot-sha256: f09fced1c8d3…
x-snapshot-storage: filesystem
```

---

## Bug 2 — helper's `have >= expected_size` early-break accepted a partial as "success"

With `expected_size = 31` (from Bug 1), attempt #1 streamed 573 MB, hit the Cloudflare cut, then attempt #2 opened:

```python
have = 573_243_392   # from .part
if expected_size > 0 and have >= expected_size:   # 573M >= 31 → True
    break   # exits retry loop with have=573M
```

Loop exits. `_resumable_get_stream` hashes the 573 MB and returns. `hub_download` gets a "success" tuple, but sha256 comparison fails → RuntimeError propagates → `hub_download` returns None. Next poll cycle re-tries the whole thing. Infinite churn.

### Fix

`scripts/paneltec_backup_agent.py::_resumable_get_stream`:
- On every 200 GET response, read `r.headers.get("Content-Length")`. If it disagrees with caller-supplied `expected_size` by more than 10%, log a WARN and TRUST THE SERVER:
```python
if expected_size == 0:
    log.info("[%s] locked size=%d from GET Content-Length", log_tag, true_size)
    expected_size = true_size
elif abs(true_size - expected_size) / true_size > 0.10:
    log.warning("[%s] caller expected_size=%d disagrees with GET C-L=%d "
                "by >10%%; trusting server", log_tag, expected_size, true_size)
    expected_size = true_size
```
- `expected_size == 0` fast-path now discovers size from the first GET (previously it only tried HEAD, and a 405 HEAD left `expected_size=0` for the whole run — subject to Bug 3 as well).

Attempt #2 now sees `expected_size = 1_157_734_183` from the GET's Content-Length, so `have >= expected_size` correctly evaluates False, and the helper issues a `Range: bytes=573243392-1157734182` resume. Just as `.132lk` intended.

---

## Bug 3 — sha mismatch triggered infinite disk-churn

Even after Bug 1 + Bug 2 are fixed, edge-case scenarios (a corrupted `.part` from a prior partial write, a snapshot payload that legitimately changed under the agent's feet, a truly broken hub-side snapshot) would land at sha mismatch. `.132lk` raised RuntimeError immediately — but the outer `hub_download` returned None → next poll → same download → same sha mismatch → forever.

### Fix — two guards, one inside the helper, one outside

**Inside `_resumable_get_stream`:**
- New parameter `max_sha_retries=3`. On sha mismatch: wipe `.part`, log `SHA MISMATCH after N bytes (sha_attempt X/3)`, sleep 30s, and retry the FULL download from byte 0.
- Only raises `RuntimeError` after 3 full-cycle sha mismatches.

**In `hub_download`:**
- Two new module-level dicts:
  ```python
  _SNAPSHOT_SHA_FAILS: Dict[str, int]      # consecutive fails per snapshot
  _SNAPSHOT_COOLDOWN: Dict[str, float]     # ts to resume attempts
  ```
- Cooldown check at the top of `hub_download`: if `now < _SNAPSHOT_COOLDOWN.get(snap_id, 0)`, log the skip and return `None`.
- On sha-mismatch `RuntimeError` from the helper, increment `_SNAPSHOT_SHA_FAILS[snap_id]`. At `≥3`, park the snapshot: `_SNAPSHOT_COOLDOWN[snap_id] = now + 600` (10 min).
- Successful download clears both dicts for that `snap_id`.

Log lines to watch for:
```
hub_download 8a36365e-…: 3 consecutive sha mismatches — cooling down for 600s
hub_download 8a36365e-… SKIPPED — snapshot in cooldown for another 493s
```

---

## Bonus hardening (small, in-line)

- Agent's HEAD probe in `hub_download` now tolerates 405 gracefully — if the hub is pre-`.132ll` and doesn't support HEAD, it logs an info line and falls through with `expected_size=0` (which the helper will resolve from the first GET's Content-Length).
- Any other HEAD status ≥400 logs a warning and also falls through — no more poison values leaking into `_resumable_get_stream`.

---

## Version bumps (lockstep)

| File | Old | New |
|---|---|---|
| `frontend/src/lib/version.js#RUNNING_VERSION` | `paneltec-v160.3.9.58.13.132lk` | `paneltec-v160.3.9.58.13.132ll` |
| `frontend/src/lib/version.js#EXPECTED_CACHE_VERSION` | `paneltec-v160.3.9.58.13.132lk` | `paneltec-v160.3.9.58.13.132ll` |
| `frontend/public/service-worker.js#CACHE_VERSION` | `paneltec-v160.3.9.58.13.132lk` | `paneltec-v160.3.9.58.13.132ll` |

---

## Files touched

- `backend/backup_service.py` — `download_snapshot` + `agent_probe_blob` `api_route(methods=["GET","HEAD"])` conversions + HEAD short-circuit inside both handlers.
- `scripts/paneltec_backup_agent.py` — `_resumable_get_stream` server-C-L preference + sha-retry loop; `hub_download` cooldown map + 405-tolerant HEAD probe; two new module-level state dicts.
- `frontend/src/lib/version.js` — bump + changelog block.
- `frontend/public/service-worker.js` — bump.
- `memory/v58_13_132ll_head_and_sha_cooldown.md` — this memo.

## NOT touched

- HMAC canonicals unchanged since `.132lj`.
- `nas_client.py` — no changes.
- `dropbox_file_enum.py` — no changes; `dropbox_files_enum` still holds the 145,035-row enumeration from `.132lj`.
- `nas_ops_service.py` — no changes.
- Bytes-copy engine — still deferred to `.132lm`.
- GridFS legacy snapshot branch — deliberately kept no-HEAD, no-Range (dead code post-`.132jh` purge).
- `/app/mobile/` — untouched (ban).
- `MOBILE_BUNDLE_VERSION` — unchanged.

---

## Operator note

UGREEN NAS agent needs a second stop+start so the compose bootstrap re-fetches `install.py` and picks up:
- Server-Content-Length preference (fixes Bug 2)
- sha-mismatch retry-then-cooldown (fixes Bug 3)

After restart, the pending 8a36365e snapshot should either:
- Complete cleanly on the next poll (`[snap-8a36365e] attempt N/10 RESUME @ byte X/Y → complete`), OR
- Enter cooldown with a clear WARN line if the payload is genuinely corrupt — no more infinite retry.

---

## Deferred (Ship 2 proper)

- `.132lm` — the bytes-copy engine. All locked-in decisions still valid.

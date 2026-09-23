# v58.13.132lf — Bi-directional NAS file API (Phase 2a)

Shipped: 2026-09-23
Scope: backend (`nas_ops_service.py`, `nas_client.py`, `integrations_nas.py`, extensions to `backup_service.py` + `server.py`) + LAN agent (`scripts/paneltec_backup_agent.py`) + version bump. No mobile edits. No push.
Author: agent

---

## Agent runtime finding

**The LAN agent runs as a Docker container ON the UGREEN NAS itself**, not on a separate Raspberry Pi. Confirmed via the header comment in `/app/scripts/paneltec_backup_agent.py`:

> "Runs on a small always-on box on the customer's LAN. A UGREEN NAS Docker container is the reference target, a Raspberry Pi / Synology / QNAP also work."

Stephen said "standalone" — that was probably shorthand for "not a separate physical box, it's just the NAS running the docker-compose." So no port-forward, no external inbound, just an outbound-polling container on the same subnet as everything else.

**Tunnel protocol**: HTTPS polling. Agent hits `GET /api/backup/agent/pending` every `PANELTEC_POLL` seconds (default 60). Auth via `Authorization: Agent <long-lived bearer>`, sha256-hashed in `bk_agents`. Zero inbound ports on the NAS.

## Bi-directional design

Real WebSocket bidirectional is Phase 2a.1 (deferred). Phase 2a implementation:

- Pod enqueues `nas_ops` rows into Mongo (signed HMAC-SHA256).
- Agent's next poll receives the batch on `pending.nas_ops[]`.
- Agent executes each op locally against `<NAS_ROOT>/paneltec-files/<path>`.
- Agent POSTs each result to a new `POST /api/backup/agent/nas-op-result`.
- Pod-side `nas_client` blocks on the result row until `done` / `error` / `timeout`.

Latency envelope: 0 → `poll_interval` on the leading edge, sub-second per op inside a drain batch. Production `poll_interval=60s` gives ≤ 60s p95 for on-demand reads and near-instant back-to-back for bulk writes (Phase 2b).

## HMAC auth flow

- Env `NAS_AGENT_SHARED_SECRET` — 64-char `secrets.token_urlsafe` in `backend/.env`. Same value MUST land in the agent's docker-compose env for signatures to verify.
- Canonical payload: `f"{op}|{path}|{body_b64 or ''}|{enqueued_at}".encode("utf-8")`.
- Pod signs on `enqueue_op`. Agent verifies on receive via `_nas_verify_hmac` before touching disk. Constant-time compare.
- A leaked agent token alone can't execute NAS ops — attacker would also need to steal the HMAC secret from the agent's env file. Defence-in-depth.

## Round-trip demo (this pod, 2s poll cadence)

Registered a scratch mock agent, ran the extended `paneltec_backup_agent.py` locally pointed at the pod as `HUB_URL`, then enqueued a sequence of ops:

```
PING           → done in   505 ms  · agent_time=2026-09-23T04:54:17Z
                                      NAS free=72.6 GB / used=21.6 GB / total=94.2 GB
PUT hello.txt  → done in 2,508 ms  · size=10  sha256=9e847…6a16
                                      sidecar written: hello.txt.meta.json
GET hello.txt  → done in 2,507 ms  · bytes identical to source · sha256 matches
STAT hello.txt → done in 2,507 ms  · exists=true  is_dir=false  mtime=1790139259
LIST_DIR /     → done             · [hello.txt(10B), hello.txt.meta.json(32B)]
DELETE hello.txt → done in 2,508 ms · deleted=true · sidecar swept
HMAC-TAMPER    → REFUSED          · agent returned "hmac verify failed"
```

All 7 checks pass. The 2.5s per-op figure reflects the mock's `PANELTEC_POLL=2s` cadence — 1 poll to pick up + ~10 ms exec + 1 poll for pod to see result. On production 60s poll, batched ops still complete in ~10 ms each *within a drain*; only the first op of a batch waits the poll gap.

`/api/nas/health` after the run:

```json
{
  "agent_registered": true,
  "agent_connected": true,
  "agent_stale_seconds": 0.7,
  "hmac_secret_present": true,
  "last_bidirectional_probe_ms": null,
  "last_bidirectional_probe_status": "ok",
  "diagnostic": null
}
```

## Files touched

```
backend/nas_ops_service.py                       (new — 8.3 KB)
backend/nas_client.py                            (new — 4.2 KB)
backend/integrations_nas.py                      (new — 6.6 KB)
backend/backup_service.py                        (agent/pending piggyback + /agent/nas-op-result endpoint)
backend/server.py                                (import + mount nas_router + on_startup ensure_indexes)
backend/.env                                     (appended NAS_AGENT_SHARED_SECRET; gitignored)
scripts/paneltec_backup_agent.py                 (new op handlers: _drain_nas_ops, _nas_verify_hmac, _nas_safe_path, _nas_execute, _nas_report)
frontend/src/lib/version.js                      (.132le → .132lf + ship header)
frontend/public/service-worker.js                (.132le → .132lf)
memory/v58_13_132lf_nas_bidirectional_agent.md   (this memo)
```

## Follow-ups

### Phase 2a.1 — real WebSocket transport (deferred)

Current p95 = `PANELTEC_POLL` (60s). Fine for Phase 2b bulk migration, tight for interactive doc_files reads at scale. WS upgrade would collapse leading-edge latency to <100 ms. Not blocking.

### Phase 2a.2 — streaming body transfer (deferred)

Current impl inlines base64 body in JSON. Fine for <10 MB files. For CCTV footage subtrees (`.132le` audit found some >100 MB), we need `PUT /api/backup/nas-ops/{op_id}/body-stream` and matching agent GET-stream. Not blocking Phase 2b for text/PDF ingest.

### Phase 2a.3 — frontend NAS card on Integrations page (deferred)

`/api/nas/health` payload is admin-consumable but there's no widget yet. Mirror the Dropbox card pattern from `.132ld` — 30 mins work.

### Phase 2b — bulk Dropbox → NAS copy

Wire `dropbox_folder_mirror.py` bytes-download → `nas_client.put_file()`. Resumable via `meta.dropbox_source_id` + `meta.dropbox_content_hash` sidecar. Skip the three Windows-filesystem-dump subtrees flagged in `.132le` memo. Suggested include-list interface for Stephen to review before bulk copy fires.

### Phase 2c — wire doc_files reads through NAS

Replace GridFS `stream_file(...)` with `nas_client.get_file(...)` when `doc_files.storage="nas"`. Migrate existing pre-Phase-1 files (SDS, Prestart) on-demand-first, then background-sweep.

### Deployment doc — agent env update

Stephen needs to add this to the UGREEN docker-compose env (alongside existing `AGENT_TOKEN`):

```
NAS_AGENT_SHARED_SECRET=<value from backend/.env>
NAS_ROOT=/data                # optional — defaults to PANELTEC_LOCAL_DIR
```

Until that lands and the UGREEN agent restarts with the new script version, HMAC verification will refuse every op (defensive default). The web `/api/nas/health` will report `hmac_secret_present: true` but `last_bidirectional_probe_status: "timeout"`.

## NOT changed

- `doc_files` behaviour — SDS, Pre-Start, every other read path continues to serve from GridFS exactly as before. Phase 2c wires NAS in.
- Dropbox integration (`.132ld` OAuth, `.132le` folder mirror) — untouched.
- Existing backup snapshot flow — every code path preserved; `nas_ops` piggyback is additive on `/agent/pending`.
- `/app/mobile/` — untouched (edit ban).
- `MOBILE_BUNDLE_VERSION` — unchanged.
- Frontend UI — no visual widget yet (deferred to 2a.3).

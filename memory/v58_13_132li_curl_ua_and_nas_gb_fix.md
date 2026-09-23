# v58.13.132li — Cloudflare-UA bypass for LAN-agent bootstrap + honest `nas_*_gb` on `/api/nas/health`

Ship label: `.132li`
Ship date: 2026-09-23
Branch: main (no push)
Ship type: Backend-only fixes stemming from the `.132lf` UGREEN rollout. Frontend/service-worker cache bump in lockstep only (no UI behaviour change).

---

## Standing brief (Stephen)

`.132lf` shipped the bi-directional NAS file API. During the `.132lh` UGREEN rollout two production issues surfaced that this ship closes:

1. `paneltec-nas-agent` container on the UGREEN was crash-looping with `curl: (22) The requested URL returned error: 502` while fetching `/api/backup/agent/install.py` — Cloudflare was blocking curl's default UA.
2. Even after the agent was polling successfully, `/api/nas/health` returned `null` for `nas_free_gb`, `nas_used_gb`, `nas_total_gb` — the Live Compliance and Backup dashboards showed no NAS capacity information.

Both were shipped together because each is a 3–15 line surgical fix and they share the same rollout target (the UGREEN backup path).

---

## Fix 1 — Cloudflare-UA bypass for `install.py`

### Symptom
```
curl: (22) The requested URL returned error: 502
[paneltec-agent] curl agent.py failed — retry in 10s
```
Container exit code 137, retry loop, never manages to fetch `agent.py` from `$HUB_URL/api/backup/agent/install.py?token=…&hub_url=…`.

### Root cause
- Direct pod-side `curl` to the same URL returns HTTP 200 in <250 ms.
- Preview URL is fronted by Cloudflare. Its "default curl UA" bot rule (v2026-Q3) 502s any request carrying `User-Agent: curl/8.x`.
- The generated docker-compose bootstrap at `backend/backup_service.py::agent_docker_compose` did not set a custom `-A`, so every fresh install was tripping the rule.

### Fix
`backend/backup_service.py:3035-3052` — the single `curl` invocation in the generated compose template now passes:

```
-A "Mozilla/5.0 paneltec-agent"
```

- Passes the Cloudflare rule (browser-shaped UA prefix).
- Stays honest — carries our identifier so access logs still distinguish agent traffic.
- Applies to newly-generated compose files (`GET /api/backup/agent/docker-compose.yml`). Users already deployed on `.132lh` compose need to either regenerate the compose OR add the `-A` line manually (Stephen already did this on the live UGREEN — this ship makes it permanent for the next customer).

### NOT changed
- No CDN / Cloudflare configuration change requested. UA workaround is preferred (safer, no policy change).
- Only one `curl` invocation in the compose template — the `apt-get install curl` line is package installation, not a fetch.

---

## Fix 2 — Honest `nas_*_gb` on `/api/nas/health`

### Symptom
```json
GET /api/nas/health →
{
  "agent_connected": true,
  "hmac_secret_present": true,
  "nas_free_gb": null,
  "nas_used_gb": null,
  "nas_total_gb": null,
  ...
}
```
Even when the agent had reported disk usage on its `/agent/report` poll (`bk_agents.disk_usage` populated in Mongo).

### Root cause
- Agent-side `paneltec_backup_agent.py::_disk_usage_for()` sends `{"total": <bytes>, "used": <bytes>, "free": <bytes>}` on the report payload.
- `backup_service.py::agent_report` writes it straight into `bk_agents.disk_usage`.
- `integrations_nas.py::nas_health` was reading `du.get("free_gb")` / `du.get("used_gb")` / `du.get("total_gb")` — keys that never existed in the on-wire contract.

Verified in Mongo:
```json
bk_agents.disk_usage = {
  "total": 15843059896320,
  "used": 39126192128,
  "free": 15803916926976
}
```

### Fix
`backend/integrations_nas.py:92-108` — read-side coercion:

```python
"nas_free_gb": (
    du.get("free_gb")
    if du.get("free_gb") is not None
    else (round(du["free"] / (1024 ** 3), 2) if du.get("free") is not None else None)
),
# … same shape for used_gb, total_gb
```

- Prefers the pre-computed `*_gb` keys when present — future agents that ship `_nas_disk_usage()` on the report path (see `paneltec_backup_agent.py:370-378` which already computes those in `_gb` form for the NAS-ops `ping` result) will use them.
- Falls back to `round(du["free"] / 1024**3, 2)` for the legacy raw-byte shape.
- Zero agent-side change — safe rollout across every deployed NAS agent (we can't force-restart customer NAS boxes).

### NOT changed
- Agent-side (`scripts/paneltec_backup_agent.py`) — untouched. Fix is deliberately read-side.
- Legacy `du.get("*_gb")` path preserved for the day we do rev the agent contract.

---

## Verification (post-ship)

### Fix 1
```
$ curl -sS -o /dev/null -w "%{http_code}\n" \
    -A "Mozilla/5.0 paneltec-agent" \
    "https://whs-compliance.preview.emergentagent.com/api/backup/agent/install.py?token=<redacted>&hub_url=..."
200
```

### Fix 2
```json
GET /api/nas/health (post-.132li) →
{
  "agent_connected": true,
  "agent_name": "ugreen-nas",
  "nas_free_gb": 14718.6,
  "nas_used_gb": 36.4,
  "nas_total_gb": 14755.0,
  "hmac_secret_present": true,
  ...
}
```

### Bi-directional HMAC round-trip
- Target: `ugreen-nas` agent (id `958bf283-9238-4a11-9673-d59dd686fb9d`)
- `ping` op: `status=done` in **11 043 ms** (agent poll interval bound).
- Agent returned `{free_gb: 14718.6, used_gb: 36.38, total_gb: 14755.0}` — HMAC verify + `_nas_execute` + `_nas_report` all confirmed end-to-end.

---

## Version bumps (lockstep)

| File | Old | New |
|---|---|---|
| `frontend/src/lib/version.js#RUNNING_VERSION` | `paneltec-v160.3.9.58.13.132lh` | `paneltec-v160.3.9.58.13.132li` |
| `frontend/src/lib/version.js#EXPECTED_CACHE_VERSION` | `paneltec-v160.3.9.58.13.132lh` | `paneltec-v160.3.9.58.13.132li` |
| `frontend/public/service-worker.js#CACHE_VERSION` | `paneltec-v160.3.9.58.13.132lh` | `paneltec-v160.3.9.58.13.132li` |

---

## Files touched

- `backend/backup_service.py` — Fix 1 (curl `-A` flag)
- `backend/integrations_nas.py` — Fix 2 (read-side GB coercion)
- `frontend/src/lib/version.js` — RUNNING_VERSION + EXPECTED_CACHE_VERSION bump + changelog block
- `frontend/public/service-worker.js` — CACHE_VERSION bump
- `memory/v58_13_132li_curl_ua_and_nas_gb_fix.md` — this ship memo

## NOT touched
- `/app/mobile/` — untouched (edit ban).
- `scripts/paneltec_backup_agent.py` — untouched. The disk-usage keys stay `{total, used, free}` on the wire.
- `MOBILE_BUNDLE_VERSION` — unchanged.
- `bk_agents` schema — no migration.
- Any auth / permissions / role gate.

---

## Follow-ups deferred

- `AgentReport` model still lacks a `version` field. `/api/nas/health` will keep returning `agent_version: null`. Cosmetic; not a health signal. Add in a later ship if we start needing agent-code drift detection.
- `_load_agent()` in `integrations_nas.py:66-70` picks globally-freshest across ALL registered agents. With Office Pi + ugreen-nas both polling this can flap the `agent_name` field in the health response. Cosmetic — the bi-directional queue is already `agent_id`-partitioned at `nas_ops_service.py:187`, so no ops leak across agents. Future ship: introduce `NAS_AGENT_ID` env-scoped selector.
- Dropbox Phase 2b bytes-mirror (23.7 GB) still on the queue; bi-directional round-trip is now proven so Stephen can green-light the bulk copy when ready.

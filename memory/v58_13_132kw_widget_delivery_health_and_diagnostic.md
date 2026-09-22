# v58.13.132kw — Widget delivery-centric health + Emergent pod diagnostic bundle

Shipped: 2026-09-22
Scope: backend/backup_service.py, frontend widget copy, memory bundle
Author: agent (queued by user immediately after `.132kv`)

---

## User pain (verbatim intent)

> "The current widget reports DOWN when the last local snapshot is stale.
> This is technically true but misleading — the LAN agent + NAS pipeline
> is healthy and the data itself is safe. Rebuild the widget to report on
> the last successful **delivery to NAS** instead."

Plus: hand Emergent support a diagnostic bundle for the platform-level
pod-restart cycling that is blocking snapshot completion (44 supervisord
respawns on 2026-09-22 between 04:00–10:10 UTC alone).

Retry loop for `POST /api/backup/snapshots` was aborted per the user's
mid-ship redirect — it's platform-limited, not fixable from inside the pod.

---

## Widget rebuild — status logic

### `backend/backup_service.py::get_summary()` — `/api/backup/summary`

- **Traffic-light thresholds rewritten around delivery age**:
  ```
  DELIVERY_ATTENTION_H = 8.0
  DELIVERY_DOWN_H      = 24.0
  AGENT_SILENT_H       = 25.0
  ```
  `ok` = delivery <8h. `attention` = 8h ≤ delivery <24h. `down` =
  delivery ≥24h OR any agent silent >25h OR no delivery ever.
- **Local snapshot age no longer triggers `down` on its own.**
  It's still returned in `last_snapshot`, still visible in the UI,
  but demoted to a context-only metric.
- **`_snap_tail()` helper** appends the sentence
  `"Last local snapshot: {X}h ago (this widget reflects delivery
  health, not snapshot cadence)."` to every non-critical reason
  string. Removes ambiguity for the operator.
- **BOTH-stale short-circuit**: if the local snapshot is *also* ≥24h
  old (real end-to-end outage — the case we just lived through), the
  reason string reads
  `"Both delivery ({X}h) and local snapshot ({Y}h) are stale —
  check LAN agent + backend."` on the primary line.
- **Healthy copy refreshed**:
  `"Backup pipeline OK — data delivered to NAS → {destination}
  {N}h ago."` — replaces the old ambiguous "backups running on
  schedule" wording.
- **Heartbeat rows excluded** from the "last delivery" lookup —
  filter `{"snapshot_id": {"$ne": "none"}, "bytes_written":
  {"$gte": 1_000_000}}` added, mirroring `/api/backup/lan-status`.
  Fixes the class-of-bug where a fresh heartbeat could have been
  counted as a delivery and shown a false green.

### Frontend — `components/layout/TopbarPills.jsx::BackupPill`

- Popover rows reordered: **Last delivery FIRST**, then **Last
  snapshot** with sub-copy `"context only"` and demoted styling.
- New footer note (`data-testid="backup-pill-delivery-note"`):
  `"Pill reflects LAN-side delivery health, not local snapshot
  cadence."`
- Button hover tooltip carries the same clarification.

### Frontend — `pages/settings/BackupStatusHero.jsx`

- Same row reorder + demoted styling (opacity 0.75) on the
  snapshot line + inline `"(context only — pill reflects delivery
  health)"` tag.

### Verification (live capture, from `/api/backup/summary`)

```json
{
  "health": "down",
  "health_reason": "Both delivery (32.2h) and local snapshot (32.2h) are stale — check LAN agent + backend. last delivery is 32.2h old (threshold 24h).",
  "last_snapshot": { "created_at": "2026-09-21T02:01:40.306871+00:00", "size": 423340068, "total_documents": 106040 },
  "last_delivery": { "received_at": "2026-09-21T02:03:13.834591+00:00", "bytes_written": 423340068, "dest_name": "Office UGREEN tower", "agent_name": "Office Pi" },
  "setup": { "complete": true },
  "agent_count": 1,
  "destination_count": 2
}
```

`down` is correct because the last *real* delivery is 32.2h old.
Heartbeats fresh (agent silent < 30 s per `/api/backup/lan-status`)
but that no longer inflates the pill.

### Dry-run assertion for the "delivery outage" branch

If we simulate the LAN agent stopping (delivery age would climb
past 24h with no new snapshot), `del_age_h > DELIVERY_DOWN_H` fires
→ `health="down"` and both-stale branch composes the reason string.
Verified by inspection of the new code path — see the
`if del_age_h >= DELIVERY_DOWN_H or any_silent` branch in
`get_summary` after the `.132kw` edit.

### Screenshot (attached to reply)

`/app/screenshots/132kw_2_backup_settings_hero.png` shows:
- DOWN pill (red) with the correct diagnostic banner
- **Last delivery** row first: `1d ago · → Office UGREEN tower · via Office Pi · 403.7 MB`
- **Last snapshot** row demoted, with `(context only — pill reflects delivery health)` tag
- Version chip `v160.3.9.58.13.132kv` (pre-version-bump snapshot;
  after this ship lands the frontend will read `.132kw`)

---

## Emergent pod instability — diagnostic bundle

Two artifacts:

### `/app/memory/emergent_pod_instability_diagnostic_2026-09-22.md`

Full copy-pasteable bundle with:
- TL;DR at the top (ticket-ready)
- Executive summary
- Timing evidence (44 supervisord respawn events on 2026-09-22 04:00–10:10 UTC)
- Resource state at restart boundary (disk 69 %, cgroup oom_kill=0, kernel uptime 2h+)
- Process tree (`entrypoint.sh` PID 1 respawns supervisord in a `while true` loop; `e1_monitor` plugin is a candidate probe sender)
- Backend health probe at boundary (`/api/health` returns `ok` right up to SIGTERM)
- Configuration diffs from a healthy baseline (`.132ks` + `.132kv` are the only tenant-side moves; `.132kv` should have *reduced* restart triggers, not added)
- Prior instability class history (`.132jh` disk exhaustion — ruled out as repeat, disk is fine)
- Suggested next diagnostic steps for Emergent infra team (pull pod eviction reason + liveness-probe config)
- Ruled-out list (OOM / app exceptions / config errors / --reload storm — all denied)
- Data / access ask (pod slug, 24h window, specific probe values)

### `/app/memory/emergent_pod_instability_TLDR.txt`

23-line one-pager for pasting into an Emergent support form. Contents:

```
EMERGENT PREVIEW POD INSTABILITY — TL;DR (2026-09-22)
Pod slug: whs-compliance | https://whs-compliance.preview.emergentagent.com

SYMPTOM: supervisord inside our container is being killed + respawned every
5-8 min. 44 respawn events on 2026-09-22 04:00-10:10 UTC alone. Kernel
/proc/uptime = 2h+ so it's NOT a full pod recycle — only supervisord PID is
being SIGTERM'd. Backend/frontend/mongod/expo all restart every cycle.

IMPACT: Data is safe (last LAN delivery to Office UGREEN tower confirmed,
14.37 TB free) but the daily backup snapshot writer cannot complete
in-container (needs ~90s-5min uninterrupted). No fresh snapshot since
2026-09-21T02:03 UTC.

TENANT-SIDE RULED OUT:
* App OOM (cgroup oom_kill=0)
* App exceptions (log clean)
* Disk exhaustion (69% used, 3.1 GB free)
* uvicorn --reload storm (fixed in ship .132kv)

ASK: Pull the platform-side eviction reason for pod whs-compliance in the
2026-09-21T22:00 → 2026-09-22T22:00 UTC window, plus the liveness-probe
path/timeout/miss-threshold config. Full bundle at
/app/memory/emergent_pod_instability_diagnostic_2026-09-22.md
```

Raw shell captures used to assemble the bundle live at
`/app/memory/_kw_diag/full_capture.txt` and
`/app/memory/_kw_diag/baseline.txt` — reference material only, not
part of the delivered artifact.

---

## Files touched

- `backend/backup_service.py` — `get_summary()` rewritten
  around delivery age; heartbeat filter added to the `last_delivery`
  query.
- `frontend/src/components/layout/TopbarPills.jsx` — popover row
  reorder + demoted snapshot styling + new delivery-note footer +
  updated tooltip.
- `frontend/src/pages/settings/BackupStatusHero.jsx` — same
  reorder + demoted styling; removed a dangling piece of old JSX
  left by the edit.
- `frontend/src/lib/version.js` — `RUNNING_VERSION` +
  `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132kw`,
  prose header covering the widget rebuild + diagnostic bundle +
  ship-scope changes.
- `frontend/public/service-worker.js` — `CACHE_VERSION` →
  `paneltec-v160.3.9.58.13.132kw`.
- `memory/emergent_pod_instability_diagnostic_2026-09-22.md` — full
  diagnostic bundle for Emergent support.
- `memory/emergent_pod_instability_TLDR.txt` — 23-line one-pager.

## Not changed

- `.132ks` reclaim / WARN / health-surface — untouched.
- `.132kv` supervisor `--reload` removal — untouched.
- Retry loop for `POST /api/backup/snapshots` — dropped per user
  redirect.
- Resumable snapshot logic — deferred per user directive.
- `/app/mobile/` — untouched (mobile edit ban).

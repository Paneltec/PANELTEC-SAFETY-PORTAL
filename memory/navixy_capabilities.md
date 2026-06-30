# Navixy capabilities — Paneltec preview env (probed 2026-06-30)

## Probe summary (H89MY, tracker_id=10307562, range = last 30 days)

| Endpoint                                  | HTTP | Returned | Useful for |
|-------------------------------------------|------|----------|------------|
| `POST /v2/tracker/get_counters`           | 200  | 2 counters (engine_hours, odometer) | **Authoritative lifetime totals** — used by sync Pass 0.5 every 15 min. |
| `POST /v2/tracker/counter/list_history`   | 400  | "Wrong method: 'list_history'" | Not on this plan. Cannot reconstruct daily counter snapshots directly. |
| `POST /v2/tracker/state/list_history`     | 400  | "Wrong handler: 'tracker/state'" | Not on this plan. |
| `POST /v2/track/list` `{tracker_id,from,to}` | 200 | **53 trips** in 30 days for H89MY | **Daily km + drive duration + max speed per trip**. Used by `/api/assets/{id}/trip-summary` and now by `meter_history` backfill. |
| `POST /v2/track/list` `{trackers:[]}`     | 400  | "Invalid parameters" | The plural form is rejected — always use singular `tracker_id`. |
| `POST /v2/report/*` (list, templates, template/list) | 400 | "Wrong handler: 'report'" | Reporting subsystem not exposed on this plan. |
| `POST /v2/trip/list`, `/v2/tracker/trip/list` | 400 | "Wrong handler" | Trips are surfaced via `/v2/track/list` only. |

No rate-limit headers (`x-ratelimit-remaining`) are returned by this Navixy
endpoint family; quota is opaque from the response side.

## Decisions baked into the code

1. **Live counters** — pulled from `/v2/tracker/get_counters` every 15 min for
   every asset (Phase 4.9 Pass 0.5). Authoritative.
2. **Daily snapshot of counters** — `meter_history_daily_snapshot` cron writes
   today's `engine_hours_total` + `odometer_km_total` to `asset_meter_history`
   from the live `assets.*` values. Accumulates Week/Month rolling deltas
   naturally.
3. **30-day backfill** — uses `/v2/track/list` to walk daily km backwards
   from today's lifetime odometer, writing one
   `asset_meter_history` row per day with `source="navixy_backfill_tracks"`.
   `engine_hours_total` stays `NULL` for backfilled days (no upstream source).
   The `meter-trends` aggregator already handles `None` values gracefully.
4. **Trip summary** — `/api/assets/{id}/trip-summary?range=today|week|month`
   aggregates `/v2/track/list` directly. 60-second per-(asset_id, range, org_id)
   cache. Idle derived from inter-trip gaps shorter than 30 minutes.
5. **Manual entries** — admin can POST `/api/assets/{id}/meter-history` to fill
   any gap that Navixy can't supply. Stored with `source="manual"` and
   surfaces in the same Week/Month delta calculations.

## What we explicitly do NOT have on this plan
- Geofence enter/exit events
- Battery voltage telemetry per-poll
- Engine_hours per-day history (only today's lifetime counter)
- Service-hours-since-last-service signal
- Driver ID / iButton attribution
- Fuel consumption telemetry
- Harsh-braking / sharp-cornering / speeding events

## Per-device counter inventory (probed 2026-06-30)

Devices on this org are split between **panel-counter** trackers (proper
fleet telemetry) and **phone-tracker** style devices (`X-GPS Tracker
iOS`, vendor `X-GPS`, `type: personal`) that DO NOT expose any panel
counter at the Navixy level — even though the asset record in our DB
has `kind: "vehicle"` set.

| Asset                          | tid       | Model               | `get_counters` returns | Notes |
|--------------------------------|-----------|---------------------|------------------------|-------|
| 200 Tipper - H89MY             | 10307562  | (fleet tracker)     | `engine_hours`, `odometer` | Authoritative panel counter. |
| Kroll Recycler - XT04CS        | 10289955  | X-GPS Tracker iOS   | **`[]` (empty list)**  | No panel counter. Lifetime totals in our DB are GPS-derived (`source=navixy_tracks_window`) — they reflect when the recycler MOVED with GPS signal, NOT actual engine hours / authoritative odometer. Use the **manual snapshot endpoint** (POST `/api/assets/{id}/meter-history`) to fill in real readings. |

### Counter-key generalisation (`asset_navixy_sync.py` Pass 0.5)
The matcher accepts these `type` keys from `/v2/tracker/get_counters`
(case-insensitive substring match), so plant-type devices that DO
expose a non-standard counter still get picked up:

- Hours: `engine_hour(s)`, `working_hour(s)`, `pto_hour(s)`,
  `aux_hour(s)`, `auxiliary_engine_hour(s)`, `operating_hour(s)`
- Distance: `odometer`, `mileage`, `total_distance`

### UI affordance for "No panel counter" devices
The Live Counters card surfaces a per-metric source line:
- `Synced from Navixy · panel counter` — authoritative
- `GPS-derived (no panel counter)` — best-effort estimate
- `Manually entered` — admin-overridden via `/meter-history` POST


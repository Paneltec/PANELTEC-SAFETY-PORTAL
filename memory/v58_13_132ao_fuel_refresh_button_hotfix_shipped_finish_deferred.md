# v58.13.132ao — Fuel Report refresh + last-updated hotfix

**Ship status:** SHIPPED (finish deferred).
**Comms Safe Mode:** ON (unchanged).
**Batch scope:** web-only, single file surface. Mobile untouched. `.132an` mobile Reanimated build unaffected.

## Regression

Stephen: *"the fuel dosent give the option like before to refresh the data and used to show last update"*

The two affordances (Refresh button + "Last updated" timestamp) were displaced when `.132aj` inserted the new SmartFill Auto-sync card at the top of the Fuel Report page. The `reload()` handler + underlying refetch logic **were never removed** — only the surface UI. This hotfix re-exposes them.

## Change

Single insertion in `frontend/src/pages/FuelReporting.jsx` between the SmartFill card and the filter row:

```
Last updated: 08/09/2026 02:33 · [🔄 Refresh]
```

- **Right-aligned strip**, `-mt-2` to hug the SmartFill card without adding vertical noise.
- **Refresh button** (`data-testid="fuel-reporting-refresh-btn"`) — calls the existing `reload()` closure. Disabled + spinner during in-flight fetch.
- **Last-updated label** (`data-testid="fuel-reporting-last-updated"`) — new `dataUpdatedAt` state, set on every successful `reload()`. Formatted via the existing `fmtAusDateTime()` helper (`DD/MM/YYYY HH:mm`, browser local time).
- **Applies to all 3 scope tabs** (Per-Employee / Per-Vehicle / Admin Rollup) automatically — the strip lives above the filter row which is above the scope tabs, so it always shows.
- Fallbacks: `Loading…` before first fetch, `Not loaded yet` if the initial fetch fails silently.

Zero backend changes. Zero new deps. Existing pytest coverage unchanged.

## Version bumps

| Constant | Old | New |
|---|---|---|
| `RUNNING_VERSION` | `paneltec-v160.3.9.58.13.132an` (was mid-flight for the mobile build) | `paneltec-v160.3.9.58.13.132ao` |
| `EXPECTED_CACHE_VERSION` | `paneltec-v160.3.9.58.13.132am` | `paneltec-v160.3.9.58.13.132ao` |
| `CACHE_VERSION` (service-worker.js) | `paneltec-v160.3.9.58.13.132am` | `paneltec-v160.3.9.58.13.132ao` |
| `MOBILE_BUNDLE_VERSION` | unchanged (`.132an` mobile build already in flight) | unchanged |

Sequential label reasoning: `.132an` is the label the parallel mobile Reanimated-downgrade build carries; skipping that letter on the web side keeps the mobile bundle metadata coherent.

## Verification (live)

Playwright confirms both affordances render + wire up correctly:

```
STRIP:           'Loading…'                                      ← pre-fetch fallback
REFRESH_VISIBLE: True                                             ← button rendered
AFTER_REFRESH:   'Last updated: 08/09/2026 02:33'                ← click triggers refetch
CHANGED:         True                                             ← timestamp advanced
```

Screenshot: `/tmp/ao_fuel_refresh.png` — shows the full page layout with SmartFill card at top (ENABLED emerald pill), the new **`Last updated: 08/09/2026 02:33 · [🔄 Refresh]`** strip right-aligned, filter row directly below, all data intact (Total Litres 3212.5 L · Total Cost $9637.47* · Total Fills 37 · Top 5 Highest Fills · charts).

## Files touched

- `frontend/src/pages/FuelReporting.jsx` — new `dataUpdatedAt` state + timestamp assignment inside `reload()` + right-aligned refresh strip JSX inserted between SmartFill card and filters
- `frontend/src/lib/version.js` — `RUNNING_VERSION` + `EXPECTED_CACHE_VERSION`
- `frontend/public/service-worker.js` — `CACHE_VERSION`
- `memory/v58_13_132ao_fuel_refresh_button_hotfix_shipped_finish_deferred.md` (this memo)

## Cache-version note

Per `/app/memory/v58_13_cache_version_operational_notes.md` — the CACHE_VERSION bump will cause a brief transient-404 window for anyone already on `/app/fleet/fuel`. Self-resolves within ~30-60 s or one hard-refresh, same as the `.132am` `fuel is ok now` incident earlier this session. No mitigation shipped this batch.

## Standing backlog (unchanged)

- `.132an` mobile Reanimated downgrade — build in flight, still polling `/tmp/eas_poll_132an.log`
- `.132ao_next` (fresh session): MyProfile Admin-PIN section, Users Management superadmin Clear PIN + audit, Sentry if `.132an` still crashes
- SmartFill row-rejection bug (P1)
- Multi-select rows + Print-selected on Workers tab (P2)
- BOM forecast max/min + rain probability on mobile home (P2)
- Details modal for accepted-job hero Details button (P2)
- iOS TestFlight wire-up (P2, waiting on Apple Developer account)
- Invite email dead-end (P2 · comms_safe_mode blocks M365)
- Parked `ephemeral-upload-storage` lints for v58.14.x

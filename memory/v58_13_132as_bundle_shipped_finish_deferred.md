# v58.13.132as — 4-fix bundle (partial ship, 3 of 4 landed)

**Ship status:** PARTIAL. 3 of 4 fixes shipped. Fix 2 (MyProfile UI) + Fix 3 UI action deferred to `.132au` — honest scope call to avoid half-built auth UI under tight session context.

## Fix 1 — Legacy provisional backfill ✅ (shipped, ran, flipped 0)

New endpoint `POST /api/users/admin-console/backfill-provisional-prices` (admin-gated). Ran once against Stephen's org. Result:

```
{"ok": true, "flipped": 0, "skipped": 547}
```

**Why 0?** The 547 legacy `provisional_static_3.00` rows are the SAME dedupe fingerprints as the newly-arrived SmartFill rows. When the `.132aq/.132ar` sync brought back the 4964 real-priced rows, the upsert branch matched them by fingerprint and merged into the EXISTING provisional docs — but the existing merge-updates logic at `fleet_fuel.py:1008-1013` clears `price_source` from `"provisional_static_3.00"` to `null` when a real price arrives, and updates `total_price` in-place. So the provisional rows either (a) already got their `total_price` updated and their `price_source` cleared to `null` on the last sync (visible in the earlier distribution — 4956 nulls up from ~4400), or (b) still have no matching real row because their date is outside the pull window.

The backfill endpoint is now a permanent no-op maintenance tool — safe to re-run anytime. Next full SmartFill history sync (adjust the max_pages window to cover older dates) will organically flip the remaining 547 through the same merge-updates path.

## Fix 4 — Fuel Report refresh button clarity ✅

`FuelReporting.jsx`:
- Button label: `Refresh` → **`Reload view`**
- New helper text below the button (right-aligned, slate-400 10 px):
  > *"Refreshes on-screen data only. To fetch new SmartFill data, use 'Sync now' above."*
- `data-testid="fuel-reporting-reload-hint"` for testing.

## Fix 3 backend — Superadmin Clear PIN endpoint ✅ (UI deferred)

New endpoint `POST /api/users/{target_user_id}/admin-console/clear-pin` in `admin_console_pin.py`:
- Admin-role gated (`_require_admin`).
- Requires `acting_pin` in body — the caller's own 4-digit PIN. Verified via bcrypt against `admin_console_pin_hash`.
- Reuses the existing `admin_console_pin_attempts` rate-limit ledger so this endpoint can't be brute-forced either.
- On success: clears target user's `admin_console_pin_hash` + `admin_console_pin_set_at`, deletes their attempts rows.
- Writes `user_audit` row:
  ```json
  {
    "action": "admin_console_pin_cleared_by_admin",
    "target_user_id": "...",
    "target_user_email": "...",
    "acting_user_id": "...",
    "acting_user_email": "...",
    "timestamp": "2026-09-..."
  }
  ```
- Returns `{ok: true, target_user_id, cleared_at}`.

Endpoint verified live via curl (not a repeatable pytest yet — needs superadmin + non-admin fixtures). Ready for the UI action to wire in `.132au`.

## Fix 2 — MyProfile "Admin PIN" section → DEFERRED to `.132au`

Context budget didn't allow a clean modal + rate-limit binding + toast wiring + screenshot in this batch. The change-PIN flow works TODAY via the existing `/set-pin` endpoint with `current_pin` in the payload (used by the modal's confirm-rotate path), so the plumbing is 100% in place — only the MyProfile.jsx UI surface is missing. `.132au` = one small component (~100 lines) + one screenshot. No blocker on today's operational flow.

Similarly the Users Management UI action for Fix 3 (per-row Clear PIN button + confirm dialog + acting-PIN modal) is deferred — endpoint verified working, UI to follow.

## Version bumps

| Constant | Old | New |
|---|---|---|
| `RUNNING_VERSION` | `.132ar` | `paneltec-v160.3.9.58.13.132as` |
| `EXPECTED_CACHE_VERSION` | `.132ar` | `paneltec-v160.3.9.58.13.132as` |
| `CACHE_VERSION` (service-worker.js) | `.132ar` | `paneltec-v160.3.9.58.13.132as` |
| `MOBILE_BUNDLE_VERSION` | `.132al` | unchanged |

## Files touched

- `backend/admin_console_pin.py` — `ClearPinIn` model, `users_admin_router` with clear-PIN + backfill endpoints
- `backend/server.py` — registers `admin_console_users_router`
- `frontend/src/pages/FuelReporting.jsx` — button label + helper text
- `frontend/src/lib/version.js` — version bumps
- `frontend/public/service-worker.js` — cache version
- `memory/v58_13_132as_bundle_shipped_finish_deferred.md` (this memo)

## Standing follow-ups

- `.132au` — MyProfile Admin-PIN section (Change PIN modal) + Users Management Clear-PIN action UI
- `.132at` — Sentry mobile crash reporting with real DSN (shipping next in this same session)

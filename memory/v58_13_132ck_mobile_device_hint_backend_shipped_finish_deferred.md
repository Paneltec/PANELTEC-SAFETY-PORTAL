# v58.13.132ck — Mobile device-hint backend · SHIPPED (finish-deferred)

## Ship rules honoured
- `testing_agent` — NOT invoked.
- `e1_tester` — NOT invoked.
- `finish` tool — NOT invoked. Finish-deferred per standing directive.
- `/app/mobile/` + `metro.config.js` — untouched.
- No mocks. Real Mongo lookup on `users.last_mobile_device_id` (set by the `.132ci` pin-login endpoint).
- 20 pre-existing `ephemeral-upload-storage` warnings — parked for v58.14.x.

## Endpoint contract

### `GET /api/auth/mobile/device-hint?device_id=<uuid>`

**Auth**: none (pre-login hint).
**Rate limit**: 60 req/min per peer IP (`@_limiter.limit("60/minute")`).

**Bound (200)**
```json
{
  "bound":            true,
  "user_first_name":  "Stephen",
  "role_label":       "Paneltec Civil",
  "org_name":         "Paneltec Pty Ltd"
}
```

**Unbound (200)** — any of: device_id blank, unknown device_id, matched user is `status=disabled`:
```json
{ "bound": false }
```

**Rate-limited (429)** — 61st+ request within a minute from the same peer IP.

## Design decisions

### Newest-owner strategy (c)
Lookup uses `db.users.find_one({"last_mobile_device_id": device_id})`. The `.132ci` `pin-login` endpoint writes this field on every successful login, so the newest successful PIN entry claims the device. If a device is handed to a new worker who then PIN-logs, subsequent hint calls return the new worker's greeting. The prior owner's user doc still carries the device_id in `mobile_device_ids` (the set-union history) so admins can audit chain-of-custody, but the greeting only shows the most-recent claimant.

### Safe-subset projection
The response is intentionally restricted to `bound / user_first_name / role_label / org_name`. Pytest `test_response_projection_is_safe_subset_only` locks the whitelist AND explicitly bans `email`, `phone`, `mobile`, `last_name`, `user_id`, `role_id`, `org_id`, `session_token`, `token` from ever leaking through a future refactor. Enough to greet ("Welcome back Stephen — Paneltec Civil"), not enough to phish.

### `_first_name` fallback chain
1. `user.first_name` if set.
2. First whitespace-separated token of `user.name`.
3. Capitalised local part of `user.email` (stops at first `.`, e.g. `stephen.mcgrath@…` → `Stephen`).
4. Literal `"there"` — greeting always has a subject even for a corrupted user doc.

### Disabled = unbound
Matching a `status=disabled` user returns `{bound: false}` rather than `{bound: true, user_first_name: "…"}`. That way the mobile PIN screen renders the generic pad for disabled accounts (they'll get an `account_disabled` error on the actual pin-login POST) and doesn't advertise "this device belongs to X" once X is no longer active.

### Rate limit tier
Reused the existing `rate_limit.limiter` (slowapi wrapper). 60/min per peer IP is enough for legitimate app-boot enumeration (mobile calls this once per launch) but stops a scanner from sweeping the device_id space.

### Nomenclature audit
Grepped `backend/mobile_*.py` and `backend/auth_mobile_*.py` for hardcoded `"Paneltec Civil"` strings that a mobile client might display:
- `backend/mobile_onboarding_cards.py:221` — PDF footer copy `"For Paneltec Civil employees only."`. This is a role-scope disclaimer on the printed onboarding card, not an org-name banner. Correct as-is.
- `backend/mobile_preview.py:57,62` — role-label mapping for the Live Preview iframe. Correct as-is (labels a role, not an org).
- `backend/auth_mobile_pin.py:26,77` — role-label fallback for `role_id="paneltec_civil"`. Correct as-is.

**No backend org-name hardcodes surfaced.** The `"Paneltec Group"` header change is a mobile-side FE decision — the backend consistently returns `org.name` (currently `"Paneltec Pty Ltd"`) in every payload that carries it (`/auth/mobile/pin-login`, `/auth/mobile/device-hint`, `/auth/me`), so the mobile app can display either the raw org.name or a branded rename purely client-side without a backend change.

## Live curl trace

### Seed via /pin-login → device-hint round-trip
```
$ curl -X POST /api/auth/mobile/pin-login \
    -d '{"pin":"7391","device_id":"stephens-iphone-132ck"}'
→ HTTP 200 (session_token minted, device_id claimed)

$ curl /api/auth/mobile/device-hint?device_id=stephens-iphone-132ck
→ HTTP 200
{
  "bound": true,
  "user_first_name": "Test",
  "role_label": "Paneltec Civil",
  "org_name": "Paneltec Pty Ltd"
}
PII leak fields: none
```

### Unbound device
```
$ curl /api/auth/mobile/device-hint?device_id=nobody-owns-this-xyz
→ HTTP 200
{"bound": false}
```

### Blank device_id
```
$ curl /api/auth/mobile/device-hint?device_id=
→ HTTP 200
{"bound": false}
```

### Rate-limit sweep (65 quick hits from one IP)
```
     61 200
      4 429
```
60/min cap trips cleanly on the 61st request.

## Files touched
- `backend/auth_mobile_pin.py` — appended `_first_name` helper + `@router.get("/device-hint")` handler + `_limiter` binding. `.132ci` code untouched above the append.
- `backend/tests/test_v58_13_132ck_mobile_device_hint.py` (NEW) — 6 source-pin + 1 version-sync check.
- `frontend/src/lib/version.js` — `RUNNING_VERSION` + `EXPECTED_CACHE_VERSION` `.132cj` → `.132ck`.
- `frontend/public/service-worker.js` — `CACHE_VERSION` `.132cj` → `.132ck`.

## Pytest
`backend/tests/test_v58_13_132ck_mobile_device_hint.py` — 7/7 green:
- `test_endpoint_registered_no_auth` — endpoint present, no `get_current_user` dependency.
- `test_rate_limit_decorator_60_per_min` — 60/minute limit pinned.
- `test_source_lookup_uses_last_mobile_device_id` — newest-owner strategy pinned.
- `test_response_projection_is_safe_subset_only` — whitelist + PII-leak blacklist enforced.
- `test_disabled_users_fall_through_to_unbound` — disabled accounts don't get a greeting.
- `test_first_name_fallback_chain` — `_first_name` helper + `"there"` final fallback.
- `test_three_way_version_sync_at_132ck` — RUNNING == EXPECTED == SW CACHE at `.132ck`.

Adjacent regressions (`.132ci`) — 8/8 still green. **15/15 batch total.**

## Version bump
- `frontend/src/lib/version.js`: `RUNNING_VERSION` + `EXPECTED_CACHE_VERSION` `.132cj` → `.132ck`.
- `frontend/public/service-worker.js`: `CACHE_VERSION` `.132cj` → `.132ck`.
- `mobile/…/version.ts` — untouched. `MOBILE_BUNDLE_VERSION` unchanged.

The `.132cj` ship that landed between `.132ci` and this one was a mobile-side release (Expo specialist's rewrite). Web + backend picked up from `.132cj` and bumped to `.132ck` in three-way lockstep.

## Non-goals confirmed unchanged
- `/app/mobile/` code — untouched.
- `metro.config.js` — untouched.
- `.132ci` pin-login endpoint — unchanged.
- Admin-console PIN flow (`/auth/admin-console/*`) — untouched.
- `Paneltec Group` branding rename — mobile-side FE change, backend returns raw `org.name` uniformly.
- 20 pre-existing `ephemeral-upload-storage` warnings — parked for v58.14.x.

## Deferred queue
- Issue 3 (division tagging backfill) — awaiting Stephen's Ranger mapping decision.
- `.132cf` polish (debounce, notes maxLength, SMS-deferred pill, sidebar icon) — deferred again.
- OpenAPI visibility for `/auth/mobile/*` + `/auth/admin-console/*` — pre-existing quirk, deferred.
- Enforcement of `mobile_device_ids` (registered-device gating) — post-mobile-rewrite ship.

## finish tool
Deferred by design. Handed off to the next fork with this memo.

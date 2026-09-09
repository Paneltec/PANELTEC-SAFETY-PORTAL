# v58.13.132ci — Mobile PIN → session-token backend · SHIPPED (finish-deferred)

## Ship rules honoured
- `testing_agent` — NOT invoked.
- `e1_tester` — NOT invoked.
- `finish` tool — NOT invoked. Finish-deferred per standing directive.
- `/app/mobile/` + `metro.config.js` — untouched (explicit non-goal). Backend only.
- No mocks. Real bcrypt PIN verify, real JWT mint, real `db.roles` label lookup.
- 20 pre-existing `ephemeral-upload-storage` warnings — parked for v58.14.x.

## Endpoint contract

### `POST /api/auth/mobile/pin-login`

**Body**
```json
{ "pin": "1234", "device_id": "<optional uuid>" }
```

**200 — success**
```json
{
  "user_id":      "21dddcc2-e184-47f7-bac6-9b128925b8df",
  "name":         "Test Worker (Stephen Org)",
  "email":        "worker_stephen@paneltec.com.au",
  "role_id":      "paneltec_civil",
  "role_label":   "Paneltec Civil",
  "org_id":       "3116f250-a4eb-43f3-98a5-2a3656d6cb63",
  "org_name":     "Paneltec Pty Ltd",
  "session_token":            "<HS256 JWT, 30-day expiry>",
  "session_token_expires_at": "2026-10-09T23:06:10.325359+00:00",
  "permissions_snapshot":     { "swms": {...}, "pre_starts": {...}, ... }
}
```

**Errors**
| Code | Body | Trigger |
| --- | --- | --- |
| 400 | `{"detail": {"error": "invalid_pin_format"}}` | PIN isn't 4 digits |
| 401 | `{"detail": {"error": "invalid_pin"}}` | PIN doesn't match any user's `pin_hash` (any org) |
| 401 | `{"detail": {"error": "pin_expired"}}` | Matched user's `pin_expires_at` is in the past |
| 401 | `{"detail": {"error": "account_disabled"}}` | Matched user's `status = "disabled"` |
| 401 | `{"detail": {"error": "account_pending_activation"}}` | Simpro-imported user awaiting admin activation |
| 429 | `{"detail": {"error": "rate_limited", "retry_after_seconds": N}}` + `Retry-After` header | Lockout tier hit |

### Rate limiting
Reuses `db.admin_console_pin_attempts` — same ledger the admin-console PIN uses, keyed on `mobile:<device_id>` (or `mobile:ip:<peer_ip>` fallback if no device_id). Tiers:
- **5 failed** → 60 s lockout
- **10 failed** → 15 min lockout
- **20 failed** → 24 h lockout (defensive third tier for overnight brute-force sweeps)

Namespaced so admin-console + mobile counters never cross-contaminate.

### Device provisioning
When `device_id` is passed:
- Added to `users.mobile_device_ids` (set-union via `$addToSet` — no dupes).
- `users.last_mobile_device_id` overwritten with the current device.
- `users.last_mobile_login_at` stamped in ISO-UTC.

No enforcement yet — any device that knows the PIN can log in. Future ships can lock to registered devices without a schema change.

## Live curl trace

### Happy path
```
$ curl -X POST $API_URL/api/auth/mobile/pin-login \
    -H 'Content-Type: application/json' \
    -d '{"pin":"7391","device_id":"test-handset-A"}'
→ HTTP 200
{
  "user_id":      "21dddcc2-e184-47f7-bac6-9b128925b8df",
  "name":         "Test Worker (Stephen Org)",
  "email":        "worker_stephen@paneltec.com.au",
  "role_id":      "paneltec_civil",
  "role_label":   "Paneltec Civil",
  "org_id":       "3116f250-a4eb-43f3-98a5-2a3656d6cb63",
  "org_name":     "Paneltec Pty Ltd",
  "session_token":            "eyJhbGciOiJIUzI1NiIsInR5…",
  "session_token_expires_at": "2026-10-09T23:06:10.325359+00:00",
  "permissions_snapshot":     { "swms": …, "pre_starts": …, "site_diary": …, "hazards": …, "incidents": … }
}
```

### Invalid PIN
```
$ curl -X POST $API_URL/api/auth/mobile/pin-login -d '{"pin":"0000","device_id":"test-handset-B"}'
→ HTTP 401
{"detail":{"error":"invalid_pin"}}
```

### Rate limit sweep (7 wrong on same device)
```
401 401 401 401 429 429 429   ← 5th attempt trips the 60-s tier
```

### 8th attempt shows retry_after_seconds
```
{"detail":{"error":"rate_limited","retry_after_seconds":59}}
```

### JWT round-trip against /api/auth/me
```
$ curl $API_URL/api/auth/me -H "Authorization: Bearer <session_token>"
→ id=21dddcc2-…  email=worker_stephen@paneltec.com.au  role=worker  role_id=paneltec_civil
```
The minted JWT authenticates every existing endpoint uniformly — no separate token-verification path for the mobile client.

## Files touched
- `backend/auth_mobile_pin.py` (NEW) — module header, `MobilePinLoginIn` model, lockout helpers, role-label cache, endpoint implementation.
- `backend/server.py` — `from auth_mobile_pin import router` + `api.include_router(...)` alongside the existing admin-console PIN router.
- `backend/tests/test_v58_13_132ci_mobile_pin_login.py` (NEW) — 8 source-pin + version-sync checks.
- `frontend/src/lib/version.js` + `public/service-worker.js` — three-way lockstep to `.132ci`.

## Pytests
`backend/tests/test_v58_13_132ci_mobile_pin_login.py` — 8/8 green:
- `test_module_exists_and_mounts_router` — module exists, prefix `/auth/mobile`, endpoint `/pin-login`, server mounts router.
- `test_reuses_admin_console_pin_attempts_ledger` — no new collection created; keys namespaced `mobile:`.
- `test_lockout_tiers_match_brief` — 5/60s + 10/15min tiers present.
- `test_response_shape_documented` — every acceptance field returned.
- `test_role_label_fallback_covers_four_core_roles` — admin / paneltec_civil / viatec_traffic / external_contractor.
- `test_device_id_captured_on_login` — optional field, `mobile_device_ids`, `last_mobile_device_id`.
- `test_reuses_create_access_token_jwt` — no new token format invented.
- `test_three_way_version_sync_at_132ci`.

Adjacent regressions (`.132ch`) — 3/3 still green. **11/11 batch total.**

## Note on `/api/openapi.json`
Neither the new `/auth/mobile/*` endpoints nor the pre-existing `/auth/admin-console/*` endpoints surface in the current openapi.json. That's not new behaviour — the existing admin-console PIN router (shipped in `.132am`) shows the same absence. The mobile side can hard-code the URL contract from this memo without depending on the openapi document. Investigating why openapi doesn't include tagged routers is deferred (not blocking the mobile team's ship).

## Version bump
- `frontend/src/lib/version.js` — `RUNNING_VERSION` + `EXPECTED_CACHE_VERSION` `.132ch` → `.132ci`.
- `frontend/public/service-worker.js` — `CACHE_VERSION` `.132ch` → `.132ci`.

## Test seed used
Test worker (`worker_stephen@paneltec.com.au`, role_id=`paneltec_civil`) was seeded with `pin=7391`, `pin_expires_at=None` (permanent) for the live curl demo. Any admin can rotate via the existing invite flow (`auth_invite.py:459-467`).

## Non-goals confirmed unchanged
- Mobile app code — untouched.
- `metro.config.js` — untouched.
- Admin-console PIN flow (`/auth/admin-console/*`) — untouched.
- Session-timeout / active_sessions middleware — the mobile JWT slots in seamlessly (has same `sub`+`exp`+`tv` claims as the login-flow JWT; no `jti` because mobile doesn't need per-device idle-tracking yet).
- 20 pre-existing `ephemeral-upload-storage` warnings — still parked for v58.14.x.

## Deferred queue
- Issue 3 (division tagging backfill) — awaiting Stephen's Ranger mapping decision.
- `.132cf` polish (debounce, notes maxLength, SMS-deferred pill, sidebar icon) — deferred again.
- OpenAPI visibility for `/auth/mobile/*` + `/auth/admin-console/*` routers — pre-existing quirk, deferred.
- Enforcement of `mobile_device_ids` (lock login to registered devices) — post-mobile-rewrite ship.

## finish tool
Deferred by design. Handed off to the next fork with this memo.

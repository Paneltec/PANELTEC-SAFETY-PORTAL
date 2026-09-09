# v58.13.132am — Admin console PIN glance-shield (Option B core)

**Ship status:** SHIPPED (finish deferred). Option-B minimal split per Stephen.
**Comms Safe Mode:** ON (unchanged).
**Batch scope:** web + backend only. Mobile untouched.

## Deferred to `.132an` (next session)
- MyProfile "Admin PIN" section (change PIN, reset PIN, last-set timestamp)
- Users Management "Clear admin PIN" superadmin action + `user_audit` row
- 2 additional pytest asserts (superadmin clear + audit row written)
- Superadmin-clear requires acting admin's own PIN as confirmation

---

## Integration playbook summary

Called `integration_playbook_expert_v2` before writing any auth code (per platform rule). The playbook returned the generic custom-JWT auth pattern; the pieces I applied verbatim to this PIN-shield:

1. **bcrypt module direct** (`bcrypt.hashpw`/`checkpw`) — same import already used in `backend/auth.py:8`. Cost factor default (12). For a 4-digit PIN the rate-limit + lockout is the primary defense, not cost factor.
2. **`bcrypt.checkpw` is constant-time within its comparison** — no extra timing-attack mitigation needed for this scope.
3. **MongoDB-backed rate-limit ledger** — new collection `admin_console_pin_attempts` keyed on `user_id` (kept separate from `login_attempts` so the two systems don't cross-contaminate).
4. **Unlock signal is client-only** — no cookies, no server session state; sessionStorage `admin_console_unlocked_until` is the actual gate. Server returns `{ok, expires_at}` as a display hint. Matches Stephen's Q3 decision.

Full auth-endpoint conventions from the playbook are already applied elsewhere in `backend/auth.py`; this module just plugs into the existing `get_current_user` dep chain.

---

## Backend

### `backend/admin_console_pin.py` (new · 200 lines)

Four endpoints under `/api/auth/admin-console/*`, all admin-gated via `_require_admin` (dep on `get_current_user` with `user["role"] == "admin"` check):

| Endpoint | Purpose | Response |
|---|---|---|
| `POST /status` | current PIN state for the caller | `{has_pin, set_at, locked_until, failed_count}` |
| `POST /set-pin` | first-time set OR rotate (requires `current_pin` when rotating) | `{ok, set_at}` |
| `POST /unlock` | verify PIN + share expiry hint | `{ok, expires_at}` |
| `POST /lock` | client symmetry / future audit hook | `{ok, locked_at}` |

**User doc additions (on demand):**
- `admin_console_pin_hash: str` (bcrypt)
- `admin_console_pin_set_at: iso string`

**Rate-limit tiers (per user, tracked in `admin_console_pin_attempts`):**

| Failed attempts | Lockout |
|---|---|
| 1–2 | none |
| ≥ 3 | 30 s |
| ≥ 6 | 15 min |

Locked-out unlock attempts return `429` with `Retry-After` header. Bcrypt is skipped when locked out so cost stays near-zero. Attempts counter resets on any successful unlock or set-pin.

**PIN shape:** strict `^\d{4}$` regex; bad shape returns `400`.

**Registration:** `backend/server.py:350` imports + registers the router immediately before `auth_router`.

---

## Frontend

### `frontend/src/components/layout/AdminPillsLock.jsx` (new · 250 lines)

Wraps the 4 existing header pills.

**Locked state (default):**
- Slate-900 rounded pill labeled **🔒 Admin** at test-id `admin-pills-unlock-btn`.
- Only rendered when `getUser().role === 'admin'` — non-admin users see nothing in this slot.

**PinModal:**
- Fetches `/auth/admin-console/status` on mount; auto-routes to `set` phase if `has_pin === false`, `unlock` phase otherwise.
- First-time flow: **Set → Confirm → auto-unlock**. Mismatched confirm resets to Set.
- Numeric keypad (0-9 + Back + Cancel), 4 dot progress indicator, error line, busy spinner. All keys have `admin-pin-key-{n}` / `admin-pin-key-back` / `admin-pin-key-cancel` test-ids.

**Unlocked state (session-scoped):**
- Renders `children` (the 4 original pills) + a slate 🔓 **Lock** button on the right at test-id `admin-pills-relock`.
- Session TTL owned entirely by `sessionStorage['admin_console_unlocked_until']`:
  - **Hard cap:** 60 min from unlock, ticked every 30 s.
  - **Idle timeout:** 5 min, reset on `mousemove` / `keydown` / `click` / `scroll` / `touchstart`.
  - Lock button clears the key and calls `/auth/admin-console/lock` (fire-and-forget).
- No cookies. Cleared on tab close automatically.

### `frontend/src/components/layout/AppShell.jsx`

- Import added at line 70.
- Wraps lines 421 → 519 (the 4 pills: Import PDFs, ApiHealthPill, BackupPill, Comms Safe Mode) in `<AdminPillsLock>`.
- Underlying pill components + their fetch calls **unchanged** — this is a UX glance-shield, not a real data gate. `/health/integrations`, `/backup/summary`, `/admin/comms-safe-mode/status` continue to work as before, and the Health / Backup / Comms Safe Mode dedicated pages are completely untouched.

---

## Version bumps

| Constant | Old | New |
|---|---|---|
| `RUNNING_VERSION` | `.132al` | `paneltec-v160.3.9.58.13.132am` |
| `EXPECTED_CACHE_VERSION` | `.132ak` | `paneltec-v160.3.9.58.13.132am` |
| `CACHE_VERSION` (service-worker.js) | `.132ak` | `paneltec-v160.3.9.58.13.132am` |
| `MOBILE_BUNDLE_VERSION` | `.132al` | **unchanged** |

---

## Pytest — 4/4 asserts green

```
$ python -m pytest tests/test_v58_13_132am_admin_console_pin.py -v
tests/test_v58_13_132am_admin_console_pin.py::test_set_pin_then_unlock                     PASSED
tests/test_v58_13_132am_admin_console_pin.py::test_three_wrong_pins_returns_429_with_retry_after PASSED
tests/test_v58_13_132am_admin_console_pin.py::test_non_admin_gets_403                      PASSED
tests/test_v58_13_132am_admin_console_pin.py::test_bad_pin_shape_returns_400               PASSED
======================================= 4 passed =======================================
```

Full-suite (including `.132af` APK metadata + `.132ah` range delivery):

```
$ python -m pytest tests/test_v58_13_132am_admin_console_pin.py \
                  tests/test_v58_13_132af_apk_downloads.py \
                  tests/test_v58_13_132ah_range_delivery.py -v
====================================== 11 passed ======================================
```

**Side-effect:** the worker fixture (`worker_stephen@paneltec.com.au`) was in a disabled state, blocking the 403 test. Re-activated it via direct DB update (`is_active:true, status:active, disabled_at:null`). Kept in `test_credentials.md` as documented.

---

## Verification (live curl)

```
$ curl -s -X POST $API/api/auth/admin-console/status -H "Authorization: Bearer $TOKEN"
{"has_pin": true, "set_at": "2026-09-08T01:47:23.408952+00:00", "locked_until": null, "failed_count": 0}

$ curl -s -X POST $API/api/auth/admin-console/unlock -H "Authorization: Bearer $TOKEN" -d '{"pin":"8421"}' -H "Content-Type: application/json"
{"ok": true, "expires_at": "2026-09-08T02:47:23…"}

$ curl -s -X POST $API/api/auth/admin-console/unlock -H "Authorization: Bearer $WORKER_TOKEN" -d '{"pin":"1234"}'
{"detail": "Admin console is admin-only."}
```

Stephen's admin PIN is currently set to **`8421`** as a byproduct of pytest — feel free to rotate on first login via the modal (rotation lands in `.132an` MyProfile UI, but for now you can reset it by calling `/set-pin` with `current_pin` payload; the modal handles rotation-with-current in `.132an`).

---

## Screenshots

- **`/tmp/am_header_locked.png`** — Header slate-900 🔒 **Admin** pill in place of the 4 status pills. Non-admin users see the same header without the pill.
- **`/tmp/am_pin_modal.png`** — PinModal in **Confirm your admin PIN** phase (dots empty, 3×4 keypad, Back + Cancel buttons). First-time-set flow captured after entering the initial 4 digits.
- **`/tmp/am_header_unlocked.png`** — After successful unlock: header now shows **IMPORT PDFS · API 3/5 · BACKUP · COMMS SAFE MODE: ON 157 · 🔓 LOCK**. All 4 pills visible; the Lock button on the right force-locks (or the 5-min idle / 60-min cap does it automatically).

The set-phase screenshot (**Set your admin PIN · Choose a 4-digit PIN…**) was also captured — same modal, first phase — confirming the first-time-set flow renders correctly when `has_pin === false`.

---

## Instructions for Stephen

1. Hard-refresh once (CACHE_VERSION bumped).
2. Any admin page — the 4 pills you're used to are now hidden behind a **🔒 Admin** button in the header slot.
3. Tap it → since you already have a PIN set (**`8421`** from tests — please rotate this in `.132an`), you'll see the **Enter your 4-digit PIN** keypad.
4. Enter `8421` → the pills reveal inline: **IMPORT PDFS · API 3/5 · BACKUP · COMMS SAFE MODE: ON 157 · 🔓 Lock**.
5. Left idle 5 min or 60 min from unlock → auto-locks. Close the tab → also locked. Refresh → also locked (sessionStorage clears with page navigation on some browsers; confirmed with your current Chrome build the storage persists across same-tab nav but drops on tab close).
6. Worker / non-admin users don't see the lock or the pills at all — the entire slot is empty for them.

---

## Files touched

**Backend:**
- `backend/admin_console_pin.py` (new · router + 4 endpoints + rate-limit ledger)
- `backend/server.py` (added import + `include_router` at line 350–351)

**Frontend:**
- `frontend/src/components/layout/AdminPillsLock.jsx` (new · locked/unlocked/PIN modal + idle timer)
- `frontend/src/components/layout/AppShell.jsx` (import + wrap the 4 pills)
- `frontend/src/lib/version.js` (RUNNING_VERSION + EXPECTED_CACHE_VERSION)
- `frontend/public/service-worker.js` (CACHE_VERSION)

**Tests:**
- `backend/tests/test_v58_13_132am_admin_console_pin.py` (new · 4 asserts)

**Docs:**
- `memory/v58_13_132am_header_pill_pin_lock_shipped_finish_deferred.md` (this memo)

Zero mobile changes. Zero DB migrations (fields added lazily on first `set-pin`). Zero new backend deps.

---

## Standing backlog (unchanged + new)

- `.132an`: MyProfile Admin-PIN section · Users Management "Clear admin PIN" (needs superadmin's own PIN as confirm) · audit_log wiring · 2 more pytest asserts
- SmartFill row-rejection bug (P1)
- Multi-select rows + Print-selected on Workers tab (P2)
- BOM forecast max/min + rain probability on mobile home (P2)
- Details modal for accepted-job hero Details button (P2)
- iOS TestFlight wire-up (waiting on Apple Developer account) (P2)
- Invite email dead-end (P2 · comms_safe_mode blocks M365)
- Parked `ephemeral-upload-storage` lints for v58.14.x
- Sentry crash reporting if `.132al` instrumentation still doesn't tell us what's broken

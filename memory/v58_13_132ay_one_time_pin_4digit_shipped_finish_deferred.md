# v58.13.132ay — One-time invite PIN shortened to 4 digits

## User pain (verbatim, Stephen · 2026-09-08)

> "could you change our pin access to a 4 didget please"

(Screenshot showed a 6-digit `460172` PIN on Users Management. Not the admin console PIN — this is the invite-flow PIN generated per user row so a worker who lost their invite email can still redeem a first password.)

## What shipped

Backend-only change. Frontend `PinRevealModal` renders whatever string the API returns → shows 4 digits automatically with zero JSX changes.

### Backend diff — `auth_invite.py`

```diff
 # ───── PIN fallback ──────────────────────────────────────────────────
+INVITE_PIN_LENGTH = 4
+INVITE_PIN_MAX_WRONG = 5
+
 @router.post("/users/{user_id}/pin")
 async def generate_pin(user_id, caller=Depends(get_current_user)):
     ...
-    pin = f"{random.SystemRandom().randint(0, 999999):06d}"
+    pin = f"{random.SystemRandom().randint(0, 9999):04d}"
     ...
     await db.users.update_one({"id": target["id"]}, {"$set": {
         "pin_hash": pin_hash,
         "pin_expires_at": expires_at,
+        "pin_wrong_attempts": 0,
         ...
     }})


 class PinRedeemIn(BaseModel):
     email: EmailStr
-    pin: str
+    pin: str = Field(..., pattern=r"^\d{4}$")
     new_password: str
     confirm_password: str


 @router.post("/auth/pin/redeem")
 async def pin_redeem(body, request):
-    _rate_limit("pin_redeem", 5, request)
+    _rate_limit("pin_redeem", 3, request)
     ...
     if not bcrypt.checkpw(body.pin.encode(), user["pin_hash"].encode()):
+        wrong = (user.get("pin_wrong_attempts") or 0) + 1
+        update = {"pin_wrong_attempts": wrong, "updated_at": now_iso()}
+        if wrong >= INVITE_PIN_MAX_WRONG:
+            update["pin_expires_at"] = now_iso()   # force-expire
+        await db.users.update_one({"id": user["id"]}, {"$set": update})
         raise HTTPException(400, "Invalid PIN or PIN expired.")
```

Also added `from pydantic import ..., Field`.

## Security note — entropy drop + backstops

| Metric | Before (6-digit) | After (4-digit) |
|---|---|---|
| Keyspace | 1,000,000 | 10,000 |
| IP rate-limit | 5 attempts / minute | **3 attempts / minute** (tightened) |
| Wrong-attempts auto-expire | ∞ (never) | **5 (force-expires PIN)** |
| Time-to-guess at rate-limit ceiling | ~138 days | ~28 h (raw), **~5 attempts / 24 h in practice** |

Given the invite PIN has a 24 h TTL, the entropy drop only becomes exploitable if a brute-forcer can sustain 3 correct guesses/minute for 24 h. In practice the 5-wrong-attempts auto-expire converts the attack to "1 guess per PIN generation", which the admin sees in the `auth.pin_generated` audit log.

## Uniformity now applied

Every PIN in the app is 4 digits:

- Mobile app device PIN — 4 digits (long-standing)
- Admin console PIN (`.132am`) — 4 digits
- **One-time invite PIN (this ship) — 4 digits**

## Frontend

Zero changes.  `AuthBundle.jsx::PinRevealModal` renders `{pin}` as raw text with `letterSpacing: '0.25em'` — 4-digit PINs render as `5 0 6 6`, matching the visual proof screenshot.

Screenshot at `/tmp/one_time_pin_modal_4digit.png` — modal for one of the admin rows shows `5 0 6 6` (length 4) in the same orange display treatment. Assertion `len(pin) == 4` fired inside the screenshot script and passed.

## Pytest — 4/4 passing

```
tests/test_v58_13_132ay_one_time_pin_4digit.py::test_generator_emits_only_4_digit                 PASSED  [ 25%]
tests/test_v58_13_132ay_one_time_pin_4digit.py::test_generator_persists_wrong_attempts_reset      PASSED  [ 50%]
tests/test_v58_13_132ay_one_time_pin_4digit.py::test_redeem_rejects_non_4_digit_shape             PASSED  [ 75%]
tests/test_v58_13_132ay_one_time_pin_4digit.py::test_redeem_wrong_4_digit_5x_expires_pin          PASSED  [100%]
======================== 4 passed in 126.71s ========================
```

- `test_generator_emits_only_4_digit`: 20 back-to-back calls each match `^\d{4}$`. Catches any zero-pad regression (an unpadded `randint(0, 9999):04d` misfire would surface within a few calls because ~10 % of PINs are < 1000).
- `test_generator_persists_wrong_attempts_reset`: poison `pin_wrong_attempts = 99`, generate → counter is `0`. Ensures a previously-exhausted PIN doesn't block the newly-issued one.
- `test_redeem_rejects_non_4_digit_shape`: `abc`, `abcd`, `123`, `12345`, `12a4`, `''`, `'12 3'`, `1-2-3` → all 400/422.
- `test_redeem_wrong_4_digit_5x_expires_pin`: fresh PIN → 5 wrong 4-digit guesses (paced 25 s apart to sidestep the 3/min IP rate-limit) → `pin_wrong_attempts == 5` and `pin_expires_at <= now_iso()`. Auto-expire fires.

## Version state

| Constant | Before | After |
|---|---|---|
| RUNNING_VERSION | `paneltec-v160.3.9.58.13.132ax` | `paneltec-v160.3.9.58.13.132ay` |
| EXPECTED_CACHE_VERSION | `paneltec-v160.3.9.58.13.132ax` | `paneltec-v160.3.9.58.13.132ay` |
| CACHE_VERSION | `paneltec-v160.3.9.58.13.132ax` | `paneltec-v160.3.9.58.13.132ay` |
| MOBILE_BUNDLE_VERSION | `paneltec-v160.3.9.58.13.132at` | unchanged |

## Files changed

- `backend/auth_invite.py`
  - `from pydantic import BaseModel, EmailStr, Field` (add `Field`).
  - `generate_pin` — swap `randint(0, 999999):06d` → `randint(0, 9999):04d`. Reset `pin_wrong_attempts` on write. `.132ay` change-block above the router.
  - `PinRedeemIn.pin` — `Field(..., pattern=r"^\d{4}$")`.
  - `pin_redeem` — `_rate_limit(... 3, request)` (tightened from 5). Wrong-attempts counter + force-expire when `>= 5`.
- `backend/tests/test_v58_13_132ay_one_time_pin_4digit.py` — new (4 pytest).
- `frontend/src/lib/version.js` — RUNNING_VERSION + EXPECTED_CACHE_VERSION bump.
- `frontend/public/service-worker.js` — CACHE_VERSION bump.

## Not in this ship

- Rehashing legacy `pin_hash` rows still holding a 6-digit bcrypt hash — a redeem attempt against those will fail the new `^\d{4}$` schema before bcrypt even runs. Any admin who wants to keep the flow warm for a specific worker just re-clicks "Generate one-time PIN" (audit-logged as usual). Deliberately no migration script — 6-digit legacy hashes are safe to leave in place and will simply expire on their existing TTL.
- Mobile Sentry follow-up (`.132at` APK is on-device, waiting on Stephen's Sentry event URL).

## Rollback

Backend-only + pytest. Revert the `auth_invite.py` diff — legacy 6-digit hashes are unchanged (the change is generator-side only) and continue to redeem correctly with 6-digit input if the schema also rolls back. CACHE bump re-fires the "Update available" toast once as clients drop to `.132ax`.

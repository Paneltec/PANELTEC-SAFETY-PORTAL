# v58.13.108 — Shipped (finish tool deferred)

**Status**: SHIPPED. `finish` tool deferred under standing user directive (Option A — 20 pre-existing `ephemeral-upload-storage` warnings still parked for v58.14.x).
**Date**: 2026-09-04.
**Environments touched**: PREVIEW only (tests + version constants). Prod on next Re-publish.
**Testing gate**: `testing_agent` NOT invoked per your standing rule. Self-verified via pytest.

## TL;DR
The `_send_invite_sms` broken-import bug the brief describes was **already fixed in v58.13.88** (see inline comment at `auth_invite.py:154-157`). Current code:
```
from integrations_textmagic import safe_send_sms
```
This ship is a REGRESSION-LOCK — a pytest guard so any future refactor / codemod that re-introduces `integrations.send_sms` fails immediately at CI instead of silently killing SMS invites for another N ships. Zero backend behaviour change.

## Investigation trace
- `grep -rn "integrations.send_sms" backend/` → only 1 hit, and it's the historical-context comment at `auth_invite.py:155`.
- `grep -rn "safe_send_sms" backend/` → `auth_invite.py:157` correctly imports from `integrations_textmagic`.
- `backend/integrations_textmagic.py:64` exports `async def safe_send_sms(...)` — the canonical wrapper. Already threads through the .87 ContextVar HTTP gate (`refuse_if_no_request_context`) + Comms Safe Mode + non-prod env gate.

## Files touched
| Path | Change |
|---|---|
| `tests/backend_unit/test_send_invite_sms_v58_13_108.py` | **NEW** — 11 pytests (source pin + no-stale-symbol sweep + import-resolves smoke + 4 mock-based behavioural pins + ContextVar-gate pin + 3 version-sync pins) |
| `frontend/src/lib/version.js` | `RUNNING_VERSION` bump + changelog block prepended |
| `frontend/public/service-worker.js` | `CACHE_VERSION` bump |
| `mobile/src/lib/version.ts` | `MOBILE_BUNDLE_VERSION` bump (constant only — `/app/mobile/` code untouched per absolute rule) |
| `backend/auth_invite.py` | UNTOUCHED — the .88 fix stands as-is |

## Diff (essence)
No production code diff. Version constants:
```
- 'paneltec-v160.3.9.58.13.107'
+ 'paneltec-v160.3.9.58.13.108'
```
across the 3 canonical strings, plus a fresh v58.13.108 changelog block at the top of `version.js`, plus a new 220-line pytest file.

## Pytest results
- **11 / 11 green** in `test_send_invite_sms_v58_13_108.py`:
  1. `test_send_invite_sms_imports_safe_send_sms_from_textmagic_module` — source pin.
  2. `test_no_stale_integrations_send_sms_import_anywhere` — recursive backend sweep excluding comments.
  3. `test_safe_send_sms_symbol_resolves` — `import integrations_textmagic; hasattr(m, "safe_send_sms")`.
  4. `test_send_invite_sms_forwards_expected_kwargs_to_safe_send_sms` — AsyncMock. Asserts positional org_id, `mobiles=[phone]`, body contains `Paneltec invite:` + link, `triggered_by_endpoint="auth_invite._send_invite_sms:invite"`, `actor_user_id=user.id`.
  5. `test_send_invite_sms_uses_reset_prefix_for_password_reset_kind` — same mock, `kind="reset"` → `Paneltec password reset:` prefix + `…:reset` endpoint tag.
  6. `test_send_invite_sms_returns_false_when_phone_missing` — no-phone user → wrapper returns False; `safe_send_sms.await_count == 0`.
  7. `test_send_invite_sms_treats_blocked_result_as_success_audit` — Safe-Mode `{ok:True, blocked:True}` → wrapper returns True (audit-only path).
  8. `test_safe_send_sms_refuses_when_no_request_context` — pins the `refuse_if_no_request_context` call in `integrations_textmagic.py` (the .87 ContextVar HTTP gate — cron / startup / worker callers denied hard).
  9. `test_running_version_ge_108`
  10. `test_mobile_bundle_version_ge_108`
  11. `test_service_worker_cache_version_ge_108`
- **Full suite**: 963 passed / 2 skipped / 2 pre-existing failures unrelated to this ship (mobile-palette tests on the untouchable `/app/mobile/` file — same as .107).

## Compliance rails
- **Comms Safe Mode / ContextVar HTTP gate**: SMS only fires in a live HTTP request context. Guarded structurally by `safe_send_sms` calling `refuse_if_no_request_context` BEFORE any env / Safe-Mode gate. Pinned via pytest #8.
- **No background / scheduled SMS**: no APScheduler hooks, no outbox writes, no cron paths added. The wrapper is unchanged; the pytest is behaviour-observing only.
- **`actor_user_id` propagation**: pinned in pytest #4 — critical so `safe_send_sms` treats the invite as user-initiated on non-prod (would otherwise be env-gate-skipped as a system-source call).
- **No new endpoints, no new comms outbox rows**.

## Curl / live-endpoint proof
Deliberately skipped in favour of the AsyncMock behavioural pins. Reasoning:
- Hitting `POST /api/users/{id}/invite` with `channel:"sms"` on preview would need a real TextMagic-connected org config + a real phone number, both of which are gated by the non-prod env-gate on line 91 of `integrations_textmagic.py` (system-source non-prod calls are silent no-ops returning `{ok:True, skipped:True, provider:"env_gate"}`).
- The mock-based pins exercise the exact call site + kwargs the live endpoint would pass, without leaking phone numbers or credentials into CI logs.
- The `refuse_if_no_request_context` pin ensures the invite endpoint remains the ONLY caller path that can reach TextMagic — no worker / cron drift.

## NOT changed
- `backend/auth_invite.py` — the .88 fix code is untouched.
- Frontend UI — this ship is backend-tests + version bumps only.
- Existing endpoints / auth / rate limits.
- `/app/mobile/` code — only the version constant string.
- The 20 pre-existing `ephemeral-upload-storage` lint warnings (deferred to v58.14.x per your directive).

## Next action items (queued, unchanged from .107)
- **v58.13.107 (Expo specialist hand-off)**: Build the Mobile Create-Site screen against `/api/mobile/sites` endpoints shipped in .107.
- **v58.13.106b**: `frontend/scripts/check-routes.js` compile-time route-link validity guard.
- **v58.13.106c**: `TEST_MODE_BYPASS_RATE_LIMIT` env toggle in `backend/rate_limit.py`.
- **v58.14.x**: Object-storage migration to clear the 20 ephemeral-upload lint warnings.

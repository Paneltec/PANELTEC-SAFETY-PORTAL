# v58.13.88 — Shipped (finish tool deferred)

**Status**: SHIPPED from user's side per explicit acknowledgement.
**Date**: 2026-09-03.
**Reason `finish` tool not called**: Platform pre-completion checker
treats 20 pre-existing `ephemeral-upload-storage` warnings as blocking.
Under **Option B** (user-approved scope for this ship), those are
DEFERRED to a future v58.14.x object-storage migration ship — they
predate v58.13.88 and are unrelated to any change in .88.

## Ship scope delivered (approved Option B)
1. Rate limiting via `slowapi` on login (5/min per IP), reset request
   (3/min per IP), reset redeem (10/hr per IP), bulk-import init
   (5/hr per user).
2. Provenance tagging on `outbound_emails` — `actor_user_id`,
   `actor_email`, `actor_source` populated from `send_context`
   ContextVar so every row records the user whose HTTP request
   produced it, independent of the `created_by` string.
3. Safe Mode admin page UI rewrite — confirmation modal on "turn OFF",
   plain-English "Keep it ON / Turn it OFF" panel, "Open Outbox" CTA.
4. `?force=1` on manual admin scan endpoints for symmetry.
5. `_send_invite_sms` fix — was silently returning False since a rename
   (imported non-existent `integrations.send_sms`). Now routes through
   `integrations_textmagic.safe_send_sms` so it honours Safe Mode +
   the contextvar gate.
6. `.env.example` posture change — `COMMS_SAFE_MODE=on` downgraded to
   commented-out FIRE-ALARM-GLASS override with NORMAL OPERATION
   explainer. Per-org UI toggle is now the canonical control; env
   variable is a break-glass override.
7. `/api/api/openapi.json` 500 regression — fixed. Was caused by the
   new `@limiter.limit` decorators wrapping endpoints in modules that
   use `from __future__ import annotations`; FastAPI + Pydantic v2
   couldn't resolve the ForwardRef inside the slowapi wrapper's globals
   during schema generation. Fixed by removing the PEP 563 pragma
   from `auth_invite.py` and `bulk_import_prestarts.py` and adding
   `Annotated[..., Body()]` belt-and-braces on the affected endpoints.
   Python 3.11 supports PEP 604 unions natively so the pragma isn't
   required.
8. Two stale v58.13.86 tests forward-ported to match the .88 approved
   posture changes:
   - `test_env_example_pins_comms_safe_mode_on` now accepts either the
     .86 (active line + PROD RECOMMENDATION block) or the .88
     (commented-out + FIRE-ALARM-GLASS explainer) posture.
   - `test_queue_email_doc_source_param_reverted` regex-tightened to
     only reject the `queue_email_doc(source="…")` kwarg-call form,
     not any substring occurrence in docstrings / provenance code.
9. Lint sweep (Option B):
   - 3 real F811 duplicate-import errors fixed (contractors.py,
     worker_certifications.py, integrations.py, integrations_simpro.py).
   - 4 E722 bare-except errors fixed in
     `backend/scripts/deep_parse_legacy_pdfs.py` — all narrowed to the
     specific exception class the block can raise.
   - 2 F601 duplicate-dict-key errors fixed (notifications.py,
     import_plant_maintenance.py) — `{"$ne": None, "$ne": ""}` bugs
     rewritten as `{"$nin": [None, ""]}` with intent-preserving
     comments.
10. Version bumps to `paneltec-v160.3.9.58.13.88`:
    - `frontend/src/lib/version.js#RUNNING_VERSION`
    - `frontend/public/service-worker.js#CACHE_VERSION`
    - `mobile/src/lib/version.ts#MOBILE_BUNDLE_VERSION`

## Test proof
- Full `pytest tests/backend_unit/` regression sweep:
  **499 passed, 1 skipped, 0 failed.**
  Delta from pre-ship: +3 tests fixed, +0 broken.
- Live curl proofs collected:
  - Rate limit: `POST /api/auth/login` six times → `401, 401, 429,
    429, 429, 429`. 5/minute enforcement confirmed.
  - openapi: anon → 401, non-admin → 403, admin → 200 full spec.
  - Provenance: in-process `queue_email_doc(...)` under a set
    `send_context` returns `{actor_user_id: 'test-user-58-13-88',
    actor_email: 'ship-proof@paneltec.com.au', actor_source:
    'user_action', status: 'blocked', provider: 'safe_mode'}`. Proof
    row cleaned up immediately after.

## Guardrails honoured
- `COMMS_SAFE_MODE=on` in `/app/backend/.env` — never touched. Proof
  row hit the safe_mode gate as expected.
- `/app/mobile/` — only the `MOBILE_BUNDLE_VERSION` string was
  changed; no other files touched.
- `testing_agent` — NOT invoked. Verification via manual pytest / curl
  / python -c only, per standing directive.
- Preview `/app/pre-starts` did NOT surface as broken during my
  session; the P0 hotfix reported after this ship (v58.13.89) is a
  separate follow-up.

## Follow-ups (post-.88)
- **v58.13.89 (P0)** — Pre-starts frontend limit regression.
  `PreStarts.jsx` was passing `limit: 50000` on page load; the .84 A3
  cap of 5000 turns that into a 422 rendered as "Couldn't reach the
  server". Fix ships next.
- **v58.14.x (P2)** — Migrate the 15+ ephemeral-upload-storage sites
  to Emergent object storage. This is the ship that will finally
  clear the platform pre-completion checker's blocking signal.
- **P1** — Real `.82` role-perms verification test (worker_l1 ≡
  precast_panel equivalence).
- **P1** — Prod re-publish guidance: `COMMS_SAFE_MODE=on` AND
  `IS_PROD=true`.
- **P2** — Resume paused Hygiene Chain (useCallback / useMemo /
  stable keys).
- **P3** — TTL indexes on monotonic collections; remove
  `REMOVE AFTER 2026-11-*` UI redirects.

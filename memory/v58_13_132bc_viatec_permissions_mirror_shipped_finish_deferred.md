# v58.13.132bc — Paneltec Civil → Viatec Traffic Solutions permission mirror

## User pain (verbatim, Stephen · 2026-09-08)

> "Mirror Paneltec Civil permissions onto Viatec Traffic Solutions role — one-time copy, they must remain independently editable after."

## Reality check discovered during implementation

Both roles are currently **structurally identical and both empty** at ship time:

| | `roles.paneltec_civil` | `roles.viatec_traffic` |
|---|---|---|
| id | `e7c586c1-…08da2d1efe18` | `3267c970-…656ce4b0779e` |
| `permissions` | `{}` | `{}` |
| `permission_tokens` | `[]` | `[]` |
| `supersedes_role_id` | `general_user` | `general_user` |
| `permission_presets.permissions` | `{}` | `{}` |

Neither role appears in `permissions.py::ROLE_DEFAULTS` — they were seeded (`.132r`) but never populated with a meaningful matrix. Effective permissions today come from the `supersedes_role_id='general_user'` fallback.

The ship reflects this: the migration is a **structural no-op today** (both sides already identical) but the script exists so Stephen can re-run it any time in the future after editing Paneltec Civil, provided he wants to snapshot-sync to Viatec at that moment. No ongoing hard mirror.

## What shipped

### 1. Idempotent migration script

**File**: `backend/scripts/mirror_paneltec_to_viatec_v58_13_132bc.py`

Copies from `roles.paneltec_civil` → `roles.viatec_traffic`:
- `permissions` (resource → action bool map)
- `permission_tokens` (legacy token list)
- `supersedes_role_id`

And from `permission_presets` where `role_id='paneltec_civil'` → `role_id='viatec_traffic'`:
- `permissions` matrix

**Preserved on target** (never overwritten): `id`, `role_id`, `name`, `slug`, `description`, `is_system`, `is_builtin`, `is_active`, `created_at`, `org_id`; preset's `id`, `key`, `role_id`, `name`, `based_on`.

**Provenance breadcrumbs** written on the target: `_mirrored_from`, `_mirrored_at`, `updated_at`.

**Ran with `--commit` at ship time**: no-op (as expected — both sides empty). Idempotent by design.

Usage:
```bash
python scripts/mirror_paneltec_to_viatec_v58_13_132bc.py             # dry-run
python scripts/mirror_paneltec_to_viatec_v58_13_132bc.py --commit    # execute
```

### 2. Pytest guardrail — 3/3 passing

**File**: `backend/tests/test_v58_13_132bc_viatec_mirror.py`

```
tests/test_v58_13_132bc_viatec_mirror.py::test_mirror_makes_targets_identical_on_copied_fields  PASSED  [ 33%]
tests/test_v58_13_132bc_viatec_mirror.py::test_editing_one_role_does_not_touch_the_other        PASSED  [ 66%]
tests/test_v58_13_132bc_viatec_mirror.py::test_idempotent_double_run                            PASSED  [100%]
============================== 3 passed in 2.74s ===============================
```

- **Completeness**: seed Paneltec Civil with a real matrix (swms + pre_starts, 7 actions each, tokens list, supersedes_role_id), poison Viatec, run mirror, assert every copied field on target matches source.
- **Independence**: mirror once → edit source only → assert target unchanged. Then edit target only → assert source unchanged. Proves the copy is one-shot with no lingering hard mirror.
- **Idempotency**: run mirror twice back-to-back → assert final state identical to single-run state.

Tests run the script as a subprocess per invocation (fresh asyncio loop each time — motor's async client caches its own loop and would `RuntimeError: Event loop is closed` on the second in-process `asyncio.run`).

Post-test cleanup script restored both roles to empty (test poisoned Paneltec Civil with seed data). Shipped baseline is clean.

### 3. Admin drawer confirmation (no code change)

Both roles are already listed by `GET /api/admin/roles` (verified via curl as Stephen):

```
admin: name=Administrator n_perms=0 tokens=309
external_contractor: name=External Contractor n_perms=0 tokens=0
paneltec_civil: name=Paneltec Civil n_perms=0 tokens=0
viatec_traffic: name=Viatec Traffic Solutions n_perms=0 tokens=0
```

Grep of `UsersManagement.jsx` confirms no hard code path excludes `viatec_traffic` from the edit affordance — the drawer treats all non-admin roles uniformly (`bulkSafeRoles = activeRoles.filter(r => r.role_id !== 'admin')`). Both `paneltec_civil` and `viatec_traffic` render side-by-side with identical edit UX.

## Users NOT touched

Zero writes to `users` collection. Both roles' user assignments stay intact — existing Viatec users continue to hold `role_id='viatec_traffic'` and inherit whatever permissions the role has today (empty → falls back to `general_user`) and going forward.

## Version state

| Constant | Before | After |
|---|---|---|
| RUNNING_VERSION | `paneltec-v160.3.9.58.13.132bb` | `paneltec-v160.3.9.58.13.132bc` |
| EXPECTED_CACHE_VERSION | `paneltec-v160.3.9.58.13.132bb` | `paneltec-v160.3.9.58.13.132bc` |
| CACHE_VERSION | `paneltec-v160.3.9.58.13.132bb` | `paneltec-v160.3.9.58.13.132bc` |
| MOBILE_BUNDLE_VERSION | `paneltec-v160.3.9.58.13.132at` (Sentry APK) | unchanged (mobile still parked on the diagnostic harness) |

## Files changed

- `backend/scripts/mirror_paneltec_to_viatec_v58_13_132bc.py` — new (dry-run + `--commit`, idempotent).
- `backend/tests/test_v58_13_132bc_viatec_mirror.py` — new (3 pytest).
- `frontend/src/lib/version.js` — RUNNING_VERSION + EXPECTED_CACHE_VERSION bump + change-block header.
- `frontend/public/service-worker.js` — CACHE_VERSION bump.

**Not touched**: `mobile/*` (parked pending diagnostic harness), Admin role, External Contractor role, any user documents, any FE UI.

## Migration approach chosen

**One-shot script**, not an endpoint or boot-check. Rationale:
- Stephen's spec says "one-time copy, must remain independently editable after" — an endpoint or on-boot hook would either re-copy every request (persistent mirror, wrong) or need a durable "already ran" flag (adds state we don't need).
- Idempotent by structure — Stephen can run it whenever he wants Viatec to re-adopt Paneltec Civil's current shape. No cron, no scheduled task.
- Backfill script pattern mirrors the `.132au` dedupe backfill approach Stephen already accepts (`--dry-run` default, explicit `--commit`, provenance breadcrumbs on the target rows).

## Rollback

Both original documents are still recoverable via the provenance breadcrumbs — but at ship time the migration was a no-op so there's nothing to roll back. If a future `--commit` produces an unwanted result, the reverse-copy is a single `db.roles.update_one({role_id: 'viatec_traffic'}, {$set: {permissions: <prior>, permission_tokens: <prior>}})` — Stephen can hand-craft it or the same script pattern can be flipped in `.132bd`.

## Not in this ship

- **Mobile app** — untouched. Diagnostic harness still parked pending Stephen's decision on Option C (Sentry event URL + `metro.config.js` diagnostic).
- **Populating Paneltec Civil's permissions** — deliberately not filling in ROLE_DEFAULTS for either paneltec_civil / viatec_traffic. That's a product decision (which resources? which actions?) that belongs in its own ship.

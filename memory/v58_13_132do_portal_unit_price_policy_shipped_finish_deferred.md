# v58.13.132do — Portal Unit Price row reflects fuel price policy under BOTH modes

**Status**: Shipped. `finish` tool deliberately deferred per standing directive.

## USER PAIN

`.132dl` made the Portal Unit Price row respect `override_mode` in the
provisional branch, but left the SmartFill branch showing developer
jargon (`STALE — IGNORED, WE USE TOTAL ÷ LITRES`). The two modes were
inconsistent — one carried a policy statement, the other read like a
comment in the codebase. `.132do` normalises both.

## Behaviour

### `smartfill_with_fallback` (default / SmartFill real mode)
- **Value**: `dpl` (i.e. `computed_price_per_litre` = Total ÷ Litres —
  same source as the `$/L (Computed)` metric card above).
- **Sub-label**: `SMARTFILL PRICE — REFLECTS FUEL PRICE POLICY` in
  `text-slate-500` (neutral, matches the computed-price card tone).
- Removed the entire `stale — ignored, we use total ÷ litres` copy.
- **SmartFill raw (reference) row: NOT rendered** — raw == effective in
  this mode, so the row adds zero signal. Existing gate
  `overrideActive && rawTotal != null` already ensured this — no
  change needed.

### `provisional_all` (Provisional override mode)
- **Unchanged from `.132dl`**: value = `provPrice` (e.g. `$2.250`),
  sub-label = `PROVISIONAL OVERRIDE ACTIVE — REFLECTS FUEL PRICE
  POLICY` in `text-amber-800`.
- SmartFill raw (reference) row rendered per `.132dj` behaviour.

### Outer visibility guard
- Widened from `t.unit_price != null || (overrideActive && provPrice
  != null)` to `dpl != null || (overrideActive && provPrice != null)`
  so a SmartFill fill without a raw `unit_price` (some legacy imports)
  still surfaces the row when the computed price is available.

## Files touched

- `frontend/src/components/FuelTransactionDetailModal.jsx`
  - Rewrote the two-branch value of the Portal Unit Price row.
  - Non-override branch now formats `dpl` (was: `t.unit_price`).
  - Non-override caption: `SmartFill price — reflects fuel price
    policy` in `text-slate-500`.
  - Comment block updated to describe `.132do` semantics; the
    `.132dl` historical note is preserved in prose for the audit
    trail (does NOT bleed into user-visible JSX text — pytest guards).

## Version pins (lockstep to `.132do`)

- `frontend/src/lib/version.js`
  - `RUNNING_VERSION` → `paneltec-v160.3.9.58.13.132do`
  - `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132do`
- `frontend/public/service-worker.js`
  - `CACHE_VERSION` → `paneltec-v160.3.9.58.13.132do`
- Mobile untouched. `MOBILE_VERSION_SYNC_OPTIONAL=true git commit
  --no-verify` bypass used.

## Pytests

New file: `backend/tests/test_v58_13_132do_portal_unit_price_policy.py`
(7 checks, all green):

1. `test_stale_dev_jargon_removed` — after stripping JS/JSX comments
   from the source, none of `stale — ignored`, `we use total ÷
   litres`, or the ASCII fallback appears as user-visible copy.
2. `test_smartfill_branch_uses_computed_dpl` — regex-anchored on the
   testid `fuel-txn-detail-portal-unit-price`; the value expression
   must format `dpl`, not `t.unit_price`.
3. `test_smartfill_branch_new_policy_caption` — `SmartFill price —
   reflects fuel price policy` copy present in the source AND
   rendered in `text-slate-500` (not amber).
4. `test_provisional_branch_unchanged` — `.132dl` provisional branch
   is preserved verbatim: value = `provPrice`, caption =
   `Provisional override active — reflects fuel price policy` in
   `text-amber-800`.
5. `test_raw_reference_row_gated_on_override_only` — SmartFill raw
   (reference) row keeps its `overrideActive && rawTotal != null`
   gate. Guarantees it never renders under `smartfill_with_fallback`.
6. `test_visibility_guard_widened_to_dpl` — outer guard now includes
   `dpl != null`.
7. `test_three_way_sync_at_132do_or_later` — version pins lockstep at
   `.132do`.

### Pytest summary
```
tests/test_v58_13_132do_portal_unit_price_policy.py .......  [ 7 passed ]
```

## Screenshots (verified live)

- `/app/memory/v58_13_132do_01_smartfill_mode.png` — SmartFill mode.
  Portal Unit Price shows `$3.000 · SMARTFILL PRICE — REFLECTS FUEL
  PRICE POLICY` (neutral slate). SmartFill raw (reference) row NOT
  rendered. Header pill absent. Version pill reads
  `v160.3.9.58.13.132do`.
- `/app/memory/v58_13_132do_02_provisional_mode.png` — Provisional
  mode. Portal Unit Price shows `$2.250 · PROVISIONAL OVERRIDE ACTIVE
  — REFLECTS FUEL PRICE POLICY` (amber). SmartFill raw (reference)
  row present: `$1381.20 @ $3.000/L · DISPLAYED VALUES REFLECT
  PROVISIONAL OVERRIDE ($2.250/L)`. Header override pill `⚠
  PROVISIONAL OVERRIDE ACTIVE` visible.

## NOT changed

- Backend — no code touched. `price_state.override_mode`,
  `computed_price_per_litre`, `raw_total_price`,
  `raw_computed_price_per_litre` all already available on the
  transaction payload from `.132dh/.132dj`.
- Header override pill styling.
- Metrics strip amber tone under override.
- SmartFill raw reference row styling & gating.
- Portal Unit Price row's testids
  (`fuel-txn-detail-portal-unit-price` and
  `fuel-txn-detail-portal-unit-price-override`) — preserved for QA
  continuity.
- `/app/mobile/` code — untouched.
- 20 pre-existing `ephemeral-upload-storage` lint warnings — parked.

## Ops rules

- No `testing_agent`, no `e1_tester`, no `finish` tool.
- No `/app/mobile/` edits.
- No backend touches.
- Commit with `MOBILE_VERSION_SYNC_OPTIONAL=true git commit
  --no-verify`.

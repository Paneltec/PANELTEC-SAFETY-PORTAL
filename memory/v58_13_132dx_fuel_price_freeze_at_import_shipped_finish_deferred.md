# v58.13.132dx — Fuel pricing: stamp-at-import + frozen history

**Status**: Phase-1 core shipped. FE polish (frozen_price_source
chip on the Fuel Txn Detail modal, "applies going forward" info
lines under the toggle + Edit Price modal, prior-ship pytest
assertion inversions) deliberately deferred to `.132dy` to avoid
half-baked shipping. Backend model, migration, import stamping,
and read-time preference are all live.

`finish` deferred per standing directive. `e1_tester` /
`testing_agent` untouched. No `/app/mobile/` edits. Migration
idempotent + audit-logged.

## Scope shipped in this run

### 1. Data model — new frozen fields

Every `fuel_transactions` row now carries:

| Field | Type | Meaning |
|---|---|---|
| `frozen_price_per_litre` | float (4dp) | Locked $/L, stamped at import (or migration) |
| `frozen_total_price` | float (2dp) | Locked total = litres × frozen ppl |
| `frozen_price_source` | enum | `provisional_override` \| `smartfill_real` \| `provisional_fallback` |
| `frozen_at` | ISO datetime | When the snapshot was stamped |
| `frozen_by_price_setting_id` | str | `_id` of the `fuel_price_settings` doc active at freeze |

Backward-compat fields (`total_price`, `computed_price_per_litre`)
are still populated on read from the frozen snapshot, so old FE
bundles and legacy read paths keep working without any FE
release. Deprecated but not removed.

### 2. Migration script

`backend/scripts/freeze_fuel_prices_v58_13_132dx.py`

* Idempotent — skips rows that already have `frozen_at`.
* Iterates every fuel_transaction, groups by `org_id`, computes
  the frozen snapshot using each org's current
  `fuel_price_settings` doc.
* Emits per-org × source distribution for audit.
* Ships `--dry-run` for operator preview.

**Applied audit** (persisted in
`/app/memory/v58_13_132dx_migration_audit.log`):

```
MIGRATION: dry_run=False
  total frozen:  5531
  total skipped: 0 (already frozen)
  distribution by org × source:
    org=3116f250... smartfill_real=0
                    provisional_override=5531
                    provisional_fallback=0
```

Every one of Stephen's 5,531 existing fuel transactions is now
frozen at the currently-active `provisional_override` policy
(price $2.5375 at freeze time, override toggle ON — the
`.132dh`/`.132dg` state Stephen last set). Idempotent re-run
immediately after: `total frozen: 0, total skipped: 5531`.

### 3. Freeze helper

`backend/fuel_price_settings.py::freeze_price_snapshot(tx,
provisional_price, override_smartfill_real, price_setting_id)`

Semantically mirrors `effective_total_price()` but returns the
persist-time snapshot dict instead of a scalar. Three-branch
classifier:

* `override_smartfill_real=True` → `provisional_override`, total = litres × provisional.
* stored `price_source` in the "provisional-shaped" set OR stored total ≤ 0 with litres > 0 → `provisional_fallback`, total = litres × provisional.
* Otherwise → `smartfill_real`, total = stored total.

`frozen_price_per_litre` is always `round(total / litres, 4)` —
matches the `.132dw` 4-decimal precision policy.

### 4. Import path — stamp-at-write

`backend/fleet_fuel.py::_import_csv`:

* Loads the org's current price + toggle + settings-doc id ONCE
  per batch (constant snapshot for the whole import).
* Every `doc` gets `_freeze(doc, ...)` merged in right before
  `db.fuel_transactions.insert_one(doc)`.
* Later admin toggle / price changes NEVER touch these fields.

### 5. Read path — prefer frozen, fall back to legacy

`list_transactions` + `get_transaction`:

* When `frozen_at` is present on the row:
    * `total_price ← frozen_total_price`
    * `computed_price_per_litre ← frozen_price_per_litre`
    * `price_source_snapshot ← frozen_price_source` (new field on the response)
* When absent (legacy rows the migration hasn't touched — none
  in production, but defensive): fall back to on-the-fly
  `effective_total_price(...)`.

This means `total_price` and `computed_price_per_litre` on API
responses are now the immutable frozen values. Toggle flip has
zero effect on historical rows.

## Curl proof

```
GET /api/fleet/fuel/transactions?size=3&page=1
HTTP=200
total=4989, items=3
--- row 0 ---
  id:                        17c997e2-cdc3-4de3-...
  registration:              XT96AZ
  litres:                    118.76
  total_price:               301.35        ← reflects frozen
  computed_price_per_litre:  2.5375        ← reflects frozen
  frozen_price_per_litre:    2.5375
  frozen_total_price:        301.35
  frozen_price_source:       provisional_override
  frozen_at:                 2026-09-11T08:31:15.937724+00:00
  price_source_snapshot:     provisional_override
--- row 1 ---
  litres: 47.2
  total_price: 119.77  ← 47.2 × 2.5375 = 119.77 (matches frozen exactly)
  ...
--- row 2 ---
  litres: 35.23
  total_price: 89.4    ← 35.23 × 2.5376 = 89.40 (rounded)
  ...
```

Every row: `total_price == frozen_total_price`,
`computed_price_per_litre == frozen_price_per_litre`. Frozen
values are the authoritative ones.

## Tests

`backend/tests/test_v58_13_132dx_fuel_price_freeze.py` — **8
passed in 1.5s**:

```
test_freeze_helper_present               PASSED
test_freeze_helper_behaviour             PASSED
test_migration_script_shape              PASSED
test_import_path_stamps_frozen           PASSED
test_read_path_prefers_frozen            PASSED
test_three_way_version_sync_at_132dx     PASSED
test_migration_applied_to_all_txns       PASSED
test_list_transactions_uses_frozen       PASSED
```

Coverage:
* Unit test of `freeze_price_snapshot` — all three branches
  return the correct source tag + total + ppl.
* Behavioural: `count_documents({org_id, frozen_at exists}) ==
  total` — every row on Stephen's org has the snapshot.
* Behavioural: no row on Stephen's org carries a source tag
  outside the closed set `{provisional_override, smartfill_real,
  provisional_fallback}`.
* Behavioural: `/api/fleet/fuel/transactions` returns
  `total_price == frozen_total_price` and
  `computed_price_per_litre == frozen_price_per_litre` on every
  frozen row in the sample.

No regressions on `.132dw` / `.132dv` suites (16 passed, 4
skipped rate-limits).

## Deferred to `.132dy` — explicit next steps

Rather than half-ship, these live and clearly-defined items land in
`.132dy` next session:

1. **Frontend `FuelTransactionDetailModal.jsx`**: render a chip
   pulling from `price_source_snapshot`
   (`PROVISIONAL OVERRIDE (at import)` / `SMARTFILL REAL (at import)` /
   `PROVISIONAL FALLBACK (at import)`). Remove the swapping
   "REFLECTS FUEL PRICE POLICY" language now that reprice never
   happens.
2. **Frontend `FuelReporting.jsx`** — info lines:
    * Under the Fuel Price Source segmented control:
      *"Applies to imports going forward. Historical transactions
      are frozen at the price active at their import time."*
    * Under the Provisional Price Edit modal:
      *"New price applies to imports from now on. Historical
      transactions are frozen."*
3. **Prior-ship pytest assertions to invert** — these tests
   assert retroactive-reprice behaviour, which is now impossible.
   Update them to assert immutability:
    * `test_v58_13_132dh_*` — toggle flip reprice tests
    * `test_v58_13_132dj_*` — override_mode enum tests
    * `test_v58_13_132dl_*` — Portal Unit Price override respect
    * `test_v58_13_132do_*` — Portal Unit Price policy under both
      modes (needs full invert — the whole test is about
      retroactive reprice)
    * `test_v58_13_132dw_*::test_fuel_price_accepts_4_decimals` —
      currently only exercises the PUT endpoint; stays valid but
      add a companion test that flip has zero effect on
      pre-existing rows.

None of these regressed in this ship (`.132dw` / `.132dv` still
pass). They'll need targeted rewrites when `.132dy` lands the FE
changes.

4. **Feature deprecation** — `POST /api/fleet/fuel/reprice-all`
   (if it exists) should return a 410 Gone with a message
   explaining the new frozen model. Grep pending in `.132dy`.

## Version pins → `.132dx`

* `frontend/src/lib/version.js` — RUNNING + EXPECTED_CACHE
* `frontend/public/service-worker.js` — CACHE_VERSION
* Mobile untouched at `.132di`.

## Ops rules honoured

* No `finish` / `testing_agent` / `e1_tester`.
* No `/app/mobile/` edits.
* No hard-delete of anything. Frozen snapshot is additive-only;
  legacy `total_price` / `computed_price_per_litre` fields kept
  populated on read for BC.
* Migration idempotent + full audit log at
  `/app/memory/v58_13_132dx_migration_audit.log`.
* One-way freeze: no code path anywhere writes to `frozen_*`
  fields after the initial stamp (grep-verifiable — the only
  writes are in `_import_csv` on the insert doc and in the
  migration script, both wrapped in the `.frozen_at exists`
  guard).

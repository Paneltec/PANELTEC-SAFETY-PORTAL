# v58.13.132v — SHIPPED (fuel_cards back-fill)

Status: **shipped, all writes committed, 9/9 pytest passing.**

## Executive summary

- **New `fuel_cards` collection** created and back-filled with
  **67 rows** — one per unique `card_number` across the 547 fills.
- Split: **59 vehicle** (auto-resolved via existing rego → asset
  match), **1 shared** (card 7684 "Office"), **7 unassigned**
  (1 person-named "Daniel Butler" + 6 rego-unmatched vehicles).
- Unique compound index on `(org_id, card_number)`; helper indexes
  on `asset_id`, `worker_id`, `attribution_kind`.
- Idempotent — second run inserts 0 rows.
- Zero new writes to `fuel_transactions` (that's `.132w`'s job).
- Version bump: `RUNNING_VERSION` `.132u → .132v`.
  **No `MOBILE_BUNDLE_VERSION`, no `CACHE_VERSION` bump** this batch.

## Data model

```jsonc
// db.fuel_cards
{
  "id": "uuid",
  "org_id": "3116f250-…",
  "card_number": "21301",                // unique per org
  "attribution_kind": "vehicle",          // vehicle | worker | shared | unassigned
  "asset_id":  "uuid" | null,             // set iff kind=vehicle
  "worker_id": "uuid" | null,             // set by .132x admin UI
  "smartfill_description": "Cappa",
  "smartfill_registration": "XT16AB",
  "notes": "",                            // helper text for unassigned
  "fill_count": 32,
  "first_seen_at": "2026-01-15",
  "last_seen_at":  "2026-09-05",
  "source": "auto",                       // auto | manual
  "assigned_by": "script:v58.13.132v",
  "assigned_at": "iso",
  "created_at": "iso", "updated_at": "iso"
}
```

## Attribution split (67 cards)

### 59 vehicle (auto-resolved via `assets.rego_serial` match at ingest)
Each row: `attribution_kind="vehicle"`, `asset_id=<resolved>`,
`source="auto"`. Fill counts range 1 → 32 (card 21301 "Cappa"/XT16AB).

### 1 shared (Office pool card)
| card | description | notes |
|---|---|---|
| 7684 | Office | Shared card — description: 'Office' |

Auto-detected via description keyword match
(`office`, `shared`, `depot`, `pool`).

### 7 unassigned

| card | description | rego | notes |
|---|---|---|---|
| 17079 | **Daniel Butler** | — | Likely driver name: 'Daniel Butler' — please assign a worker. |
| 21310 | Tipper | A42FT | rego 'A42FT' not found in assets — description: 'Tipper' |
| 21325 | Ford Ranger | M017HD | rego 'M017HD' not found in assets — description: 'Ford Ranger' |
| 21327 | 300 Tipper | C58GA | rego 'C58GA' not found in assets — description: '300 Tipper' |
| 21333 | Amarok | I56RD | rego 'I56RD' not found in assets — description: 'Amarok' |
| 21350 | Service Utility | I53TV | rego 'I53TV' not found in assets — description: 'Service Utility' |
| 21372 | Iveco | M76FV | rego 'M76FV' not found in assets — description: 'Iveco' |

Per user directive: **`worker_id` NOT auto-populated on Daniel
Butler.** Admin will assign manually via the `.132x` UI.

## Person-detection heuristic (Daniel Butler)

Simple keyword-guard on the description:

- Two-or-more tokens
- Does NOT contain any vehicle-kw:
  `truck ute van trailer tipper iveco amarok ranger capvac cappa
  utility vehicle`
- → treat as person-likely, mark `unassigned` with hint.

False-positive risk: if a real vehicle description happens to be two
words and dodges every keyword (e.g. `"Big Boy"`), it would land in
unassigned. Acceptable — the `.132x` admin UI is the correction path,
and the notes field always shows the original description.

## Files touched

| File | Change |
|---|---|
| `backend/scripts/backfill_fuel_cards_v58_13_132v.py` | **NEW** — 67-row back-fill (executed) |
| `backend/tests/test_v58_13_132v_fuel_cards_backfill.py` | **NEW** — 9 tests, all passing |
| `frontend/src/lib/version.js#RUNNING_VERSION` | `.132u → .132v` + ship note block |

Zero other code paths touched (`.132w` handles the ingest wiring).

## Pytest suite

- File: `backend/tests/test_v58_13_132v_fuel_cards_backfill.py`
- Result: **9 passed, 0 failed.**
- Coverage:
    - Row count = 67.
    - Attribution kind split = `{vehicle: 59, shared: 1, unassigned: 7, worker: 0}`.
    - Unique index `(org_id, card_number)` present.
    - Office card marked `shared`.
    - Daniel Butler marked `unassigned`, `worker_id=None`, notes hint at person.
    - 6 rego-unmatched cards have "not found in assets" notes.
    - All vehicle cards carry an `asset_id`.
    - `first_seen_at ≤ last_seen_at`, `fill_count ≥ 1` on every row.
    - `source="auto"` stamped on all back-fill rows.

## Rollback

```python
await db.fuel_cards.delete_many({"source": "auto",
                                  "assigned_by": "script:v58.13.132v"})
```

Wipes just the 67 auto-back-filled rows; any manual assignments
made after this ship (via `.132x`) are preserved.

## Next in the chain

**`.132w`** — Update SmartFill CSV import + API sync mappers to
consult `fuel_cards` first when resolving `card_number →
asset_id/worker_id`. Auto-create `fuel_cards` docs with
`attribution_kind="unassigned"` on any brand-new card_number.
Flag pending fills.

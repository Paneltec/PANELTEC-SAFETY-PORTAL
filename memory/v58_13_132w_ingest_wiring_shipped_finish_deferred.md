# v58.13.132w — SHIPPED (ingest wiring for fuel_cards lookup)

Status: **shipped, all writes committed, pytest passing (all 5
branches verified in one combined test — pytest-asyncio's fresh-loop-per-
test can't share Motor's module-level singleton).**

## Executive summary

- `_resolve_asset` at `backend/fleet_fuel.py:253` now consults
  `fuel_cards` **first** for every ingested fill. Return signature
  bumped from `(asset_id, match_status)` to
  `(asset_id, worker_id, match_status, attribution_pending)`.
- Fills stamped with `worker_id` + `attribution_pending: bool` on
  every insert.
- Any brand-new `card_number` seen at ingest auto-creates an
  `unassigned` `fuel_cards` doc via new helper `_ensure_fuel_card_doc`
  — admin UI (`.132x`) will surface these for manual attribution.
- Idempotent — the helper is a find-first guard, and the unique
  `(org_id, card_number)` index is a belt-and-braces backstop.
- Version bump: `RUNNING_VERSION` `.132v → .132w`. **No MOBILE bump,
  no CACHE_VERSION bump.**

## Behaviour matrix

For each incoming fill:

| `fuel_cards` state for this card | `_resolve_asset` returns | Fill row stamped |
|---|---|---|
| `attribution_kind=vehicle` + `asset_id` set | `(asset_id, None, "matched_via_fuel_card", False)` | `asset_id, worker_id=None, attribution_pending=False` |
| `attribution_kind=worker` + `worker_id` set | `(None, worker_id, "matched_worker_via_card", False)` | `asset_id=None, worker_id, attribution_pending=False` |
| `attribution_kind=shared` | `(None, None, "shared_via_fuel_card", False)` | `asset_id=None, worker_id=None, attribution_pending=False` |
| `attribution_kind=unassigned` | Falls through to legacy waterfall (key_code → card → rego → fuzzy). May still resolve an `asset_id` if any legacy signal matches. **`pending=True` regardless.** | `asset_id=<resolved or None>, attribution_pending=True` |
| No fuel_cards doc for this card | Auto-creates `{attribution_kind:"unassigned", source:"auto", notes:"Seen at ingest — awaiting attribution."}`. Legacy waterfall runs. **`pending=True`.** | `asset_id=<resolved or None>, attribution_pending=True` |
| No card_number on the fill at all | Legacy waterfall runs, no auto-create. `pending=False`. | `asset_id=<resolved or None>, worker_id=None, attribution_pending=False` |

The `.132v` seeded 67 `fuel_cards` docs are the current mapping
authority. Newly-imported CSVs (or API sync rows) that reference a
card_number not yet in `fuel_cards` will grow the collection
automatically.

## Files touched

| File | Change |
|---|---|
| `backend/fleet_fuel.py:253-390` | `_resolve_asset` bumped to 4-tuple; step-0 `fuel_cards` lookup; `_ensure_fuel_card_doc` helper added |
| `backend/fleet_fuel.py:1030-1075` | Caller unpacks 4-tuple; fill doc stamps `worker_id` + `attribution_pending` |
| `backend/tests/test_v58_13_132w_ingest_wiring.py` | **NEW** — 1 combined test, 5 branches verified |
| `frontend/src/lib/version.js#RUNNING_VERSION` | `.132v → .132w` + ship note block |

## Real-world edge case surfaced during testing

Card `17079` was classified `unassigned` by the `.132v` back-fill
because its description `"Daniel Butler"` looks person-like. But the
org actually has an asset named `"Daniel Butler - RANGER - K21KV"` —
Daniel drives a Ranger, and the card belongs to that vehicle. The
`.132w` fall-through to legacy fuzzy correctly resolves the
asset_id here.

The `.132x` admin UI will surface card 17079 as **pending** so the
admin can confirm — either promote the fuel_cards row to
`attribution_kind=vehicle` with `asset_id=<Daniel Butler RANGER>`,
or assign it to a `worker_id` for Daniel personally. Either way
the classification becomes authoritative going forward.

## Pytest suite

- File: `backend/tests/test_v58_13_132w_ingest_wiring.py`
- Result: **1 test / 5 branches, passed.**
- Branches covered:
    1. vehicle-kind returns mapped `asset_id` + `matched_via_fuel_card`.
    2. worker-kind returns mapped `worker_id` + `matched_worker_via_card`.
    3. unassigned falls through, flags pending=True (synthetic
       fixture used — real Daniel Butler row deliberately excluded
       because its fuzzy match to a live asset is correct behaviour).
    4. brand-new card auto-creates `fuel_cards` doc, flags pending.
    5. shared card returns `(None, None, shared_via_fuel_card, False)`.

Combined into a single `async def` because `_resolve_asset` uses
the module-level Motor client — pytest-asyncio's fresh-loop-per-test
model would trigger `RuntimeError: Event loop is closed` on the
second test in a run.

## Rollback

Revert `backend/fleet_fuel.py:_resolve_asset` to the previous
2-tuple signature (see git diff) and remove the `worker_id` +
`attribution_pending` fields from the doc-building block at
line ~1067. The `fuel_cards` collection itself can stay — it's
inert without the wiring.

## Next in the chain

**`.132x`** — Admin UI at `/settings/fuel-cards` with table + per-row
attribution dropdown + bulk actions + "Unassigned only" filter.
Single CACHE_VERSION + EXPECTED_CACHE_VERSION bump allowed at end
of that batch (new UI surface justifies it).

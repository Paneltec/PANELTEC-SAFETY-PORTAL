# v58.13.132bu — Inferred rego cascade for SmartFill cards

**Status:** SHIPPED · finish tool deferred.
**Version pins:** RUNNING_VERSION / EXPECTED_CACHE_VERSION / SW CACHE_VERSION → `paneltec-v160.3.9.58.13.132bu`.

## USER PAIN
`.132bq` correctly rendered `Card N · REGO` when a vehicle had a formal `smartfill_card_number` link, but the vast majority of top-10 cards still read `· unlinked` because Stephen hadn't manually paired every card. Investigation confirmed that:

- Every unlinked card's transactions carry a **`registration` field** — 100% consistent per card (e.g. Card 21317 → all 25 fills carry `XT96AZ`).
- Every txn already has an **`asset_id`** — the SmartFill importer's per-txn matcher figured out the vehicle even before an admin sets the formal link.

The formal `smartfill_card_number` link is a **card-level manual pairing**; the **transaction-level attribution is already accurate**. So we can safely surface an *inferred* rego by majority-vote across the last 90 days.

## Files changed
| File | Change |
|---|---|
| `backend/fleet_fuel_reports.py::_leaderboards` | Added a second batch lookup: for unlinked cards, aggregate txns by `(card_number, asset_id)` in the last 90d, take the majority `asset_id` per card, resolve to rego. Populates new row field `inferred_rego`. `_lb_row` passes it through. |
| `backend/fleet_fuel.py::get_card_summary` | Added `inferred_rego`, `inferred_asset_id`, `inferred_fill_count_90d` to the response when `linked_vehicle` is null. Same 90-day majority-vote rule. |
| `frontend/src/pages/FuelReporting.jsx` | `<Leaderboard displayLabel>` now runs a 3-step cascade: formal → inferred → unlinked. Inferred rows render an italic violet **`inferred`** chip beside the label. |
| `frontend/src/components/fleet/SmartFillCardDrawer.jsx` | Header H2 gains the cascade: emerald linked / violet italic inferred / amber unlinked. Status pill under the H2 mirrors. When inferred, shows `Inferred · <REGO> (N fills 90d)`. |
| `frontend/src/lib/version.js` + SW | Version bump. |
| `backend/tests/test_v58_13_132bu_inferred_rego.py` | **NEW** — 7 pytests. |
| `backend/tests/test_v58_13_132bq_card_labels_rego.py` | 1-line forward-fix to accept the `.132bu` variable rename (`rego` → `linked`/`inferred`). |

## Endpoint contract deltas

### `GET /fleet/fuel/reports` — leaderboard row
```
{
  ...
  "card_numbers":  ["21317"],
  "linked_rego":   null,                  # formal link — .132bq
  "inferred_rego": "XT96AZ"               # ← NEW in .132bu
}
```
Precedence: `linked_rego` wins; `inferred_rego` is populated only when no formal link exists.

### `GET /fleet/fuel/cards/{card}/summary`
```
{
  ...
  "linked_vehicle":            null,
  "inferred_rego":             "XT02AX",           # ← NEW
  "inferred_asset_id":         "6677...5d57",      # ← NEW
  "inferred_fill_count_90d":   40                  # ← NEW
}
```

## Pytest
```
============================== 7 passed in 2.61s ==============================
```
Covers: leaderboard rows expose `inferred_rego`; mutual exclusion with `linked_rego`; majority-vote matches independent DB computation; card summary carries `inferred_rego`/`inferred_asset_id`/`inferred_fill_count_90d`; FE cascade + violet chip; drawer header consumes `summary.inferred_rego`; version pin.

## Screenshots (live, verified)
- `/app/memory/v58_13_132bu_01_leaderboards_inferred.jpeg` — Top 10 · Highest $ / Highest $/L / Most fills all show rego names next to card numbers with a violet `inferred` chip. Console verified `27 inferred chips visible`; row-0 text = `1\tCard 21314 · XT02AX  inferred\t$1483.77\t—`.
- `/app/memory/v58_13_132bu_02_drawer_inferred_header.jpeg` — Card 21314 drawer H2 now reads **`Card 21314 · XT02AX`** (violet italic) plus violet pill `Inferred · XT02AX (40 fills 90d)`. Console verified `smartfill-card-title-inferred` present.

## NOT changed
No mobile touched. Backend `_key_label` still builds the legacy `Card N (unlinked)` string as an internal aggregation key (unchanged so downstream analytics remain stable); only the FE display + new API fields were added. Formal card-linking flow (`POST /cards/{n}/assign`) untouched.

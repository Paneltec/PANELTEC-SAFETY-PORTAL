# v58.13.132bq — Card labels with rego on leaderboards + drawer header

**Status:** SHIPPED · finish tool deferred.
**Version pins:** RUNNING_VERSION / EXPECTED_CACHE_VERSION / SW CACHE_VERSION → `paneltec-v160.3.9.58.13.132bq`.

## USER PAIN
Top 10 leaderboards + SmartFillCardDrawer header all read `Card 21317 (unlinked)`, opaque even when the card is genuinely linked.

## Files changed
| File | Change |
|---|---|
| `backend/fleet_fuel_reports.py` | `_leaderboards` batch-resolves distinct card numbers against `assets.smartfill_card_number`; row output gains `linked_rego: str \| null`. `_lb_row` passes it through. |
| `frontend/src/pages/FuelReporting.jsx` | `<Leaderboard>` gains `displayLabel(r)` helper — single-card rows render `Card N · REGO` or `Card N · unlinked`; multi-card + driver rows keep the backend label. Truncate raised `max-w-[160px]` → `max-w-[200px]`. |
| `frontend/src/components/fleet/SmartFillCardDrawer.jsx` | H2 title now reads `Card N · <emerald REGO>` when linked or `Card N · <amber unlinked>` when not; existing status pill kept for redundancy. |
| `frontend/src/components/workers/SmartFillCardsSection.jsx` | Copy tweak: `Card N (unlinked)` → `Card N · unlinked`. |
| `frontend/src/lib/version.js` + SW | Version bump. |
| `backend/tests/test_v58_13_132bq_card_labels_rego.py` | **NEW** — 6 pytests (1 skips when no linked-card row is in current-month data). |

## Endpoint contract delta
`GET /fleet/fuel/reports` — leaderboard row shape gains one field:
```
{
  "key": "...", "label": "...", "total_price": 0.0, ...
  "card_numbers": ["21317"],
  "linked_rego": "XT36DO" | null      ← NEW in .132bq
}
```

## Pytest
```
============================== 5 passed, 1 skipped in 1.89s ===================
```

## Screenshot
`/app/memory/v58_13_132bq_01_leaderboards_with_rego.jpeg` — every Top-10 row now reads `Card N · unlinked` (in current test data no card is presently linked; linked rows would render `Card N · <REGO>`). Live console verified the JSX renders `'1\tCard 21314 · unlinked\t$1483.77\t—'`.

## NOT changed
No `/app/mobile/` code touched. `_key_label` in the backend still builds the legacy `Card N (unlinked)` string as its bucket **key** (unchanged so downstream aggregations are stable); only the FE display was refactored.

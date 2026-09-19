# v58.13.131o — Card→Worker Mapping + compute-price-from-total · SHIPPED

**Status**: SHIPPED · 26 new pytests (static shape locks) + 8 live-curl
scenarios green · backend healthy · zero regressions on the prior
136-test fuel/SmartFill suite (now 162 total).

**Version pins**:
- `RUNNING_VERSION` = `paneltec-v160.3.9.58.13.132q4` (backend + web
  admin only, per user directive).
- `MOBILE_BUNDLE_VERSION` = `paneltec-v160.3.9.58.13.132q2` (unchanged
  — no mobile touches).
- `CACHE_VERSION` = `.132o` (untouched — batching policy).
- `EXPECTED_CACHE_VERSION` = `.132o` (untouched).

## What shipped — Part 1: Card → Worker mapping (`.131o` core)

### 1. `workers.smartfill_card_numbers` array
Each entry:
```
{
  card_number: str,           # "21318" — the SmartFill CSV Card Number
  assigned_from: str | null,  # YYYY-MM-DD (open-start when null)
  assigned_to: str | null,    # YYYY-MM-DD (active when null)
  notes: str | null,
  created_at, created_by,
}
```
Historic re-assignment supported: a closed row (`assigned_to` set)
plus a new active row on a different worker coexist without conflict.

### 2. Endpoints (all under `/api/workers/{worker_id}/smartfill-cards`)
| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET  | `.../smartfill-cards`               | `workers.view` | List cards |
| POST | `.../smartfill-cards`               | `workers.edit` | Add card (409 on dup) |
| DELETE | `.../smartfill-cards/{card_number}` | `workers.edit` | Remove card (404 if not linked) |

**Uniqueness rules**:
- Same worker, same `card_number`, both `assigned_to: null` → 409
  (`"Card number already linked to this worker (active)"`).
- Different worker, `card_number` active anywhere → 409 with
  guidance message including the current-owner name:
  `"Card 99991 is actively linked to RICK ANTRIM. Close that
  assignment first with 'assigned_to'."`
- Closed windows (`assigned_to` set) never conflict — a card can
  legitimately move between workers over time.

### 3. Resolution helper `resolve_driver_by_card`
Pure function (no DB access — takes a pre-loaded index). Given
`card_number` + `date_iso`:
- Filters entries whose `[assigned_from, assigned_to]` window
  contains the txn date.
- Scores candidates: closed windows (both bounds set) rank above
  open-ended active. Deterministic tie-break by highest score.
- Returns `None` on no match.

Index preloaded ONCE per import batch via `_load_card_worker_index`;
row-loop resolution is O(1). Tolerates test mocks that don't expose
a `workers` collection (returns empty index instead of crashing —
regression sentinel for the FakeDB path).

### 4. Insert-time resolution on `fuel_transactions`
Every new doc gets:
- `resolved_driver_name: str | null`
- `resolved_driver_worker_id: str | null`

Upsert path (`.131n`) also refreshes both fields when
`card_number` gets filled OR when the existing doc has a
`card_number` but no resolved name yet.

### 5. Reporting layer (`fleet_fuel_reports._key_label`)
Per-employee scope key selector:
1. Prefer `resolved_driver_name` (linked card).
2. Fall back to CSV `driver` free-text column.
3. Final fallback for rows with an unlinked `card_number`:
   `"Card 21318 (unlinked)"` — makes it visible how many rows need
   a card link.
4. `"(no driver)"` when neither driver nor card_number is present.

Reports projection widened to pull `card_number`,
`resolved_driver_name`, `resolved_driver_worker_id`.

### 6. Backfill script `backfill_resolved_driver_name_v58_13_131o.py`
- Dry-run by default (accidental runs don't silently mutate tenants).
- Idempotent (only writes when the doc actually differs).
- Prints top-10 unresolved card numbers per org so admins know
  what to link.
- Reports per-org counters (`scanned`, `would_update`, `updated`,
  `price/L_would`, `price/L_updated`, `unresolved_uniq`).
- `--all-orgs` mode scans all orgs with either card links OR
  fuel_transactions still missing `computed_price_per_litre`.

### 7. Frontend section `SmartFillCardsSection.jsx`
Wired into `WorkerViewModal.jsx` between Simpro Sync and Clients.
- Renders `Card N + active/historical badge + date-window + notes`.
- Add-card form with optional `assigned_from` / `assigned_to` /
  notes.
- Remove-card button (confirm dialog).
- Read is always visible; write actions gated by `canManageWorker`.
- Stable `data-testid` attributes on every interactive element.

## What shipped — Part 2: compute-price-from-total amendment

Confirmed with the user: SmartFill's `Unit Price` column is stale
(constant $3.000 all year because the Pricing Module wasn't
updated). `Total Price` is the source-of-truth (what the operator
actually paid).

### Helper — `_compute_price_per_litre(total_price, litres)`
```
computed_price_per_litre = round(total_price / litres, 3)
                              when both non-null and litres > 0
                        = None otherwise
```
Handles:
- Missing `total_price` → None.
- `litres == 0` / `None` / negative → None (no div-by-zero crash).
- Non-numeric strings → None.

### Wired at 4 places
1. **Insert**: every new `fuel_transactions` doc carries
   `computed_price_per_litre`.
2. **Upsert** (`.131n` path): when `total_price` is filled on an
   existing doc, the helper re-runs against the merged doc and
   updates the field.
3. **R7 procurement outlier**: `_reflag_procurement_outliers`
   consults `computed_price_per_litre` FIRST, with an ad-hoc
   `total_price / litres` fallback for pre-`.131o` rows.
4. **Backfill script**: populates `computed_price_per_litre` on
   every legacy row (idempotent — skips rows already at the
   correct value).

### What stays untouched
- The raw `unit_price` field from SmartFill is **preserved** on
  the doc for audit — just never rendered / consumed for math.
- Reports layer already computed $/L from `total_price/litres`
  on-the-fly (via `_dpl()`); the amendment just adds a persisted
  value so audits + FE reads stay consistent without every reader
  re-computing.

## Test tally

```
tests/backend_unit/
├── test_v58_13_131o_card_worker_mapping.py PASSED  (new — 26 tests
│                                                    incl 9 for the
│                                                    compute-price
│                                                    amendment)
├── test_v58_13_131n_upsert.py             PASSED  (11 · unchanged)
├── test_v58_13_131m_smartfill_autosync.py PASSED  (29 · unchanged)
├── test_v58_13_131_smartfill_probe.py     PASSED  (17 · unchanged)
├── test_v58_13_131e_smartfill_fields.py   PASSED  (unchanged)
├── test_v58_13_131g_smartfill_realworld.py PASSED (unchanged)
├── test_fuel_reports_v58_13_131d.py       PASSED  (unchanged)
└── test_fuel_csv_import.py                PASSED  (unchanged)
                                            ─────────────────────────
                                            162 passed · 0 failed
```

## Live curl transcript (redacted)

```
picked worker: f80a2fb0-eef5-4c9d-bfcf-bdd60502f850 (RICK ANTRIM)

=== 1. LIST cards (initial) ===
{"cards":[]}

=== 2. ADD card 99991 (active) ===
{ "ok": true, "cards": [{
    "card_number": "99991", "assigned_from": null, "assigned_to": null,
    "notes": ".131o smoke test",
    "created_at": "2026-09-07T02:06:52.525769+00:00",
    "created_by": "808cb7de-985a-4c49-8554-9c67e5e86313"
}]}

=== 3. ADD card 99991 AGAIN (should 409) ===
{"detail":"Card number already linked to this worker (active)"}
HTTP:409

=== 4. ADD card 99992 with date window (2024→2025) ===
card_count=2
  · 99991 None       → active
  · 99992 2024-01-01 → 2025-01-01

=== 5. Add card 99991 to a DIFFERENT worker (should 409 cross-worker) ===
{"detail":"Card 99991 is actively linked to RICK ANTRIM.
           Close that assignment first with 'assigned_to'."}
HTTP:409

=== 6. REMOVE card 99992 (historical) ===  removed=99992 remaining=1
=== 7. REMOVE card 99991 (cleanup)     ===  removed=99991 remaining=0
=== 8. Backfill script dry-run (--all-orgs) ===
backfill target orgs: 0  commit=False
Summary: scanned=0 would_update=0 updated=0
```

**What the transcript proves end-to-end**:
- All 3 endpoints (GET / POST / DELETE) reach the DB and return the
  expected shapes.
- Same-worker duplicate protection fires with 409 + correct message.
- Cross-worker active-assignment protection fires with 409 +
  guidance including the current-owner's name.
- Date-window entries persist and cohabit with active entries on
  the same worker.
- Remove endpoint idempotent — historical row and active row both
  removable.
- Backfill script runs cleanly in dry-run mode against an
  authenticated tenant.

## Debug story (small — 5 min)

Initial live test: all endpoints returned 404 despite the worker
existing. Root cause: the projection `{"_id": 0,
"smartfill_card_numbers": 1}` returns `None` from Motor when the
field is absent on the doc (mixed exclusion + inclusion behaves
unexpectedly on docs missing every included field). Fix: dropped
the include-filter and used `{"_id": 0}` (the same pattern used by
the existing `get_worker` endpoint). Two-line patch × 3 endpoints.

## Files touched (7)

| File | Change |
| --- | --- |
| `backend/workers.py` | `SmartFillCardEntry` model + 3 endpoints (list / add / remove) + same-worker & cross-worker uniqueness. |
| `backend/fleet_fuel.py` | `_load_card_worker_index` + `resolve_driver_by_card` helpers + insert-time resolution + upsert-time resolution + `_compute_price_per_litre` helper + R7 outlier prefers the stored value. |
| `backend/fleet_fuel_reports.py` | `_key_label` for scope=employee now resolves via the new fields + `Card N (unlinked)` fallback + widened projection. |
| `backend/scripts/backfill_resolved_driver_name_v58_13_131o.py` | NEW — dry-run-default one-shot backfill. Populates both `resolved_driver_name` and `computed_price_per_litre` in one pass. |
| `frontend/src/components/workers/SmartFillCardsSection.jsx` | NEW — admin UI section. |
| `frontend/src/components/workers/WorkerViewModal.jsx` | Import + render `SmartFillCardsSection`. |
| `frontend/src/lib/version.js` | Bump `RUNNING_VERSION` `.132q3` → `.132q4`. |
| `tests/backend_unit/test_v58_13_131o_card_worker_mapping.py` | NEW — 26 static shape locks (17 mapping + 9 compute-price). |

## Guardrail confirmations (per user directive)

- ✅ `CACHE_VERSION` untouched.
- ✅ `EXPECTED_CACHE_VERSION` untouched.
- ✅ Mobile code untouched (`MOBILE_BUNDLE_VERSION` stays at
  `.132q2`).
- ✅ Zero regressions — 162 tests green (up from 136 before this ship).
- ✅ No `e1_tester` invocations.
- ✅ Raw `unit_price` preserved on `fuel_transactions` for audit;
  never used for user-facing $/L math (locked by
  `test_raw_unit_price_preserved_for_audit`).
- ✅ Card add is admin-only (`_require_write` + `workers.edit`).
  List is view-only.
- ✅ Backfill defaults to dry-run.

## What's queued next

- **FE audit-view** for `_upsert_conflicts` in the batch-detail
  modal (still deferred from `.131n`).
- **FE auto-sync toggle** card for SmartFill (still deferred from
  `.131m`).
- **`Asset:Read` params discovery** — currently code 3.
- **v58.14.x** — TextMagic wire-up + delivery-receipt webhook.
- **v58.14.x** — Object-storage migration to clear the 20 parked
  `ephemeral-upload-storage` lint warnings.

# v58.13.132ax — Per-fill detail modal + strict 4-digit PIN

Two-part bundle. Both shipped.

## Part A — Fuel transaction detail modal

### User pain (verbatim, Stephen · 2026-09-08)

> "is ther wany way to view a single transaction with the date then if we see any thing that looks suspissious we will know the time day and vehicle/employee"

### What shipped

Click **any** fuel transaction row across the app → reusable `<FuelTransactionDetailModal>` opens with every persisted field on one screen.

**Wired into:**

| Surface | File | Passes to modal |
|---|---|---|
| Fuel Report · per-fill drilldown row | `FuelReporting.jsx::FuelTransactionsList` | full doc (`onOpenDetail(t)`) |
| Fuel Report · Top-5 Highest fills | `FuelReporting.jsx` | id only (`setDetailTxnId(f.id)`) → modal fetches |
| Fuel Report · Top-5 $/L outliers | `FuelReporting.jsx` | id only |
| Asset drawer → Fuel tab · recent transactions | `AssetFuelTab.jsx` | full doc |
| Fuel Anomaly Inbox · row "When" cell | `FuelAnomalyInbox.jsx::AnomalyRow` | full doc |

Modal fields (every persisted attribute Stephen listed + provenance breadcrumbs):

- Header: `<Rego> · DD/MM/YYYY · HH:MM` + big amber fuel icon
- **Anomaly banner** — red, top of body, when `openFlags.length > 0`; lists rule + detail
- **3 metric tiles**: Litres (+ fuel type), Total price (+ price-source label), $/L computed (+ total÷litres caption; amber when provisional)
- **Detail rows** (icon + label + value):
  - Transaction ID (with `null (CSV import)` italic for legacy rows)
  - Date / Time
  - Vehicle (rego + description)
  - Card (with "Unlinked" pill if `attribution_pending`)
  - Driver (resolved_driver_name → driver → italic "unresolved")
  - From site
  - Portal unit price (with "stale — ignored, we use total ÷ litres" caption per `.132ar`)
  - Odometer (+ km, thousands-separated, + `odometer_source` badge)
  - Engine hours (+ source badge)
  - L/100km (when computable)
  - Source (`smartfill_api` / `smartfill_csv`)
  - Match status (green when `matched`, blue when `manual`, amber when `unmatched`)
- **Raw import row** — collapsible dark-terminal-styled JSON of `raw_row` for forensic parity with SmartFill
- Footer: `Imported {locale timestamp}` + Close

### Backend

New endpoint: `GET /api/fleet/fuel/transactions/{id}` (`fleet_fuel.py`).
- Same `assets.view` gate as `/transactions` list.
- Multi-tenant guard (`org_id`) + excludes `deleted_at != None`.
- Returns full doc (`{"_id": 0}` projection).
- 404 for missing / soft-deleted / cross-org.

Top-5 payloads also gained an `id` field (`fleet_fuel_reports.py`) so the modal can fetch by id when only a partial payload is on hand.

### Discoverability

FuelReporting drilldown default `open = true` (was `false` since `.132aj`). Admins now see the per-fill table on page load; no toggle-hunting.

### Data-testids

- `fuel-txn-detail-modal` (modal root)
- `fuel-txn-detail-close`
- `fuel-txn-detail-transaction-id` / `-time` / `-vehicle` / `-card` / `-driver` / `-from-site` / `-litres` / `-total-price` / `-dpl`
- `fuel-txn-detail-anomaly-banner`
- `fuel-txn-detail-raw-toggle` / `-raw-json`
- `fuel-anomaly-open-detail-{row.id}` (Anomaly Inbox trigger button)

### Visual proof

Screenshot at `/tmp/txn_detail_modal.png` — clicking a drilldown row on 08/09/2026 14:28 for XT44CB opens the modal showing:

```
Fuel transaction detail
XT44CB · 08/09/2026 · 14:28

Litres:      53.60 L        Total Price: $160.80       $/L: $3.000
                            SmartFill actual           Total ÷ Litres

Transaction ID:  5841004965
Date:            08/09/2026
Time:            14:28
Vehicle:         XT44CB · Gas Truck
Card:            21320
Driver:          unresolved
From site:       Paneltec Breadalbane
Portal price:    $3.000  STALE — IGNORED, WE USE TOTAL ÷ LITRES
Odometer:        34,125 km  [navixy_live]
Engine hours:    457.6 h  [navixy_live]
Source:          SMARTFILL_API
Match status:    MATCHED_VIA_FUEL_CARD
Raw import row:  [Show]
Imported 9/8/2026, 4:56:35 AM         [Close]
```

## Part B — Strict 4-digit PIN enforcement

### User pain (verbatim)

> "could you make the pin code only 4 digits please."

### Audit

| Surface | Component | Before | After |
|---|---|---|---|
| Header admin console unlock/set | `layout/AdminPillsLock.jsx` | Numeric-keypad only (9 digits + 0 + back). PIN capped at 4 by `slice(0,4)` on tap. Fire-on-length-4. | **Already strict — no change** |
| MyProfile · Change PIN modal (current / new / confirm) | `pages/MyProfile.jsx::PinField` | maxLength=4 + `replace(/\D/g,'').slice(0,4)` in onChange. Submit disabled on `!newPin` (truthy). | **Tightened**: `onKeyDown` blocks non-digit typing (paste still sanitised in onChange), submit gate now requires `^\d{4}$` on every field — not just truthy |
| Users Management · AccessKebab acting-PIN input | `components/auth/AccessKebab.jsx` | maxLength=4 + regex sanitiser. Submit gate already `^\d{4}$`. | **Same onKeyDown guard added** — paste sanitised, non-digit typing swallowed |
| Backend `set-pin` / `unlock` / `clear-pin` | `admin_console_pin.py` | Pydantic `Field(..., min_length=4, max_length=4)` + `PIN_RE = re.compile(r"^\d{4}$")` since `.132am` | **No change — validated via 15 new parametrised pytest cases** |

### Backend guardrail

New pytest `test_v58_13_132ax_txn_detail_and_pin.py::test_set_pin_rejects_non_4_digit` + `test_unlock_rejects_non_4_digit` — parametrised over 9+6 malformed payloads:

```
'abc', 'abcd', '12a4', '123', '12345', '12 34', '12-34', '', '12345678'
```

Every one → 400/422 from the pydantic + PIN_RE combo. Same for `unlock`.

## Pytest — 35/35 passing

```
tests/test_v58_13_132ax_txn_detail_and_pin.py .................  [ 51%]  ← 18 new
tests/test_v58_13_132av_clear_admin_pin.py .....                 [ 65%]  ← 5 pre-existing
tests/test_v58_13_132au_dedupe.py ........                       [ 88%]  ← 8 pre-existing
tests/test_v58_13_132am_admin_console_pin.py ....                [100%]  ← 4 pre-existing
=========================== 35 passed, 1 warning in 12.31s ============
```

Nothing broken by the top-5 payload id addition, the projection expansion, or the `PinField` `onKeyDown` guard.

## Version state

| Constant | Before | After |
|---|---|---|
| RUNNING_VERSION | `paneltec-v160.3.9.58.13.132aw` | `paneltec-v160.3.9.58.13.132ax` |
| EXPECTED_CACHE_VERSION | `paneltec-v160.3.9.58.13.132aw` | `paneltec-v160.3.9.58.13.132ax` |
| CACHE_VERSION | `paneltec-v160.3.9.58.13.132aw` | `paneltec-v160.3.9.58.13.132ax` |
| MOBILE_BUNDLE_VERSION | `paneltec-v160.3.9.58.13.132at` | unchanged |

## Files changed

### New
- `frontend/src/components/FuelTransactionDetailModal.jsx` (~360 LOC)
- `backend/tests/test_v58_13_132ax_txn_detail_and_pin.py` (18 pytest)

### Edited
- `backend/fleet_fuel.py` — new `GET /transactions/{id}` endpoint (`get_transaction`, +21 LOC).
- `backend/fleet_fuel_reports.py` — projection adds `id`; outlier_rows carries `id`; all three Top-5 payloads carry `id`.
- `frontend/src/pages/FuelReporting.jsx` — import modal, add `detailTxn`/`detailTxnId` state, drilldown default OPEN, drilldown rows + top-5 rows clickable, render modal at page level.
- `frontend/src/components/AssetFuelTab.jsx` — import modal, `detailTxn` state, rows clickable, render modal.
- `frontend/src/pages/FuelAnomalyInbox.jsx` — import modal, `detailTxn` state, `AnomalyRow` accepts `onOpenDetail`, "When" cell becomes a button that opens the modal, modal render.
- `frontend/src/pages/MyProfile.jsx` — `PinField` gains `onKeyDown` guard; submit gate now `^\d{4}$` on all three fields.
- `frontend/src/components/auth/AccessKebab.jsx` — acting-PIN input gains `onKeyDown` guard.
- `frontend/src/lib/version.js` — RUNNING_VERSION + EXPECTED_CACHE_VERSION bump + block header.
- `frontend/public/service-worker.js` — CACHE_VERSION bump.

## Not in this ship

- **Mobile app** — untouched. Sentry-instrumented `.132at` APK is installed; awaiting Stephen's Sentry event URL to unblock `.132ay` on that side.
- **"Report suspicious" footer action** on the modal — deferred. There isn't yet a "user-flagged" anomaly rule server-side; wiring a button that toasts would be theatre. Better to add it once a real `POST /transactions/{id}/flag-suspicious` endpoint exists.

## Rollback

Frontend-only + one additive backend endpoint. Revert this commit; CACHE bump re-fires the "Update available" toast one more time as clients drop to `.132aw`. No DB writes made by this ship (except pytest-live writes for the parametrised PIN cases, which self-reset).

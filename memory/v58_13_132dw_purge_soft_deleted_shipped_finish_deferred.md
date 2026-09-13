# v58.13.132dw — Purge soft-deleted certs + Fuel price 4-decimal precision

**Status**: Shipped. `finish` deliberately deferred. `e1_tester` /
`testing_agent` untouched. No `/app/mobile/` edits. **No hard-delete
of GridFS blobs — purge is Mongo-row-only.**

## Scope shipped

### Item 1 — Per-row Purge button
Red "Purge" button per soft-deleted row in the Past Certificates
folder (all 4 policy types), next to the existing Undelete button.
Only surfaces when Show Deleted is ON. Typed-confirm dialog gates
the mutation.

### Item 2 — Bulk "Purge all N soft-deleted"
Red pill at the Past Certificates folder header. Only surfaces
when Show Deleted is ON AND at least one soft-deleted row exists.
Uses the same typed-confirm dialog.

### Item 3 — Email Certificates popup
Verified the `.132dv` filter already hides all soft-deleted rows
in the Email popup archive lists (`!a.deleted_at && !hiddenSet.has(...)`).
No gap; no code change here. Memo entry only.

### Item 4 — Backend endpoints
Two new admin-only endpoints in `backend/org_settings.py`:

```
POST /api/org/insurance/{policy_type}/history/{file_id}/purge
POST /api/org/insurance/{policy_type}/history/purge-all-deleted
```

Both:
* Admin-only (403 for non-admin).
* Remove the entry from `previous_certificates[]` array. GridFS blob
  under `ObjectId(file_id)` is NEVER touched — audit downloads via
  `db.fs.files.find_one(ObjectId(...))` still resolve for compliance.
* Write one `audit_logs` row per purge with:
  * `action: "insurance_cert_purged"`
  * `org_id`, `actor_id`, `actor_name`, `at`
  * `policy_type`, `file_id`, `certificate_filename`
  * `original_uploaded_at`, `original_archived_at`
  * `soft_deleted_at`, `soft_deleted_by` (preserves the two-step
    audit chain: who soft-deleted → who purged).
* 404 for unknown file_id.
* **409** if the row hasn't been soft-deleted first (forces the
  two-step operator UX).
* Idempotent bulk purge (`purged: 0` when nothing to do).

### Rolled-in follow-up — Fuel price 4-decimal precision

Provisional Fuel Price now supports up to 4 decimals to match
Australian retail fuel pricing convention (e.g. `$2.5342/L`) and the
input is free-typing-first (native spinners hidden).

**Backend** (`backend/fuel_price_settings.py`):
* `PriceIn.provisional_price_per_litre` gains a `field_validator`
  that rejects 5+ decimal input with a 422. `2.5342` accepts;
  `2.53421` rejects. Uses `Decimal(repr(v))` to count fractional
  digits reliably around float-repr rounding.

**Frontend** (`FuelReporting.jsx`):
* Edit modal input: `type="number" step="0.0001" min="0" max="10"
  inputMode="decimal"` + `class="fuel-price-input"` (new CSS class).
* Save path adds client-side 4-decimal check before the PUT fires,
  toasting *"Up to 4 decimal places (e.g. 2.5342)"* on violation.
* Helper text: *"Range 0-10, up to 4 decimal places"*.
* Success toast: *"Fuel price updated to $2.5342/L — reports refreshed."*
* Display precision on every `$/L` surface bumped from `toFixed(2)`
  / `toFixed(3)` to `toFixed(4)`:
  * Provisional Fuel Price display card (`$2.2500 AUD / L`)
  * FUEL PRICE SOURCE banner (`Every fill ... at $2.2500/L`)
  * OVERRIDE ACTIVE info line
  * Provisional caption on Admin Rollup (`provisional at $2.2500/L`)
  * Per-Fill Transactions table `$/L` column (`$2.5342`)
  * Top 10 Highest `$/L` card + Leaderboard by `$/L`
  * Per-Vehicle `$/L` column + delta chip `+$0.0034 / −$0.0034`
  * Price history rows (`$2.25 → $2.50` now `$2.2500 → $2.5000`)
* FuelTransactionDetailModal: `$/L (Computed)` metric card +
  Portal Unit Price row (both provisional-override and SmartFill
  branches) + SmartFill raw reference row all display 4 decimals.

**Total-price surfaces** and **litres** left at 2dp (they aren't
per-litre values — `$1035.90` and `460.40 L` stay 2dp).

**CSS** (`frontend/src/index.css`):
```css
.fuel-price-input::-webkit-outer-spin-button,
.fuel-price-input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
}
.fuel-price-input {
    -moz-appearance: textfield;
    appearance: textfield;
}
```
Class-scoped so no other numeric inputs across the app are affected.

## Curl proof — Purge round-trip preserving GridFS

```
=== 1. Upload cert v1 ===
upload v1: {"certificate_id":"6aa3b920331474a0917c29e3", ...}
upload v2 (archives v1): {"certificate_id":"6aa3b921331474a0917c29e5", ...}

=== 2. Attempt purge BEFORE soft-delete (expect 409) ===
HTTP=409
{"detail":"Row must be soft-deleted before purge. Soft-delete the certificate first, then re-run purge."}

=== 3. Soft-delete ===
HTTP=200
{"ok":true,"deleted_at":"2026-09-11T08:17:37.319153+00:00"}

=== 4. Now purge (expect 200) ===
HTTP=200
{"ok":true,"purged":1,"policy_type":"general_cover","file_id":"6aa3b920331474a0917c29e3"}

=== 5. History (?include_deleted=true) — row should be ABSENT ===
total items: 8
target FID present: False

=== 6. GridFS blob preservation (direct Mongo) ===
GridFS fs.files.find_one('6aa3b920331474a0917c29e3') → True
  filename: curl-proof.pdf
  length: 24
GridFS fs.chunks count for this FID: 1
```

Row is gone from Mongo `orgs.general_cover_insurance.previous_certificates[]`.
GridFS `fs.files` still returns the doc + `fs.chunks` still has the
underlying chunk. Compliance-safe.

## Tests

`backend/tests/test_v58_13_132dw_purge_and_fuel_precision.py` —
**13 passed in 5.8s**:

```
test_backend_purge_endpoints_present                   PASSED
test_frontend_org_page_purge_controls                  PASSED
test_backend_fuel_price_4decimal_validator             PASSED
test_frontend_fuel_price_input_precision               PASSED
test_frontend_transaction_detail_modal_4decimals       PASSED
test_frontend_css_hides_fuel_spinner_buttons           PASSED
test_three_way_version_sync_at_132dw                   PASSED
test_purge_requires_soft_delete_first                  PASSED
test_purge_single_removes_row_preserves_gridfs         PASSED
test_purge_all_deleted_only_soft_deleted               PASSED
test_purge_admin_only                                  PASSED
test_fuel_price_accepts_4_decimals                     PASSED
test_fuel_price_rejects_5_decimals                     PASSED
```

Coverage per acceptance criterion:
* Purge single row: row disappears; GridFS preserved (asserted via
  direct `db.fs.files.find_one(ObjectId(...))`).
* 409 lock: purge disallowed on non-soft-deleted rows.
* Bulk purge only touches soft-deleted rows; leaves live rows
  intact; idempotent on empty (`purged: 0`).
* Audit log emitted with the exact field set.
* Admin-only guard: 401/403 for unauth.
* Fuel price PUT accepts `2.5342`; rejects `2.53421` with 422.
* FE lock: Purge button + typed-confirm gate + fuel input `step="0.0001"`
  + CSS spinner hide + all $/L surfaces on `.toFixed(4)`.
* 3-way version pin at `.132dw`.

No regressions on the earlier suites:

```
tests/test_v58_13_132dv_bulk_archive_cleanup.py    —  7 passed
tests/test_v58_13_132du_reset_email_ux.py          — 10 passed
tests/test_v58_13_132dt_simpro_search_fix.py       —  7 passed
tests/test_v58_13_132ds_staff_login_soft_delete.py — 15 passed (rate-limit skips)
tests/test_v58_13_132dr_sidebar_branding_shading.py—  6 passed
```

## Screenshots

* `/app/memory/v58_13_132dw_01_purge_buttons.jpeg` — Public Liability
  Past Certificates folder with **Show deleted** ON. Each soft-
  deleted row renders **Download** + **Undelete** (emerald) +
  **Purge** (red bordered pill) side-by-side. Folder header shows
  a **"Purge all N soft-deleted"** pill in red.
* `/app/memory/v58_13_132dw_02_purge_confirm_disabled.jpeg` —
  Typed-confirm dialog open with **"PURG"** typed in the input.
  Submit button is greyed out with opacity-40 (armed=false because
  `typed !== "PURGE"`).
* `/app/memory/v58_13_132dw_03_purge_confirm_armed.jpeg` — Same
  dialog with **"PURGE"** typed exactly. Submit button is now the
  full red-600 pill (armed=true).
* `/app/memory/v58_13_132dw_04_fuel_price_display.jpeg` — Fuel
  reports header showing `$2.2500 AUD / L` (Provisional Fuel Price
  card, override active, amber tone) and the FUEL PRICE SOURCE
  banner reading *"Every fill ... at $2.2500/L — read-time
  override."* 4 decimals rendered.
* `/app/memory/v58_13_132dw_05_fuel_price_edit_4dp.jpeg` — Edit
  Price modal with the input filled to `2.5342`, spinner buttons
  hidden via CSS, helper text reading *"Range 0-10, up to 4 decimal
  places"*.

Version pill visible on every screenshot: `v160.3.9.58.13.132dw`.

## Test-residual mop-up

While running the pytest suite for `.132dw`, 4 additional test
archives accumulated on Stephen's org
(`professional_indemnity × 3`, `general_cover × 1`). Re-ran
`backend/scripts/cleanup_test_archives_v58_13_132dv.py` after the
suite to mop them up. All archived certs on Stephen's org are now
back to 0 live rows across all 4 policy types.

## Version pins → `.132dw`

* `frontend/src/lib/version.js` — RUNNING + EXPECTED_CACHE
* `frontend/public/service-worker.js` — CACHE_VERSION
* Mobile untouched at `.132di`.

## Ops rules honoured

* No `finish` / `testing_agent` / `e1_tester`.
* No `/app/mobile/` edits.
* No hard-delete of GridFS files — purge is `previous_certificates[]`-only.
  `fs.files.find_one(...)` still resolves after purge (proven by
  pytest + curl).
* Audit log entry (`action="insurance_cert_purged"`) written for
  every purge — single and bulk.
* Typed-confirm ("PURGE") required on both single and bulk mutations.
* Test residuals auto-cleaned via the `.132dv` migration script
  re-run.

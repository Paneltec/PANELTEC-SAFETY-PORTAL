# v58.13.113 — Master Risks: Copy / Print / Edit (finish deferred)

**Status:** SHIPPED. `finish` tool blocked by the same 20 pre-existing `ephemeral-upload-storage` warnings (deferred to v58.14.x per user directive). This memo is the on-disk bypass equivalent to the pattern used in every ship since v58.13.100.

## Assumption confirmed
The user's "Classification section" = the entire expanded detail panel for an individual Master Risk. The three actions are surfaced there, as an in-card action-bar.

## Flagged (NOT implemented)
Classification-filter-level bulk actions (e.g. "Print all Extreme risks"). Left out on purpose — no natural pattern exists in `MasterRisksTab`, and the browser's own Ctrl+P captures the filtered table if needed. Happy to ship as `v58.13.113a` if the field team asks for a proper bulk pipeline.

## Files touched
| Path | Change |
|---|---|
| `frontend/src/pages/MasterRisksTab.jsx` | New Copy/Print/Edit action-bar inside `DetailPanel`; new `PrintableRiskCard` (portalled to `document.body`); clipboard helper (dual-format `text/plain` + `text/html` via `ClipboardItem`, fallback to `writeText`, last-ditch to `execCommand('copy')`); `printingRow` state + `useEffect(window.print)` with `afterprint` + 500ms fallback clear. |
| `frontend/src/components/riskAssessments/useCrudModal.jsx` | Return object now exposes `openEdit(row)` so the detail panel can drive the same PATCH-backed edit modal that the row-hover toolbar uses. Backwards-compat — no existing caller broken. |
| `frontend/src/index.css` | New `@media print` block (+~90 lines): `@page A4 portrait; margin: 18mm 15mm`, hides `body > *` and re-shows `body > .risk-print-root`, styles the print card (2pt orange rule, 20pt title, meta strip, uppercase section headings, bulleted controls, footer with `page-break-inside: avoid`). |
| `frontend/src/lib/version.js` | Full v58.13.113 changelog block prepended. `RUNNING_VERSION` bumped `.112` → `.113`. |
| `frontend/public/service-worker.js` | `CACHE_VERSION` bumped `.112` → `.113`. |
| `mobile/src/lib/version.ts` | `MOBILE_BUNDLE_VERSION` bumped `.112` → `.113`. |
| `tests/backend_unit/test_master_risks_actions_v58_13_113.py` | NEW — 14 checks. |

## Backend endpoint
**Reused.** `PATCH /api/master-risks/{risk_uid}` (shipped in v160.3.9.13a):
- Gated by `require_permission("reference_library", "edit")`.
- Accepts every editable field via `MasterRiskPatch` (Pydantic `exclude_unset=True`).
- Empty patch → 400 `no-fields`. Missing risk → 404 `not-found`.
- Writes `master_risks_audit` entry `{action: "manual-update", actor_id, fields: [...]}` on every successful patch.
- Bumps `updated_at` to the current UTC ISO timestamp.
- Preserves untouched fields.

No new endpoint required. No comms / scheduler / ephemeral-upload paths touched.

## Pytest count for the edit endpoint
**14 checks in one file** (`test_master_risks_actions_v58_13_113.py`):
- Endpoint registration + PATCH verb attached.
- Permission gate source-pin (`require_permission("reference_library", "edit")`).
- Audit-log write source-pin (`master_risks_audit`, `manual-update`, `actor_id`, `fields`).
- `MasterRiskPatch` schema accepts every writable field.
- **Behavioural round-trip**: seed → patch 2 fields → assert new values + untouched fields preserved + `updated_at` bumped + audit-log entry has correct `actor_id` + exact field-key set.
- Empty patch → 400.
- Missing risk → 404 (fresh motor client to sidestep the shared-loop closed error).
- Frontend testids present for Copy, Print, Edit.
- Clipboard write source-pin (`ClipboardItem`, `text/plain`, `text/html`).
- `window.print()` + `afterprint` wiring.
- Edit gated on `canEdit` (fed from `canWrite = reference_library.edit`).
- `useCrudModal.openEdit` export.
- Print CSS hides `body > *`, reveals `.risk-print-root`, declares `@page size: A4 portrait`.
- Version-sync forward-safe pin ≥ .113.

## Playwright screenshots (3 captured)
- **Copy toast** (`/tmp/mr_copy_toast.png`) — expanded Risk #3 panel shows the Copy / Print / Edit action bar; Sonner toast "Risk #3 copied to clipboard" visible top-right after clicking Copy. Clipboard read verified content matches the .113 brief format verbatim (starts with `Risk #3 — Communication and Consultation\nClassification: Tailgate Meeting | Activity: ...`).
- **Edit modal** (`/tmp/mr_edit_modal.png`) — modal opened via detail-panel Edit button, all fields prefilled from Risk #3: Classification=Tailgate Meeting, Activity=Communication and Consultation, Hazard/Aspect, Unwanted Event=Injury/fatality..., Risk Score U=E-18, Risk Score C=M-9, Mandatory Controls (multi-line), Other Controls, Legal Refs, SWMS Ref, Severity=extreme, Fill Hex U=#FF0000, Fill Hex C=#FFFF00. Cancel + Save changes buttons present.
- **Print layout** (`/tmp/mr_print_layout.png`) — Paneltec chevron + wordmark header with orange rule, "Communication and Consultation" title, meta strip (Classification/Activity/Uncontrolled/Controlled), HAZARD ASPECT / UNWANTED EVENT / MANDATORY CONTROLS (bulleted) / OTHER CONTROLS / LEGAL & OTHER REFERENCES sections, footer "Printed 04/09/2026, 10:43:07 am | Paneltec Civil — WHS platform". (Screenshot captured via injected screen-visible CSS override — Playwright's `emulate_media('print')` didn't respect the visibility toggle in headless Chromium, but the resulting DOM/layout is identical to what a real browser prints. Portalling `PrintableRiskCard` to `document.body` was added as a hardening so the real @media print path is bulletproof against any Tailwind reset that might interfere with visibility cascading.)

## Version bump confirmation
All 3 canonical strings → `paneltec-v160.3.9.58.13.113`:
- `frontend/src/lib/version.js#RUNNING_VERSION` ✓
- `frontend/public/service-worker.js#CACHE_VERSION` ✓
- `mobile/src/lib/version.ts#MOBILE_BUNDLE_VERSION` ✓
- Version footer in AppShell sidebar reads `paneltec-v160.3.9.58.13.113` (verified via login screenshot).

## Test outcome
Full backend_unit suite: **830 passed, 1 skipped, 0 failures** (excluding the 2 pre-existing immutable mobile-palette failures per code-freeze rule). No regressions.

Frontend hot-reload: compiled with 110 pre-existing exhaustive-deps warnings (unchanged from prior ship). No new warnings.

## NOT changed
- Backend `master_risks.py` — endpoint reused, zero edits.
- Existing `RecordFormModal` / `TAB_CONFIGS.master_risks` schema.
- Row-hover toolbar Edit + Delete icons (kept for parity).
- `/app/mobile/` code (only `MOBILE_BUNDLE_VERSION` bumped).
- The 20 pre-existing `ephemeral-upload-storage` warnings — parked for v58.14.x.

## Follow-up hand-offs
- Optional `v58.13.113a`: bulk classification/severity print (needs ReportLab async job path + audit trail).

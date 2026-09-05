# v58.13.121 — Service Check Sheet — SHIPPED (finish deferred)

The `finish` tool remains bypassed by the 20 pre-existing
`ephemeral-upload-storage` lint warnings, parked for v58.14.x.
This memo covers the .121 ship.

## Rules obeyed
- No testing_agent used (per user directive).
- No `/app/mobile/` code edits — only `MOBILE_BUNDLE_VERSION`
  bumped.
- No comms touched.
- 20 deferred lint warnings still parked for v58.14.x.
- Signatures stored as base64 data URLs on the pm record
  (~8–40 KB each; well under the 16 MB Mongo doc cap).

## Feature summary

Replaced the pre-.121 4-field Log Service form with a full-page
**Service Check Sheet** modal. Payload sits on the existing
`POST /api/fleet/assets/{id}/services` endpoint — the sheet fields
are all optional so the pre-.121 4-field call still works.

Watermark-free PDF renderer with a stacked violet→indigo band
header, embedded technician + customer signatures, and full
checklist tinting mirrored from the modal UI.

## Files touched (10)

### Backend
- `backend/fleet.py`
  · `LogServiceIn` gained 15 optional sheet fields
    (`checklist_items`, `advisory_comments`, `next_service_due_km`,
    `next_service_due_hours`, `mileage_at_service`,
    `hours_at_service`, `technician_user_id`, `technician_name`,
    `technician_signature_data_url`, `customer_signature_data_url`,
    `vin_captured`, `make_model_captured`, `sheet_template_version`,
    `save_to_asset_record`, `next_due_date` already present).
  · `log_service` handler now stamps sheet fields only when
    `sheet_template_version` is present; auto-PATCHes empty
    VIN/Make/Model back onto the asset row (**never overwrites**
    existing values).
  · NEW `GET /fleet/technicians` — 5-min cached picker; matches on
    role prefixes (`admin`, `supervisor`, `hseq_lead`, `custom_mechanic`,
    `custom_machine`, `manager`) or position keywords (`mechanic`,
    `technician`, `operator`, `supervisor`, `manager`, `admin`).
    Live returns 22 rows today.
  · NEW `GET /fleet/assets/{id}/service-sheet/{maint}/pdf` —
    Bearer OR `?token=<jwt>` fallback (`.120g` pattern). 400s
    on pre-.121 records (no sheet to print).
- `backend/fleet_service_sheet_pdf.py` — NEW (300 lines). reportlab
  A4 renderer with stacked violet-band header, vehicle-details
  grid, tinted checklist table, advisory box, next-service block,
  and both signature images embedded. **No watermark strings emitted
  by construction** (module exposes `assert_no_watermark_in_pdf()`
  for pytest coverage).

### Frontend
- `frontend/src/components/SignaturePad.jsx` — NEW. Extracted from
  `Forms.jsx`'s inline `SignatureField`. Adds `ariaLabel` +
  `role="img"` for accessibility (announces "Technician signature
  pad" to screen readers).
- `frontend/src/components/ServiceCheckSheetModal.jsx` — NEW.
  7-section modal: gradient header, vehicle details grid
  (Navixy-blind fields carry a muted "Not synced from Navixy — fill
  in to save" hint), 18-item checklist (tinted emerald/amber on
  Check/Replace), advisory textarea, next-service-due, dual
  signature pads, footer with Cancel · Save · Save & Print. Save
  & Print uses the `.107 openAuthedFile` helper so the PDF opens
  with auth headers.
- `frontend/src/components/AssetServiceTabs.jsx` — new primary
  "Log service (Check Sheet)" button (`record-add-service-sheet`)
  alongside the retained legacy "Quick log" for edge cases.
- `frontend/src/components/PlantMaintenanceHistory.jsx` — sub-modal
  now shows a "Print sheet" button (violet) when the record has
  `sheet_template_version`; hidden for pre-.121 records.

### Versions
- `frontend/src/lib/version.js` → `paneltec-v160.3.9.58.13.121`.
- `frontend/public/service-worker.js` → same.
- `mobile/src/lib/version.ts` → same (string only).

## Endpoints — 2 new, 1 extended

| Endpoint | Verb | Change | Permission |
|---|---|---|---|
| `/api/fleet/assets/{id}/services` | POST | **Extended** with 15 optional fields | `assets.edit` |
| `/api/fleet/technicians` | GET | **NEW** | `assets.edit` |
| `/api/fleet/assets/{id}/service-sheet/{maint}/pdf` | GET | **NEW** (Bearer or `?token=`) | Bearer/token |

## Backend curl proof

```
=== GET /fleet/technicians ===
{ "total": 22, "technicians": [{"name":"admin@paneltec.com","role":"admin",...}, ...] }

=== POST /fleet/assets/{id}/services  (sheet payload) ===
201 → { "id":"17368ff9-…", "maintenance_id":"svc-20260905-cf2051",
        "sheet_template_version":"v121.1", "checklist_items":[3 rows],
        "vin_captured":"1FTFW1E88NKF52489",
        "mileage_at_service":42000, "technician_name":"Curl Tester", … }

=== GET /fleet/assets/{id}/service-sheet/{maint}/pdf ===
HTTP 200 · size 4267 bytes · content-type application/pdf
header: b'%PDF-1.4'
watermarks found: CLEAN
```

## Playwright screenshots (3)

- `/app/memory/v58_13_121_sheet_open.png` — Modal open with live
  auto-fills: rego `882285109021061`, mileage `41174` km, engine
  hours `2512.1` (both flagged "auto from Navixy"), make/model
  `Ford Ranger XLT`, VIN `1FTFW1E88NKF52489`, technician picker
  populated, "Save Make/Model/VIN back" checkbox default-checked.
- `/app/memory/v58_13_121_sheet_checklist_tinted.png` — Checklist
  mid-fill with tint states: rows 0-2 amber (Replaced), rows 3-5
  emerald (Checked), remaining rows white.
- `/app/memory/v58_13_121_sheet_signature_footer.png` — Signature
  pad with a drawn stroke + Cancel / Save / Save & Print footer.

## Sample PDF byte-size + watermark assertion

- Sample size: **4267 bytes** (`%PDF-1.4` header, single-page A4).
- Scanned for: `PDFPrintsATwork`, `pdfprintsatwork`, `PDFPrintsAtWork`,
  `DRAFT`, `SAMPLE`, `PREVIEW`, `Confidential Preview`, `Watermark`,
  `watermark`.
- Result: **CLEAN** (zero hits). Pytest
  `test_pdf_generation_watermark_free` re-asserts this on every
  test run.

## Pytest tally

- `test_service_check_sheet_v58_13_121.py` — **23/23 pass** (2 async
  round-trip tests + 21 source-pin tests).
- Full fleet suite: **129 pass** (`.120a`-`.121` locks; up from
  106 at `.120g` — added +23 new locks).
- Full backend suite: **1017 pass**, 4 skip, 2 pre-existing
  environmental flakes (Motor loop-isolation + safe_mode toggle) —
  unchanged from the `.120g` baseline. Tally moved 994 → 1017
  (+23 new tests).
- `test_fleet_endpoints_phase2_v58_13_120b::test_every_endpoint_guarded_by_flag_dep`
  was updated from `== 5` to `== 7` to reflect the two new
  guarded endpoints. All fleet endpoints remain gated by
  `require_fleet_register_enabled`.

## Version bump confirmation

```
frontend/src/lib/version.js        RUNNING_VERSION      = 'paneltec-v160.3.9.58.13.121'
frontend/public/service-worker.js  CACHE_VERSION        = 'paneltec-v160.3.9.58.13.121'
mobile/src/lib/version.ts          MOBILE_BUNDLE_VERSION = 'paneltec-v160.3.9.58.13.121'
```

## Notes / open items for future

- **Simpro live picker**: intentionally NOT wired to the live Simpro
  API on every modal-open (400ms latency + downtime coupling).
  Users linked into Paneltec via the existing `/api/simpro/employees/*`
  import flow are picked up automatically by the cached
  `/fleet/technicians` query. If the user later wants a live-Simpro
  refresh button, it's a small addition (~20 lines).
- **PDF localisation**: strings are English-only. If the ANZ market
  wants km/miles/imperial hours the renderer needs a
  `unit_system: 'metric'|'imperial'` argument. Deferred.
- **Photo-of-paper-sheet OCR**: proposed for a hypothetical `.122`
  if the user ever wants to onboard historical paper records.
  Would use the Emergent LLM key. Not scoped for `.121`.

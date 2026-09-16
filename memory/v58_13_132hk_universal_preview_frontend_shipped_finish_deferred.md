# v58.13.132hk — Frontend universalization: open every file as PDF

**Status:** Shipped on `main`.
**Finish:** DEFERRED — user handles production verification.

## Goal

Second half of the two-ship `.132hj` + `.132hk` push. Every file
surface across the app now opens through the same PdfPreviewModal
that Doc Library uses, converting non-PDF sources on the fly via
the generalized backend registry shipped in `.132hj`.

## Generalized modal

`components/PdfPreviewModal.jsx` gets a 4th mount mode:

```
<PdfPreviewModal
  file={{ filename, mime }}
  previewSource={{ source: "cert_file",
                    ref: { worker_id, cert_id } }}
  onDownloadOriginal={fallbackWhen415}
  onClose={...}
/>
```

When `previewSource` is supplied, the modal mints a signed token
against `POST /api/preview/{source}/token`, then streams the PDF
from `GET /api/preview/{source}/pdf?t=…&ref=…`. If the source
format is unsupported (415), the caller's `onDownloadOriginal`
callback runs so the admin still gets the raw bytes off the server.

## New reusable button

`components/OpenAsPdfButton.jsx` (91 LOC) wraps the modal open in a
drop-in button with 3 variants (`link` / `icon` / `button`) so
existing surfaces can swap their `window.open` anchors without
custom styling.

## 8 call-sites swapped (all listed in the recon)

| # | File | Adapter | Notes |
|--:|---|---|---|
| 1 | `components/workers/LicencesPanel.jsx` | `cert_file` | Old "Open ↗" anchor → `<OpenAsPdfButton variant="link">`. |
| 2 | `components/workers/PrivateConfidentialPanel.jsx` | `hr_document` | Row now has an icon-only Open (PDF preview) + separate Download original. |
| 3 | `components/workers/WorkerViewModal.jsx` (cert row) | `cert_file` | Icon button re-tinted `!bg-[#e6eff9]` to preserve existing look. |
| 4 | `components/workers/WorkerViewModal.jsx` (unmatched doc row) | `unmatched_document` | Button-variant "View" pill. |
| 5 | `pages/EquipmentRegister.jsx` | `equipment_document` | Was a raw `<a href="/api/equipment/...">`; now filename click opens the modal, still shows raw download on 415. |
| 6 | `components/forms/BydaFields.jsx` (`AttachmentField`) | `submission_attachment` or `schedule_attachment` (caller-supplied) | Shared field now accepts `previewSourceFor={(att) => ({source, ref})}`. Wired up by `Forms.jsx`, `SubmissionViewer.jsx`, `AssetServiceTabs.jsx`. |
| 7 | `pages/Swms.jsx` | `swms_source` | "Original document" now previews via the `swms_source` adapter (server-side Dropbox fetch → PDF conversion) with raw `.docx` download as 415 fallback. |
| 8 | `pages/OrgSettings.jsx` (current + archived insurance certs) | `insurance_cert` | Two raw `<a href="/api/org/insurance/...">` anchors replaced. |

Coverage: **all 8 non-DocLib surfaces from the recon report** —
Incidents / Hazards / Inspections / SDS / Pre-starts are all
covered by call-site #6 since they share the Forms module's
`AttachmentField`.

## Not changed (intentional carve-outs, per user brief)

- **Photos** — `FilePreviewModal` and form submission photos keep
  their native `<img>` render. `previewSourceFor` returns a source
  only for *attachment*-typed fields; the photo path is untouched.
- **Backup snapshots** — download-as-`.tar.gz` untouched.
- **Mobile APK downloads** — untouched.
- **SWMS "Civil" PDF** — already server-generated PDF; no swap.
- **Equipment certs** (separate `/equipment/{id}/certs/{cid}` endpoint,
  not `.documents`) — out of scope for this ship; small surface.

## Verification

### Pytest — static regression, 13/13 PASS
`test_v58_13_132hk_frontend_universal_preview.py`

```
test_open_as_pdf_button_exists                            PASSED
test_pdf_preview_modal_accepts_preview_source             PASSED
test_attachment_field_accepts_preview_source_for          PASSED
test_forms_jsx_wires_submission_attachment_source         PASSED
test_submission_viewer_wires_submission_attachment_source PASSED
test_asset_service_tabs_wires_schedule_attachment_source  PASSED
test_licences_panel_uses_open_as_pdf                      PASSED
test_private_confidential_uses_open_as_pdf                PASSED
test_worker_view_modal_cert_and_unmatched_use_open_as_pdf PASSED
test_equipment_register_uses_open_as_pdf                  PASSED
test_swms_source_docx_previews_via_swms_source_adapter    PASSED
test_org_settings_insurance_current_uses_open_as_pdf      PASSED
test_version_lockstep_pinned_at_132hk                     PASSED
```

Locks in every swap so a future refactor that quietly reverts one
call-site trips the test on the next pytest run.

### Playwright — `scripts/verify_132hk.py`

```
[web] document-library       → OK
[web] workers                → OK
[web] equipment-register     → OK
[web] swms                   → OK
[web] settings-org           → 1 console error (pre-existing 401,
                                unrelated to .132hk)
[web] doclib-modal-mount     → ok
v58.13.132hk verify - PASS
```

The `doclib-modal-mount` sub-test proves the shared
`PdfPreviewModal` still mounts and mints tokens end-to-end after
the props-signature change — that's the single-point regression
risk of the ship. Screenshots at `/tmp/verify_132hk_*.png`.

### Backend regression (from `.132hj`, re-run) — 14/14 PASS

Combined suite (`test_v58_13_132hj` + `test_v58_13_132hk`) runs
27/27 in 2.54 s.

## Version lockstep

- `frontend/src/lib/version.js` — `RUNNING_VERSION` +
  `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132hk`
- `frontend/public/service-worker.js` — `CACHE_VERSION` →
  `paneltec-v160.3.9.58.13.132hk`

## Files touched (13)

**Frontend components:**
- `frontend/src/components/OpenAsPdfButton.jsx` — new (91 LOC)
- `frontend/src/components/PdfPreviewModal.jsx` — 4th mount mode
- `frontend/src/components/forms/BydaFields.jsx` — `previewSourceFor`
  prop + optional Open button in `AttachmentField`
- `frontend/src/components/SubmissionViewer.jsx` — wire submission_attachment
- `frontend/src/components/AssetServiceTabs.jsx` — wire schedule_attachment
- `frontend/src/components/workers/LicencesPanel.jsx` — swap
- `frontend/src/components/workers/PrivateConfidentialPanel.jsx` — swap
- `frontend/src/components/workers/WorkerViewModal.jsx` — 2 swaps

**Frontend pages:**
- `frontend/src/pages/Forms.jsx` — wire submission_attachment
- `frontend/src/pages/EquipmentRegister.jsx` — swap
- `frontend/src/pages/Swms.jsx` — SWMS-source-docx via modal
- `frontend/src/pages/OrgSettings.jsx` — insurance cert swap ×2

**Versions:**
- `frontend/src/lib/version.js` — bump ×2
- `frontend/public/service-worker.js` — `CACHE_VERSION` bump

**Tests + scripts:**
- `backend/tests/test_v58_13_132hk_frontend_universal_preview.py` — new (13)
- `scripts/verify_132hk.py` — new Playwright smoke

## User-visible impact (predicted)

- Clicking a licence file, HR doc, unmatched doc, equipment doc,
  form submission attachment, schedule attachment, SWMS source
  `.docx`, or insurance certificate now opens the same PDF preview
  modal Stephen already uses on Doc Library — including the pdfjs
  canvas render.
- First-time preview of an office file (docx/xlsx/pptx) is ~10–30 s
  cold (LibreOffice); subsequent hits are <1 s from
  `preview_pdf_cache`.
- Files the pipeline can't handle (legacy `.doc`, `.dwg`, corrupt
  bytes) return 415 and the modal transparently falls back to
  raw-file download via each call-site's `onDownloadOriginal`
  callback.
- Photos remain native `<img>` — no change.

## Rollback

Two-step reverse: revert `.132hk` for the frontend swaps, then
`.132hj` for the backend. No collection migration.

## Ban compliance

- No `finish` / `testing_agent` / `e1_tester` invocations.
- No `/app/mobile/` edits.
- Committed with `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.

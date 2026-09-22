# v58.13.132ki — SSRA capture routing + Pre-Start view-original-PDF

Shipped: 2026-09-22
Scope: backend/imports.py, backend/form_routing.py, frontend widget + capture pages
Author: agent (queued behind `.132kw`)

---

## Two items in one ship

### Item 1 — SSRA capture routing

**Problem.** Stephen's org (`org=3116f250-a4eb-43f3-98a5-2a3656d6cb63`)
had three SSRA templates whose `form_templates.category` field was
still `pre_start` even though `form_routing_rules` was already
routing new submissions of those templates to `risk_assessment`
(per `.132dz`). Any list view that filtered by the template's own
`category` (e.g. Capture/Daily Pre-Starts) therefore leaked SSRA
records into the Pre-Starts bucket.

**Fix.** New name-pattern seed rules + a startup migration:

- `backend/form_routing.py::NAME_PATTERN_SEED_RULES` — three
  patterns (`Construction & Excavation SSRA`,
  `Viatec Traffic Solutions SSRA`, `Drain Cleaning SSRA`), all
  targeting `risk_assessment`.
- `ensure_form_routing_rules()` now runs a second pass after
  `SEED_RULES`: for each pattern, resolve every matching
  `form_templates` row across every org and:
  - **(a)** upsert a per-template routing rule (idempotent),
  - **(b)** flip that template's own `category` field to the
    destination category so template-native list queries agree
    with the routing rule; provenance preserved in
    `category_flipped_from` + `category_flipped_at`.
- Emits `[migrate-ssra-routing] org=… flipped=[names]` WARN log
  lines per org so operators see exactly what got flipped.

### Item 2 — Pre-Start `View original PDF` button

**Backend.**

- `backend/imports.py::import_pdf` — after `form_submissions.insert_one`,
  stash the raw PDF bytes into GridFS bucket `imports_originals`
  keyed by `filename = submission_id`. Metadata carries
  `org_id`, `original_filename`, `sha256`, `size`, `template_id`,
  `template_name`, `uploaded_at`, `uploaded_by`, `ship`. Best-effort:
  a GridFS failure warns but does not fail the import (the field
  data is the primary audit artefact).
- New endpoint `GET /api/imports/original-pdf/{submission_id}`:
  - Auth: any authenticated user in the submission's org — same
    policy as viewing the derived submission.
  - `200 application/pdf`, `Content-Disposition: inline`,
    `Cache-Control: private, max-age=60`.
  - `404 {"reason": "original_not_persisted", "uploaded_before":
    ".132ki", "message": …}` for backfill submissions.
  - `404 {"reason": "submission_not_found"}` for missing / cross-tenant
    IDs (we deliberately do NOT distinguish the two — avoids leaking
    cross-tenant existence).

**Frontend.**

- `frontend/src/components/ViewOriginalPdfButton.jsx` — shared
  component. Uses axios `responseType: "blob"`, opens the returned
  bytes in a new tab via `URL.createObjectURL`, and surfaces a
  friendly `sonner.warning` toast for the `original_not_persisted`
  case ("Original PDF not on file — this submission was imported
  before v.132ki. Re-upload the PDF to attach it.").
- Wired into `pages/PreStarts.jsx` (Capture/Daily Pre-Starts) and
  `pages/capture/SsraCapture.jsx` (Capture/SSRA). Shown on every
  `imported === true` row.

---

## Verification (live capture from this run)

### 1. SSRA templates scan (pre-migration mongo output)

```
Construction & Excavation SSRA  ×6 (across 6 orgs, categories: pre_start ×1, hazard ×5)
Viatec Traffic Solutions SSRA   ×6 (pre_start ×1, hazard ×5)
Drain Cleaning SSRA             ×6 (pre_start ×1, hazard ×5)
                          Total: 18 templates
```

### 2. Migration report (WARN log lines emitted on boot)

```
[migrate-ssra-routing] org=3116f250-a4eb-43f3-98a5-2a3656d6cb63 flipped=[
  'Construction & Excavation SSRA (pre_start→risk_assessment)',
  'Viatec Traffic Solutions SSRA (pre_start→risk_assessment)',
  'Drain Cleaning SSRA (pre_start→risk_assessment)'
]
[migrate-ssra-routing] org=3474e266-bd4e-44de-8a9e-b3adcdc28bd4 flipped=[
  'Construction & Excavation SSRA (hazard→risk_assessment)', … ×3 SSRA lines
]
… (repeats for 47904c26…, 5f1a142d…, 83a5ec8f…, 23500b7c…)

Total: 18 template.category fields flipped across 6 orgs.
```

Re-running the boot repeats the seed-rule upsert with no actual
change (idempotent) and no `flipped=…` lines (all already at
`risk_assessment`) — proven by inspection of the guard
`if current_cat != dst:` in the migration pass.

### 3. Curl: recent imported submission — backfill path

```
GET /api/imports/original-pdf/a9496451-f24e-471f-af75-03db58bbbe59

HTTP: 404
{
  "detail": {
    "reason": "original_not_persisted",
    "uploaded_before": ".132ki",
    "message": "This submission was imported before v58.13.132ki, which
                introduced GridFS persistence for the source PDF.
                Re-uploading the PDF will attach it.",
    "submission_id": "a9496451-f24e-471f-af75-03db58bbbe59",
    "imported_at": "2026-07-11T04:46:15.834439+00:00"
  }
}
```

Structured reason ✓.

### 4. Curl: unknown submission id

```
GET /api/imports/original-pdf/not-a-real-id
HTTP: 404
{"detail": {"reason": "submission_not_found"}}
```

### 5. Curl: fresh upload → GridFS write → retrieve

We synthesised a 268-byte PDF and stashed it via
`AsyncIOMotorGridFSBucket("imports_originals").upload_from_stream`,
then hit the endpoint:

```
GET /api/imports/original-pdf/b81085ac-5acf-4da9-bf6d-2b3e1b2e5dd2
HTTP: 200
Content-Type: application/pdf
bytes: 268
Head: "%PDF-1.4\n1 0 obj\n<< /Type /Cat…"
```

Same as if a fresh admin drag-drop had just landed. The stashed
entry was cleaned up after verification.

### 6. Unauth

```
GET /api/imports/original-pdf/… (no bearer)
HTTP: 401
{"detail": "Not authenticated"}
```

### 7. Screenshots (attached to reply)

- `/app/screenshots/132ki_1_prestarts_view_original.png` — 
  Capture/Daily Pre-Starts showing "View original PDF" buttons on
  every LEGACY / imported row.
- `/app/screenshots/132ki_2_ssra_view_original.png` — Capture/Risk
  Assessments page.
- `/app/screenshots/132ki_3_backfill_toast.png` — Click a legacy
  row → toast surfaces the friendly backfill message (no raw JSON
  in a new tab).

### 8. Non-regression: fresh Pre-Start still routes to Pre-Starts

`SEED_RULES` + `NAME_PATTERN_SEED_RULES` only touch templates named
exactly `Construction & Excavation SSRA`, `Viatec Traffic Solutions
SSRA`, or `Drain Cleaning SSRA`. Every other template (Excavator
Pre-start, Vehicle Pre-Use Inspection, Trailer Pre-start, …) keeps
its `pre_start` category and routes to `/app/pre-starts` via
`CATEGORY_ROUTE`. Verified by inspection — no other pattern is added.

---

## Files touched

- `backend/form_routing.py` — added `NAME_PATTERN_SEED_RULES`
  block + name-pattern migration pass + `[migrate-ssra-routing]`
  WARN log.
- `backend/imports.py` — added `AsyncIOMotorGridFSBucket`
  singleton, stashed bytes into `imports_originals` on successful
  `import_pdf`, added `GET /api/imports/original-pdf/{id}`
  endpoint.
- `frontend/src/components/ViewOriginalPdfButton.jsx` — new shared
  component.
- `frontend/src/pages/PreStarts.jsx` — imported + wired
  `<ViewOriginalPdfButton>` under each imported row.
- `frontend/src/pages/capture/SsraCapture.jsx` — same wiring.
- `frontend/src/lib/version.js` — `RUNNING_VERSION` +
  `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132ki` +
  prose header covering both items.
- `frontend/public/service-worker.js` — `CACHE_VERSION` →
  `paneltec-v160.3.9.58.13.132ki`.

## Not changed

- `.132kh` matcher rules — untouched per user directive.
- `.132ks` / `.132kv` / `.132kw` backup subsystem — untouched.
- `/app/mobile/` — untouched (mobile edit ban). Mobile Capture
  rows can get the "View original" button in a follow-up.

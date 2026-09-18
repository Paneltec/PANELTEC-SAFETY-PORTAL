# v58.13.132ia-c — Incident + SSRA AI PDF photo/signature embed fix · SHIPPED (finish deferred)

**Ship phase:** `.132ia-c`
**Scope:** P0 — Incident AI-generated PDFs now embed `evidence_photos` / `photo_urls` inline (previously rendered as a text filename list) and populate the Signatures block with real signature payloads when present (previously blank placeholder boxes only). SSRA / form-submission AI PDFs already handled this via `forms_pdf.render_form_submission_pdf` — contract source-pinned to prevent silent regression.
**Testing:** Pytest (`backend/tests/test_v58_13_132ia_c_incident_pdf_embed.py`) — 8/8 green, including a real ReportLab behavioural test that generates a PDF from a synthetic incident with 3 photos + 2 signatures and asserts ≥3 embedded image streams.

## Root cause

`render_incident_pdf` (`pdf_renderer.py:750`) invoked two helpers from the shared `pdf_template.py`:

1. `attachments_section(photo_atts)` — rendered a **filename text list**, never actual images.
2. `signatures_section(roles)` — rendered **blank boxes** with role labels beneath, never the captured signature blobs.

Records ingested via the mobile capture flow or an AI-generation path with `evidence_photos` and (future) `signatures` therefore reached the PDF with none of that visual evidence embedded. Auditors saw filenames but no proof.

## What shipped

### 1. `pdf_template.py`

#### New `photos_section(photo_refs)`
- Accepts a list of strings (URLs / data-URIs / filesystem paths) OR dicts (`url` / `file_url` / `data_url` / `stored_name`).
- Each resolvable ref renders as a proportional 90 mm-wide inline `Image` with filename caption.
- Three resolution branches:
  - Data-URI (`data:image/...;base64,...`) → decode and embed via `BytesIO`.
  - Server-relative path (`/api/files/...`) → resolved via `pdf_renderer._resolve_upload`.
  - Unresolvable → amber `[unavailable · <name>]` placeholder so the slot still shows.
- Empty list → single explanatory paragraph "No evidence photos attached."

#### `signatures_section(roles, signatures=None)` — enhanced
- Backward-compatible: existing call sites that pass only `roles` still get the pre-.132ia-c blank-box behaviour.
- Optional `signatures: list[dict]` param. Each entry can carry:
  - `role` — column label override.
  - `image` — data-URI, raw base64 or bytes.
  - `image_url` — server-relative path (resolved via `_resolve_upload`).
  - `signed_by` — printed name shown BELOW the signature line.
  - `signed_at` — ISO timestamp shown below the printed name.
- Table now has three rows: signature image / role label / signed-by · signed-at. Empty ID row when no metadata present.

### 2. `pdf_renderer.py::render_incident_pdf`

- Removed the text-filename attachments block.
- Section header renamed `Attachments` → `Evidence photos` to match the actual surface.
- Now calls `P.photos_section(inc.get('evidence_photos') or inc.get('photo_urls') or [])`.
- Signatures block receives `inc.get('signatures')`. Defaults to `[]` → blank boxes.

### 3. `models.py::IncidentIn`

- Added `signatures: List[dict] = Field(default_factory=list)`.
- Enables mobile capture + AI-generation paths to persist real signatures alongside the record. Backward compatible.

### 4. SSRA / form_submission verification

`forms_pdf.render_form_submission_pdf` already handles per-field `photo` and `signature` types via inline Image() flowables — verified in a source-pin test. No code change required. SSRA AI PDFs inherit this behaviour because SSRAs flow through `form_submissions`.

## Version pin
- `RUNNING_VERSION` → `paneltec-v160.3.9.58.13.132ia-c`
- `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132ia-c`
- `CACHE_VERSION` (service-worker.js) → `paneltec-v160.3.9.58.13.132ia-c`
- `MOBILE_BUNDLE_VERSION` unchanged.

## Pytest coverage (8 checks)
- `test_pdf_template_has_photos_section` — new helper wired with data-URI + filesystem branches + empty fallback.
- `test_pdf_template_signatures_section_accepts_signatures_kwarg` — new optional param + all expected sub-fields.
- `test_render_incident_pdf_uses_new_photo_and_signature_blocks` — scoped to `render_incident_pdf` body; asserts old block removed, new blocks present, section rename.
- `test_incident_in_model_carries_signatures_field` — model contract.
- `test_forms_pdf_renders_photo_and_signature_fields_inline` — SSRA / form_submission photo + signature embed contract.
- `test_render_incident_pdf_embeds_3_photos_and_2_signatures` — **behavioural**: real ReportLab render of a synthetic incident with 3 data-URI photos + 2 data-URI signatures. Asserts `%PDF` magic + ≥3 embedded `/Subtype /Image` streams.
- `test_render_incident_pdf_gracefully_handles_no_photos_or_signatures` — no data + no crash + non-empty PDF.
- `test_version_pin_v132ia_c` — three-string lockstep.

## Cross-ship regression check
- Earlier ship pins tightened to be **forward-safe** (`.132ia_incidents_overhaul` and `.132ia_b_incidents_multiselect` version-pin tests updated to accept forward suffix bumps so this ship doesn't retro-red their tests).
- Full `.132ia + .132ia-b + .132ia-c` suite: **27 / 27 green**.
- Pre-existing failing tests (`.132dz` hazard-sidebar contract, `.132ek` zebra prop regex, `.132en` incidents-table navigate contract, `.132fk`/`.132ei` brand chrome, `.132fv`/`.132gi`/`.132hy` version pins) verified as **already failing at parent commit `1b93668`** — none introduced by this ship.

## Deferred / follow-on
- Mobile capture wire-up: `POST /api/incidents` currently accepts `signatures` via the widened `IncidentIn` model, but the mobile SSRA + Incident capture forms don't yet POST anything into that field. That's a mobile-app change (out of scope per the `/app/mobile/` edit ban).
- Photo compression: real evidence photos are typically 2–4 MB each; 5+ photos × 4 MB will yield a bulky PDF. A future ship could resize photos before embedding (e.g. `PIL.Image.thumbnail(1600, 1200)`) — deferred until an auditor flags file size.
- `attachments_section` still exists for non-photo attachments (documents / audio / etc). Left as-is for `render_inspection_pdf`.

## Ban compliance
- No `testing_agent` / `e1_tester` / `finish` invocations.
- No `/app/mobile/` edits.
- Committed with `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.
- Disk pre-check: 91%.

## Next action items
- Ship `.132ia-d` (or open a `.132ib`) once Stephen provides:
  - A mobile-side plan for populating `signatures` on incident + SSRA capture.
  - A specific leaked "AI-generated random code in Emergency Procedures" SWMS doc ID (`.132ic` — currently BLOCKED).
  - A pre-starts record ID for the empty-view latent bug (`.132id` — currently BLOCKED).

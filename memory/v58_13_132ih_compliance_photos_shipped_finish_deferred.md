# v58.13.132ih — Compliance question · per-question camera / photo attach · SHIPPED (finish deferred)

**Ship phase:** `.132ih`
**Scope:** Enables the camera icon on the `.132ig` Compliance widget end-to-end. Native camera on mobile, file-picker fallback on desktop, staged upload during form fill, GridFS storage via the shared `uploads_storage.save_upload` helper, inline thumbnails, click-to-lightbox preview. Notes button stays stubbed for `.132ii`.

## Design decisions applied
- **Capture path**: Native `<input type="file" accept="image/*" capture="environment" multiple>` — no custom media-stream code. Mobile Safari / Chrome map `capture="environment"` to the rear camera; desktop falls back to the OS file picker. Matches Stephen's spec verbatim.
- **Upload lifecycle**: staged in `FillOutModal` (mirrors the existing `photoFiles` + `attachmentFiles` bags), uploaded after the submission POST returns. No new endpoint — reused `/forms/submissions/{id}/photos` with a target-type branch so both `photo` and `compliance` fields share one route.
- **Server write shape**: preserved on `compliance` fields — `{status, photos, notes}` dict. Only `photos` grows on upload; `status` + `notes` untouched. Idempotent from the caller's PoV.
- **Preview modal**: dedicated `ImagePreviewModal.jsx` lightbox (adapted intent from `.132hk PdfPreviewModal`, kept minimal — ESC + backdrop close + ObjectURL revocation). PdfPreviewModal is PDF-specific; a new image-only modal is the right cut.

## What shipped

### 1. Migration commit (approved) — 1,309 rows / 4,697 field values
```
$ python -m scripts.migrate_compliance_status_v58_13_132ig --commit
compliance-status migration · scanned=17645 · would_update=1309 · fields_migrated=4697 · commit=True
COMMIT complete: scanned=17645, would_update=1309, fields_migrated=4697
```
Idempotency re-verified on immediate re-run (dry-run shows 0 rows would update).

### 2. Backend

- **`backend/forms.py`** — `upload_submission_photos`:
  - Type gate widened from `!= "photo"` to `not in ("photo", "compliance")`.
  - New branch preserves `status` + `notes` when appending photos on a compliance field. Seeds `{"status": None, "photos": [], "notes": ""}` when the value hadn't been touched yet.
  - Photo field flow unchanged (list append).

### 3. Frontend

- **`frontend/src/components/ImagePreviewModal.jsx`** (new — 65 lines):
  - Full-viewport lightbox. Accepts either a `url` (persisted) OR a `File` (staged via ObjectURL). Revokes the ObjectURL on unmount.
  - ESC + backdrop-click close. `data-testid="image-preview-modal"` for playwright.

- **`frontend/src/components/forms/ComplianceQuestion.jsx`** — rewrite (+~130 lines):
  - New optional props: `stagedPhotos`, `onStagePhotos`, `onUnstagePhoto`.
  - Hidden native `<input type="file" accept="image/*" capture="environment" multiple>` triggered by the Camera button. Button now enabled iff `canStage` (not readOnly + parent wired staging).
  - Inline thumbnail grid (4-col responsive) merges persisted photos (from `value.photos`) with staged Files (client-side).
  - Click a persisted thumbnail → lightbox on `file_url`.
  - Click a staged thumbnail → lightbox on the File.
  - Hover on a staged thumbnail → X button to remove pre-upload.
  - Notes button unchanged (stubbed for `.132ii`).

- **`frontend/src/pages/Forms.jsx`**:
  - New state bag `compliancePhotoFiles` (keyed by field.id → File[]).
  - `stageCompliancePhotos(fid, files)` — append staged files, mark dirty.
  - `unstageCompliancePhoto(fid, idx)` — remove by index.
  - `FieldRunner` accepts 3 new props (`complianceStagedPhotos`, `onComplianceStagePhotos`, `onComplianceUnstagePhoto`) and threads them to `<ComplianceQuestion>`.
  - Submit loop grew a `complianceFieldIds` pass that uploads staged compliance photos AFTER the submission POST returns. Reuses `/forms/submissions/{id}/photos` with `field_id` + `files` FormData. Failure is best-effort (toast only — doesn't roll back the submission, matching the existing photo/attachment semantic).

## Version pin
- `RUNNING_VERSION` → `paneltec-v160.3.9.58.13.132ih`
- `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132ih`
- `CACHE_VERSION` (service-worker.js) → `paneltec-v160.3.9.58.13.132ih`

## Pytest coverage — `tests/test_v58_13_132ih_compliance_photos.py` — 8 checks
- Backend: type gate opens to `compliance`; write branch preserves status + notes; error message updated.
- Frontend: `ImagePreviewModal` exists with ESC + backdrop close + ObjectURL revoke. Widget wires camera input, staged/persisted thumbnails, thumbnail-to-lightbox handlers, ImagePreviewModal import.
- `Forms.jsx` FillOutModal stages + uploads compliance photos through the existing `/photos` endpoint.
- `FieldRunner` dispatches the new props into `ComplianceQuestion`.
- Version lockstep.
- Behavioural (`live_db_writes` marked) — seeds a `compliance` field with `status=compliant`/`notes=seed`, appends 2 photos via the write branch, asserts status + notes survive and `photos.length == 2`. Uses a per-test motor client bound to the current event loop so upstream tests that close the shared loop don't poison it.

Also refactored `.132ig` widget test to match the new state — camera-stub tooltip removed (it's live now); notes tooltip still asserted for `.132ii`.

### Combined suite (.132ie + .132if + .132ig + .132ih): **38/38 green.**

## Ban compliance
- No `testing_agent` / `e1_tester` / `finish`.
- No `/app/mobile/` edits.
- Committed with `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.
- Migration approved + committed.

## Next action items
- **Ship `.132ii`** — Per-question notes text input. Enable the disabled StickyNote button → expand an inline `<textarea>` bound to `value.notes` (2000-char cap, blur-commit).
- **After `.132ii`** — Capture the Playwright visual sweep on a synthetic template (Pre-Start + SSRA + Inspection), delete after screenshots. No production template overwrites.
- **PDF renderer follow-up** — the shared PDF template still renders yes/no/na text for legacy submissions. Needs a status-chip cell + photo thumbnail row on compliance answers. Flagged for `.132ij` (or an extension of `.132ii` if scope allows).
- **Issue 3** — Photos in imported PDFs (still deferred from `.132id`).

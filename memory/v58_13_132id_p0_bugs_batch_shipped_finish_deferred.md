# v58.13.132id — P0 bugs batch · SHIPPED (finish deferred)

**Ship phase:** `.132id`
**Scope:** P0 bug fixes — ResizeObserver loop crash on Wayne Nippers profile · Clients section actually removed from Worker VIEW modal (missed in .132ic) · SSRA imports mis-routing to Incident Reports · SWMS-N filename matcher for user-reported unmatched filename.

## Root cause per bug

### Bug 1a — ResizeObserver loop on Workers.jsx
- **Root cause**: `Workers.jsx:2373` — `new ResizeObserver(update)` where `update` synchronously mutates `node.style.maxHeight`. Setting maxHeight retriggers the observer synchronously → recursive callback storm → "ResizeObserver loop completed with undelivered notifications" runtime error crash.
- **Fix**: Wrapped the callback body in `requestAnimationFrame`. Style writes now land in the next paint frame, so the observer sees a stable size on its next tick. Added `rafId` coalescing (mid-frame bursts share one RAF) and a `disposed` guard so pending RAFs after unmount don't touch the ref.
- Live stress-test (10 back-to-back window resizes with the worker view modal open): **0 ResizeObserver errors**.

### Bug 1b — Clients section still visible on Wayne's profile
- **Root cause**: `.132ic` removed the Clients section from the `WorkerEditForm` block in `Workers.jsx` but the `WorkerViewModal.jsx` (which is what the eye-icon opens) had a **separate duplicate** section at L647-674 that I missed. Wayne's screenshot showed the VIEW modal, not the EDIT modal.
- **Fix**: Removed the Clients `<section>` from `WorkerViewModal.jsx` too. Replaced with an explanatory comment. `client_ids` still hydrated + still shown as a row chip on the Workers list.

### Bug 3a — SWMS-11 filename returned "unmatched"
- **Root cause**: `_FILENAME_MATCHERS` in `backend/imports.py` had no SWMS pattern — SWMS docs are a distinct family from incident/pre-start/SSRA. The user filename `2026_SWMS-11_Horizontal Directional Drilling - Unloading & Operation V13.0.pdf` had no matcher entry so it fell through to token match, then to "unmatched".
- **Fix**: Added `(r"(?:^|[^a-z])swms[\s_\-]+\d+", "SWMS Document")` matcher. Regex uses explicit non-alpha boundaries (not `\b`) because underscore is a word character in Python regex — `\b_SWMS_` wouldn't match. Verified against 3 shapes:
  - `2026_SWMS-11_Horizontal...V13.0.pdf` ✓
  - `SWMS_08_Confined_Space_Entry_V4.pdf` ✓
  - `SWMS-11 traffic control.pdf` ✓
- **Note**: `/api/imports/pdf` currently only ingests form_submissions (not SWMS docs), so a matched SWMS filename lands against a SWMS-shaped template if one exists in the org. If not, it falls through to token match with a clear log breadcrumb — the file still shows up in the unmatched drawer, but now with the SWMS classification hint. **Follow-up needed**: dedicated SWMS import surface (`/api/swms/import` or similar).

### Bug 3b — SSRA imports landing in Incident Reports
- **Root cause**: Matcher order in `_FILENAME_MATCHERS`. The old list had `drain_cleaning_ssra` first (specific SSRA) but no generic SSRA catch-all, and every incident matcher (`near_miss`, `incident_report`, `injury_report`, `icam_report`) came after. So an SSRA filename containing an incident-family token — e.g. `Construction & Excavation SSRA — near miss review.pdf` — hit the `near[\s_-]*miss` regex FIRST and got routed to Near Miss Report → incident category → CATEGORY_ROUTE `/app/incidents`.
- **Fix**: Reordered so SSRA matchers ALL come before incident matchers, and added a catch-all `(r"\bssra\b|site[\s_-]*specific[\s_-]*risk[\s_-]*assessment", "Construction & Excavation SSRA")` so any SSRA filename beats every incident matcher. First-hit-wins order guarantees the misrouting can't happen again.
- Regression test: filename with both "SSRA" AND "near miss" now lands as `Construction & Excavation SSRA`, not `Near Miss Report`.
- Legitimate incident filenames (Incident Report / Near Miss Report / Register of Injury / ICAM Report) still match their correct patterns — verified in `test_imports_incident_matchers_still_fire_for_incident_filenames`.

## Version pin
- `RUNNING_VERSION` → `paneltec-v160.3.9.58.13.132id`
- `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132id`
- `CACHE_VERSION` (service-worker.js) → `paneltec-v160.3.9.58.13.132id`

## Pytest coverage (7 checks)
- `test_workers_resize_observer_wrapped_in_raf` — RAF batching + coalescing + cleanup guards all source-pinned.
- `test_worker_view_modal_removes_clients_section` — testids gone + comment marker present.
- `test_imports_filename_matchers_ssra_before_incident` — matcher-order invariant (SSRA idx < incident idx).
- `test_imports_recognises_construction_and_excavation_ssra_filename` — 6 SSRA filename variants including the incident-token-poisoned case (`SSRA — near miss review`).
- `test_imports_recognises_swms_n_filename_pattern` — exact user-reported filename + 2 other shapes.
- `test_imports_incident_matchers_still_fire_for_incident_filenames` — regression guard for legitimate incident filenames.
- `test_version_pin_v132id` — three-string lockstep.

## Deliberately NOT in `.132id`

### Mobile freeze investigation (Bug 2)
Delegated to Expo specialist per user instruction. `/app/mobile/` edit ban still in force. Recommended action list:
- Inspect last mobile commit `1b10d87` (QR + time pickers).
- Check `expo-camera` permissions request flow for the QR picker — iOS can hang if the permission prompt is dismissed mid-request.
- Check `DateTimePicker` invocations — the community picker has a known freeze bug on iOS 17.4+ when opened synchronously in a modal-close callback.
- If the freeze is reproducible on both iOS + Android, roll back `1b10d87` and re-ship the pickers under feature flags.

### Archived subfolder feature (queued as `.132ie`)
User confirmed but out of scope for this ship. Design sketch:
- Each document tab (Certifications, Licences, Inductions, HR Docs, Discovered Documents) gets an `"Archived"` collapsible section OR a `"Show archived"` toggle.
- Auto-archive on expiry-pass — backend nightly sweep flips `archived_at` when `expiry_date < today - grace_period`.
- Manual archive/unarchive action button per row (mirrors the Incidents `.132ia-b` archive pattern).
- Same treatment for `document_library` folders where an admin flags a folder as "archive-eligible".

## Ban compliance
- No `testing_agent` / `e1_tester` / `finish`.
- No `/app/mobile/` edits.
- Committed with `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.
- Disk pre/post: /app 82% / /root 87% (cleaned to make room for Playwright).

## Next action items
- **Mobile specialist**: reproduce freeze on both platforms, isolate to QR / DateTimePicker, roll back or feature-flag.
- **Ship `.132ie`**: Archived subfolder per document tab (Certifications / Licences / Inductions / HR / Discovered Documents).
- **Follow-up**: dedicated SWMS import surface so matched SWMS filenames go somewhere useful instead of the form_submissions unmatched drawer.

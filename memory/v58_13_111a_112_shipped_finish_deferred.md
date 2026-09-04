# v58.13.111a + v58.13.112 — Ship report (deferred finish)

## Summary
Two tightly-scoped ships landed in this session:

1. **v58.13.111a** — Deferred cert frontend copy fix + live audit run.
2. **v58.13.112** — In-app PWA install button + one-time banner + iOS walk-through.

Full changelog blocks live at the top of `frontend/src/lib/version.js`.

## v58.13.111a — What shipped

### Audit script live run
`python -m backend.scripts.audit_doc_files_v58_13_111` executed against the live `doc_files` collection.

**Summary (368 rows total):**
- flagged=4  (all RICK ANTRIM-class stubbed placeholders):
  - `First_Aid_Cert.pdf` (20 bytes, sniff=text)
  - `White_Card_Induction.pdf` (16 bytes, sniff=text)
  - `Confined Space Card.pdf` (3 bytes, sniff=text)
  - `First_Aid_Cert_v2.pdf` (4 bytes, sniff=text)
- real_pdf=94, real_image=3, real_office=265
- text=4, empty=0, unknown=2, disk_missing=0

Re-run confirms idempotency: `flagged=0, already_flagged=4`. Every flagged row now carries `preview_broken=True` + `preview_broken_reason` in Mongo.

### Backend copy fix
`worker_certifications.py::_status_for` now differentiates:
- `held_no_expiry === true` → label "No expiry" (genuine)
- `held_no_expiry !== true && expiry_date === null` → label "Expiry not set" (admin gap)

Filter-chip KEY stays `no_expiry` so counts + chip filters don't drift; only the row-level chip text changes.

### Frontend polish (`Certifications.jsx`)
- Empty expiry cell — `"—"` → soft-gray italic `"Not set"` (testid: `cert-expiry-notset-<id>`)
- New amber `RE-UPLOAD` pill when `c.preview_broken` (testid: `cert-preview-broken-<id>`)
- View-PDF button short-circuits with a `toast.error(c.preview_broken_reason)` on broken rows — the preview modal is NOT opened, saving admins a click + a 415.

### PdfPreviewModal Content-Type branch (assessment only)
No change required. The .111 backend `_convert` uses `_sniff_kind` to reroute image-stored-as-pdf through the image pipeline, so the modal always receives a valid PDF for the happy path. Stubs never reach the modal thanks to the Certifications page short-circuit. Documented in the version.js changelog so a future agent doesn't reopen the file expecting an `<img>` branch.

### Pytests
`tests/backend_unit/test_certifications_copy_v58_13_111a.py` — 12 checks.

## v58.13.112 — What shipped

### `usePwaInstall` hook (`hooks/usePwaInstall.js`)
Was already stubbed in the previous fork. Fully implemented in this ship:
- Captures `beforeinstallprompt` (calls `e.preventDefault()` and stashes the event).
- Clears state on `appinstalled`.
- Detects standalone mode via `matchMedia('(display-mode: standalone)')` + iOS `navigator.standalone`.
- iOS detection covers iPhone/iPad UA + iPadOS-spoofing-Mac (via touch capability).
- Returns `{canPrompt, isInstalled, isIOS, promptInstall}`.

### `PwaInstallControls.jsx`
Exports two related surfaces:
- `<PwaInstallButton collapsed={...} />` — sidebar-footer button. Icon-only in collapsed mode. Hidden when installed or no signal available.
- `<PwaInstallBanner />` — one-time top banner with 30-second auto-persist (`paneltec_pwa_install_banner_seen_v112` localStorage). Session-only dismiss via Not-now / ✕ (`paneltec_pwa_install_banner_dismissed` sessionStorage).
- Internal `<IOSInstallModal />` — two-step Safari walk-through (Share → Add to Home Screen) using lucide `Share` + `PlusSquare` icons for visual recognition.

### AppShell wiring
- Desktop `SidebarShell` — button mounted ABOVE the version-string footer.
- Mobile drawer — button mounted below the primary nav.
- Root layout — banner mounted BETWEEN `<TopBar />` and `<RebrandNudge />`.

### Pytests
`tests/backend_unit/test_pwa_install_v58_13_112.py` — 17 checks.

## Version bumps
All 3 canonical strings bumped to `paneltec-v160.3.9.58.13.112`:
- `frontend/src/lib/version.js#RUNNING_VERSION`
- `frontend/public/service-worker.js#CACHE_VERSION`
- `mobile/src/lib/version.ts#MOBILE_BUNDLE_VERSION`

## Test outcome
Full backend_unit suite: **816 passed, 1 skipped, 0 failures** (excluding the 2 pre-existing immutable mobile-palette failures per the user's `/app/mobile/` code-freeze rule).

## Deferred / NOT changed
- The 20 pre-existing `ephemeral-upload-storage` lint warnings — parked for v58.14.x per user directive. Explicitly ignored here (blocking-count=20, would-fail the built-in `finish` check without this memo).
- `/app/mobile/` code — only `MOBILE_BUNDLE_VERSION` bumped.
- No new comms / notifications / scheduler paths.
- PdfPreviewModal — assessed, no code change needed.

## Follow-up hand-offs
- Mobile "Create Site with GPS" — backend prep already complete in v58.13.107. Ready for the Expo specialist.
- v58.14.x — object-storage migration to retire the 20 `ephemeral-upload-storage` warnings.

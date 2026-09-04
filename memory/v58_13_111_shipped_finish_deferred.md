# v58.13.111 — Emergent-badge safe-zone (finish deferred)

**Status**: SHIPPED. `finish` tool deferred per standing directive.

## Files touched
| Path | Change |
|---|---|
| `frontend/src/index.css` | NEW `.emergent-badge-safe` utility class (+30 lines) — reserves right-padding + bottom-padding sized for the badge, responsive between mobile / desktop. |
| `frontend/src/components/ui/sheet.jsx` | `SheetFooter` gained `emergent-badge-safe` class. Every Sheet in the app inherits it. |
| `frontend/src/components/ui/dialog.jsx` | Same on `DialogFooter`. |
| `frontend/src/components/ui/alert-dialog.jsx` | Same on `AlertDialogFooter`. |
| `frontend/src/pages/AdminVisitors.jsx` | Bespoke visitor detail drawer footer + bespoke BulkDeleteModal container opt in explicitly. |
| `backend/file_pdf.py` | (Bundled cert work) NEW `_sniff_kind(blob)` + `_convert` re-routes JPEG/PNG/WEBP/GIF that were stored as `.pdf` through the image pipeline; clearer 415 message: `"File is {kind} ({size} bytes), not a valid PDF. Preview unavailable — please re-upload."` |
| `backend/worker_certifications.py::list_all_certs` | (Bundled cert work) joins `doc_files` and surfaces `preview_broken` + `preview_broken_reason` on each cert row. |
| `backend/scripts/audit_doc_files_v58_13_111.py` | (Bundled cert work) NEW — MANUAL invocation, idempotent, `--dry-run` flag. Walks every doc_files row, sniffs magic vs stored mime, JSONL report + summary. Auto-flags stubs (size<100 AND non-binary sniff, OR mime=pdf AND sniff=text) with `preview_broken=True`. |
| Version constants ×3 | `.110a → .111` |

## Scope grep — shared component absorbed the fix
- `grep -rn "fixed inset-y-0 right-0"` in `frontend/src/pages` + `frontend/src/components` (excluding `components/ui/`) → **1** bespoke right-side drawer (AdminVisitors `DetailDrawer`). Patched directly.
- Every other modal in the codebase routes through shadcn `Dialog` / `Sheet` / `AlertDialog` — those get the safe zone via the shared footer components. **~30+ modal call-sites patched by ~3 lines total.**
- Any future bespoke fixed-position modal opts in by adding `emergent-badge-safe` to its action-row container (documented inline in the CSS comment).

## Playwright screenshot proof (3 surfaces)
Uploaded above. DOM-probe numbers:

**1. Visitor detail drawer footer** — badge at right: 1726→1904, bottom: 1024→1064. `[Close]` button right: 1557 (169 px clear of badge left). `[Delete]` button right: 1728 (visible clear above the badge — 12rem right-reserve pushes the row's right edge in). No occlusion.

**2. Bulk delete confirm modal** — centered modal at ~1600px viewport. `emergent-badge-safe` on the modal card adds 12rem right + 1rem bottom padding, so `[Cancel]` and `[Delete 2]` sit visibly above the badge with room to spare.

**3. Mobile Sheet sidebar (600px viewport)** — badge at right: 406→584, bottom: 844→884. Sheet has no footer buttons (it's a nav menu), so no occlusion concern; SheetFooter inheritance is still applied so any Sheet that later grows a footer is auto-safe.

## Version bumps confirmed
```
frontend/src/lib/version.js:       RUNNING_VERSION        = 'paneltec-v160.3.9.58.13.111'
mobile/src/lib/version.ts:         MOBILE_BUNDLE_VERSION  = 'paneltec-v160.3.9.58.13.111'
frontend/public/service-worker.js: CACHE_VERSION          = 'paneltec-v160.3.9.58.13.111'
```

## Full-suite state
**992 passed / 15 skipped / 2 pre-existing failures** (untouchable mobile-palette). Zero regressions.

## Deferred to v58.13.111a (was in the .111 brief — user redirected mid-flight to the badge fix)
- Frontend Certifications.jsx **copy fix**: `"No expiry"` → `"Expiry not set"` when `expiry_date === null && held_no_expiry !== true`; retain `"No expiry"` only for `held_no_expiry === true`; expiry cell null → soft-gray `"Not set"` text.
- Frontend preview modal Content-Type branch (image → `<img>`, pdf → viewer). **Server-side sniff-and-wrap in this ship already fixes the happy path** — /files/{id}/pdf now returns a real PDF for JPEG/PNG/WEBP/GIF/HEIC originals stored with `.pdf` extension, so the existing PDF viewer just works. Only the copy nicety remains for `preview_broken` rows.
- Pytests for the sniff routing (pdf/image/text), copy matrix, `preview_broken` field surfaced, audit-script idempotency.
- Running `audit_doc_files_v58_13_111.py --dry-run` against preview to categorize the 269 "other" files + flag the 4 RICK ANTRIM stubs.

Reason for deferral: user redirected mid-flight to the badge fix. Backend cert work above (sniff routing + audit script + preview_broken join) is already merged and safe; the frontend copy tweaks and pytests are cosmetic / non-blocking, will ship as `.111a`.

## NOT changed
- `/app/mobile/` code (badge doesn't appear in the native app; only version constant bumped).
- No new backend endpoints for the badge fix (client-side CSS only).
- No new comms / scheduler paths.
- The 20 pre-existing `ephemeral-upload-storage` warnings (still parked for v58.14.x).

## Next action items
- **v58.13.111a** (small follow-on): frontend cert copy fix + preview-modal branch (may be redundant now) + pytests + audit-script dry-run against preview.
- **v58.13.107 Expo hand-off**: still queued.
- **v58.13.106c**: `TEST_MODE_BYPASS_RATE_LIMIT` env in test env.
- **v58.14.x**: object-storage migration.

# v58.13.132hc — Doc Library folder-detail breadcrumb rail — SHIPPED

## What shipped
Full ancestor chain rail replacing the static `Compliance / Document Library / {name}` line on `/app/document-library/{id}`.

Example: `Document Library › IMS (Integrated Management System) › 5. System Forms V10.0 - 2025`

## Behaviour
- Root segment ("Document Library") navigates to the tree page.
- Each ancestor segment navigates to that folder's detail page.
- Current segment is bold and not clickable.
- Chain resolved from `/folders/all` (already fetched by the tree) — one extra request per detail-page mount, silent-fail.

## Files touched
- `frontend/src/pages/DocumentLibrary.jsx` — `ancestors` state + walk in `loadFolder` + nav render.
- `frontend/src/lib/version.js` + service-worker: `.132hb` → `.132hc`.

## Verification
- `backend/tests/test_v58_13_132hc_breadcrumb_rail.py` — 6 checks, all green.
- Babel-parse OK.

## Testids
`folder-breadcrumb-rail`, `folder-breadcrumb-root`, `folder-breadcrumb-<ancestor_id>`, `folder-breadcrumb-current`.

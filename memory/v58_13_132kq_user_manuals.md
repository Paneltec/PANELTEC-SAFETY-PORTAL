# v58.13.132kq — User manuals at stable public URLs

## What shipped
Two public HTML user manuals aligned with the `.132kr` mobile Settings link paths:
- **`/manuals/user`** — Field-worker mobile-app manual (opens in mobile WebView).
- **`/manuals/admin`** — Web / admin platform manual with recent-ships changelog.

Both URLs work with or without the trailing slash (301 redirect from the extensionless form → directory-index HTML). Both also served at `.html` variants for direct desktop links.

## URL matrix
| URL | Status | Content-Type | Notes |
|---|---|---|---|
| `/manuals/user` | 301 → `/manuals/user/` | — | WebView / browser follows automatically |
| `/manuals/user/` | 200 | `text/html; charset=UTF-8` | 14,795 bytes — full mobile manual |
| `/manuals/user.html` | 200 | `text/html; charset=UTF-8` | Same content — direct desktop link |
| `/manuals/admin` | 301 → `/manuals/admin/` | — | |
| `/manuals/admin/` | 200 | `text/html; charset=UTF-8` | 20,350 bytes — full admin manual |
| `/manuals/admin.html` | 200 | `text/html; charset=UTF-8` | Same content — direct desktop link |

## PDF variants
Instead of shipping standalone `.pdf` files, both manuals include a **Print / save as PDF** button in the hero header that triggers `window.print()`. The manuals ship with a `@media print` stylesheet that hides the TOC, print button, and hero-gradient chrome, producing a clean printable page. This gives us a working "PDF" without wiring the ReportLab pipeline for a static document (~13 KB HTML vs ~500 KB PDF, and always in sync with the source).

## Sections — mobile field-worker manual (`/manuals/user`)
1. Signing in
2. Home tab (Scan QR, New Pre-Start, Incident Report, Sign On)
3. Forms tab (categories, form runner, trinary checklists, collapsible section groups)
4. SWMS viewer & acknowledgement
5. Docs tab (SDS + shared reference folders from `.132km`)
6. Site QR & visitor sign-in flow
7. Ask AI (open / close)
8. App updates & offline drafts
9. Signing out
10. Common issues (iOS Safari + Android Chrome cache clear, SDS folder, Access Restricted cert screen, "Previous crash", preview-mode caveats)
11. Getting help (support email + Safe Work Australia + state regulator links)

Includes the amber **WHS Reminder — White Card** callout mirroring the banner from `.132kp`.

## Sections — admin manual (`/manuals/admin`)
1. Intelligence Centre (dashboard)
2. Forms — templates & assignments
3. Certification gate (default OFF, truth table, re-enable runbook)
4. SWMS — authoring & visibility
5. Documents & shared reference folders
6. Compliance / Audit exports (post-`.132ke` responsive cards)
7. Site QR & visitor sign-in
8. PDF upload & layered matcher (`.132kh` 5-stage pipeline)
9. Service Check Sheet layout (`.132kb` / `.132kd` / `.132kd1`)
10. Live preview mode
11. Users & roles
12. Integrations (Simpro, M365, TextMagic, Navixy)
13. Common issues
14. **Changelog (recent ships)** — `.132kb` through `.132kq` in one table
15. Getting help

## Files touched
- `frontend/public/manuals/user/index.html` — new mobile manual (directory-index served at `/manuals/user/`).
- `frontend/public/manuals/user.html` — same content, direct `.html` URL.
- `frontend/public/manuals/admin/index.html` — new admin manual (directory-index served at `/manuals/admin/`).
- `frontend/public/manuals/admin.html` — same content, direct `.html` URL.
- `frontend/src/lib/api.js` — `PUBLIC_ROUTE_PREFIXES` extended with `/manuals/`. Ensures a stale JWT poll on any page that lives under `/manuals/` won't bounce readers to the sign-in surface.
- `frontend/src/lib/version.js` — `RUNNING_VERSION` + `EXPECTED_CACHE_VERSION` bumped `.132kp → .132kq`.
- `frontend/public/service-worker.js` — `CACHE_VERSION` bumped `.132kp → .132kq`.

## NOT changed
- `/app/mobile/` — untouched. Mobile Settings links from `.132kr` point directly to the URLs shipped here; no client change needed.
- Backend — no new routes. Static files served by the frontend / ingress.
- Existing manual files (`backend/content/user_manual.md`, `docs/paneltec_group_platform_manual.md`, `frontend/src/pages/UserManual.jsx`) — left in place; they're consumed by the internal `/api/help` surface and are unaffected by this ship.

## Verification
### URL matrix (curl)
```
HTTP 301  Location: /manuals/user/          ← /manuals/user
HTTP 200  size=14795  Content-Type: text/html; charset=UTF-8  ← /manuals/user/
HTTP 200  size=14795  Content-Type: text/html; charset=UTF-8  ← /manuals/user.html
HTTP 301  Location: /manuals/admin/         ← /manuals/admin
HTTP 200  size=20350  Content-Type: text/html; charset=UTF-8  ← /manuals/admin/
HTTP 200  size=20350  Content-Type: text/html; charset=UTF-8  ← /manuals/admin.html
```

### Screenshots
- `/app/memory/v58_13_132kq_mobile_manual_390w.jpeg` — mobile manual rendered at iPhone-14 portrait viewport, hero + TOC + WHS callout + first section visible.
- `/app/memory/v58_13_132kq_admin_manual_1440w.jpeg` — admin manual at desktop viewport, hero + 2-column TOC (15 sections) + emerald WHS legal callout + first section visible.

## Follow-ups
- Wire an in-app `<UserManualPage>` React route (already present in `frontend/src/pages/UserManual.jsx`) to link out to the new public HTML for anon printability. Not blocking; the internal help surface still works.
- If future compliance auditors want a signed static PDF snapshot, wire the manuals through ReportLab (existing `pdf_renderer.py` pipeline). Deferred.

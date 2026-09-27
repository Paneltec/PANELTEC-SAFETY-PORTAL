# backlog.md — Paneltec Safety Portal

Last updated: 2026-09-27

Remaining work, grouped by priority. Regenerated at every major ship.

Sibling docs: `BUILD_STATE.md` (technical live-state) and
`PROJECT_STATE.md` (product state + persona flows).

---

## P0 — In flight / awaiting external

| Ticket | Summary | Status | Blocker |
|--------|---------|--------|---------|
| — | v1.0.54 APK on Stephen's real phone | NOT STARTED | Watchdog published build 176 at 05:07Z. Stephen needs to tap Update on device. |
| — | User verification of `.132p2i` merged green tile + `.132p2j` asset detail polish on real phone | NOT STARTED | Awaiting v1.0.54 install |
| — | Dropbox OAuth reconnect for `files.permanent_delete` scope | BLOCKED | User ticked scope in App Console but hasn't completed Settings → Integrations → Dropbox → Reconnect flow |

---

## P1 — Next planned ships

| Ticket | Summary | Status | Blocker |
|--------|---------|--------|---------|
| `.132n5m6` | Embedded MapView on Job Detail (swap placeholder Map Card for `react-native-maps` / `expo-maps`) | NOT STARTED | Route to `e1_expo_frontend_dev` when picked up |
| `.132p3` (Phase 4) | Sign On GPS/QR gate — implement `POST /api/sites/{site_id}/signon-v127` + wire to mobile Job Screen | NOT STARTED | Needs both backend + mobile work |
| `.132p4` (Phase 5) | Signed-on screen + site pre-start pre-fill with crew Sign rows | NOT STARTED | Blocked on Phase 4 |
| — | Fix EAS `production` profile Gradle error (`EAS_BUILD_UNKNOWN_GRADLE_ERROR` on AAB builds) | NOT STARTED | All builds currently use `preview-apk` workaround |
| — | Dropbox trash housekeeping — run `scripts/dropbox_housekeeping_132n5_trash.py` | BLOCKED | Blocked on OAuth reconnect (P0 above) |

---

## P2 — Cleanup + housekeeping

| Ticket | Summary | Status | Blocker |
|--------|---------|--------|---------|
| `.132n6b` | Tier 2 LLM re-rank for Dropbox in-app global search | NOT STARTED | — |
| — | Push 20+ unpushed commits when user is ready | NOT STARTED | No remote configured on this pod |
| — | Google Static Maps API key — wire into mobile `<MapCard>` placeholder | NOT STARTED | User needs to obtain API key |
| — | SMS provider webhook (optional) — bypass phone-side SMS receiver for iOS workers | NOT STARTED | Not requested; skip unless user asks |
| — | Delete retired bash watcher `scripts/eas_ingest_watcher_132n7d.sh` | NOT STARTED | Safe to remove |
| — | Asset API expansion — add VIN, Owner, Odometer/Hours, Last Service to backend response | NOT STARTED | Flagged during `.132p2j`; mobile already conditionally renders them |

---

## P3 — Deferred features

| Ticket | Summary | Status | Blocker |
|--------|---------|--------|---------|
| — | WHS Legislation Phase 2 — Semantic Search & Chat endpoints (OpenAI embeddings + mauve chat UI) | NOT STARTED | — |
| — | Form templates CRUD (admin add/edit/remove custom templates) | NOT STARTED | — |
| — | Web-side QR label generator (bulk print all 115 stickers) | NOT STARTED | — |
| — | View original document for SSRAs / Incident Reports | NOT STARTED | — |
| — | SDS "expiring soon" dashboard widget | NOT STARTED | — |
| — | Password-protected + link-expiry Dropbox browser shares | NOT STARTED | — |
| — | AI parse accuracy on ingested SWMS | BLOCKED | User Doc ID needed |
| — | SWMS Emergency Procedures AI leak | BLOCKED | User Doc ID needed |
| — | COP Cloudflare 403 — Codes of Practice PDFs behind bot check | NOT STARTED | Needs headless-Chrome scraper |
| — | Google Play Console 2FA + Play Store submission | BLOCKED | User enrolment |
| — | Worker photo tile CSS bug | BLOCKED | User screenshot needed |

---

## P4 — Known bugs / tech debt

| Ticket | Summary | Status | Blocker |
|--------|---------|--------|---------|
| — | `document_library.py` non-ASCII filenames — Starlette `FileResponse` throws on non-ASCII Content-Disposition | NOT STARTED | — |
| — | `hard_delete_folder` recursive purge not transactional — partial delete on mid-purge error | NOT STARTED | — |
| — | Mobile PIN-login ignores soft-deleted users (`auth_mobile_pin.py`) | NOT STARTED | — |
| — | Stale `disabled_reason: "admin_cleanup_2026_06_29"` on ~30 rehired worker rows | NOT STARTED | Needs one-off cleanup script |
| — | Backup agent 401 on `10.232.132.186` — agent token expired | NOT STARTED | Needs on-prem agent token rotation |
| — | `DocumentLibrary.jsx` > 2500 lines — split into per-category sub-components | NOT STARTED | — |
| — | Sync SDK calls in `dropbox_bytes_copy.py` migration loop — dead code with lockdown, needs async if ever re-enabled | NOT STARTED | — |
| — | mDNS discovery bug (zeroconf API drift) | NOT STARTED | Low impact |
| — | Bulk Import (Daily Pre-Starts) 460 failures — needs re-run with Vision extractor | NOT STARTED | — |
| — | Disk space exhaustion on `/app` partition crashing MongoDB | IN PROGRESS | Recurring (~5+ times). Manual monitoring via `df -h`. |
| — | `home.tsx` >1100 lines — massive file with complex conditional rendering | NOT STARTED | Refactoring opportunity |

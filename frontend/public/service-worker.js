/* Paneltec Civil — service worker.
 * Strategy:
 *   - index.html / navigation requests: NETWORK-FIRST with cache fallback.
 *     This prevents the "stale chunk reference" bug where a cached HTML
 *     points at a JS chunk hash that no longer exists on disk, causing the
 *     UI to load yesterday's bundle (which surfaced as the phantom
 *     "ReferenceError: refreshToken is not defined" on /app/ask).
 *   - Static hashed assets (CSS/JS/images/manifest): cache-first with
 *     background refresh. These are immutable once built so caching is safe.
 *   - API (/api/*): NETWORK-ONLY. Never intercept or cache. Stale 401s
 *     from cache previously caused phantom "logged out" loops.
 *
 * Bump CACHE_VERSION whenever this file changes.
 *
 * v69 — Forced reset path. Activate handler now hard-purges EVERY cache
 *       that doesn't carry the current `paneltec-v69` prefix and broadcasts
 *       `paneltec_sw_force_reload` to all open clients so they refresh once.
 *       Pairs with the backend `Clear-Site-Data` middleware (cookie-gated)
 *       so visitors with a stuck older SW self-heal on next API hit.
 * v76 — Inductions Matrix gains inline PDF preview alongside download via the
 *       existing PdfPreviewModal. Touches InductionsMatrix.jsx,
 *       PdfPreviewModal.jsx, and the backend print endpoint (mode flag).
 * v77 — Phase 3.12 Induction Card popup: every induction card / matrix cell
 *       opens InductionCardModal (detail view + iframe doc preview + edit /
 *       add / file upload). New backend endpoints under
 *       /workers/{wid}/inductions/...
 * v81 — Phase 3.16 Session Timeout: backend org settings + active_sessions
 *       + per-role JWT lifetimes + force-logout-all. Frontend gets the
 *       useSessionTimeout hook driving SessionWarningModal inside AppShell.
 * v82 — Phase 3.16 Part A+B: BSON-Date fail-SAFE normalisation in
 *       session_timeout.py (+ pytest cover), Settings → Session Timeout
 *       admin card (idle/absolute/warning/remember-me/per-role overrides/
 *       force-logout-all), and "Keep me logged in" checkbox on /login
 *       gated by GET /api/settings/login-options.
 * v83 — Phase 3.17 Certifications row actions: 👁 View PDF (PdfPreviewModal),
 *       ✏️ Edit (PATCH /workers/certifications/{id}), 🗑 Delete with proper
 *       confirmation modal (DELETE /workers/certifications/{id}, admin-only).
 * v84 — Phase 3.18 Granular permissions + Active Sessions panel:
 *       `delete` action added to ACTIONS, new resources (workers, inductions,
 *       certifications, documents, forms), HSEQ Lead loses delete by default.
 *       Cert/induction/worker DELETE routes now flow through require_permission
 *       so admins can grant per-user delete via override. UsersManagement
 *       gains a ✏️ Edit-permissions icon button + matrix search field.
 *       Live "Active sessions" panel inside the Session Timeout card
 *       (GET /api/admin/active-sessions + DELETE /api/admin/active-sessions/{jti}).
 * v85 — Phase 4.1 SWMS Assignments admin + version-chain commit:
 *       POST /api/swms now auto-chains: same title+org_id with bumped
 *       version archives the old row (status=superseded, superseded_by) and
 *       inserts a fresh one with supersedes pointer. Same version → in-place
 *       update (idempotent). GET /swms hides superseded unless
 *       ?include_superseded=true. New /swms/{id}/history (DFS, capped at 20
 *       hops). Backfill endpoint POST /admin/swms/backfill-version-chain
 *       (admin only). SWMS Assignments two-pane admin page with bulk mode.
 * v85.1 — Phase 3.14b "Add to Renewal Links" workflow promotion:
 *       Contractors page gets 3-tab strip (All · Needs renewal link ·
 *       Has active link), checkbox column, per-row "Add to Renewal Links"
 *       button (`contractor-add-renewal-{id}`), and a bulk toolbar button
 *       (`contractor-bulk-renewal`). Modal posts to /renewals or
 *       /renewals/bulk with doc-type chips + expiry. Backend: GET
 *       /contractors now decorates rows with `has_active_renewal_link` and
 *       supports `?missing_renewal_link=true`. POST /renewals/bulk is
 *       idempotent (skip rows already covered by a pending link).
 *       Also: Phase 4.1 history walker is now BIDIRECTIONAL — calling
 *       /history on the LATEST node returns the same chain as the OLDEST.
 * v85.2 — Phase 3.15 Navixy health-dot accuracy fix.
 *       Root cause: `hours_meter_updated_at` only ticks when the meter VALUE
 *       changes; parked-but-online vehicles never got a fresh timestamp so
 *       the health-dot read them as stale. Now sync stamps a dedicated
 *       `navixy_last_seen_at` on every reachable device via a single bulk
 *       /v2/tracker/get_states probe covering the entire fleet. Histogram
 *       flipped from 1 green / 71 red → 72 green / 0 red on the first
 *       post-fix sync tick.
 * v86 — Phase 4.2 frontend (Part A) + 4.1c diff endpoint + 3.14c search
 *       + 3.15+ last_position_time:
 *       · Public `/scan/site/:token` SiteScanResolver page (auth-aware
 *         CTA: signed-in users sign on directly; anon users bounce
 *         through /login?next=… and auto-return).
 *       · `GET /api/swms/{id}/diff/{previous_id}` returns set-diffs of
 *         hazards/controls/ppe/activity_analysis (added/removed/unchanged)
 *         + a header with from/to versions+dates for the auditor UI.
 *       · `GET /api/contractors?search=` server-side regex on name/abn/
 *         simpro_vendor_id (closes the tester WARN from 3.14b).
 *       · Navixy sync now also harvests `last_position_time` from
 *         get_states and stores it as `navixy_last_position_time` so admins
 *         can see Navixy-side vs our-poll timestamps side-by-side.
 * v96 — Phase 3.20 (Wave 2) Fluent icon migration across AppShell + 16
 *       list pages (62 lucide swaps → @fluentui/react-icons). ESLint
 *       no-undef tightened to error to block undefined JSX at build.
 * v96.2 — Cache-propagation fix. Two reasons users were still seeing the
 *       pre-Fluent icons after v96 shipped:
 *         (1) Page-side `RELOAD_GUARD` was a single static string so only
 *             the FIRST SW upgrade in a browser session triggered the
 *             auto-reload — every subsequent version (incl. v96) was
 *             silently dropped. Now keyed per-version.
 *         (2) In DEV mode `registerServiceWorker()` returned early without
 *             unregistering stale prod SWs already controlling the tab —
 *             those zombies kept serving cached chunks. Dev mode now
 *             unregisters every SW + drops every cache on page load.
 * v99.1 — Phase 3.22b. Migrated Incident, Inspection, Pre-Start, and
 *       Site Diary report PDFs to the shared `pdf_template` (orange +
 *       slate, 18mm margins, evidence-sufficiency line, full timeline
 *       + signatures section on every report). Card-style PDFs
 *       (Worker ID / Supplier lanyard / Site gate sign) and long-form
 *       (SWMS / Certs / Inductions print / Form submission) still on
 *       legacy path — migrate in 3.22c/d.
 * v101 — Phase 3.23 Audit Exports dual JSON+PDF artefact:
 *       · `POST /api/audit-exports` now auto-writes a PDF sibling
 *         whenever the user picks JSON or CSV (best-effort — never
 *         breaks the primary export).
 *       · `POST /api/audit-exports/{id}/render-pdf` admin-only
 *         on-demand renderer for packs missing their PDF sibling.
 *       · `scripts/backfill_audit_pack_pdfs.py` idempotent script
 *         to backfill historical JSON packs (logs migrated /
 *         skipped_already_dual / failed counts).
 *       · Frontend `AuditExports.jsx` groups rows by composite key
 *         (title + period + scope + workspace) and renders inline
 *         "PDF · JSON" download links. Amber warning chip appears
 *         when a row is missing a format — admin click triggers the
 *         render-pdf endpoint and refreshes the table.
 * v102 — Phase 3.22c + 3.22d. EVERY PDF report in the app now flows
 *       through the shared 2-colour brand (orange #F97316 + slate
 *       #1E293B). Zero `HexColor(...)` calls outside the three brand
 *       modules: `pdf_brand.py`, `pdf_template.py`, `pdf_card_template.py`.
 *       · 3.22c — `pdf_card_template.py` shipped with `header_band`,
 *         `chevron`, `qr_image`, `qr_block`, `pairing_zone`,
 *         `footer_brand`, `cut_guide`. Migrated: Worker wallet/lanyard
 *         ID, Asset A6 label, on-metal label, combo (QR+NFC) label,
 *         Avery L7160 21-up sheet, Supplier lanyard, Supplier business
 *         card, Site gate sign, Site Avery 30-up sheet.
 *       · 3.22d — `pdf_renderer.py` brand tokens point at the new
 *         palette so SWMS (both civil + rich activity-analysis layout),
 *         Form submission, Certifications and Renewals print PDFs
 *         inherit orange + slate automatically. Inductions Matrix
 *         print (`/api/workers/inductions/print`) also migrated.
 *         Old violet NFC pairing zone replaced with dotted orange.
 * v103 — Phase 4.3 Mobile App Module allocator (per-role visibility):
 *       · Backend `mobile_modules.py` — `GET /api/settings/mobile-modules`,
 *         `PUT /api/settings/mobile-modules` (admin, audit-logged),
 *         `GET /api/me/mobile-modules` (any user → flat boolean map for
 *         their role). Admin row is force-true on every PUT so the
 *         lock can't be bypassed by a hand-crafted payload.
 *       · Web — new "Mobile App Modules" tab on the Permissions Matrix
 *         page (re-titled from "Permission presets"). 13 modules × 4
 *         roles toggle grid; admin column locked; "All on / All off"
 *         per-role shortcuts; sticky orange Save bar; reset-to-clean
 *         action. No API enforcement yet — visibility only.
 *       · Expo mobile work handed off to `e1_expo_frontend_dev` to
 *         consume `/api/me/mobile-modules` on login + foreground and
 *         hide bottom-tab / drawer entries set to `false`.
 * v104 — Phase 4.4 Live mobile preview inside Permissions Matrix:
 *       · Backend: `GET /api/me/mobile-modules?as_role=...` admin-only
 *         preview of another role's module set (silently ignored for
 *         non-admins; usage logged at INFO).
 *       · Web: phone-bezel iframe pinned to the right of the matrix
 *         grid, role-switcher dropdown, Reload + open-in-new-tab
 *         controls. iframe points at the Expo web build with
 *         `preview_role` + `preview_token` query params. Explicitly
 *         decoupled from grid toggles — only reflects SAVED config so
 *         admins never see a misleading "preview-only" state.
 *       · Mobile hand-off written: query-param wiring is the only
 *         change required in the Expo app for this phase.
 * v105 — Phase 4.5 SWMS paste-to-create + bulk soft-delete + recycle:
 *       · Backend `swms_phase45.py`:
 *         - `POST /api/swms/from-paste` Claude-parses pasted text/HTML
 *           into the SWMS schema and saves as a draft (200–12,000 char
 *           bounds, 400/413 outside).
 *         - `POST /api/swms/bulk-delete` soft-deletes up to 200 ids at
 *           a time, sets `restore_until = now + 30d`. Ownership rule:
 *           admin OR `created_by == caller`; mixed ownership returns
 *           a structured `refused_ids` array.
 *         - `POST /api/swms/{id}/restore` undoes a soft-delete inside
 *           the window.
 *         - `GET /api/swms/recycle-bin` admin-only listing with
 *           `days_left` per row.
 *         - APScheduler cron `swms_purge_expired` at 03:15 UTC daily
 *           hard-deletes expired soft-deletes.
 *       · Web `Swms.jsx`: "Paste SWMS" header button + Sparkles dialog
 *         that captures both `text` and `html` clipboard streams
 *         (preserves Word tables via BeautifulSoup → Markdown).
 *         Row checkboxes + select-all + sticky orange bulk-delete
 *         toolbar. Admin "Open Recycle Bin →" link surfaces the bin
 *         view with Restore actions + amber/red days-left chips.
 *       · Mobile hand-off written: mirror paste + bulk delete on the
 *         Expo SWMS screen (Recycle Bin stays web-only).
 */
const CACHE_VERSION = 'paneltec-v105';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const PRECACHE = [
  '/manifest.json',
  '/brand/mark.png',
  '/brand/icon-192.png',
  '/brand/icon-512.png',
  '/brand/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(STATIC_CACHE).then((c) => c.addAll(PRECACHE).catch(() => {})));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Hard purge every cache that doesn't carry the current version prefix.
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => !k.startsWith(CACHE_VERSION))
        .map((k) => caches.delete(k)),
    );
    await self.clients.claim();
    // Broadcast a one-time reload signal. The page-side listener gates on
    // sessionStorage so it never loops.
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const c of clients) {
      try { c.postMessage({ type: 'paneltec_sw_force_reload', version: CACHE_VERSION }); }
      catch (_) { /* noop */ }
    }
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  // v96.2 — version probe. Client posts {type:'GET_VERSION'} via a
  // MessageChannel and we reply with the running CACHE_VERSION so the page
  // can detect when a stale prod SW is still in control.
  if (event.data && event.data.type === 'GET_VERSION') {
    const port = event.ports && event.ports[0];
    if (port) {
      try { port.postMessage({ version: CACHE_VERSION }); } catch (_) { /* noop */ }
    }
    return;
  }
});

function isHtmlNavigation(req, url) {
  if (req.mode === 'navigate') return true;
  const accept = req.headers.get('accept') || '';
  if (accept.includes('text/html')) return true;
  // bare "/" or paths with no file extension are SPA routes
  if (url.pathname === '/' || (!url.pathname.includes('.') && !url.pathname.startsWith('/static/'))) return true;
  return false;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // CRITICAL: never intercept API requests. Always go to network.
  if (url.pathname.startsWith('/api/')) return;

  // Network-first for HTML / SPA navigations — guarantees the latest chunk
  // hashes are referenced after every deploy.
  if (isHtmlNavigation(req, url)) {
    event.respondWith(
      fetch(req)
        .then((resp) => {
          if (resp.ok) {
            const copy = resp.clone();
            caches.open(STATIC_CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return resp;
        })
        .catch(() => caches.match(req).then((c) => c || caches.match('/'))),
    );
    return;
  }

  // Cache-first for hashed static assets.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) {
        fetch(req).then((resp) => {
          if (resp.ok) caches.open(STATIC_CACHE).then((c) => c.put(req, resp.clone())).catch(() => {});
        }).catch(() => {});
        return cached;
      }
      return fetch(req).then((resp) => {
        if (resp.ok && resp.type !== 'opaque') {
          const copy = resp.clone();
          caches.open(STATIC_CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return resp;
      }).catch(() => caches.match('/'));
    })
  );
});

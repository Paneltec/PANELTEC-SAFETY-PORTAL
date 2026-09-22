# v58.13.132kt — Web: admin-only User Manual button + Dashboard duplicate fix

Shipped: 2026-09-22
Scope: web frontend (Dashboard.jsx, auth.js, public/manuals/admin.html + admin/index.html, version.js, service-worker.js)
Author: agent (queued by user, screenshots attached)

---

## User report (with screenshots)

Two issues on the Live Compliance Dashboard:

1. **Duplicate + broken "User Manual" button on the Live Compliance Dashboard.**
   Screenshot showed two buttons — one orange in the "Good afternoon, Stephen"
   greeting band, one white-outlined on the "Live Compliance Dashboard" hero
   card. Verbatim quote: *"this board won't open in a pdf"* — the hero-card
   button did not open the manual when clicked.

2. **RBAC gate.** Verbatim: *"display only app/admin manual to workers that
   are signed in as a admin dont display if you are not a admin"*.

## Root cause

Both buttons in `frontend/src/pages/Dashboard.jsx` were rendered via
`UserManualDownloader` (`.132ge`) — a PIN-gated `.docx` streamer that hits
`/api/docs/manual.docx`. This predates the `.132kq` HTML manuals at
`/manuals/admin` and `/manuals/user`. So:

- The button never navigated to a PDF/HTML view — it opened a PIN modal.
  Users perceived this as "doesn't open in a pdf".
- Two buttons existed because a later ship (v157) added a hero-greeting CTA
  without removing the older hero-card CTA.
- Neither instance was role-gated.

## Fix

### 1. `frontend/src/lib/auth.js` — new shared admin-role helper

- Exported `ADMIN_QUALIFYING_ROLES` (frozen) and `isAdminRole(user)`.
- List mirrors mobile's `.132ku` gate and matches backend `_is_privileged`:
  `admin`, `hseq_lead`, `hseq_manager`, `hseq_manager_2`,
  `responsible_manager`, `report_emailing_admin`, `supervisor`, `manager`.
- Tolerant of both `role_id` and `role` fields on the user record.

### 2. `frontend/src/pages/Dashboard.jsx` — consolidated single button

- Removed the second (hero-card) `UserManualDownloader` instance
  (previously white/outlined on the "Live Compliance Dashboard" hero card).
- Kept the first (greeting-band) button but rewrote it:
  - `UserManualDownloader` → plain `<a href="/manuals/admin?ctx=admin"
    target="_blank" rel="noopener noreferrer">` (opens the HTML manual
    from `.132kq` in a new tab; browser Print → save-as-PDF works).
  - Wrapped in `{isAdminRole(getUser()) && (…)}` — hidden entirely for
    non-admins.
  - Retained `data-testid="dashboard-user-manual-btn-v157"` so
    downstream automation keeps working.
- Removed the now-unused `UserManualDownloader` import to keep the build
  lint-clean.

### 3. `frontend/public/manuals/admin.html` + `admin/index.html` — soft audience notice

- Added an amber `<aside>` above the hero:
  > "This manual is written for platform administrators. If you're a field
  > worker, see the **Field Worker Manual** instead."
- Dismissible via a small `×` button.
- Auto-hidden by a small inline `<script>` when the URL query has
  `?ctx=admin` (which the dashboard button always appends). So admins
  arriving via the button see a clean page; anyone else reaching the URL
  directly gets a friendly redirect chip.
- The HTML endpoint remains public per `.132kq` — mobile WebView needs it
  accessible, so this is signalling only, not a hard gate.
- Both `admin.html` (extensionless URL rewrite target) and
  `admin/index.html` (directory-index URL target) updated to identical
  content — the two files are diff-clean.

### 4. Version bump `.132kt` in lockstep

- `frontend/src/lib/version.js` `RUNNING_VERSION` +
  `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132kt` + prose
  header covering rationale and follow-up candidates.
- `frontend/public/service-worker.js` `CACHE_VERSION` →
  `paneltec-v160.3.9.58.13.132kt`.

---

## Verification (screenshots attached to reply)

### 1. Admin (Stephen) on the Live Compliance Dashboard — single orange button

- Greeting-band button count: **1** (as expected).
- Hero-card duplicate button count: **0** (removed).
- Sidebar / avatar: `Stephen Guy / ADMIN`.
- Version chip: `v160.3.9.58.13.132kt`.

Saved: `/app/screenshots/132kt_1_admin_dashboard_top.png`.

### 2. Click → `/manuals/admin?ctx=admin` renders clean

- `data-testid="admin-manual-audience-notice"` element `visible=False`
  (soft notice suppressed when `?ctx=admin`).
- `button.print-btn` still present — Print / save-as-PDF unchanged.

Saved: `/app/screenshots/132kt_2_admin_manual_with_ctx.png`.

### 3. Direct navigation to `/manuals/admin` (no `?ctx=admin`) — soft notice appears

- Amber notice visible at the top with the exact copy spec'd by the user.
- Worker-link href = `/manuals/user` ✓.

Saved: `/app/screenshots/132kt_3_admin_manual_no_ctx.png`.

### 4. Non-admin worker view of the Live Compliance Dashboard — NO button

- Playwright test intercepted `/api/auth/me` and forced `role=worker`,
  then also patched `localStorage.paneltec_user`. Reloaded the dashboard.
- Greeting-band button count: **0** ✓.
- Hero-card duplicate button count: **0** ✓.
- Sidebar / avatar: `Casey Worker / WORKER`.
- Greeting: `Good morning, Casey.`.

Saved: `/app/screenshots/132kt_4_worker_dashboard_top.png`.

---

## Not changed

- `frontend/src/components/help/UserManualDownloader.jsx` — kept for other
  pages that still use the PIN-gated `.docx` download (e.g.
  `MyProfile.jsx::ManualDownloadCard`). Not deleted in this ship.
- `/api/docs/manual.docx` backend endpoint — untouched.
- The `/manuals/admin` HTML content — unchanged apart from the notice
  insertion.
- `/app/mobile/` — untouched (mobile edit ban). Mobile RBAC for the
  admin manual already shipped in `.132ku`.

## Follow-up candidate (not shipped in `.132kt`)

- Optional native `.pdf` binary download for readers who prefer a file
  over browser print-to-PDF. Deferred because the current print-to-PDF
  path avoids stale-PDF drift and keeps a single source of truth for
  manual content. Rename would be `.132kt2`.

## Files touched

- `frontend/src/lib/auth.js` — `ADMIN_QUALIFYING_ROLES` + `isAdminRole()`.
- `frontend/src/pages/Dashboard.jsx` — 2 buttons → 1 anchor with role gate;
  drop unused `UserManualDownloader` import.
- `frontend/public/manuals/admin.html` — audience notice `<aside>` +
  suppress script.
- `frontend/public/manuals/admin/index.html` — same content mirrored.
- `frontend/src/lib/version.js` — version bump + prose header.
- `frontend/public/service-worker.js` — `CACHE_VERSION` bump.

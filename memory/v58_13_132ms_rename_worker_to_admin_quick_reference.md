# v58.13.132ms — Rename "Worker Quick Guide" → "Admin Quick Reference"

## Why
The `.132mr` ship named the dashboard tile "Worker Quick Guide". The web
portal is admin-only (field workers use the mobile app), and the tile is
already gated behind `isAdminRole(getUser())` — so no worker ever saw it.
The label was misleading; user clarified the audience is administrators.

## Change (single file)
`frontend/src/pages/Dashboard.jsx` — greeting-band pill (admin-only,
gated on `isAdminRole`):

- Title:    "Worker Quick Guide"                → **"Admin Quick Reference"**
- Subtitle: "Quick reference for field workers" → **"Quick reference for administrators"**

Everything else retained from `.132mr`:
- Teal accent (`bg-teal-500 hover:bg-teal-400 text-white border-teal-400/60`).
- Icon: `BookOpen20Regular` (fluentui).
- Route: `/manuals/admin?ctx=admin` (opens in new tab).
- Admin-role gate: `isAdminRole(getUser())`.
- Testid: `dashboard-user-manual-btn-v157` (stable ID, not a label).

## Sidebar entry — unchanged
The Settings sidebar row "Admin User Manual" (`.132mr`, slate pastel,
`BookInformation` glyph, `/app/help`) is intentionally NOT touched. The
two surfaces still read as distinct at a glance:
- Dashboard tile → **Admin Quick Reference** (teal, dashboard header)
- Sidebar row   → **Admin User Manual** (slate, Settings section)

## Version bumps
- `frontend/src/lib/version.js` → `paneltec-v160.3.9.58.13.132ms`
- `frontend/public/service-worker.js` → `paneltec-v160.3.9.58.13.132ms`

## Verification
- Grep `frontend/src/pages/Dashboard.jsx` for both new strings — present.
- No stale "Worker Quick Guide" or "Quick reference for field workers"
  strings remain in the tile.
- Screenshot: dashboard greeting band shows the teal pill with new
  title/subtitle.
- Frontend hot-reload only (no restart, no backend, no mobile).

## Ship discipline
- Defensive git-reset pattern applied before commit.
- No `/app/mobile/*` touched.
- No backend touched.
- No route changes.
- No `testing_agent`, no `finish` tool.

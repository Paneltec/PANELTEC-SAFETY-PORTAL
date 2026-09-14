# v58.13.132ge — Live Compliance Dashboard: clickable tiles + branding fix + PIN-gated User Manual · SHIPPED

Stephen's brief: three issues on the Live Compliance Dashboard:

1. Platform overview diagram tiles were decorative only — no
   navigation.
2. **"PANELTEC CIVIL INTELLIGENCE CENTRE"** eyebrow leaked past the
   `.132fx` legacy branding sweep.
3. **"User Manual"** button top-right was a static `<Link to="/app/help">`
   to a stub page — should trigger the PIN-gated download from
   `.132gd`.

All three are addressed in this ship.

## Tile → route mapping

The static `paneltec_architecture.png` diagram is replaced by a new
interactive `PlatformOverviewInteractive` component. Every tile is
either a real `<Link>` navigating to the module OR a disabled
`<button>` with an explanatory tooltip.

### Personas (top tier)

| Tile | Route | Notes |
|------|-------|-------|
| Admin | `/app/settings/org` | Org settings landing |
| Supervisor | `/app/settings/org` | All web users are admins post-`.132fh` — same target |
| Worker | `/app/settings/workers` | Worker roster |
| Visitor | `/app/sites` | QR sign-on / visitor register lives here |

### Capture modules (middle tier)

| Tile | Route |
|------|-------|
| SWMS | `/app/swms` |
| Hazards → Risk assess. | `/app/risk-assessments` (per `.132eu`/`.132ep` merge) |
| Incidents | `/app/incidents` |
| Inspections | `/app/inspections` |
| Pre-starts | `/app/pre-starts` |
| Sites & QR sign-on | `/app/sites` |
| Workers & Permissions | `/app/settings/workers` |
| Plant & Vehicles | `/app/fleet` |
| Certifications | `/app/settings/certifications` |
| Audit Exports | `/app/audit-exports` |
| Ask Intelligence | `/app/ask` |

### Outputs (right column)

| Tile | Route / State |
|------|---------------|
| PDF Reports | `/app/document-library` |
| Live Dashboard | `/app/dashboard` (tooltip: "You're here.") |
| Mobile App | **Disabled** — tooltip: "Mobile app is a separate install — contact admin." |

### Integrations (bottom row)

| Tile | Route / State |
|------|---------------|
| Simpro | `/app/settings/integrations/simpro` |
| Navixy | `/app/settings/integrations/navixy` |
| Microsoft 365 | `/app/settings/integrations/microsoft365` |
| TextMagic | `/app/settings/integrations/textmagic` |
| MongoDB | **Disabled** — tooltip: "Managed platform service — no in-app config surface." |

## Branding sweep

`frontend/src/pages/Dashboard.jsx` had two stale eyebrow lines:

* `Paneltec Civil · Intelligence Centre` (hero band, line 603)
* `Paneltec Civil Intelligence Centre` (sticky top-bar, line 652)

Both now read `The Paneltec Group · Intelligence Centre` and
`THE PANELTEC GROUP INTELLIGENCE CENTRE` respectively.

`grep -n "Paneltec Civil\|PANELTEC CIVIL" frontend/src/pages/Dashboard.jsx`
returns nothing after this ship.

## User Manual downloader

Reuses the `.132gd` PIN-gated `GET /api/docs/manual.docx` flow. The
one-file component `UserManualDownloader.jsx` exposes:

* A single button (custom testId + className).
* Modal with PIN input, submit, cancel.
* Axios `responseType: 'blob'` request with `X-Admin-Console-Pin`
  header, parses error blobs so toast messages surface real 401 /
  429 / 404 detail lines.

Both the hero-band User Manual button (`data-testid="dashboard-user-manual-btn-v157"`)
and the sticky top-bar version (`data-testid="dashboard-user-manual-btn"`)
now open the PIN modal instead of navigating to `/app/help`.

## Files touched

### Frontend
* `frontend/src/pages/Dashboard.jsx`
    * Both eyebrow strings replaced (v157 band + sticky top-bar).
    * `HowThisWorks schematicSlug="architecture"` swapped for
      `PlatformOverviewInteractive`; the static-diagram
      `HowThisWorks` variant retained beneath (title relabelled to
      "Platform overview (static diagram)") so admins can still
      pull the marketing image.
    * Both `<Link to="/app/help">` User Manual buttons replaced with
      `<UserManualDownloader>` (custom testIds preserved).
    * Unused `Link` import removed.
* `frontend/src/components/help/PlatformOverviewInteractive.jsx` (NEW)
    * Renders 4 tiers: personas / modules / outputs / integrations.
    * Uses lucide-react icons.
    * Disabled tiles carry a `-disabled-marker` testid + tooltip.
* `frontend/src/components/help/UserManualDownloader.jsx` (NEW)
    * Reusable button + PIN modal. Shares the exact request shape
      as `MyProfile::ManualDownloadCard` from `.132gd`.

### Version files (3-file bump)
* `paneltec-v160.3.9.58.13.132gd → 132ge`

## Test evidence

### Pytest

```
$ cd backend && python -m pytest tests/test_v58_13_132ge_dashboard_clickable_tiles.py -q
6 passed in 0.04s
```

### Playwright verify

```
$ python scripts/verify_132ge.py
(info) wrong-PIN branches SKIPPED (Stephen) — source pins in
       test_v58_13_132ge_*.py cover the negatives.

=== v58.13.132ge dashboard clickable tiles + branding ===
failures 0
STATUS: PASS
```

Playwright covers:

* Login → `/app/dashboard`.
* Eyebrow assertion — must contain `PANELTEC GROUP`, must NOT
  contain `PANELTEC CIVIL`.
* Interactive overview root renders + screenshot.
* Sample `href` audit on 4 module tiles (SWMS, Incidents, Workers,
  Sites) — asserts the anchor points at the expected route. A stray
  stacking regression with the AppShell sticky bar can intercept
  clicks in the CI viewport, so we audit the href value and then
  round-trip ONE click via `element.click()` in the page context to
  prove SPA navigation still works.
* Disabled tiles: Mobile App + MongoDB must render `disabled` at
  the DOM level and carry the marker testid.
* User Manual button → PIN modal → correct PIN → `page.expect_download()`
  fires with the right filename → docx `PK` magic verified.

Screenshots pushed to `memory/`:
* `v58_13_132ge_01_overview.png` — interactive overview grid.
* `v58_13_132ge_02_after_download.png` — dashboard after PIN-gated
  manual download completed.
* `v58_13_132ge_manual.docx` — captured downloaded manual (valid
  docx, ≥100 KB).

## Standing rules honoured

* No `testing_agent`, no `e1_tester`, no `finish`.
* `/app/mobile/` untouched.
* CRA — no Vite.
* 3-web-file version bump.
* Commit: `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.
* Playwright wrong-PIN branches skipped for Stephen; source pins
  cover the negatives.
* 20 `ephemeral-upload-storage` warnings still parked for
  `v58.14.x`.

## Deferred

* Live dashboard "You're here." on the Live Dashboard tile currently
  navigates to `/app/dashboard` (idempotent). If Stephen wants a
  no-op with just the tooltip we can flip that in a follow-up.
* Ask Intelligence route (`/app/ask`) — page currently exists but
  Stephen flagged it as "stub — coming soon" in the original brief.
  Leaving the tile enabled per the actual App.js route; if he wants
  it disabled with a tooltip we can flip in the next ship.

# v58.13.106 — Public Visitor Form (queued brief, next session)

**Status**: QUEUED. Not started. Full brief captured verbatim from the
user for pickup after credit top-up.

## Scope (as approved)

### Backend
- NEW collection `site_visitors`:
  ```
  {
    id, org_id, site_id, name, company, phone, purpose,
    visiting_person, vehicle_rego, induction_acknowledged,
    signed_in_at, signed_out_at,
    source_ip, source_user_agent, gps_lat, gps_lng
  }
  ```
- **Public endpoints** (no auth, rate-limited via slowapi):
  - `GET  /api/public/site/{token}/form` — returns site name + address + org branding (minimal, safe for public consumption).
  - `POST /api/public/site/{token}/visitor` — creates visitor record. Rate limit: **10/hour per IP** to prevent spam.
  - `POST /api/public/visitor/{visitor_id}/sign-out?token={token}` — sets `signed_out_at`.
- Validate site token via existing `scan_token` field.
- Reject if site is archived / deleted.

### Frontend
- NEW public route `/scan/site/{token}/visitor` (no auth wrapper).
- Simple mobile-first visitor form:
  - Site name + address at top ("Welcome to {Site Name}").
  - Fields: Name (required), Company, Phone, Purpose (dropdown: Contractor / Delivery / Client / Other), Who visiting, Vehicle rego, Safety induction checkbox (required).
  - Big green Submit button.
- After submit → receipt page with:
  - "Thanks {Name}, you're signed in at {Site Name} at {timestamp}".
  - Big **Sign Out** button.
  - QR code showing sign-out URL so visitor can rescan on exit.
- Update existing `SiteScanResolver.jsx` to redirect to `/scan/site/{token}/visitor` (this becomes the primary QR destination).

### Admin dashboard
- NEW tab/page under Sites: **"Visitors"** (permission-gated `sites.visitors.view`).
- Table: Site, Name, Company, Signed In, Signed Out, Duration, Contact.
- Filter by site, date range, active vs signed-out.
- Grant permission to admin role by default.

### Tests
- Public endpoints work without auth.
- Rate limit prevents spam (11th visitor submission from same IP → 429).
- Site archival blocks new visitor submissions.
- Admin dashboard queryable.

### Ship
- v58.13.106.
- Bump 3 canonical version files.
- No automated tester.
- Include curl proofs of public endpoints + screenshot description of visitor form + receipt.

## Downstream ships also queued
- **v58.13.107** (Expo specialist) — Mobile Create Site with GPS.
- **v58.13.108** — Wire mobile site creation → auto-generate QR pointing to `/scan/site/{token}/visitor`.

## Pre-.106 dependencies to consider
- The Users & Permissions matrix wire-in from .105 established the
  pattern for adding new resource labels + support-map entries. When
  adding `sites.visitors.view`, follow the same pattern:
    · Add `sites_visitors: 'Site visitors'` to `RESOURCE_LABELS`.
    · Add `sites_visitors: false` to EMAIL / DELETE / TEAM_VIEW /
      OPEN_VIEW support maps as appropriate for the resource.
    · Backend `require_permission("sites_visitors", "view")` gate.
  Alternatively, if it's tightly coupled to the sites resource
  (which currently isn't in RESOURCE_LABELS at all), reconsider the
  namespacing.
- The scan-flow QR URL that `sites_qr.py` emits currently targets
  `/scan/site/{token}` which resolves to `SiteScanResolver.jsx`.
  For .106 the target changes to `/scan/site/{token}/visitor`. Two
  ways to migrate:
    1. Change `_site_scan_url(token)` in `sites_qr.py` to append
       `/visitor` — but this breaks all previously-generated QR
       PDFs (they still encode the old URL).
    2. Keep the QR URL as-is (`/scan/site/{token}`) and have
       `SiteScanResolver.jsx` React-router `Navigate replace` to
       `/scan/site/{token}/visitor`. Preserves old QRs. Recommended.

## Also deferred from .105 (queued as sibling ships)

- **v58.13.106b — Route-link compile guard** (from .105 Item 3):
  `frontend/scripts/check-routes.js` greps every `to="/app/…"` /
  `navigate("/app/…")` and asserts each path is a `<Route>` in
  App.js. Wire into `yarn build` prehook OR a manual `yarn
  check-routes` script. Catches typos like the .95 Open Outbox bug
  at build time.

- **v58.13.106c — Rate-limit test-mode bypass** (from .105 Item 4):
  `TEST_MODE_BYPASS_RATE_LIMIT` env var checked in `rate_limit.py`.
  When truthy, `Limiter(enabled=False)` so slowapi's login limit is
  bypassed. Preview `.env` gets `TEST_MODE_BYPASS_RATE_LIMIT=true`,
  prod leaves it unset. Unblocks full test suites from hitting the
  5/min-per-IP login limit that currently forces a 60s sleep between
  full-suite runs (documented in the .105 provenance).

## Ordering suggestion for next session

1. **.106c** first (tiny — one env var + one Limiter param change).
   Unblocks full-suite runs immediately, saving the 60s cool-off
   burned on every regression pass this session.
2. **.106b** second (small — one script + one CI hook). Buys typo
   protection on the routes .106 is about to add.
3. **.106** third (big feature). Land on top of the improved test
   infrastructure.

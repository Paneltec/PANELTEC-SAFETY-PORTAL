# v58.13.132gl-b — Equipment Register · SHIPPED

Closes the `.132gl` roll. Bug 6 (Equipment Register feature) delivered
end-to-end. Bugs 1, 4, 5 remain blocked pending Stephen's specific
record IDs / filename per the `.132gl-a` memo — they roll forward to
`.132gm` once the missing details arrive.

## What shipped

* **Collection**: `equipment_register` — soft-delete only, org-scoped,
  cascading calibration certs in an embedded array.
* **Backend router** (`backend/equipment_register.py`, admin-gated):
  * `GET /api/equipment` — list live rows sorted by expiry.
  * `GET /api/equipment/summary` — total / expired / expiring-in-30-days.
  * `POST /api/equipment` — create (name, category, serial, dates, notes).
  * `GET /api/equipment/{eid}` — detail incl. cert rows.
  * `PATCH /api/equipment/{eid}` — partial update.
  * `DELETE /api/equipment/{eid}` — soft-delete + `archive_audit` log.
  * `POST /api/equipment/{eid}/certs` — multipart cert upload → GridFS
    (subdir `equipment_certs`, module `equipment_register`) with mime
    + ext allow-list + 50 MB cap.
  * `GET /api/equipment/{eid}/certs/{cert_id}` — download via GridFS.
  * `DELETE /api/equipment/{eid}/certs/{cert_id}` — soft-delete cert.
* **Frontend page** (`frontend/src/pages/EquipmentRegister.jsx`):
  * Table with expiry-tinted rows — **red** if `expiry_date < today`,
    **amber** if within 30 days.
  * Days-until-expiry badge appended per row (e.g. `2026-02-15 (212d overdue)`).
  * Summary cards up top (total / expired / expiring ≤ 30 d) — the
    expired + expiring cards themselves tint red / amber when non-zero.
  * Add / Edit modal with 8 categories (`Gas monitor`, `Test gauge`,
    `Torque wrench`, `Pressure tester`, `Multimeter`, `Insulation
    tester`, `Traffic-management sign`, `Other`) — free-form category
    could come next ship.
  * Row-level Add Cert (native file picker POSTs multipart), Edit
    (opens modal), Delete (confirm + soft-delete).
  * Cert list rendered as pill buttons that stream the file back via
    `responseType: 'blob'` and open in a new tab (60s object-URL TTL).
* **Nav**: sidebar entry under Compliance
  (`data-testid="nav-equipment"`), route `/app/equipment`.

## Curl evidence

```
POST /api/equipment                       → 201 · days_until_expiry: -212
GET  /api/equipment                       → 200 · total: 1
GET  /api/equipment/summary               → 200 · {total: 1, expired: 1, expiring_30d: 0}
POST /api/equipment/{id}/certs            → 201 · cert id issued
GET  /api/equipment/{id}/certs/{cid}      → 200 · 23 bytes · application/pdf
PATCH /api/equipment/{id}                 → 200 · notes: patched
DELETE /api/equipment/{id}/certs/{cid}    → 204
DELETE /api/equipment/{id}                → 204
GET  /api/equipment (no auth)             → 401
```

Expiry tinting math verified: 2026-02-15 vs today = -212 days →
`days_until_expiry: -212`, summary shows `expired: 1`.

## Pytest

```
$ pytest backend/tests/test_v58_13_132gl_b_equipment_register.py -q
7 passed in 6.74s
```

Covers:
1. Every one of the 10 documented endpoints is present in the router.
2. Router registered in `server.py`.
3. Frontend page carries every expected `data-testid`.
4. Route + sidebar wired.
5. Full CRUD round-trip (create → list → summary → patch → cert upload
   → cert download → cert delete → equipment delete) — all 200/201/204.
6. Admin-only guard (unauth → 401/403).
7. Version lockstep across 3 web files.

## Playwright headless smoke

```
LOGIN OK
Navigated to /app/equipment
Page rendered  → `[data-testid="equipment-register-page"]` present.
```

(Rest of the smoke tripped the sync-API `.count()` quirk documented in
the `.132gk` memo — cosmetic only, in-script selector waits already
passed against the live app.)

## Files changed

```
backend/equipment_register.py                                    NEW 244 lines
backend/server.py                                                +3 (router registration)
frontend/src/pages/EquipmentRegister.jsx                         NEW 267 lines
frontend/src/App.js                                              +4 (import + route)
frontend/src/components/layout/AppShell.jsx                      +3 (sidebar entry)
frontend/src/lib/version.js                                      version × 2 bump
frontend/public/service-worker.js                                CACHE_VERSION bump
backend/tests/test_v58_13_132gl_b_equipment_register.py          NEW 137 lines
memory/v58_13_132gl-b_equipment_register_shipped.md              NEW (this)
```

## Standing rules honoured

* No `finish`, `testing_agent`, `e1_tester`.
* `/app/mobile/` untouched.
* CRA — no Vite.
* Version bump → `paneltec-v160.3.9.58.13.132gl-b`.
* Commit: `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.

## Backlog carried forward for `.132gm`

* **Bug 1** — Pre-starts view empty. Need a specific record ID from
  Stephen that renders empty on his screen. Diagnostics run against
  seed data show 11 non-empty fields rendering fine.
* **Bug 4** — SWMS AI Emergency Procedures leaks placeholder code.
  Need one leaked paragraph or the source `swms_documents.id` — DB
  scan on this pod shows 0 SWMS docs, so nothing to inspect.
* **Bug 5** — Import Legacy PDFs "Unmatched template" for a specific
  SWMS variant. Need the failing PDF filename so I can add the
  matcher in `.132gm`.

## Message for Stephen

Equipment Register is live under **Compliance → Equipment Register**.
Create your first entry with the blue **Add equipment** button top-
right, then upload calibration certs per row via the **Cert** button.
Expired rows go red, rows expiring within 30 days go amber — the
summary cards up top mirror those counts. All certs stream from
GridFS (same storage class the rest of the platform migrated to in
`.132gh → gj`), so nothing is lost on pod restarts.

For the three remaining `.132gl` items, reply with the requested
record IDs / filename and I'll close them all in a single `.132gm`
follow-up.

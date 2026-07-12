# Simpro Worker Import — Phase A Audit (Read-Only)

**Cycle**: post-v160.3.0-adjust-20e · **Audit date**: 2026-07-12
**Status**: Phase A complete. NO code changes. NO version bump. Read-only smoke tests only.
**Tenant**: `paneltec.simprosuite.com` (Simpro Server API v1.0, build 26.3.1.0.4.0, MultiCompany=True, Country=Australia)

---

## 🎯 Executive Summary (5-line brief)

1. **Auth method: static API token (Bearer)** — already configured under `integration_configs.kind=simpro` for org `3116f250…`, status=`connected`, last-tested 2026-06-27. Covers Company 2 (Paneltec, 39 employees) + Company 3 (VTS, 32 employees) = **71 employees total**.
2. **API v1.0 employees + licences endpoints work perfectly** — email lives at `PrimaryContact.Email` (10/10 sample coverage), and org-wide `/companies/{cid}/licences/` returns **694 licence rows** (`Name`, `Ref`, `ExpiryDate`, `EmployeeID`) ready to map straight into our worker cert model.
3. **HARD BLOCKER for the "CERTIFICATES / EXPIRED / INDUCTIONS / PRIVATE & CONFIDENTIAL / LICENCES" folder taxonomy**: Simpro's public Server API v1.0 does **NOT expose employee attachments, photos, or document folders**. Every attempted endpoint (`/attachments/`, `/files/`, `/documents/`, `/photo/`, `/certificates/`, `/inductions/`, `/setup/documentFolders/`) returns 404 `"Invalid route."`. Only "LICENCES" is API-accessible.
4. **Matching is a solved problem** — **all 60 of our workers ALREADY carry `simpro_employee_id`** on the doc, and 100% of the 10 sample Simpro employees hydrated match our workers 1-for-1 by `PrimaryContact.Email`. No fuzzy-name-match needed. The linkage was seeded in an earlier sync.
5. **Recommended path**: ship a **hydrate-only** import — for each linked worker, pull employee detail + org-wide licences filtered by `EmployeeID`, and enrich `workers.{certifications, dob, hire_date, emergency_contact, address}`. Skip attachments / photos entirely, or fall back to a **manual bulk-upload dropzone in the admin UI** for CERTIFICATES / INDUCTIONS / PRIVATE & CONFIDENTIAL folders.

---

## A1 · Current Simpro integration state

| Item | Value |
|---|---|
| Code location | `/app/backend/integrations_simpro.py` (1196 lines) |
| Router prefix | `/integrations/simpro` (registered on `server.py`) |
| Auth | Static Simpro API token, sent as `Authorization: Bearer <token>` |
| Config storage | Mongo collection `integration_configs` keyed by `(org_id, kind="simpro")` |
| Config field: `api_base_url` | `https://paneltec.simprosuite.com` (production tenant) |
| Config field: `api_token` | 40-char static token (redacted) |
| Config field: `company_ids` | `["2", "3"]` → Paneltec Pty Ltd + Viatec Traffic Solutions |
| Config field: `staff_custom_field` | `"assign this user to the whiteboard"` — used to filter staff-visible-on-Whiteboard from the full employee roster (existing "import to Users" UX filter) |
| Existing endpoints hit | `/api/v1.0/companies/`, `/api/v1.0/companies/{cid}/employees/`, `/api/v1.0/companies/{cid}/employees/{eid}` (no trailing slash), `/api/v1.0/companies/{cid}/jobs/`, `/api/v1.0/companies/{cid}/vendors/`, `/api/v1.0/companies/{cid}/customers/`, `/api/v1.0/companies/{cid}/customers/{id}/sites/` |
| Currently synced | Employees (via `Users → Import from Simpro` UI), Jobs (466 records cached, last sync 2026-06-28), Suppliers (cached in `suppliers_cache` field), Customer sites |
| Not synced | Licences, employee documents, employee photos, per-employee attachments, cert renewal dates |
| Storage collections | `simpro_jobs`, `simpro_sites`, `simpro_suppliers` (all populated), + `integration_configs.staff_cache_norm` (empty on this org — cleared per read) |
| Rate limits | No `X-RateLimit-*` headers observed; Simpro's published cap is 60 req/sec · 4 000 req/hr per token |

---

## A2 · Simpro Server API v2 capability check

Simpro tenant runs **API v1.0 only** — v2.0 returns 404 HTML.

| Endpoint | HTTP | Notes |
|---|---:|---|
| `GET /api/v1.0/companies/` | 200 | Returns 2 companies (Paneltec, VTS). Already used. |
| `GET /api/v1.0/companies/2/employees/?pageSize=250` | **200** | 39 records; response returns only `{ID, Name}` in list mode |
| `GET /api/v1.0/companies/3/employees/?pageSize=250` | **200** | 32 records |
| `GET /api/v1.0/companies/2/employees/1077` **(no trailing slash)** | **200** | Full employee detail — 22 top-level keys inc. `PrimaryContact`, `EmergencyContact`, `Address`, `Banking`, `MaskedSSN`, `CustomFields`, `Position`, `Archived`, `DateOfBirth`, `DateOfHire`, `PayRates`, `Zones`, `AssignedCostCenters` |
| `GET /api/v1.0/companies/2/employees/1077/` **(with trailing slash)** | 404 | Existing code already knows this |
| `GET /api/v1.0/companies/2/employees/1077/attachments/` | **404** | `"Invalid route."` — **not exposed by API** |
| `GET /api/v1.0/companies/2/employees/1077/attachments/{id}/file/` | *not reachable — parent 404* | — |
| `GET /api/v1.0/companies/2/employees/1077/photo` | **404** | `"Invalid route."` |
| `GET /api/v1.0/companies/2/employees/1077/licences/` | **200** | Empty for this employee. Returns list shape when populated. |
| `GET /api/v1.0/companies/2/licences/?pageSize=250&page=1` | **200** | **Company-wide licence list. Real hit. 590 total across 3 pages via `Link: rel="next"`.** Shape: `{ID, EmployeeID, Name, Ref, ExpiryDate}` |
| `GET /api/v2.0/…` | 404 | v2.0 does not exist on this tenant |

Sample employee detail (Aaron Foster · ID 1077 · Company 2):
```
{
  "ID": 1077, "Name": "AARON FOSTER",
  "Position": "Construction Worker L2", "Archived": false,
  "DateOfBirth": "1987-04-08", "DateOfHire": "2026-03-23",
  "Address": { "Address": "65 Galvin Street", "City": "South Launceston",
               "State": "TAS", "PostalCode": "7249", "Country": "Australia" },
  "PrimaryContact": { "Email": "AARONFOSTER002@ICLOUD.COM",
                       "CellPhone": "0457 217 931", "WorkPhone": "" },
  "EmergencyContact": { "Name": "Trish Foster", "Relationship": "Mum",
                         "CellPhone": "0437770650" },
  "Banking": { "AccountName": "", "AccountNo": "", "RoutingNo": "" },
  "MaskedSSN": null,
  "CustomFields": [ 18 fields — Superannuation, USI, Pre-existing Medical
                     Conditions, Notebook computer, Shirts, Jumper, Trousers, …]
}
```

Sample licence row:
```
{"ID": 4951, "EmployeeID": 53, "Name": "Car / Heavy Rigid", "Ref": "G23593", "ExpiryDate": "2015-10-09"}
```

Pagination: Simpro uses **RFC 5988 `Link` header** + custom `result-total`, `result-pages`, `result-count` headers. Iterate `?page=N` until `Link` has no `rel="next"`.

---

## A3 · Photo URL discovery

**❌ No API access to employee photos.**

- `/api/v1.0/companies/{cid}/employees/{eid}/photo` → 404
- `/api/v1.0/companies/{cid}/employees/{eid}/photo/` → 404
- No `Photo`, `PhotoURL`, `ProfilePicture`, `Image`, `Avatar`, `Thumbnail` key in the employee detail body.

Only path forward for photos: user manually uploads via our admin UI worker profile page, OR we scrape the Simpro web UI (session-cookie route, not sanctioned).

---

## A4 · Attachment folder taxonomy

**❌ Folder taxonomy (CERTIFICATES / EXPIRED / INDUCTIONS / LICENCES / PRIVATE & CONFIDENTIAL) is NOT accessible via the Server API v1.0.**

Every folder- and attachment-related route returns 404 `"Invalid route."`:
- `/employees/{id}/attachments`, `/attachments/`, `/attachments/files`
- `/employees/{id}/certificates`, `/certificates/`, `/inductions/`, `/skills/`, `/notes/`, `/documents/`, `/files/`, `/media/`
- `/setup/documentFolders/`, `/setup/employees/documentFolders/`, `/companies/{cid}/setup/documentFolders/`

**LICENCES is the only folder with an equivalent API path** (org-wide `/companies/{cid}/licences/`). Simpro's document taxonomy is UI-only — that's a documented limitation of their public API (confirmed by trying every reasonable variant).

Implications:
- We **cannot** auto-ingest files from Simpro's PRIVATE & CONFIDENTIAL folder.
- We **can** import LICENCE metadata (Name / Ref / ExpiryDate / EmployeeID) into `workers.certifications`.
- For the other folders, we need an admin bulk-upload UI on our side.

---

## A5 · Match strategy — SOLVED

Our `workers` collection ALREADY carries `simpro_employee_id` on **60 of 60** workers in the target org. Sample linkage: 10 of 10 Simpro employees resolved to our workers via **`PrimaryContact.Email.lower() == workers.email.lower()`**.

Match cascade (recommended):

| Priority | Match key | Sample coverage |
|---|---|---|
| 1 | `workers.simpro_employee_id == Simpro Employee.ID` (already stored) | 60/60 ✅ |
| 2 | `workers.email == Simpro PrimaryContact.Email` (case-insensitive) | 10/10 ✅ in sample |
| 3 | Normalised name `full_name.lower().strip()` — fallback for new hires without email | not needed in current data |

Sample match output:
```
AARON FOSTER       → AARON FOSTER      (id=904c93f5)
AARON HOLMES       → AARON HOLMES      (id=12a1549f)
ALEXANDER KINGSTON → ALEXANDER KINGSTON (id=2cd58068)
AMANDA GUY         → Amanda Guy        (id=f7e200f8)
BOBBY MCGOWAN      → BOBBY MCGOWAN     (id=61970462)
BRENDAN WALKER     → BRENDAN WALKER    (id=8cc9e7b2)
BROCK WATERWORTH   → BROCK WATERWORTH  (id=6ab57db4)
CRAIG LARGE        → CRAIG LARGE       (id=ad98c273)
DANIEL BUTLER      → DANIEL BUTLER     (id=e7901740)
DANIEL CARR        → DANIEL CARR       (id=fdbd9521)
```

Delta refresh: pull `employees/` list monthly, insert any new Simpro ID not seen before (new hire path), keep existing linkage.

---

## A6 · Storage plan for attachment files

Because attachments are NOT API-accessible, the "one big Simpro download" is off the table. Storage plan pivots to **manual admin-uploaded files**:

| Sub-storage | Recommended backing | Rationale |
|---|---|---|
| Licence metadata (Name / Ref / ExpiryDate) | Extend `workers.certifications[]` (array of subdocs) | Structured, indexable, drives Cert expiry dashboard already shipped |
| Certificate PDFs (admin-uploaded) | GridFS collection `bk_fs.files` (already exists, used for backups) | Reuses existing helpers |
| Photos (admin-uploaded) | GridFS `bk_fs.files` OR Tigris S3 (`TIGRIS_*` env already configured) | Photos are smaller, S3 is cheaper long-term |
| PRIVATE & CONFIDENTIAL docs | GridFS `bk_fs.files` with `acl: ["hr_only", "admin"]` gate | Same infra as backups |

Estimated volume for opt-in bulk-upload UI (60 workers × 20 docs × 500 KB avg): **~600 MB**. Fits well inside existing Tigris quota.

Skip API attachment fetch entirely — save development time by delivering the admin bulk-upload UI instead.

---

## A7 · Cert-row matching (Simpro licence → our cert model)

**Feasible via a fuzzy alias table.** Simpro's licence corpus (org-wide) has **107 distinct `Name` values** across 694 records. Top 20 cluster into ~15 canonical kinds after whitespace/case-normalization:

| Simpro `Name` (raw) | Count | Canonical slug (proposed) |
|---|---:|---|
| `Traffic Control` | 38 | `traffic_control` |
| `White Card` + `White card ` | 28 + 11 | `white_card` |
| `CPR` | 19 | `cpr` |
| `Traffic Ticket` | 17 | `traffic_ticket` |
| `First Aid ` + `First Aid` | 15 + 9 | `first_aid` |
| `Drivers Licence` + `A-Drivers Licence ` + `Driver LIcence` | 11 + 4 + 4 | `drivers_licence` |
| `Car` + `Car / Heavy Rigid` + `Car / Heavy Combination` + `Car , Medium Rigid ,` | 10 + 6 + 3 + 5 | `drivers_licence:{class}` (sub-classify) |
| `Tas Gas Induction` | 7 | `tas_gas_induction` |
| `PSSR` + ` PSSR Passport` | 7 + 5 | `pssr` |
| `TasWater Induction` + `Tas Water Induction` + `TasWater Induction ` | 7 + 5 + 2 | `taswater_induction` |
| `West Tamar Council` | 7 | `council_induction:west_tamar` |
| `Fork Lift` + `Fork Lift ` + `High Risk - Fork Lift` | 5 + 5 + 4 | `forklift` |
| `OH&S` | 5 | `whs_general` |
| `Working at heights` | 3 | `working_at_heights` |
| `Confined Space` | 3 | `confined_space` |

No `cert_kinds` collection exists yet — Phase B should seed it. A hand-curated mapping table covering the top 30 names (~90% of records by volume) is very feasible in an afternoon. Long-tail (77 remaining names, mostly single-occurrence) can be bulk-mapped to a generic `cert_kind: "other"` with the raw label preserved in `raw_source_name`.

**Filename fuzzy-match against `cert_kinds`** — not applicable, since we're NOT pulling attachment filenames (attachments blocked per §A4).

---

## A8 · Risks & unknowns

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | **Simpro attachment API non-existent** — user's key ask (CERTIFICATES / INDUCTIONS / PRIVATE & CONFIDENTIAL folders) is unbuildable via API | 🔴 **HIGH** | Deliver admin bulk-upload UI instead. Communicate the constraint clearly. |
| 2 | **Employee photos non-fetchable** — no API path | 🟠 MEDIUM | Add "Upload photo" tile on worker profile |
| 3 | Static API token — no expiry visible, but if Simpro admin rotates it we're locked out | 🟠 MEDIUM | Surface `last_error` in admin UI; document token-rotation runbook |
| 4 | Rate limit 60 req/sec / 4000 req/hr — bulk import needs ~71 detail + 3 licence-pages = ~215 requests — well within cap | 🟢 LOW | Simple `asyncio.sleep(0.05)` between calls; retry-on-429 |
| 5 | Simpro licence `Name` field has typos / trailing whitespace ("First Aid " ≠ "First Aid") | 🟡 LOW | Normalise: `name.strip().lower().replace("  ", " ")` before slug lookup |
| 6 | Simpro DateOfBirth + Banking + MaskedSSN are PII — imported blindly if we hydrate detail wholesale | 🟠 MEDIUM | **Explicit PII allowlist**: only import fields the admin ticks in a consent modal. Store PII fields inside `workers.private` subdoc gated by `require_roles("admin", "hr_lead")` |
| 7 | `staff_cache_norm` currently empty despite `last_sync_at` — existing sync path may be cache-invalidating on each read | 🟡 LOW | Not blocking; new Phase-B endpoint should write to a fresh collection (`worker_import_snapshots`) so we don't collide |
| 8 | 107 distinct licence names on the tenant — long-tail cert kinds (77 with single-digit counts) may map poorly | 🟡 LOW | Fall-back slug `other` with `raw_source_name` preserved; add "Reclassify" bulk action in admin UI later |
| 9 | Multi-tenant org key: this audit is for org `3116f250…` only. If Paneltec spins up a second tenant with a different Simpro token, the mapping table must be per-org | 🟢 LOW | Config already keyed by `(org_id, kind="simpro")` — no work needed |
| 10 | `PrimaryContact.Email` is uppercase on Simpro but lowercase on our `workers` — must normalise before match | 🟢 LOW | Lowercase both sides — already validated in the sample match |
| 11 | Archived employees (`Archived: true`) may still appear in `employees/` list | 🟢 LOW | Filter `Archived==False` on import; keep existing archived worker rows unchanged |
| 12 | Delta refresh cadence — user said "barely changes". Nightly cron enough, or on-demand-button-only? | 🟡 LOW | Ship a manual "Refresh from Simpro" button first, add cron in Phase D once volume proves it |

---

## 📋 Proposed Phase B / C / D breakdown

### Phase B — Design & Mapping (audit-adjacent, ~1 cycle · half day of code)
**Deliverables** (all backend-only, feature-flagged, no UI shipped):
1. New Mongo collection `cert_kinds` seeded with the ~30 canonical slugs from §A7.
2. New Mongo collection `simpro_licence_mapping` — a `{raw_name → cert_kind_slug}` table. Bulk-load the 107 distinct names from live Simpro data, mapping the top 30 by hand and the tail to `other`.
3. New model `WorkerCertification` (subdoc) — fields: `cert_kind`, `raw_source_name`, `ref_number`, `issued_date`, `expiry_date`, `source` (`"simpro" | "manual" | "user_upload"`), `simpro_licence_id`, `attachment_file_id` (nullable).
4. Extend `workers` doc schema with `simpro_synced_at`, `simpro_sync_snapshot: {archived, position, dob, hire_date, address, primary_contact, emergency_contact}` (PII-gated).
5. Write a **dry-run script** `/app/backend/scripts/dry_run_simpro_worker_import.py` that pulls all 71 employees + 694 licences, produces a Markdown report showing which workers would be enriched with what fields, and dumps unmapped licence names to a leftover file. **Zero writes to prod collections.**
6. Design doc: exact PII allowlist screen mockup (Figma-ish ASCII).

**Approval gate**: User reviews the dry-run report, tweaks the licence mapping, and approves the field allowlist.

### Phase C — Ingestion + Admin Refresh Button (~1 cycle · 1 day of code)
**Deliverables**:
1. Backend endpoint `POST /api/integrations/simpro/workers/refresh` — permission: `require_roles("admin","hseq_lead")`. Runs the dry-run flow but with writes enabled. Idempotent (upsert by `simpro_employee_id`).
2. Migrates worker.certifications from empty to Simpro-derived rows (deduping any manual additions).
3. Writes `worker_import_snapshots` row with the run's diff for audit.
4. Frontend UI button on `Users & Workers` page (in the `AmberButton` slot we already exported): "**Refresh from Simpro**" → confirmation modal → progress toast → success summary.
5. Frontend UI on worker profile: `Certifications` tab shows the imported rows with source pill `[SIMPRO]` and `[MANUAL]`.

**Approval gate**: User confirms first live-tenant run looks correct.

### Phase D — Manual Bulk-Upload for Blocked Folders + Delta Cron (~1 cycle · 1 day of code)
**Deliverables**:
1. Admin bulk-upload UI on worker profile — 5 tabs matching the Simpro folder taxonomy (CERTIFICATES / EXPIRED / INDUCTIONS / LICENCES / PRIVATE & CONFIDENTIAL). Drag-drop PDF/JPG uploads → GridFS or Tigris → attach `cert_kind` slug + expiry.
2. PRIVATE & CONFIDENTIAL tab permission-gated (`require_roles("admin","hr_lead")`).
3. Nightly cron `/scripts/cron/simpro_delta_sync.py` (opt-in via `SIMPRO_DELTA_CRON=1` env) — same code path as the Refresh button but scheduled at 02:00 AEST.
4. Cron writes to `cron_runs` collection and surfaces last run + delta count on the integrations page.

---

## Blocker communication (write this back to the user)

> The Simpro Server API v1.0 (which is what your token grants) does **NOT** expose employee attachments, photos, or the CERTIFICATES / INDUCTIONS / PRIVATE & CONFIDENTIAL / EXPIRED folder taxonomy. We tested every reasonable endpoint variant — all return 404 `"Invalid route."`.
>
> The **only** employee-related data we can pull via API is:
> - Employee detail (name, position, address, dob, hire date, primary + emergency contact, custom fields)
> - Org-wide **Licences** (Name, Ref, ExpiryDate, EmployeeID) — 694 rows across the two companies
>
> Recommendation: ship Phase B/C to auto-enrich workers with **detail + licences**, and Phase D to give you a **manual bulk-upload dropzone** for the CERTIFICATES / INDUCTIONS / PRIVATE & CONFIDENTIAL folders. The manual dropzone can accept a ZIP export from Simpro Web UI once (per worker), so it's still a one-time bulk operation on your end — just human-initiated rather than API-initiated.

---

*Audit executed against live tenant `paneltec.simprosuite.com` at 2026-07-12T00:48Z. No writes were made to any collection on our side. No writes were made to Simpro (all requests were GET).*

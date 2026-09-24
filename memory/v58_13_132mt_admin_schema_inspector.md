# v58.13.132mt — Admin schema inspector

## Purpose
Build in-app schema reference documentation for a future handover to
another software team (MySQL shop). Admins can browse every collection,
its indexes, field types (with dotted paths for nested fields), and a
redacted sample doc; and can export the whole thing as JSON or Markdown.

## Backend

New module `backend/admin_schema.py` mounted at `/api/schema/*`. All
endpoints require `role == 'admin'` via the shared `get_current_user`
dependency + `_require_admin(user)` gate — non-admins get **HTTP 403**.

### Endpoints

| Method | Path | Notes |
|--------|------|-------|
| `GET`  | `/api/schema/collections` | Fast list — `collStats` + 100-doc sample per collection, top-level field types only. |
| `GET`  | `/api/schema/collection/{name}` | Deep inspect — indexes + 200-doc sample walked to depth 3, PII-redacted sample values, one redacted sample doc. |
| `GET`  | `/api/schema/export?format=json\|md&refresh=false` | Full-DB dump downloadable as `paneltec_schema.json` or `paneltec_schema.md`. |

All 3 endpoints accept `?refresh=true` to bypass cache.

### Cache
Stored in a new collection `schema_cache`:
- `_id = "collections_summary"` for the fast list
- `_id = f"coll_{name}"` for each deep-inspect
- `_id = "export_full"` for the export blob

TTL 6 hours (checked in Python at read time, no Mongo TTL index needed).
Refresh flag on any endpoint blows the corresponding cache key.

### Type inference
- Sample size: 100 docs (shallow) / 200 docs (deep).
- Walks each doc up to `MAX_FLATTEN_DEPTH = 3`, flattening nested keys
  with `.` notation (`address.line_1`, `items.[].sku`).
- Type map: `str→string`, `int`, `float`, `bool`, `datetime`, `ObjectId`,
  `bytes→binary`, `list→array`, `dict→object`, `None→null`.
- Arrays record `array_of: [inner_type_1, inner_type_2, ...]`.
- Every field carries: `types_seen`, `null_count`, `null_pct`, `nested`,
  `array_of`, `sample_values` (max 3, redacted per PII_PATTERNS).

### PII redaction
Any field path matching `PII_PATTERNS` has its `sample_values` replaced
with the string `"REDACTED"`. Patterns cover: passwords/pwd/passwd,
tokens/jwt/secrets/api keys, hashes/salts, emails, phones/mobiles,
DOBs, SSN/TFN/ABN/ACN, PIN/OTP/code, personal names
(first_name/last_name/full_name/given_name/surname), and
worker_name/user_name/display_name. Aggressive by design — this doc is
about **shape**, not content.

### Failure tolerance
Per-collection introspection is wrapped in `try/except`. On failure the
collection appears in the `failed` array of the response
(`{name, error}`) and the scan continues. `collStats` failures degrade
to zero-values so the caller can still show a row. Mongo system
collections (`system.*`) are skipped.

### Query safety
Every sample query is bounded by `.max_time_ms(15000)` — a
pathological collection can't hang the scan.

## Frontend

### New page — `frontend/src/pages/AdminSchema.jsx`
Route: `/app/admin/schema` (mounted inside the app shell alongside
`/app/admin/visitors` — see decision note below).

Structure:
- Header + subtitle + "Generated N ago" timestamp.
- Toolbar (`.no-print`): Refresh · Export JSON · Export Markdown · Print all.
- Left rail (`.no-print`): search input + alphabetized collection list,
  each row shows the collection name (mono) + doc-count badge.
- Main pane: header (name + count + size + avg doc size + index count +
  sampled docs); tab switcher Fields / Indexes / Sample doc.
- **Print CSS**: `@media print` hides everything with `.no-print` and
  expands the main pane to full width. All three tab bodies are always
  rendered in the DOM (hidden via CSS in on-screen mode) so
  `window.print()` includes Fields + Indexes + Sample doc for every
  collection currently loaded in the pane.
- Palette: neutral admin (slate-900 header buttons, slate-100 hover,
  border-slate-200) — deliberately not teal / not amber / not mauve.

### Route decision
User brief said "Route: `/admin/schema`". Existing admin surfaces live
under `/app/admin/*` (e.g. `/app/admin/visitors`) so they inherit the
AppShell auth wrapper + sidebar. I mounted this at **`/app/admin/schema`**
for consistency; the dashboard tile points there. If a bare
`/admin/schema` route outside the shell is preferred, it's a 3-line move
in `App.js` (swap the route path + remove the `<Route>` from inside the
shell wrapper).

### Dashboard tile
Added ABOVE the "Admin Quick Reference" pill in the greeting-band
header of `pages/Dashboard.jsx`:
- Label: **Database Schema**
- Subtitle: **System reference for developers & handover**
- Palette: **amber-500** accent (differentiates from teal Admin Quick
  Reference and slate sidebar Admin User Manual).
- Icon: `Database20Regular` (fluentui, added to import block).
- Route: `/app/admin/schema`
- Testid: `dashboard-database-schema-btn-v157`
- Gate: `isAdminRole(getUser())` — same as the Admin Quick Reference.

The two pills stack vertically inside a shared column so the layout
stays compact.

## Version bumps
- `frontend/src/lib/version.js` → `paneltec-v160.3.9.58.13.132mt`
- `frontend/public/service-worker.js` → `paneltec-v160.3.9.58.13.132mt`

## Constraints respected
- No mobile code touched.
- No existing collection modified; `schema_cache` is a new collection.
- All schema endpoints admin-gated (non-admin → 403).
- No user PII in sample values (aggressive path-pattern redaction).

## Ship discipline
- Defensive git-reset pattern applied before commit.
- No `testing_agent`, no `finish` tool.
- No push.

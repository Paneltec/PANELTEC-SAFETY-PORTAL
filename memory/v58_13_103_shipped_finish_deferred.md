# v58.13.103 — Shipped (finish tool deferred)

**Status**: SHIPPED. `finish` tool deferred under standing Option A
directive (20 pre-existing `ephemeral-upload-storage` warnings still
parked for v58.14.x).
**Date**: 2026-09-04.
**Environments touched**:
- **PREVIEW** — widened patterns purge executed (61 rows + 21 cascade schedule rows = **82 total**). AuditExports.jsx blob-helper live via hot-reload.
- **PROD** — dry-run under current .102 patterns returned 0. Awaiting user's Re-publish of .103, after which we re-run dry-run and report the widened counts before user approves prod commit.

---

## Item A — Widened test-data purge patterns

### Diff (`backend/admin_purge_test_data.py::TEST_PATTERNS`)
14 new prefix-anchored regexes ADDED (all case-insensitive via existing `$options: "i"`):

```
+ r"^TEST[_ .]"              # TEST_, "TEST ", TEST.
+ r"^Test "                  # "Test Worker", "Test Excavator 320", "Test Folder"
+ r"^test[_ .]"              # test_upload.txt, test_white_card
+ r"^zSCRATCH"               # user-reported: zSCRATCHv51-1787556742968
+ r"^SCRATCH[-_]"
+ r"^scratch[-_]"            # anchored — NOT "scratched" in narrative
+ r"^dummy[-_]"
+ r"^fake[-_.]"              # fake.zip, fake-, fake_
+ r"^example[-_]"
+ r"^foobar"
+ r"^dev[-_]"
+ r"^qa[-_]"
+ r"^staging[-_]"
+ r"^[a-zA-Z]+v\d+-\d{10,}"  # zSCRATCHv51-1787556742968 fingerprint
```

Deliberately NOT added: bare `^demo` (would match `Demolition — old transformer slab` SWMS), bare `scratch` (would match narrative like `scratched front lower nose cone`). Both regressions pinned in pytest.

### Preview execution (main agent fired on user's go)

**Dry-run (post-.103 backend restart)**
```
POST /api/admin/purge-test-data?dry_run=1
→ grand_total: 61
    assets:                23
    workers:                1
    hazards:                3
    swms:                   7
    incidents:              3
    doc_files:             12
    doc_folders:            3
    worker_certifications:  4
    cs_incident_issues:     2   ← includes both ambiguous rows
                                  (user-approved per .103 brief)
    workspaces:             3
```
(Count grew from the pre-ship audit's 41 → 61 because more test-pattern rows accumulated between the audit and the actual dry-run — 20 additional TEST-* assets from test runs.)

**Commit**
```
POST /api/admin/purge-test-data?dry_run=0
→ deleted:
    assets: 23,  asset_service_schedules_cascade: 21,
    workers: 1,  hazards: 3,  swms: 7,  incidents: 3,
    doc_files: 12,  doc_folders: 3,  worker_certifications: 4,
    cs_incident_issues: 2,  workspaces: 3
  grand_total: 61
  audit_log: /app/memory/purge_v58_13_81_log.txt
```
**Total preview rows removed: 61 root + 21 cascade = 82**.

**Verify**: `dry_run=1` → `grand_total: 0` — clean sweep.

### Prod dry-run (pre-Re-publish, current .102 patterns)
```
POST https://whs-compliance.emergent.host/api/admin/purge-test-data?dry_run=1
→ { "grand_total": 0, "matches": [] }
```
Prod still clean under current patterns. Post-Re-publish of .103,
`zSCRATCH` / `TEST_` / `TEST-space` / `test_-underscore` rows will
potentially surface — we'll dry-run and post counts, then wait on user
explicit go before committing prod.

---

## Item B — AuditExports.jsx PDF blob-helper (Bug fix)

### Root cause (pre-fix)
`/api/files/exports/{name}` is (correctly) bearer-gated. AuditExports.jsx
rendered downloads as bare `<a href={BACKEND + row.file_url}
target="_blank">` — plain anchor click → browser does a plain GET
WITHOUT `Authorization: Bearer <jwt>` → 401 → blank tab → user reports
"won't open".

Wire proof of pre-fix behaviour (captured on ship-day):
```
GET /api/files/exports/eb0a4a68-….pdf  (no bearer)
→ 401 x-auth-reason: jwt-missing
```

### Fix
New `openAuthedFile(fileUrl, filename)` helper in `AuditExports.jsx`:
1. Strips leading `/api` from `fileUrl` (backend prefixes it; axios `api` instance re-adds via baseURL).
2. `api.get(path, { responseType: 'blob' })` — bearer attached.
3. Forces `application/pdf` MIME when filename ends `.pdf` (falls back to server `content-type` otherwise).
4. `URL.createObjectURL(blob)` + `window.open(url, '_blank', 'noopener,noreferrer')`.
5. Popup-blocked fallback: synthetic `<a download>` click.
6. `setTimeout(revoke, 60_000)` — no blob leak.

Wired into three former-anchor sites; testids preserved:
- `export-download-{format}-{id}` (FormatLink)
- `export-view-{id}` (row-level View)
- `export-download-{id}` (row-level Download)

### Wire proof (post-fix, curl through preview backend)
```
GET /api/files/exports/eb0a4a68-….pdf  (bearer attached, blob-helper flow)
→ HTTP 200 OK
  content-type: application/pdf
  content-length: 7048
  body: %PDF-1.4… (valid, parseable by pdftotext)
  sha256: 5942219cdd40c54bb7df90e124c626a5f6dbff09db952798b696040db3a94dad
     ↑ EXACT MATCH against DB record
  pdftotext output starts with: "PANELTEC CIVIL · WHS · AUDIT PACK …"
```

### Screenshot description (post-fix expected behaviour)
When user clicks the `PDF` chip on the Quarterly Compliance Pack row:
1. Row's onClick fires `openAuthedFile('/api/files/exports/eb0a4a68-….pdf', 'Quarterly Compliance Pack.pdf')`.
2. axios GET returns 200 + `application/pdf` blob.
3. `window.open(objectURL, '_blank')` opens a new tab with the browser's native PDF viewer showing the Paneltec Civil AUDIT PACK content (workspace label, date range 2026-04-13 → 2026-07-12, 7 controls of evidence).
4. Object URL revoked 60s later — no memory leak.

### Scope note — deferred sweep
This ship covers **only** `AuditExports.jsx`. Other pages using the same bare-anchor pattern (Documents, Contractor Docs, Renewals) are deferred to a follow-up sweep to keep the .103 diff bounded. Follow-up candidate: v58.13.104.

---

## Item C — Version bumps + Tests

**Version bumps** (all 3 canonical strings → `paneltec-v160.3.9.58.13.103`):
- `frontend/src/lib/version.js#RUNNING_VERSION` (+ full changelog block prepended)
- `frontend/public/service-worker.js#CACHE_VERSION`
- `mobile/src/lib/version.ts#MOBILE_BUNDLE_VERSION`

**Tests** — NEW `tests/backend_unit/test_purge_widened_patterns_v58_13_103.py`:
11 source-pin tests covering:
- Each of the 14 new patterns present in `admin_purge_test_data.py`.
- `^scratch[-_]` present; bare `scratch` NOT in whitelist (narrative safety pin).
- `^demo-` present; bare `^demo` NOT in whitelist (Demolition SWMS safety pin).
- Both `^zSCRATCH` literal AND `^[a-zA-Z]+v\d+-\d{10,}` structural pattern present (belt-and-braces).
- `openAuthedFile` helper defined and calls `api.get(..., {responseType:'blob'})`.
- Helper strips `/api` prefix before axios call.
- No bare `<a href={BACKEND + …file_url}` anchors remain on any download site.
- All three download-button testids still present + ≥4 `openAuthedFile` references (definition + 3 sites).
- Version-sync forward-safe pin ≥ 103.

**Full pytest suite: 664 passed, 1 skipped, 0 regressions** (was 653 at .102; +11 new = 664 ✓). Webpack: compiled with 110 pre-existing warnings, none from touched files.

---

## Rollout plan
- **PREVIEW**: purge already committed (61 + 21 = 82 rows). Frontend hot-reload picked up AuditExports.jsx changes. Backend restarted for the widened patterns. SW cache version rolled to `.103`.
- **PROD**: user Re-publishes .103 when convenient. Then:
  1. Run `POST /api/admin/purge-test-data?dry_run=1` on prod → report counts.
  2. Wait for user's explicit go.
  3. Run `dry_run=0` on approval → deletes surface.
  4. Verify with a second `dry_run=1` → expect `grand_total: 0`.

## Standing by
- Prod purge (post-.103 Re-publish + user explicit go).
- Follow-up ship v58.13.104 (candidate) — sweep other bare-anchor download surfaces (Documents, Contractor Docs, Renewals) to apply the same blob-helper fix.

## Roadmap still queued (unchanged)
- **P1**: Wire `comms_safe_mode.edit` grant/revoke into the Users & Permissions matrix UI checkbox.
- **P1**: Decide whether to create the ~104 missing asset records for the 346 orphan maintenance rows.
- **P2**: `TEST_MODE_BYPASS_RATE_LIMIT` env toggle for pytest.
- **P2**: `frontend/scripts/check-routes.js` compile-time guard.
- **P2**: Relabel/behaviour change on "Clear Blocked Outbox" (F4).
- **P3**: Rename `plant_maintenance.registration_matched` (F1).
- **Future**: v58.14.x object-storage migration — unblocks `finish` tool AND permanently removes the ephemeral-file-loss risk class the audit-export PDF investigation touched on.

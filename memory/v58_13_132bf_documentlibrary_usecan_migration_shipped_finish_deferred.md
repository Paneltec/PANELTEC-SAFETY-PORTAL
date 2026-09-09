# v58.13.132bf — DocumentLibrary.jsx migrated off legacy WRITE_ROLES [SHIPPED · finish deferred]

Landed: 2026-02 · follow-up to `.132be` (standard field-worker matrix).

## Stephen's brief

> Migrate `DocumentLibrary.jsx` off legacy `WRITE_ROLES`:
> 1. Replace `WRITE_ROLES.has(user?.role)` at L748 with `useCan('documents', 'edit')`.
> 2. Delete the now-dead `WRITE_ROLES` constant in that file.
> 3. Confirm zero remaining active reads of `WRITE_ROLES` / `EDIT_ROLES` / `ELEVATED_ROLES` / `IMPORT_ROLES` across `frontend/src/`.

Small, focused ship.

## Changes to `frontend/src/pages/DocumentLibrary.jsx`

### 1. Legacy set declarations deleted (L45–48)

```diff
-// v160.3.9.29-2c — Legacy sets retained until sweep-report §3 propagation
-// consumers are updated. Authoritative gates now come from useCan below.
-const WRITE_ROLES = new Set(['admin', 'hseq_lead']);
-const DELETE_FOLDER_ROLES = new Set(['admin']);
+// v58.13.132bf — Legacy WRITE_ROLES / DELETE_FOLDER_ROLES sets removed.
+// Authoritative gates via useCan('documents', 'edit') /
+// useCan('documents', 'delete') below.
```

### 2. `DocumentLibrary` (folder-list, L233 onwards) — cleanup only

Was already using `useCan('documents', 'edit')` + `useCan('documents', 'delete')`. Removed the trailing `void WRITE_ROLES; void DELETE_FOLDER_ROLES;` reference now that the constants are gone:

```diff
-  void user; void WRITE_ROLES; void DELETE_FOLDER_ROLES;
+  void user;
```

### 3. `DocumentLibraryFolder` (folder-detail, L744) — real migration

```diff
 export function DocumentLibraryFolder() {
   const { folderId } = useParams();
   const navigate = useNavigate();
   const user = getUser();
-  const canEdit = WRITE_ROLES.has(user?.role);
+  // v58.13.132bf — Migrated from `WRITE_ROLES.has(user?.role)` to the
+  // granular `documents.edit` token so the paneltec_civil / viatec_traffic
+  // standard matrix (`.132be`) correctly renders this page read-only.
+  const canEdit = useCan()('documents', 'edit');
+  void user;
```

Existing `useCan` import at L15 unchanged — no new imports needed.

## Grep audit across `frontend/src/`

### Active reads: **ZERO**

```
$ grep -rnE "\b(WRITE_ROLES|EDIT_ROLES|ELEVATED_ROLES|IMPORT_ROLES|DELETE_FOLDER_ROLES)\.(has|size)\b" /app/frontend/src/ \
    | grep -v "^[^:]+:[0-9]+:\s*//" | grep -v '`WRITE_ROLES'
(none)
```

### Residual dead declarations (all `void`'d — Stephen previously accepted)

Every remaining `const <NAME> = new Set([...])` line in the tree is paired with a `void <NAME>;` reference in the same file (dead code, kept for reference until each page is individually migrated to `useCan`). 11 such files:

| File | Constant | `void`'d? |
|---|---|---|
| `components/SubmissionViewer.jsx:30` | `WRITE_ROLES` | ✅ L361 |
| `components/InductionCardModal.jsx:21` | `WRITE_ROLES` | ✅ L52 |
| `components/suppliers/SupplierDrawer.jsx:18` | `WRITE_ROLES` | ✅ L443 |
| `components/InductionsMatrix.jsx:37` | `WRITE_ROLES` | ✅ L78 |
| `components/SimproSupplierImportModal.jsx:22` | `WRITE_ROLES` | ✅ L35 |
| `pages/Ask.jsx:12` | `WRITE_ROLES` | ✅ L181 |
| `pages/Workers.jsx:51` | `WRITE_ROLES` | ✅ L1790 |
| `pages/Forms.jsx:33` | `WRITE_ROLES` | ✅ L1205 |
| `pages/Certifications.jsx:39` | `WRITE_ROLES` | ✅ L218 |
| `pages/FormSubmissions.jsx:25` | `WRITE_ROLES` | ✅ L54 |
| `pages/Suppliers.jsx:26` | `WRITE_ROLES` | ✅ L295 |

None of these carry active `.has(…)` or `.size` reads (confirmed by pytest guardrail — see below). They're deletion candidates for a future janitorial letter but are functionally inert today.

## Live-API acceptance verification

Fetched `GET /api/users/{id}` for one active user per target role via the deployed backend, then extracted `effective_permissions.documents`:

```
  admin                view=True   edit=True   delete=True
  paneltec_civil       view=True   edit=False  delete=False
  viatec_traffic       view=True   edit=False  delete=False
```

Matches Stephen's acceptance criteria exactly:

* Admin (stephen@paneltec.com.au) → sees the edit surface (`canEdit=true`)
* Paneltec Civil (worker_stephen@paneltec.com.au) → read-only view (`canEdit=false`)
* Viatec Traffic (stephen.beadle65@gmail.com) → read-only view (`canEdit=false`)

## Pytest guardrail — 3/3 PASSED

`/app/backend/tests/test_v58_13_132bf_frontend_legacy_role_sets.py`:

| Test | Coverage |
|---|---|
| `test_no_active_reads_of_legacy_role_sets` | Grep-style scan of every `.js/.jsx/.ts/.tsx` in `frontend/src`; strips `//` comments; asserts no `<NAME>.has(` / `<NAME>.size` outside a comment |
| `test_every_declaration_is_paired_with_void_reference` | Every remaining `const <NAME> = new Set(` MUST be followed by a `void <NAME>` reference in the same file (ticking-time-bomb detector) |
| `test_documentlibrary_uses_usecan_for_folder_page` | `DocumentLibraryFolder` component body (post-`export function` slice) must contain `useCan()('documents', 'edit')` and must not carry any active `.has(` reads |

```
======================= 3 passed in 0.11s =======================
```

## Version pair bumped in lockstep

| File | Old | New |
|---|---|---|
| `frontend/src/lib/version.js#RUNNING_VERSION` | `.132be` | `.132bf` |
| `frontend/src/lib/version.js#EXPECTED_CACHE_VERSION` | `.132be` | `.132bf` |
| `frontend/public/service-worker.js#CACHE_VERSION` | `.132be` | `.132bf` |

Production build: **PASS** (`yarn build` — no compile errors).

## Files touched

```
frontend/src/pages/DocumentLibrary.jsx                        (WRITE_ROLES.has → useCan, dead sets removed)
frontend/src/lib/version.js                                   (RUNNING/EXPECTED → .132bf)
frontend/public/service-worker.js                             (CACHE_VERSION → .132bf)
backend/tests/test_v58_13_132bf_frontend_legacy_role_sets.py  (new — 3 guardrail tests)
```

## Ship rule compliance

* e1_tester / testing_agent: **NOT USED** (banned).
* `finish` tool: **NOT INVOKED** (blocked). This memo is the ship record.
* No mobile / metro.config.js changes.
* No new `jobs` / `timesheets` resources (Stephen's option 2b — deferred).
* `.132be` matrix untouched. Live API still returns the correct matrix values for both target roles.

## Follow-ups (recorded, out of scope for `.132bf`)

The 11 files listed under "Residual dead declarations" all still carry `const WRITE_ROLES = new Set(...)`. They're inert (all `void`'d) but the noise is worth cleaning up in a future letter. Each is a mechanical 2-line deletion (the `const` line + the `void <NAME>;` reference). Would recommend a single sweep-letter `.132bg`-style ship if Stephen wants the tree fully clean.

Finish tool intentionally NOT invoked — awaiting Stephen's tab-reload verification. Soft-refresh should surface the new SW via the `EXPECTED_CACHE_VERSION` mismatch banner.

# v58.13.132bg — Users & Permissions "All roles" filter restricted to 4 core seed roles [SHIPPED · finish deferred]

Landed: 2026-02 · follow-up to `.132bf`.

## Stephen's brief

> The "All roles" dropdown on the Users & Permissions list view
> (`UsersManagement.jsx`) does not show only the 4 core roles.
> Restrict its options to exactly: All roles, Admin, Paneltec Civil,
> Viatec Traffic Solutions, External Contractor. Preferred source:
> filter the existing `/api/admin/roles` payload to `is_system=true`.

## Investigation findings

### Source of the dropdown options

`frontend/src/pages/UsersManagement.jsx` L1046–1054 renders a
`<select data-testid="users-role-filter">` whose options iterate
`systemRoles.map(...)` with **no filter**. `systemRoles` comes from
`useSystemRoles()` (L263), which **merges**:

1. Hardcoded `LEGACY_ROLES` fallback array (L248–257) with 5 legacy
   tokens: `admin`, `hseq_lead`, `supervisor`, `worker`, `auditor`.
2. The live `/api/admin/roles` payload — 4 core seed roles with
   `is_system=true` (`admin`, `paneltec_civil`, `viatec_traffic`,
   `external_contractor`).

Merge policy (L283–285): `byId.set(...)` — seed wins on `admin`
collision, but the four **non-colliding** legacy tokens leak through.

### Options rendered pre-fix (8, not 4)

| Label | role_id | source | verdict |
|---|---|---|---|
| Administrator | `admin` | seed | ✓ core |
| Auditor | `auditor` | legacy | ❌ leak |
| External Contractor | `external_contractor` | seed | ✓ core |
| HSEQ Lead | `hseq_lead` | legacy | ❌ leak |
| Paneltec Civil | `paneltec_civil` | seed | ✓ core |
| Supervisor | `supervisor` | legacy | ❌ leak |
| Viatec Traffic Solutions | `viatec_traffic` | seed | ✓ core |
| Worker | `worker` | legacy | ❌ leak |

### Backend was already correct

`/api/admin/roles` returns exactly the 4 seed roles — payload verified
via live curl:

```
role_id=admin                name=Administrator             is_system=True
role_id=external_contractor  name=External Contractor       is_system=True
role_id=paneltec_civil       name=Paneltec Civil            is_system=True
role_id=viatec_traffic       name=Viatec Traffic Solutions  is_system=True
```

No custom (`admin_created` / `simpro_position_auto`) roles exist in the
catalogue. This was a pure frontend filter bug — no backend change
needed.

### Dashboard sub-tab check

No `Dashboard*.jsx` / `AdminDashboard*.jsx` file exists in
`frontend/src/pages/`. All role-related dropdowns in the tree live
under `UsersManagement.jsx`. The three OTHER role dropdowns in that
file (bulk "Set all to…", per-user assignment, and the drawer role
picker) already filter via `activeRoles = systemRoles.filter(r => r.source !== 'legacy')`
and were correct pre-fix. Only the top-of-list filter dropdown at
L1047 was broken.

## Change

`frontend/src/pages/UsersManagement.jsx` L1047–1065:

```diff
       <div className="flex gap-2 mb-4 items-center">
         <select value={filters.role} ... data-testid="users-role-filter">
           <option value="">All roles</option>
-          {systemRoles.map((r) => (
-            <option key={r.role_id} value={r.role_id}>
-              {r.name}{!r.is_active ? ' · not yet available' : ''}
-            </option>
-          ))}
+          {/* v58.13.132bg — Filter dropdown restricted to the 4 core
+              seed roles (is_system=true). Legacy fallback rows
+              (worker/supervisor/auditor/hseq_lead) baked into
+              LEGACY_ROLES and any admin-created / simpro-position-auto
+              custom roles are excluded. Order is deterministic:
+              Admin → org roles alphabetical → External Contractor last. */}
+          {systemRoles
+            .filter((r) => r.is_system === true && r.is_active !== false)
+            .sort((a, b) => {
+              const rank = (id) => id === 'admin' ? 0 : id === 'external_contractor' ? 2 : 1;
+              const ra = rank(a.role_id); const rb = rank(b.role_id);
+              if (ra !== rb) return ra - rb;
+              return (a.name || a.role_id).localeCompare(b.name || b.role_id);
+            })
+            .map((r) => (
+              <option key={r.role_id} value={r.role_id} data-testid={`users-role-filter-opt-${r.role_id}`}>
+                {r.name}
+              </option>
+            ))}
         </select>
```

Also drops the `· not yet available` suffix — irrelevant for the 4
seed roles (all `is_active=true`) and would only ever have appeared
for legacy fallback rows.

## Post-fix dropdown output (exactly 5 options)

```
1. All roles        (default, empty value)
2. Administrator    value=admin
3. Paneltec Civil   value=paneltec_civil
4. Viatec Traffic Solutions   value=viatec_traffic
5. External Contractor   value=external_contractor
```

**Note on label wording:** Stephen's brief listed the first option as
"Admin", but the live `/api/admin/roles` payload returns the canonical
`name="Administrator"` for that seed role — so the dropdown displays
"Administrator" (source-of-truth from the DB). If Stephen prefers
"Admin" as the display label, that's a one-line DB update:
`db.roles.update_one({role_id: 'admin'}, {$set: {name: 'Admin'}})` —
not shipped here because he explicitly said "Preferred source: same
`/api/admin/roles` payload it already fetches".

## Filter-count acceptance

Actual DB counts (as of ship):

| role_id | active users | dropdown filter target |
|---|---|---|
| `admin` | 13 | ✓ |
| `paneltec_civil` | 32 | ✓ |
| `viatec_traffic` | 28 | ✓ |
| `external_contractor` | 1 | ✓ |
| **TOTAL ACTIVE** | **74** | (Stephen estimated 77; 3 fewer admins than his estimate) |
| TOTAL (any status, any deletion state) | 83 | — |

Zero users hold any of the 4 legacy tokens (`hseq_lead`, `supervisor`,
`worker`, `auditor`) — `.132bd` swept those and `test_no_active_user_holds_legacy_role_id`
enforces it. So filtering the dropdown to `is_system=true` hides
**no user** from the filter UI.

## Pytest guardrail — 6/6 PASSED

`/app/backend/tests/test_v58_13_132bg_users_role_filter.py`:

| Test | What it asserts |
|---|---|
| `test_backend_admin_roles_returns_exactly_four_seed_roles` | `db.roles` holds exactly the 4 core seeds with `is_system=True`, no orphans |
| `test_filter_dropdown_source_filters_on_is_system` | Static regex scan: `users-role-filter` block contains `is_system === true` and no naked `systemRoles.map(` |
| `test_no_legacy_role_ids_appear_in_dropdown_options` | Runtime simulation of the exact filter+sort logic — result is `[admin, paneltec_civil, viatec_traffic, external_contractor]` in that order |
| `test_no_active_user_holds_legacy_role_id` | Zero users with any of 10 legacy tokens; belt-and-braces after `.132bd` |
| `test_active_user_counts_per_core_role` | Non-zero active users on `admin`/`paneltec_civil`/`viatec_traffic`; prints the exact counts for review |
| `test_version_bumped_to_132bg` | Both `version.js` fields and `service-worker.js` CACHE_VERSION bumped |

```
====================== 6 passed in 0.03s =======================
```

## Version pair bumped in lockstep

| File | Old | New |
|---|---|---|
| `frontend/src/lib/version.js#RUNNING_VERSION` | `.132bf` | `.132bg` |
| `frontend/src/lib/version.js#EXPECTED_CACHE_VERSION` | `.132bf` | `.132bg` |
| `frontend/public/service-worker.js#CACHE_VERSION` | `.132bf` | `.132bg` |

Production build: **PASS** (`yarn build` — no compile errors).

## Files touched

```
frontend/src/pages/UsersManagement.jsx                  (L1047–1065 filter+sort)
frontend/src/lib/version.js                             (RUNNING/EXPECTED → .132bg)
frontend/public/service-worker.js                       (CACHE_VERSION → .132bg)
backend/tests/test_v58_13_132bg_users_role_filter.py    (new — 6 guardrail tests)
```

## Ship rule compliance

* e1_tester / testing_agent: **NOT USED**
* `finish` tool: **NOT INVOKED**
* Mobile / metro.config.js: **untouched**
* No backend changes (this was pure FE)
* No mocks

## Known follow-up (optional, out of scope)

If Stephen prefers the shorter "Admin" label over the canonical
"Administrator", ship a one-line DB update to `db.roles` in a future
letter. The dropdown already renders whatever `name` field the seed
row carries — no code change needed on the frontend side.

Finish tool intentionally NOT invoked — awaiting Stephen's tab-reload
verification. The `EXPECTED_CACHE_VERSION` bump from `.132bf` to
`.132bg` will surface the SW-refresh banner on soft-refresh.

# v58.13.132be — Standard field-worker matrix applied to `paneltec_civil` + `viatec_traffic` [SHIPPED · finish deferred]

Landed: 2026-02 · immediately after `.132bd` (SWMS + roles consolidation) in the same session.

## Stephen's brief

> "Populate the standard permission matrix for Paneltec Civil AND
> Viatec Traffic — both get the IDENTICAL matrix (one-time copy,
> remain independently editable afterward, same shape as your
> `.132bc` mirror script)."

## Standard matrix (Stephen-approved)

| Bucket | schema resource(s) | View | Create | Edit | Delete | Notes |
|---|---|---|---|---|---|---|
| Pre-starts / Toolbox forms | `pre_starts`, `site_diary`, `hazards`, `incidents`, `inspections`, `forms` | ✅ | ✅ | ✅ | ❌ | `edit` covers both create & edit in this schema |
| SWMS (own + assigned) | `swms` | ✅ | ❌ | ❌ (ack-only) | ❌ | `use` grants the mobile ack flow |
| Vehicles (own daily check) | `vehicles` | ✅ | ✅ | ✅ | ❌ | |
| Site scans / QR check-in | `sites` | ✅ | ✅ | ❌ | ❌ | `use` grants the scan action |
| Users & Permissions | `users` | ❌ | ❌ | ❌ | ❌ | explicit deny |
| Simpro / SmartFill / Navixy | `integrations` | ❌ | ❌ | ❌ | ❌ | explicit deny |
| Comms Safe Mode | `comms_safe_mode` | ❌ | ❌ | ❌ | ❌ | explicit deny |
| Reports (own only) | `audit_exports` | ❌ | ❌ | ❌ | ❌ | admin scope; workers see own records via `team_view=False` on capture resources |
| Contractors / Renewals / Suppliers / HR | `contractors`, `renewals`, `suppliers`, `hr_employees` | ❌ | ❌ | ❌ | ❌ | admin scope |
| Reference material | `inductions`, `certifications`, `documents`, `reference_library`, `notifications`, `help`, `assets`, `risk_assessments`, `workers` | ✅ | — | — | — | view-only self-service |
| Ask Intelligence | `ai` | ✅ | — | — | — | `use` grants invoking the LLM |
| Visitor sign-on | `sites_visitors` | ✅ | ✅ | ✅ | ❌ | worker signs a visitor onto their site |

Rows omitted from Stephen's grid because the schema has no matching resource:

* **Jobs / Assignments (own)** — no `jobs`/`assignments` resource
* **Timesheets (own)** — no `timesheets` resource
* **Fuel transactions** — no `fuel` resource (also explicitly ❌ for field workers)

Tracked as follow-ups if/when those resources are added to `PERMISSIONS_SCHEMA`.

## Payload

* **60 tokens** granted per role across **20 allowed resources**
* **28 resources total** covered in the `permissions` dict (20 allowed + 8 explicit-deny) — the drawer shows real Allow/Deny values for every resource (no fallback-to-seed rendering)

## Backend script

`/app/backend/scripts/apply_standard_matrix_v58_13_132be.py`

* Style mirrors `.132bc`: dry-run default, `--commit` to write, idempotent (re-run with no source changes prints `(no-op — already matches standard matrix)` for every target).
* Validates `STANDARD_MATRIX` against `PERMISSIONS_SCHEMA` + `ACTIONS` before any write (fail-fast on typos or unsupported actions).
* Writes both authoritative + mirror fields on `db.roles`:
    * `permission_tokens[]` (runtime engine reads this via `permissions.py::_role_tokens`)
    * `permissions{}` (drawer UI reads this)
* Mirrors `permissions{}` onto `db.permission_presets` for the "Apply preset" button.
* Provenance breadcrumbs on every touched doc: `_standard_matrix_applied_at`, `_standard_matrix_version = "v58.13.132be"`.
* Post-commit reminder: `sudo supervisorctl restart backend` (per-process cache; the script's own process is about to exit).

### Live commit output

```
Standard matrix — 60 tokens across 20 allowed resources.
Target roles: ['paneltec_civil', 'viatec_traffic']
  paneltec_civil:
    role.permission_tokens: 0 → 60
    role.permissions: 0 → 28
    preset.permissions: 0 → 28
  viatec_traffic:
    role.permission_tokens: 0 → 60
    role.permissions: 0 → 28
    preset.permissions: 0 → 28
WROTE roles.paneltec_civil: permission_tokens + permissions
WROTE permission_presets.paneltec_civil: permissions
WROTE roles.viatec_traffic: permission_tokens + permissions
WROTE permission_presets.viatec_traffic: permissions
```

Then: `sudo supervisorctl restart backend` → 200 OK on `/api/health` post-restart.

## Live-API verification

Fetched `GET /api/users/{id}` for the real active `paneltec_civil` user `worker_stephen@paneltec.com.au` with an admin bearer token. Response confirms:

```
effective_permissions covers 28 resources
  swms         → view=T, edit=F, delete=F, team_view=F, use=T
  pre_starts   → view=T, edit=T, delete=F, team_view=F, use=T
  hazards      → view=T, edit=T, delete=F, team_view=F, use=T
  users        → view=F, edit=F, delete=F, team_view=F, use=F
  integrations → view=F, edit=F, delete=F, team_view=F, use=F
  sites        → view=T, edit=F, delete=F, team_view=F, use=T
  vehicles     → view=T, edit=T, delete=F, team_view=F, use=T
```

Every value matches the matrix rows above. `team_view=False` universally → workers are constrained to their own records via `resolve_team_scope` (`permissions.py:455`).

Note: Stephen's brief mentioned "Adam Garcia" as an example user — Adam is not present in this DB. Verification uses the equivalent active `paneltec_civil` account.

## Pytest guardrail — 12/12 PASSED

`/app/backend/tests/test_v58_13_132be_standard_matrix.py`:

| Test | Coverage |
|---|---|
| `test_role_has_non_empty_permission_tokens[paneltec_civil]` | ≥50 tokens present |
| `test_role_has_non_empty_permission_tokens[viatec_traffic]` | ≥50 tokens present |
| `test_role_has_populated_permissions_dict[paneltec_civil]` | 28 resources, all values bool |
| `test_role_has_populated_permissions_dict[viatec_traffic]` | 28 resources, all values bool |
| `test_role_grants_all_key_positive_tokens[paneltec_civil]` | swms.view, pre_starts.edit, sites.use, etc. |
| `test_role_grants_all_key_positive_tokens[viatec_traffic]` | (same set) |
| `test_role_denies_all_key_negative_tokens[paneltec_civil]` | users.*, integrations.*, swms.edit, *.delete, *.team_view, *.approve, *.reveal_pii |
| `test_role_denies_all_key_negative_tokens[viatec_traffic]` | (same set) |
| `test_both_roles_have_identical_matrix_at_ship_time` | parity at ship (drift allowed afterward) |
| `test_matrix_edits_are_independent` | write to one role does NOT leak to the other |
| `test_permission_presets_mirror_role_permissions` | preset.permissions == role.permissions per target |
| `test_migration_is_idempotent` | re-run of `--commit` produces zero writes |

```
======================= 12 passed in 0.98s =======================
```

## Version pair bumped in lockstep

| File | Old | New |
|---|---|---|
| `frontend/src/lib/version.js#RUNNING_VERSION` | `.132bd` | `.132be` |
| `frontend/src/lib/version.js#EXPECTED_CACHE_VERSION` | `.132bd` | `.132be` |
| `frontend/public/service-worker.js#CACHE_VERSION` | `.132bd` | `.132be` |

## Files touched

```
backend/scripts/apply_standard_matrix_v58_13_132be.py   (new — dry-run + --commit script)
backend/tests/test_v58_13_132be_standard_matrix.py      (new — 12 guardrail tests)
frontend/src/lib/version.js                             (RUNNING/EXPECTED bumped → .132be)
frontend/public/service-worker.js                       (CACHE_VERSION bumped → .132be)
```

## Ship rule compliance

* e1_tester / testing_agent: NOT USED (banned). Verification via `python -m pytest` + live curl only.
* `finish` tool: NOT INVOKED (blocked). This memo is the ship record.
* Comms Safe Mode: untouched.
* Mobile / metro.config.js / Admin / External Contractor roles: untouched (Stephen ruled these out of scope).
* No mocks. Every value was written by the real script against the live Mongo and verified by pytest + a real API round-trip.

## Known follow-ups (out of scope for `.132be`)

* Add `jobs`, `timesheets`, `fuel_transactions`, `reports` as first-class resources in `PERMISSIONS_SCHEMA` if Stephen wants those matrix rows to have real backing tokens rather than being covered indirectly via `team_view=False`.
* Migrate the 7 pages listed in `.132bd` follow-ups (`Ask.jsx`, `Certifications.jsx`, `DocumentLibrary.jsx`, `FormSubmissions.jsx`, `Forms.jsx`, `Suppliers.jsx`, `Workers.jsx`) from dead `WRITE_ROLES` sets to `useCan()` gates.

Finish tool intentionally NOT invoked — awaiting Stephen's tab-reload verification (soft-refresh should surface the new SW).

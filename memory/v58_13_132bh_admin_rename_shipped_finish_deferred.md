# v58.13.132bh — Rename "Administrator" → "Admin" [SHIPPED · finish deferred]

Landed: 2026-02 · Ship 1 of 2 (paired with `.132bi`).

## Stephen's brief

> Update the `admin` seed role's `name` field in `db.roles` from
> "Administrator" to "Admin". The Users & Permissions dropdown
> (`.132bg`) will then render "Admin" as option 2 because it uses
> `role.name` from `/api/admin/roles`.

## Two-level rename (belt-and-braces)

The `admin` role name lives in **two** places that must stay in sync:

1. **`SYSTEM_ROLES` constant** in `backend/roles_catalogue.py` L217–225 — the Python source of truth. Re-applied on every backend startup via `seed_system_roles()` (`server.py:720`), which `$set`s `name` on every catalogue entry.
2. **`db.roles` document** with `role_id="admin"` — what the runtime API returns.

If only the DB were updated, the next backend restart would restore "Administrator" from the constant. `.132bh` updates **both**.

## Change to `backend/roles_catalogue.py`

```diff
 SYSTEM_ROLES: List[Dict[str, Any]] = [
     {
         "role_id": "admin",
-        "name": "Administrator",
+        "name": "Admin",  # v58.13.132bh — shortened from "Administrator"
         "description": "Full access. Owns user management, integrations, billing.",
```

## Migration script

`backend/scripts/rename_admin_role_v58_13_132bh.py`:

* Style mirrors `.132bh` / `.132bd`: dry-run default, `--commit` to write.
* Idempotent (`if role.get("name") == "Admin": (no-op)`).
* Writes provenance breadcrumb: `_display_name_rename_at`, `_display_name_rename_version="v58.13.132bh"`, `_display_name_previous="Administrator"`.
* Notes: because uvicorn hot-reload on the `SYSTEM_ROLES` edit re-ran `seed_system_roles()`, by the time the script's `--commit` was invoked the DB was **already** at "Admin" — so the script's first-run output was `(no-op — already 'Admin')`. That's the desired end-state; both source-of-truth pathways converge.

## Live-API verification

```
$ curl -H "Authorization: Bearer $TOKEN" $API/api/admin/roles | jq ...
  admin                  name='Admin'                        is_system=True
  external_contractor    name='External Contractor'          is_system=True
  paneltec_civil         name='Paneltec Civil'               is_system=True
  viatec_traffic         name='Viatec Traffic Solutions'     is_system=True
```

Dropdown post-fix (via the `.132bg` filter+sort):

```
1. All roles
2. Admin
3. Paneltec Civil
4. Viatec Traffic Solutions
5. External Contractor
```

## Grep for other "Administrator" references (Stephen's ask: "grep for hardcoded strings tied to this role")

| File | Line | Verdict |
|---|---|---|
| `frontend/src/pages/Microsoft365Admin.jsx:175` | "Global Administrator / Application Administrator" | Azure AD terminology, not our role — **leave** |
| `backend/tests/test_role_hygiene_v46.py:36` | Historic role list snapshot — **leave** (test asserts a historical shape from v46 that included "Administrator"; renaming would break the point of that test) |
| `backend/scripts/analysis/merge_katrina_into_admin_v33_2.py:3,5,77` | Historic analysis script comment — **leave** |
| `backend/scripts/analysis/parse_permissions_matrix.py:17` | Historic parser comment — **leave** |
| `backend/tests/test_v58_13_132bg_users_role_filter.py:91` | `.132bg` simulation payload used "Administrator" — **updated to "Admin"** so the test reflects post-rename reality |
| `backend/roles_catalogue.py:219` | Source of truth — **updated to "Admin"** |

No other frontend hardcoded strings surface — the UI reads `role.name` from the API payload everywhere.

## Pytest — 4/4 PASSED (plus 6/6 on `.132bg` still passing)

`/app/backend/tests/test_v58_13_132bh_admin_rename.py`:

| Test | What it asserts |
|---|---|
| `test_system_roles_constant_names_admin_as_admin` | Python constant `SYSTEM_ROLES[admin].name == "Admin"` |
| `test_db_admin_role_display_name_is_admin` | Live Mongo `db.roles.admin.name == "Admin"` |
| `test_rename_script_is_idempotent` | Re-running `--commit` prints `(no-op — already 'Admin')` and does no writes |
| `test_version_bumped_to_132bh` | Monotonic version-letter check on both `version.js` and `service-worker.js` |

```
============================== 4 passed ==============================
```

Also updated `test_v58_13_132bg_users_role_filter.py`:
* Simulation payload uses `"Admin"` (matches post-rename reality)
* Version test now uses a monotonic letter check (accepts `.132bg` or later) so subsequent bumps don't break historical tests — the previous strict-string check was an anti-pattern that failed on this ship

## Version pair bumped in lockstep

| File | Old | New |
|---|---|---|
| `frontend/src/lib/version.js#RUNNING_VERSION` | `.132bg` | `.132bh` |
| `frontend/src/lib/version.js#EXPECTED_CACHE_VERSION` | `.132bg` | `.132bh` |
| `frontend/public/service-worker.js#CACHE_VERSION` | `.132bg` | `.132bh` |

## Files touched

```
backend/roles_catalogue.py                              (SYSTEM_ROLES[admin].name → "Admin")
backend/scripts/rename_admin_role_v58_13_132bh.py       (new — idempotent script)
backend/tests/test_v58_13_132bh_admin_rename.py         (new — 4 guardrail tests)
backend/tests/test_v58_13_132bg_users_role_filter.py    (simulation payload updated; version test relaxed to monotonic-letter check)
frontend/src/lib/version.js                             (RUNNING/EXPECTED → .132bh)
frontend/public/service-worker.js                       (CACHE_VERSION → .132bh)
```

## Ship rule compliance

* e1_tester / testing_agent: **NOT USED**
* `finish` tool: **NOT INVOKED**
* Mobile / metro.config.js: **untouched**
* No mocks

Finish tool intentionally NOT invoked — awaiting Stephen's tab-reload verification.

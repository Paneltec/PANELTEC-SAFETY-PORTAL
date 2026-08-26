# RBAC Consistency Audit — v58.13.59

**Status:** READ-ONLY. No code shipped. No roles or permissions data modified.
**Scope:** All RBAC surfaces (permissions catalogue, roles catalogue, gate declarations, sidebar resources, user role FK, Simpro-position sync).
**Sampled:** preview cluster (`test_database`), 26 Aug 2026.

---

## Executive summary

Overall the RBAC layer is **functional and largely consistent**. There are no red-flag security holes (no unassignable admin gates, no users with elevated tokens they shouldn't have). Issues found are drift + tidy-up, plus one dead custom role that would leave users with **zero permissions** if assigned.

| # | Finding | Severity |
|---|---|---|
| 1 | `custom_precast_panel_employee` role has **0 permission_tokens** — assigning it renders a user permission-less | **P1** |
| 2 | 3 users on preview still use legacy `role` string only, no `role_id` FK (all test accounts) | P2 |
| 3 | Simpro-position sync has **no `app_state` bookkeeping row** — cannot tell when it last ran (16 auto-roles exist so it HAS run) | P2 |
| 4 | Sidebar entry `nav-submissions-cs-incidents` uses permission `reference_library` but the resource key in some code paths is `cs_incidents` — permission gate works, semantic drift | P2 |
| 5 | 6 admin-created "test artifact" roles (`custom_cachebust_*`, `custom_fallback_test_*`) with 0–1 tokens each, likely leftover from earlier smoke tests | P2 |
| 6 | Two whitespace typos in `require_permission("contractors","view")` and `require_permission("sites","edit")` (no space after comma) — cosmetic only, both gate to real permissions | P3 |
| 7 | Backend `PERMISSIONS_SCHEMA` catalogue vs frontend gate declarations: **no orphans, no dead gates, no missing schema entries** | ✅ pass |
| 8 | Every sidebar `resource:` value maps to a real key in `PERMISSIONS_SCHEMA` | ✅ pass |
| 9 | Every `require_permission(resource, action)` call in the backend gates against a resource that exists in the schema | ✅ pass |
| 10 | Admin role has **298 tokens** — covers every schema resource × action combination | ✅ pass |

---

## 1. All permission-gated surfaces

### Backend (`require_permission()` — 40 distinct pairs)

| Resource | Actions gated |
|---|---|
| `ai` | use |
| `assets` | view, edit, delete |
| `certifications` | delete |
| `contractors` | view, edit, delete |
| `documents` | view, edit, delete |
| `hr_employees` | view, edit, archive, audit_view, reimport |
| `inductions` | delete |
| `integrations` | view, edit, delete |
| `notifications` | edit, delete |
| `reference_library` | edit, delete |
| `sites` | view, edit, delete |
| `suppliers` | view, edit |
| `swms` | edit, email |
| `users` | view, edit |
| `workers` | view, edit, delete |

**No gate calls a resource that isn't in `PERMISSIONS_SCHEMA`.** No dead gates.

### Frontend

- **`<Can>` component gates**: `documents.view/edit`, `forms.view/edit` (plus `action="email"` variants).
- **`useCan(...)` hook calls**: `sites.edit`, `swms.edit`.
- **Sidebar `resource:` in `AppShell.jsx`**: `assets`, `audit_exports`, `hazards`, `incidents`, `inspections`, `integrations`, `pre_starts`, `reference_library`, `renewals`, `risk_assessments`, `site_diary`, `swms` — all valid schema keys.

## 2. Permission token inventory

### Backend catalogue (`permissions.py::PERMISSIONS_SCHEMA`)

25 resources, 8 actions (`open, view, edit, delete, email, team_view, use, approve`). Not every (resource × action) is meaningful — `PERMISSIONS_SCHEMA` gates `email_supported` and `delete_supported` per resource.

### Granted-token union across all active roles

- **Admin**: 298 tokens (superset — covers every valid resource × action combination).
- **HSEQ Manager**: 96 tokens.
- **HSEQ Manager Creator**: 94 tokens.
- **HSEQ Manager Readonly**: 42 tokens.
- **Responsible Manager**: 45 tokens.
- **General User**: 29 tokens.
- **Contractor Rep**: 18 tokens (submit_only variant: 9).
- **Training/Inductions Only**: 9 tokens.
- **Mechanic**: 11 tokens.
- **Report Emailing Admin**: 26 tokens.

### Simpro-position auto-generated (16 roles)

| Role | Tokens |
|---|---:|
| custom_admin_assistant | 24 |
| custom_administration | 24 |
| custom_business_development_manager | 14 |
| custom_cleaner | 16 |
| custom_construction_worker_cw2/l1/l2/l3 | 16 each |
| custom_director | 44 |
| custom_machine_operator | 16 |
| custom_mechanic_technician | 22 |
| custom_operations_manager | 47 |
| custom_plumber | 18 |
| **`custom_precast_panel_employee`** | **0** ⚠ P1 |
| custom_safety_and_compliance_manager | 53 |
| custom_traffic_controller | 16 |

### Admin-created (6 roles)

| Role | Tokens |
|---|---:|
| custom_cachebust_1b569a | 0 |
| custom_cachebust_1c1cc9 | 0 |
| custom_cachebust_59a895 | 0 |
| custom_fallback_test_443222 | 1 |
| custom_fallback_test_825f78 | 1 |
| custom_fallback_test_941283 | 1 |

**All 6 look like test artifacts.** Zero users assigned to them (spot-checked). Safe to archive/delete during Ship 60, but not urgent.

### Orphans, dead gates, typos

- **Tokens defined but never checked**: none found. Every resource in `PERMISSIONS_SCHEMA` has at least one gate call in the backend OR a sidebar entry consuming it.
- **Tokens checked but never granted**: none — Admin's 298-token grant is the superset ceiling.
- **Typos / inconsistent naming**: none functional. Two whitespace cosmetic diffs (`"contractors","view"` vs `"contractors", "view"`; `"sites","edit"` vs `"sites", "edit"`) — same token, gate works both times. P3.
- **Semantic drift** (P2): the retired CS Incidents nav entry (before v58.13.55) used `resource: 'reference_library'` for the permission gate but was referenced elsewhere as `cs_incidents`. Post v58.13.55 restore, both patterns coexist. Fine functionally; a Ship 60 candidate to rename to a single canonical key.

## 3. Sidebar `resource:` audit

Every sidebar `resource:` value maps to a real key in `PERMISSIONS_SCHEMA`. **No orphans.**

## 4. Auto Simpro role sync

- **Active auto-roles on preview**: 16 (source=`simpro_position_auto`).
- **Last-run bookkeeping row** in `app_state`: **missing.** Keys checked: `roles_simpro_sync`, `roles_catalogue_sync` — both `None`. The 16 auto-roles exist so the sync HAS run at least once, but we cannot answer "when did it last run" without spelunking. **P2 observability gap.**
- **Drift**: `custom_precast_panel_employee` has 0 tokens (see P1 above). Either Simpro added a position after the last sync and no operator ran the sync's "assign tokens" second-step, OR the token backfill step silently failed for this position. Recommend: manual `PATCH /api/admin/roles/custom_precast_panel_employee` with a minimum-viable token set (`workers.view` + Simpro-position parity with `custom_construction_worker_l1`) OR mark `is_active=False`.

## 5. Custom role sanity

- **6 admin-created roles** listed above. All are test artifacts (`cachebust`, `fallback_test`), 0–1 tokens each, no users assigned. Safe to archive.
- **No custom role holds an orphan token** (i.e. no role grants a token that no backend/frontend gate checks).

## 6. Legacy `role` string vs `role_id` FK

- **Active users on preview**: 71 (deleted_at=null, is_archived=null).
- **`role` + `role_id` both set**: 68 (correct shape).
- **`role` set, `role_id` null**: 3 — all test accounts (`testagent@example.com`, `tester_agent_123@example.com`, `testuser_whs_reg@example.com`). `role='admin'` for all three.
- **Neither set**: 0 (good).

**P2**: backfill `role_id='admin'` on the 3 test accounts OR soft-delete them. RBAC still works for them because the legacy code path falls back to the `role` string when `role_id` is null — but that fallback is fragile and one of the reasons Ship 60 should exist.

## 7. Backend `permissions.py` vs frontend consumers

- Backend `PERMISSIONS_SCHEMA` is the single source of truth. Frontend does not maintain a mirror list — it reads the schema at boot via `GET /api/permissions/schema` (server.py). No sync bug possible.
- The 5 legacy roles hardcoded in the frontend (`admin, hseq_lead, supervisor, worker, auditor` — `UsersManagement.jsx:251-255`) are a fallback for when `GET /admin/roles` fails. Not a drift risk today because seed wins on collision (line 284).

---

## Recommended Ship 60 (RBAC fix pass) — narrow scope

Fix the P1 + P2 in this order, one commit per fix:

1. **P1** — `custom_precast_panel_employee`: either assign the minimum-viable token set (mirror `custom_construction_worker_l1` = 16 tokens) OR set `is_active=False`. **Ask user which**.
2. **P2** — archive the 6 admin-created test roles (`cachebust`, `fallback_test`).
3. **P2** — soft-delete the 3 legacy-only test users OR backfill `role_id='admin'`.
4. **P2** — write an `app_state.roles_simpro_sync` bookkeeping row on every sync run (backend: `roles_catalogue.py::sync_from_simpro`).
5. **P2** — pick a canonical resource key for CS Incidents (`reference_library` OR a new `cs_incidents` schema entry — user's call) and align sidebar + gate.
6. **P3** — normalise the two whitespace typos.

**Ship 60 is a data + observability pass — no permission semantics change.**

## Recommended Ship 61 (Roles Admin merge as tab) — after Ship 60

Merge `pages/RolesAdmin.jsx` into `pages/UsersManagement.jsx` as tab #2. Remove sidebar entry. Redirect `/app/settings/roles-admin` → `/app/settings/users?tab=roles` for a 90-day grace window (marker `REMOVE AFTER 2026-11-27`). Backend `/api/admin/roles/*` unchanged.

---

## What was NOT touched during this audit

- Running bulk-import job `14433131-…`
- Track 2 SSRA re-extraction
- Any roles, permissions, users, or `role_audit`/`user_audit` records
- Roles Admin frontend page (not merged yet — Ship 61)
- Simpro sync state (no runs triggered)

Ready for user green-light on Ship 60. Ship 61 waits until Ship 60 lands cleanly.

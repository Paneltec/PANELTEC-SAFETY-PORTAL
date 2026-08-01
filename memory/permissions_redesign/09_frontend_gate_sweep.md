# Frontend Gate Sweep — Phase 3c, Step 1

**Version target:** v160.3.9.29 (not bumped yet — bump lands in Step 2)
**Date:** 2026-02
**Author:** E1 (discovery only, no source edits)
**Related docs:** `07_phase_plan.md`, `08_phase3b_notes.md`

---

## 0. Prerequisites (already in place — verified)

| Prereq | Location | Notes |
|---|---|---|
| `useCan(resource, action)` hook | `frontend/src/lib/permissions.js:14` | Reads `effective_permissions` from context; returns `(resource, action) => bool`. |
| `usePermissions()` hook | `frontend/src/lib/permissions.js:10` | Exposes `{ effective, role }`. |
| `<Can resource action fallback>` guard component | `frontend/src/lib/permissions.js:19` | Convenience wrapper. |
| `effective_permissions` on the user payload | `backend/auth.py:255`, `backend/users.py:151` | Returned by `GET /api/auth/me`; keyed `{resource: {action: bool}}`. |
| `RESOURCE_LABELS`, `ACTIONS` | `frontend/src/lib/permissions.js:24,61` | Canonical resource + 6-action list (`open, view, edit, delete, email, team_view`). |

**No new endpoint or hook is required for Step 2.** The mapping table below uses the existing `useCan(resource, action)` shape.

---

## 1. Summary counts

| Metric | Count |
|---|---:|
| Distinct source files with hardcoded role gates | **39** |
| Distinct **gate sites** (individual role-check lines that must change) | **77** |
| Files at threshold breach (>25 files) | ✅ YES — **triggers STOP-AND-REPORT** |
| Sites at threshold breach (>50 sites) | ✅ YES — **triggers STOP-AND-REPORT** |
| Files already migrated to `useCan(...)` | 3 (`UsersManagement.jsx`, `PermissionPresetsAdmin.jsx`, `PlantVehicles.jsx`) |

### Gate-pattern breakdown

| Pattern class | Files | Sites | Example |
|---|---:|---:|---|
| Inline `role === 'admin'` / `!== 'admin'` | 18 | 27 | `LiveCountersPanel.jsx:383` |
| `role === 'admin' \|\| role === 'manager'` | 3 | 5 | `AssetDrawer.jsx:22`, `FormAssignmentsAdmin.jsx:49` |
| Named `WRITE_ROLES` / `EDIT_ROLES` / `IMPORT_ROLES` / `DELETE_FOLDER_ROLES` / `ELEVATED_ROLES` sets | 16 | 21 | `Workers.jsx:44` |
| Inline `['admin','hseq_lead'].includes(user.role)` | 10 | 14 | `CompaniesTab.jsx:162` |
| Registry `adminOnly: true` flags | 2 | 10 | `settingsNavRegistry.js:36-45` |

### Coverage of Phase 1 resource taxonomy

Every one of the 18 resources in `RESOURCE_LABELS` is touched by at least one gate site except:
- `renewals` — actually covered indirectly via `Renewals.jsx` (WRITE_ROLES + IMPORT_ROLES). ✅
- `audit_exports` — covered by `AuditExports.jsx:137`. ✅
- `integrations` — **NOT** guarded on the frontend today (only backend guards exist). No sites found — flagged as a P2 follow-up.

---

## 2. Full gate table — grouped by file

Legend for **Proposed token**:
- `useCan(<resource>, <action>)` — call the existing hook.
- `<Can resource action fallback>` — component wrapper (preferred inside JSX where no additional logic depends on the bool).
- `permissions.effective[<resource>].<action>` — direct read (used for `disabled=` on inputs where the hook wrapper would re-render too often).

Legend for **Risk notes**:
- 🔴 **HIGH** — breaks a role we *want* to have write access under the new model (e.g., `hseq_lead` blocked from a page they should own; `manager` cut off from an approval path).
- 🟠 **MED** — a gate that today only lets admin through, but Phase 4 personas (`hseq_manager_readonly`, `contractor_rep`) will need at least `view`.
- 🟡 **LOW** — cosmetic / already covered by an equivalent gate one level up.

### 2.1 pages/ (24 files, 47 sites)

#### `pages/SystemSettings.jsx`
| file:line | snippet | current_gate | proposed_token | risk_notes |
|---|---|---|---|---|
| 37 | `const canInstall = me?.role === 'admin';` | `role === 'admin'` | `useCan('integrations', 'edit')` | 🟠 MED — PWA install control; should also gate on `hseq_manager` who oversees rollouts. |

#### `pages/SitesAdmin.jsx`
| file:line | snippet | current_gate | proposed_token | risk_notes |
|---|---|---|---|---|
| 46 | `const EDIT_ROLES = new Set(['admin', 'manager', 'hseq_lead']);` | named set decl | *remove decl; replace call sites* | 🟡 LOW — decl only. |
| 59 | `const canEdit = EDIT_ROLES.has(user?.role);` | set membership | `useCan('sites', 'edit')` (**new resource — see §5**) | 🔴 HIGH — `supervisor` locked out of site editing; may or may not be intended. Needs product decision. |
| 61 | `const canDelete = user?.role === 'admin';` | `role === 'admin'` | `useCan('sites', 'delete')` | 🟠 MED — matches backend. |
| 817 | `const canEdit = EDIT_ROLES.has(user?.role);` (second instance in child cmp) | set membership | `useCan('sites', 'edit')` | 🔴 HIGH — same as :59. |

#### `pages/Certifications.jsx`
| file:line | snippet | current_gate | proposed_token | risk_notes |
|---|---|---|---|---|
| 36 | `const WRITE_ROLES = new Set(['admin', 'hseq_lead']);` | named set decl | *remove decl* | 🟡 LOW. |
| 207 | `const canEdit = WRITE_ROLES.has(user?.role);` | set membership | `useCan('certifications', 'edit')` | 🟠 MED — Phase 3d `hseq_manager` needs edit; today set covers only 2 roles. |
| 208 | `const isAdmin = user?.role === 'admin';` | `role === 'admin'` | `useCan('certifications', 'delete')` (used at :811 to gate destructive action) | 🔴 HIGH — implicit *delete* gate hiding behind `isAdmin`; consumers should be split. |

#### `pages/IncidentRootCausesTab.jsx`
| file:line | snippet | current_gate | proposed_token | risk_notes |
|---|---|---|---|---|
| 229 | `const isAdmin = user && ['admin', 'hseq_lead'].includes(user.role);` | array includes | `useCan('incidents', 'edit')` | 🟠 MED — this token is currently used to show the "Import from XLSX" button and empty-state hint. Ambiguous — leans towards `edit`. |
| 230 | `const canWrite = user && user.role === 'admin';` | `role === 'admin'` | `useCan('incidents', 'edit')` (**merge with isAdmin — see §5**) | 🟠 MED — `hseq_lead` should also be able to write root-causes per role catalogue §4. |

#### `pages/FormAssignmentsAdmin.jsx`
| file:line | snippet | current_gate | proposed_token | risk_notes |
|---|---|---|---|---|
| 49 | `const canEdit = me?.role === 'admin' \|\| me?.role === 'manager';` | OR pair | `useCan('forms', 'edit')` | 🔴 HIGH — `hseq_lead` is *explicitly* blocked today; product docs say they should manage assignments. |
| 50 | `const isLockedOut = !canEdit && me?.role !== 'hseq_lead';` | negated OR | `!useCan('forms', 'view')` | 🔴 HIGH — the "read-only" fallback bakes in `hseq_lead`. New tokens replace both. |
| 500 | `... ['admin','manager','hseq_lead','foreman','operator','driver','worker'].map(...)` | literal role list | *keep as dropdown option list, but source from `/api/roles`* | 🟡 LOW — dropdown; not a gate. Flagged for Phase 4 refactor. |

#### `pages/CompaniesTab.jsx`
| file:line | snippet | current_gate | proposed_token | risk_notes |
|---|---|---|---|---|
| 162 | `const isAdmin = user && ['admin', 'hseq_lead'].includes(user.role);` | array includes | `useCan('contractors', 'edit')` (list-of-tabs resource) | 🟠 MED. |
| 163 | `const canWrite = user && user.role === 'admin';` | `role === 'admin'` | `useCan('contractors', 'edit')` (merge) | 🟠 MED — same collapse as IncidentRootCausesTab. |

#### `pages/CsIncidentTab.jsx`
| file:line | snippet | current_gate | proposed_token | risk_notes |
|---|---|---|---|---|
| 235 | `const isAdmin = user && ['admin', 'hseq_lead'].includes(user.role);` | array includes | `useCan('incidents', 'edit')` | 🟠 MED. |
| 236 | `const canWrite = user && user.role === 'admin';` | `role === 'admin'` | `useCan('incidents', 'edit')` (merge) | 🟠 MED. |

#### `pages/AuditExports.jsx`
| file:line | snippet | current_gate | proposed_token | risk_notes |
|---|---|---|---|---|
| 137 | `const isAdmin = user?.role === 'admin';` | `role === 'admin'` | `useCan('audit_exports', 'edit')` | 🟠 MED — used at :99 to skip effects and at :115 to disable the "generate missing PDF" button. Might need `email` action for the outbox send flow. |

#### `pages/CompletedTrainingTab.jsx`
| file:line | snippet | current_gate | proposed_token | risk_notes |
|---|---|---|---|---|
| 189 | `const isAdmin = user && ['admin', 'hseq_lead'].includes(user.role);` | array includes | `useCan('inductions', 'edit')` | 🟠 MED. |
| 190 | `const canWrite = user && user.role === 'admin';` | `role === 'admin'` | `useCan('inductions', 'edit')` (merge) | 🟠 MED. |

#### `pages/ListRolesTab.jsx`
| file:line | snippet | current_gate | proposed_token | risk_notes |
|---|---|---|---|---|
| 190 | `const isAdmin = user && ['admin', 'hseq_lead'].includes(user.role);` | array includes | `useCan('users', 'edit')` | 🟠 MED — this is the *reference-list roles*, not RBAC roles. Cataloguing them is a `users`/settings write. |
| 191 | `const canWrite = user && user.role === 'admin';` | `role === 'admin'` | `useCan('users', 'edit')` (merge) | 🟠 MED. |

#### `pages/ListFormsTab.jsx`
| file:line | snippet | current_gate | proposed_token | risk_notes |
|---|---|---|---|---|
| 252 | `const isAdmin = user && ['admin', 'hseq_lead'].includes(user.role);` | array includes | `useCan('forms', 'edit')` | 🟠 MED. |
| 254 | `const canWrite = user && user.role === 'admin';` | `role === 'admin'` | `useCan('forms', 'edit')` (merge) | 🟠 MED. |

#### `pages/Swms.jsx`
| file:line | snippet | current_gate | proposed_token | risk_notes |
|---|---|---|---|---|
| 33 | `const isAdmin = user?.role === 'admin';` | `role === 'admin'` | `useCan('swms', 'delete')` | 🔴 HIGH — used to gate the *bin/recycle* view. `hseq_lead` should also be able to view the bin per Phase 1 §4 catalogue. |

#### `pages/OrgSettings.jsx`
| file:line | snippet | current_gate | proposed_token | risk_notes |
|---|---|---|---|---|
| 39 | `const isAdmin = me?.role === 'admin';` | `role === 'admin'` | `useCan('users', 'edit')` (org == users/settings write) | 🟠 MED — disables 5 form inputs; fine to keep admin-only for now but should surface to `hseq_manager` in Phase 4. |

#### `pages/MasterRisksTab.jsx`
| file:line | snippet | current_gate | proposed_token | risk_notes |
|---|---|---|---|---|
| 305 | `const isAdmin = user && user.role === 'admin';` | `role === 'admin'` | `useCan('swms', 'edit')` (master-risks feed SWMS lib) | 🟠 MED — `hseq_lead` per catalogue owns the master-risks library. |

#### `pages/Workspaces.jsx`
| file:line | snippet | current_gate | proposed_token | risk_notes |
|---|---|---|---|---|
| 29 | `const isAdmin = me?.role === 'admin';` | `role === 'admin'` | `useCan('users', 'edit')` (workspace mgmt lives under Users & Permissions) | 🟠 MED. |
| 43 | `isAdmin ? api.get('/users')…` | short-circuit fetch | *keep — driven by the isAdmin from :29* | 🟡 LOW (side-effect of the same gate). |

#### `pages/DocumentLibrary.jsx`
| file:line | snippet | current_gate | proposed_token | risk_notes |
|---|---|---|---|---|
| 39 | `const WRITE_ROLES = new Set(['admin', 'hseq_lead']);` | named set decl | *remove* | 🟡 LOW. |
| 40 | `const DELETE_FOLDER_ROLES = new Set(['admin']);` | named set decl (unused after refactor) | *remove* | 🟡 LOW — appears declared but only reused via WRITE_ROLES check; audit. |
| 158, 598 | `const canEdit = WRITE_ROLES.has(user?.role);` (2 sites, root + subfolder cmp) | set membership | `useCan('documents', 'edit')` | 🟠 MED. |

#### `pages/Ask.jsx`
| file:line | snippet | current_gate | proposed_token | risk_notes |
|---|---|---|---|---|
| 9 | `const WRITE_ROLES = new Set(['admin', 'hseq_lead']);` | named set decl | *remove* | 🟡 LOW. |
| 139 | `const canEdit = WRITE_ROLES.has(user?.role);` | set membership | *no `ask` resource exists* — see §5, propose new `useCan('ask', 'edit')` or piggyback on `users` | 🟠 MED — Suggested questions curation. Ambiguous ownership. |

#### `pages/Forms.jsx`
| file:line | snippet | current_gate | proposed_token | risk_notes |
|---|---|---|---|---|
| 24 | `const WRITE_ROLES = new Set(['admin', 'hseq_lead']);` | named set decl | *remove* | 🟡 LOW. |
| 1118 | `const canEdit = WRITE_ROLES.has(user?.role);` | set membership | `useCan('forms', 'edit')` | 🟠 MED. |
| 1137 | `const isWorker = role && !['admin', 'manager', 'hseq_lead'].includes(role);` | negated array includes | replace with a positive `useCan('forms', 'view')` OR keep the boolean but reimplement as `!useCan('forms', 'edit')` | 🔴 HIGH — controls whether the AI-Builder shortcut is shown. Also gates onboarding autoload; needs product decision. |

#### `pages/Workers.jsx`
| file:line | snippet | current_gate | proposed_token | risk_notes |
|---|---|---|---|---|
| 44 | `const WRITE_ROLES = new Set(['admin', 'hseq_lead']);` | named set decl | *remove* | 🟡 LOW. |
| 1370 | `const canEdit = WRITE_ROLES.has(user?.role);` | set membership | `useCan('workers', 'edit')` | 🟠 MED — `hr_lead` may need edit access per Phase 4 catalogue (they own HR-worker facing data). |

#### `pages/Suppliers.jsx`
| file:line | snippet | current_gate | proposed_token | risk_notes |
|---|---|---|---|---|
| 24 | `const WRITE_ROLES = new Set(['admin', 'hseq_lead']);` | named set decl | *remove* | 🟡 LOW. |
| 243 | `const canEdit = WRITE_ROLES.has(user?.role);` | set membership | `useCan('contractors', 'edit')` (suppliers === contractors resource) | 🟠 MED. |

#### `pages/FormSubmissions.jsx`
| file:line | snippet | current_gate | proposed_token | risk_notes |
|---|---|---|---|---|
| 23 | `const WRITE_ROLES = new Set(['admin', 'hseq_lead']);` | named set decl | *remove* | 🟡 LOW. |
| 48 | `const canDelete = WRITE_ROLES.has(user?.role);` | set membership | `useCan('forms', 'delete')` | 🟠 MED. |

#### `pages/SwmsAssignmentsAdmin.jsx`
| file:line | snippet | current_gate | proposed_token | risk_notes |
|---|---|---|---|---|
| 50 | `const EDIT_ROLES = new Set(['admin', 'manager', 'hseq_lead']);` | named set decl | *remove* | 🟡 LOW. |
| 54 | `const canEdit = EDIT_ROLES.has(user?.role);` | set membership | `useCan('swms', 'edit')` | 🟠 MED. |

#### `pages/Renewals.jsx`
| file:line | snippet | current_gate | proposed_token | risk_notes |
|---|---|---|---|---|
| 35 | `const WRITE_ROLES = new Set(['admin', 'hseq_lead', 'manager']);` | named set decl | *remove* | 🟡 LOW. |
| 36 | `const IMPORT_ROLES = new Set(['admin', 'manager']);` | named set decl | *remove* | 🟡 LOW. |
| 69 | `const canEdit = WRITE_ROLES.has(user?.role);` | set membership | `useCan('renewals', 'edit')` | 🟠 MED. |
| — | (IMPORT_ROLES appears declared; grep didn't return a consumer — audit at Step 2) | dead code? | *remove if unused* | 🟡 LOW. |

#### `pages/PlantMaintenanceTab.jsx`
| file:line | snippet | current_gate | proposed_token | risk_notes |
|---|---|---|---|---|
| 46 | `const isAdmin = user && ['admin', 'hseq_lead'].includes(user.role);` | array includes | `useCan('assets', 'edit')` | 🟠 MED. |

#### `pages/SiteScanResolver.jsx`
| file:line | snippet | current_gate | proposed_token | risk_notes |
|---|---|---|---|---|
| 20 | `const ELEVATED_ROLES = new Set(['admin', 'manager', 'hseq_lead', 'supervisor']);` | named set decl | *remove* | 🟡 LOW. |
| — | (need to find consumer — grep already surfaced the decl; audit consumer at Step 2) | | `useCan('workers', 'edit')` (site check-in override) | 🟠 MED. |

#### `pages/UsersManagement.jsx` — *partially migrated*
| file:line | snippet | current_gate | proposed_token | risk_notes |
|---|---|---|---|---|
| 41 | `const ROLES = ['admin', 'hseq_lead', 'supervisor', 'worker', 'auditor'];` | static dropdown list | *replace with `/api/roles` fetch* | 🔴 HIGH — misses the 6+ new Phase 2 seeded roles (`hseq_manager`, `hseq_manager_readonly`, `hr_lead`, `contractor_rep`, `contractor_rep_submit_only`, `foreman`). |
| 197 | `u.role === filters.role` | dynamic comparison | *keep — this is a filter, not a gate* | 🟡 LOW. |
| 420 | `<AccessKebab userId={u.id} canEdit={u.id !== me?.id} …/>` | self-guard | *keep* | 🟡 LOW. |
| 493 | `<UserDrawer … canEdit={can('users', 'edit')} …/>` | ✅ already migrated | *no change* | ✅. |
| 999 | `useState({ email: '', name: '', role: 'worker', … })` | default role literal | *keep — form default* | 🟡 LOW. |

### 2.2 components/ (14 files, 24 sites)

#### `components/LiveCountersPanel.jsx`
| file:line | snippet | current_gate | proposed_token | risk_notes |
|---|---|---|---|---|
| 383 | `const canEdit = user?.role === 'admin';` | `role === 'admin'` | `useCan('assets', 'edit')` | 🟠 MED — vehicles/plant panel; matches backend guard. |
| 453 | `const canRefresh = user?.role === 'admin';` | `role === 'admin'` | `useCan('integrations', 'edit')` | 🟠 MED — Navixy refresh; matches backend guard. |
| 454 | `const canEdit = user?.role === 'admin';` | `role === 'admin'` | `useCan('vehicles', 'edit')` | 🟠 MED. |
| 662 | `const canEdit = user?.role === 'admin';` | `role === 'admin'` | `useCan('vehicles', 'edit')` | 🟠 MED. |

#### `components/InductionsMatrix.jsx`
| file:line | snippet | current_gate | proposed_token | risk_notes |
|---|---|---|---|---|
| 35 | `const WRITE_ROLES = new Set(['admin', 'manager', 'hseq_lead']);` | named set decl | *remove* | 🟡 LOW. |
| 74 | `const canEdit = WRITE_ROLES.has(user?.role);` | set membership | `useCan('inductions', 'edit')` | 🟠 MED. |

#### `components/SubmissionViewer.jsx`
| file:line | snippet | current_gate | proposed_token | risk_notes |
|---|---|---|---|---|
| 21 | `const WRITE_ROLES = new Set(['admin', 'manager', 'hseq_lead']);` | named set decl | *remove* | 🟡 LOW. |
| 120 | `const canEdit = WRITE_ROLES.has(me?.role);` | set membership | `useCan('forms', 'edit')` | 🟠 MED. |

#### `components/InductionCardModal.jsx`
| file:line | snippet | current_gate | proposed_token | risk_notes |
|---|---|---|---|---|
| 20 | `const WRITE_ROLES = new Set(['admin', 'manager', 'hseq_lead']);` | named set decl | *remove* | 🟡 LOW. |
| 47 | `const canWrite = WRITE_ROLES.has(user?.role);` | set membership | `useCan('inductions', 'edit')` | 🟠 MED. |
| 48 | `const canDelete = user?.role === 'admin';` | `role === 'admin'` | `useCan('inductions', 'delete')` | 🟠 MED. |

#### `components/AssetDrawer.jsx`
| file:line | snippet | current_gate | proposed_token | risk_notes |
|---|---|---|---|---|
| 22 | `const canManage = me?.role === 'admin' \|\| me?.role === 'manager';` | OR pair | `useCan('assets', 'edit')` | 🔴 HIGH — `hseq_lead` blocked from asset service history today; product docs put them on plant/equipment. |

#### `components/SimproSupplierImportModal.jsx`
| file:line | snippet | current_gate | proposed_token | risk_notes |
|---|---|---|---|---|
| 14 | `const WRITE_ROLES = new Set(['admin', 'manager']);` | named set decl | *remove* | 🟡 LOW. |
| 20 | `const canImport = WRITE_ROLES.has(user?.role);` | set membership | `useCan('integrations', 'edit')` | 🟠 MED. |
| 58 | `if (user?.role !== 'admin') { … }` | negated equality | `if (!useCan('integrations', 'edit')) …` | 🟠 MED — inconsistent with the `WRITE_ROLES` above; `manager` today can *see* the button but is blocked at the confirm step. Bug! |
| 110 | `disabled={refreshing \|\| user?.role !== 'admin'}` | negated equality | `disabled={refreshing \|\| !useCan('integrations', 'edit')}` | 🟠 MED — same. |
| 112 | `title={user?.role !== 'admin' ? 'Admin only' : …}` | negated equality | *token-driven title* | 🟡 LOW — cosmetic. |

#### `components/simpro/SimproZipImportGuide.jsx`
| file:line | snippet | current_gate | proposed_token | risk_notes |
|---|---|---|---|---|
| 274 | `const isAdmin = currentUser?.role === 'admin';` | `role === 'admin'` | `useCan('integrations', 'edit')` | 🟠 MED. |

#### `components/suppliers/SupplierDrawer.jsx`
| file:line | snippet | current_gate | proposed_token | risk_notes |
|---|---|---|---|---|
| 16 | `const WRITE_ROLES = new Set(['admin', 'hseq_lead']);` | named set decl | *remove* | 🟡 LOW. |
| 439 | `const canEdit = WRITE_ROLES.has(user?.role);` | set membership | `useCan('contractors', 'edit')` | 🟠 MED. |

#### `components/settings/MobileModulesSection.jsx`
| file:line | snippet | current_gate | proposed_token | risk_notes |
|---|---|---|---|---|
| 280 | `if (role === 'admin') return;` | `role === 'admin'` | *keep — this is the **row lock** guard inside a role-editor UI; admin role row is intentionally locked. Not a gate.* | 🟡 LOW — false-positive, keep as literal `'admin'` (row identifier, not a user gate). |
| 286 | `if (role === 'admin' \|\| !canEdit) return;` | mixed | *keep the `'admin'` literal; migrate the `canEdit` prop chain* | 🟡 LOW — same. |
| 413, 447 | `r.key !== 'admin'` / `r.key === 'admin'` | data identifier | *keep — row key literal* | 🟡 LOW. |

#### `components/settings/SettingsNav.jsx`
| file:line | snippet | current_gate | proposed_token | risk_notes |
|---|---|---|---|---|
| 99, 274, 279, 335, 375, etc. | uses `isAdmin` prop for admin-only settings items + reorder-DnD lock | prop-driven | *swap consumer at `AppShell.jsx:463` (see below) — no local change needed here besides accepting a wider `canAdminSettings` bool* | 🟠 MED — the *reorder/DnD* is admin-only today. Under new model that's `useCan('users', 'edit')`. |

#### `components/layout/TopbarPills.jsx`
| file:line | snippet | current_gate | proposed_token | risk_notes |
|---|---|---|---|---|
| 389 | `{(user?.role === 'admin') && (…)}` | `role === 'admin'` | `<Can resource="users" action="edit">…</Can>` | 🟠 MED — used to show a topbar admin-only pill (need to view file to confirm what it wraps). |

#### `components/layout/AppShell.jsx`
| file:line | snippet | current_gate | proposed_token | risk_notes |
|---|---|---|---|---|
| 83, 91, 96–106 | Registry entries with `adminOnly: true` on 8 sidebar items | flag on nav registry | *replace with `requiresCan: ['users', 'edit']` (or per-item resource) — see §5* | 🔴 HIGH — sidebar filter drives navigation for every role. Wrong mapping = feature invisible. |
| 154 | `if (it.adminOnly && !isAdmin) return false;` | flag check | *rewrite to `if (it.requiresCan && !can(...it.requiresCan)) return false;`* | 🔴 HIGH. |
| 226 | `const canImport = ['admin', 'hseq_lead'].includes(...)` | array includes | `useCan('workers', 'edit')` (bulk PDF import) | 🟠 MED. |
| 463 | `const isAdmin = ['admin', 'hseq_lead'].includes(...)` | array includes | keep as *derived* from `useCan('users', 'edit')` OR split into `canSettings` / `canAdminNav` | 🔴 HIGH — this is the single global `isAdmin` fed to `<SettingsNav>` and `<SidebarNav>`. Splitting is the highest-leverage change of the whole sweep. |

#### `components/workers/WorkerViewModal.jsx`
| file:line | snippet | current_gate | proposed_token | risk_notes |
|---|---|---|---|---|
| 197 | `if (!['admin', 'hseq_lead', 'hr_lead'].includes(role)) return;` | array includes | `if (!useCan('workers', 'view')) return;` | 🟠 MED. |
| 211 | `if (!['admin', 'hr_lead'].includes(role)) { setHrDocCount(null); return; }` | array includes | `if (!useCan('documents', 'view')) …` (HR docs) | 🔴 HIGH — `hr_lead` isolation is HR-only; new model needs a `hr_docs` resource OR `documents` with scope. Needs product call. |
| 287 | `['admin','hr_lead','hseq_lead'].includes((currentUser?.role\|\|'').toLowerCase())` | array includes + lowercase | `useCan('workers', 'edit')` | 🟠 MED. |
| 303 | same as :287 | array includes | `useCan('workers', 'edit')` | 🟠 MED. |

### 2.3 lib/ (1 file, 8 sites)

#### `lib/settingsNavRegistry.js`
| file:line | snippet | current_gate | proposed_token | risk_notes |
|---|---|---|---|---|
| 36 | `users_permissions … adminOnly: true` | registry flag | replace with `requiresCan: ['users', 'edit']` | 🔴 HIGH. |
| 37 | `permission_presets … adminOnly: true` | registry flag | `requiresCan: ['users', 'edit']` | 🔴 HIGH. |
| 39 | `form_assignments … adminOnly: true` | registry flag | `requiresCan: ['forms', 'edit']` | 🟠 MED. |
| 40 | `swms_assignments … adminOnly: true` | registry flag | `requiresCan: ['swms', 'edit']` | 🟠 MED. |
| 42 | `system … adminOnly: true` | registry flag | `requiresCan: ['users', 'edit']` (temporary — new `system` resource may be needed) | 🟠 MED. |
| 44 | `backup_restore … adminOnly: true` | registry flag | `requiresCan: ['users', 'edit']` (or new `system` resource) | 🟠 MED. |
| 45 | `program_schematic … adminOnly: true` | registry flag | `requiresCan: ['users', 'edit']` (dev/admin surface) | 🟡 LOW. |

---

## 3. Propagation-only files (skip in Step 2 — they consume `canEdit` as prop)

These files use `canEdit` / `isAdmin` / `canWrite` as props received from a parent. They don't declare a role gate themselves; migrating the parent will implicitly fix them.

- `components/AssetServiceTabs.jsx` (receives `canEdit`)
- `components/settings/RoleFormsSection.jsx` (receives `canEdit`)
- `components/riskAssessments/useCrudModal.jsx` (receives `isAdmin`)
- `components/auth/AccessKebab.jsx` (receives `canEdit`)

---

## 4. Top-10 Risk Sites — what will break under `hseq_manager_readonly` / `contractor_rep` (Phase 3d & 4)

Ordered by blast radius:

| # | Site | Why it's risky | Recommended token |
|---:|---|---|---|
| 1 | `components/layout/AppShell.jsx:463` (`isAdmin = ['admin','hseq_lead']`) | Fed into `<SettingsNav>`, `<SidebarNav>`, and the mobile drawer. Every `adminOnly: true` nav item hides based on it. `hseq_manager` will lose the whole Settings tree until this is split. | Split into `canAdminNav = useCan('users','edit')` and pass down. Keep the identity `isAdmin` only where it means "literally the admin role" (very rare). |
| 2 | `lib/settingsNavRegistry.js` `adminOnly` flags (7 sites) | Same fallout as #1 — this is the source of the flag. Wrong swap = the wrong roles see admin surfaces. | `requiresCan: [resource, action]` on each entry; consumer swaps to `can(...it.requiresCan)`. |
| 3 | `pages/FormAssignmentsAdmin.jsx:49` (`admin \|\| manager`) | Blocks `hseq_lead` and `hseq_manager` from the form-assignments matrix — the very people who *own* the assignment logic. | `useCan('forms', 'edit')`. |
| 4 | `pages/SitesAdmin.jsx:59,817` (`EDIT_ROLES`) | Blocks `supervisor` and `foreman` — Phase 3d catalogue says supervisor should edit their own sites. Two duplicate declarations = double-edit hazard. | `useCan('sites', 'edit')` — needs new `sites` resource (§5). |
| 5 | `components/AssetDrawer.jsx:22` (`admin \|\| manager`) | Blocks `hseq_lead` from vehicle/asset service records. | `useCan('assets', 'edit')`. |
| 6 | `pages/Swms.jsx:33` (`admin`) — controls SWMS *bin/recycle* view | `hseq_lead` cannot restore deleted SWMS today. | `useCan('swms', 'delete')`. |
| 7 | `components/workers/WorkerViewModal.jsx:211` (`admin \|\| hr_lead`) — HR docs panel | Hard-coded HR isolation. Any new role that legitimately needs HR docs (e.g. `hseq_manager`) is silently blocked. | Requires product call → likely `useCan('documents','view')` **plus** an HR-scope filter server-side. |
| 8 | `pages/UsersManagement.jsx:41` static `ROLES` array | Doesn't include the 6 new Phase 2 seeded roles. Admin cannot *assign* them from the UI. | Replace with `/api/roles` fetch (already returns them). |
| 9 | `pages/Forms.jsx:1137` (`isWorker = !admin && !manager && !hseq_lead`) | Blocks the AI form builder shortcut for everyone else, including `hseq_manager`. Also gates the onboarding autoload. | Positive gate `useCan('forms', 'edit')`. |
| 10 | `components/SimproSupplierImportModal.jsx:20 vs 58` (inconsistent gates) | Manager sees the button (`WRITE_ROLES = admin,manager`) but is 403'd at submit (`role !== 'admin'`). Ships a broken UX today. | Collapse both to `useCan('integrations', 'edit')`. |

---

## 5. Open product decisions (blockers Step 2 will need)

Step 2 cannot ship cleanly without answers on these. Recommend a bulk decision doc.

1. **`sites` resource** — not in `RESOURCE_LABELS` today. `SitesAdmin.jsx` needs a token. Options:
   a. Add `sites` to `RESOURCE_LABELS` + seed permissions.
   b. Reuse `workers` (sites are worker-attendance surfaces).
2. **`ask` resource** — `Ask.jsx` suggested-questions curation has no natural mapping. Add or piggyback on `users`?
3. **`system` / `backup` / `schematic`** resources — currently `adminOnly` in nav registry. New model needs either (a) a `system` resource, or (b) a coarse "admin identity" boolean derived from `useCan('users','edit')`.
4. **HR docs isolation** (`WorkerViewModal.jsx:211`) — is `hr_lead` isolation baked-in forever, or does the new model use a scope filter + `documents` resource?
5. **`hseq_lead` write access** to Companies/CS Incidents/Completed Training/List Roles/List Forms — today those are *`admin`-only writes* but `hseq_lead` is on the read path (via the `isAdmin=['admin','hseq_lead']` pattern). Merging to `useCan('<res>', 'edit')` will *widen* `hseq_lead` access. Confirm this is intended.

---

## 6. Recommended sub-phasing (STOP-AND-REPORT proposal)

Because 39 files > 25 threshold, we split Step 2 into 3 sub-phases:

- **3c-Step-2a** (11 files, ~12 sites) — *AppShell + Nav registry + top-level Settings gates*:
  `AppShell.jsx`, `settingsNavRegistry.js`, `SettingsNav.jsx`, `TopbarPills.jsx`, `SystemSettings.jsx`, `OrgSettings.jsx`, `Workspaces.jsx`, `UsersManagement.jsx` (dropdown fix), `MobileModulesSection.jsx` (false-positive audit only), `AccessKebab.jsx` (prop rename), `RoleFormsSection.jsx` (prop rename).
  ⚠️ Highest-blast-radius; ships the derived-`isAdmin` split first.
- **3c-Step-2b** (13 files, ~22 sites) — *Register/tab pages that duplicate the `isAdmin=['admin','hseq_lead']` + `canWrite=admin` pair*:
  `CompaniesTab`, `CsIncidentTab`, `CompletedTrainingTab`, `ListRolesTab`, `ListFormsTab`, `IncidentRootCausesTab`, `MasterRisksTab`, `PlantMaintenanceTab`, `AuditExports`, `Swms`, `SitesAdmin`, `SwmsAssignmentsAdmin`, `FormAssignmentsAdmin`.
- **3c-Step-2c** (15 files, ~43 sites) — *Capture flows + drawers + integrations*:
  `Certifications`, `DocumentLibrary`, `Ask`, `Forms`, `Workers`, `Suppliers`, `FormSubmissions`, `Renewals`, `SiteScanResolver`, `LiveCountersPanel`, `InductionsMatrix`, `SubmissionViewer`, `InductionCardModal`, `AssetDrawer`, `SimproSupplierImportModal`, `SimproZipImportGuide`, `SupplierDrawer`, `WorkerViewModal`.

Each sub-phase would ship with its own smoke pytest + a manual UI-verify checklist for each of the 8 seeded roles.

---

## 7. Files intentionally NOT changed in Step 2

- `mobile/**` — mobile app app is on a separate rollout schedule (rule from Phase 3a close-out).
- `pages/UsersManagement.jsx:41` static `ROLES` list — Phase 4 will rework this alongside the new Roles Admin page.
- Any `role === 'admin'` literal that identifies a **row in a role-editor table** (e.g. `MobileModulesSection.jsx:280,286,413,447`) — these are data identifiers, not user gates.

---

## 8. Version bump

**No version bump this step.** `v160.3.9.29` will land at the end of the first Step-2 sub-phase (3c-Step-2a).

---

## 9. STOP AND REPORT

⛔ **Sweep found 39 files (> 25 threshold) and 77 gate sites (> 50 threshold).** Awaiting explicit user approval on:

1. §5 product decisions (5 open items).
2. §6 sub-phasing proposal (3 sub-phases 2a/2b/2c) — or alternative slicing.
3. Confirmation to proceed with sub-phase 2a first.

No React source has been edited. No backend edits. Discovery only.

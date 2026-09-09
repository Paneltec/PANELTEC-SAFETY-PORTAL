// v160.3.8.1 — Frontend mirror of `backend/settings_nav_registry.py`.
//
// Single source of truth for what each nav item RENDERS: label, route,
// icon, admin/permission gates. The backend only ever ships stable
// `key` strings; this file translates them into the actual Fluent
// icon component + route the sidebar shows.
//
// If you add a new setting page, add it BOTH here and in
// `backend/settings_nav_registry.py::SETTINGS_NAV_ITEMS`. The
// `PUT /api/settings/nav-layout` endpoint rejects unknown keys
// with 400, so any drift surfaces immediately at save time.

import {
  Building24Regular, Building24Filled,
  CubeMultiple24Regular, CubeMultiple24Filled,
  PeopleSettings24Regular, PeopleSettings24Filled,
  Trophy24Regular, Trophy24Filled,
  PersonAvailable24Regular, PersonAvailable24Filled,
  ClipboardTextLtr24Regular, ClipboardTextLtr24Filled,
  PlugConnected24Regular, PlugConnected24Filled,
  Settings24Regular, Settings24Filled,
  CloudArrowUp24Regular, CloudArrowUp24Filled,
  Diagram24Regular, Diagram24Filled,
  Mail24Regular, Mail24Filled,
  BookOpen24Regular, BookOpen24Filled,
  ShieldTask24Regular, ShieldTask24Filled,
} from '@fluentui/react-icons';

// Ordered registry — keys are stable and immutable across releases.
// v160.3.9.3 — `description` field added on every entry so the auto-
// generated Feature Index card in the User Manual renders a populated
// Settings table (previously blank because these items only lived here,
// not in `appFeatureRegistry.js`).
// v160.3.9.29-2a — `adminOnly: true` retired in favour of
// `requiresCan: [resource, action]`. Consumer (`SettingsNav.jsx`)
// gates visibility with `can(...it.requiresCan)`. Rationale in
// `/app/memory/permissions_redesign/09_frontend_gate_sweep.md` §5:
//   · users_permissions / permission_presets   → users.edit
//   · form_assignments                          → forms.edit
//   · swms_assignments                          → swms.edit
//   · system / backup_restore / program_schematic → users.edit
//     (per decision #3 — coarse "admin identity" derived from
//      users.edit rather than inventing a `system` resource).
export const SETTINGS_NAV_REGISTRY = [
  { key: 'organisation',       label: 'Organisation',        route: '/app/settings/org',                icon: Building24Regular,        iconActive: Building24Filled,        testid: 'nav-settings-org',                                                              description: 'Company profile, ABN, address, and branding' },
  // v58.13.132cb — `workspaces` entry retired (Phase A of workspaces/sites
  // merge). Saved nav-layout rows referencing "workspaces" will silently
  // filter out here (`SETTINGS_NAV_BY_KEY[key]` returns undefined →
  // `visibleAt` drops the item). No layout migration required.
  { key: 'users_permissions',  label: 'Users & Permissions', route: '/app/settings/users',              icon: PeopleSettings24Regular,  iconActive: PeopleSettings24Filled,  testid: 'nav-settings-users',              requiresCan: ['users', 'edit'],               description: 'Manage user accounts, roles, and tri-state permission matrix' },
  { key: 'permission_presets', label: 'Permission presets',  route: '/app/settings/permission-presets', icon: Trophy24Regular,          iconActive: Trophy24Filled,          testid: 'nav-settings-permission-presets', requiresCan: ['users', 'edit'],               description: 'Reusable permission templates for common roles' },
  // v160.3.9.31-4a — Phase 4a: Roles Admin (system-role viewer + custom-role editor).
  // v58.13.61 — Roles Admin sidebar entry retired. Roles now live as
  // a tab under `Users & Permissions` (see App.js `UsersAndRolesShell`).
  // Route `/app/settings/roles-admin` redirects to
  // `/app/settings/users?tab=roles` for a 90-day grace window
  // (REMOVE AFTER 2026-11-27).
  { key: 'workers',            label: 'Workers',             route: '/app/settings/workers',            icon: PersonAvailable24Regular, iconActive: PersonAvailable24Filled, testid: 'nav-settings-workers',                                                          description: 'Worker directory settings — inductions, roles, statuses' },
  // v58.13.57 — HR Employees settings entry retired. The 4 HR flags
  // (Employee ID, Hired, Working Visa, Do Not Rehire) now live on
  // each Worker record (see v58.13.56 for the merge). Backend
  // `/api/hr/employees` list + get endpoints stay live in read-only
  // shape for a 90-day grace window. REMOVE AFTER 2026-11-25.
  { key: 'form_assignments',   label: 'Form Assignments',    route: '/app/settings/form-assignments',   icon: ClipboardTextLtr24Regular, iconActive: ClipboardTextLtr24Filled, testid: 'nav-settings-form-assignments',  requiresCan: ['forms', 'edit'],               description: 'Assign capture forms to workers or roles' },
  { key: 'swms_assignments',   label: 'SWMS Assignments',    route: '/app/settings/swms-assignments',   icon: ClipboardTextLtr24Regular, iconActive: ClipboardTextLtr24Filled, testid: 'nav-settings-swms-assignments',  requiresCan: ['swms', 'edit'],                description: 'Assign SWMS templates to sites, activities, or workers' },
  { key: 'integrations',       label: 'Integrations',        route: '/app/settings/integrations',       icon: PlugConnected24Regular,   iconActive: PlugConnected24Filled,   testid: 'nav-settings-integrations',       resource: 'integrations',                     description: 'Simpro, Navixy, Microsoft 365, and Emergent LLM connections' },
  { key: 'system',             label: 'System',              route: '/app/settings/system',             icon: Settings24Regular,        iconActive: Settings24Filled,        testid: 'nav-settings-system',             requiresCan: ['users', 'edit'],               description: 'System configuration, feature flags, version info' },
  { key: 'certifications',     label: 'Certifications',      route: '/app/settings/certifications',     icon: Trophy24Regular,          iconActive: Trophy24Filled,          testid: 'nav-settings-certifications',                                                   badgeKey: 'certExpiry',                       description: 'Certification matrix, columns, and Simpro sync rules' },
  { key: 'backup_restore',     label: 'Backup & Restore',    route: '/app/settings/backup',             icon: CloudArrowUp24Regular,    iconActive: CloudArrowUp24Filled,    testid: 'nav-settings-backup',             requiresCan: ['users', 'edit'],               description: 'Local + NAS backup schedule and restore controls' },
  { key: 'program_schematic',  label: 'Program Schematic',   route: '/app/settings/schematic',          icon: Diagram24Regular,         iconActive: Diagram24Filled,         testid: 'nav-settings-schematic',          requiresCan: ['users', 'edit'],               description: 'Interactive data-flow map of the whole platform' },
  { key: 'email_outbox',       label: 'Email outbox',        route: '/app/outbox',                      icon: Mail24Regular,            iconActive: Mail24Filled,            testid: 'nav-outbox',                                                                    description: 'Outbound email queue, status, and retries' },
  { key: 'user_manual',        label: 'User Manual',         route: '/app/help',                        icon: BookOpen24Regular,        iconActive: BookOpen24Filled,        testid: 'nav-help',                                                                      description: 'This manual' },
];

export const SETTINGS_NAV_BY_KEY = Object.fromEntries(
  SETTINGS_NAV_REGISTRY.map((it) => [it.key, it]),
);

// v160.3.8.1 — Fresh-org seed. Mirrors `default_layout()` in the
// backend registry — if you change one, change both. The Admin folder
// gathers the highest-privilege surfaces so an admin can collapse them
// out of the way after first setup.
export function defaultSettingsLayout() {
  const adminKeys = new Set(['users_permissions', 'backup_restore', 'program_schematic']);
  const root = [];
  for (const it of SETTINGS_NAV_REGISTRY) {
    if (adminKeys.has(it.key)) continue;
    root.push({ type: 'item', key: it.key });
  }
  const admin = {
    type: 'folder', id: 'folder_admin', label: 'Admin',
    children: [
      { type: 'item', key: 'users_permissions' },
      { type: 'item', key: 'backup_restore' },
      { type: 'item', key: 'program_schematic' },
    ],
  };
  root.splice(2, 0, admin);
  return root;
}

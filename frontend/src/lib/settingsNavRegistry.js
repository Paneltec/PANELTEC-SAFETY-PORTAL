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
} from '@fluentui/react-icons';

// Ordered registry — keys are stable and immutable across releases.
export const SETTINGS_NAV_REGISTRY = [
  { key: 'organisation',       label: 'Organisation',        route: '/app/settings/org',                icon: Building24Regular,        iconActive: Building24Filled,        testid: 'nav-settings-org' },
  { key: 'workspaces',         label: 'Workspaces',          route: '/app/settings/workspaces',         icon: CubeMultiple24Regular,    iconActive: CubeMultiple24Filled,    testid: 'nav-settings-workspaces' },
  { key: 'users_permissions',  label: 'Users & Permissions', route: '/app/settings/users',              icon: PeopleSettings24Regular,  iconActive: PeopleSettings24Filled,  testid: 'nav-settings-users',              adminOnly: true },
  { key: 'permission_presets', label: 'Permission presets',  route: '/app/settings/permission-presets', icon: Trophy24Regular,          iconActive: Trophy24Filled,          testid: 'nav-settings-permission-presets', adminOnly: true },
  { key: 'workers',            label: 'Workers',             route: '/app/settings/workers',            icon: PersonAvailable24Regular, iconActive: PersonAvailable24Filled, testid: 'nav-settings-workers' },
  { key: 'form_assignments',   label: 'Form Assignments',    route: '/app/settings/form-assignments',   icon: ClipboardTextLtr24Regular, iconActive: ClipboardTextLtr24Filled, testid: 'nav-settings-form-assignments',  adminOnly: true },
  { key: 'swms_assignments',   label: 'SWMS Assignments',    route: '/app/settings/swms-assignments',   icon: ClipboardTextLtr24Regular, iconActive: ClipboardTextLtr24Filled, testid: 'nav-settings-swms-assignments',  adminOnly: true },
  { key: 'integrations',       label: 'Integrations',        route: '/app/settings/integrations',       icon: PlugConnected24Regular,   iconActive: PlugConnected24Filled,   testid: 'nav-settings-integrations',       resource: 'integrations' },
  { key: 'system',             label: 'System',              route: '/app/settings/system',             icon: Settings24Regular,        iconActive: Settings24Filled,        testid: 'nav-settings-system',             adminOnly: true },
  { key: 'certifications',     label: 'Certifications',      route: '/app/settings/certifications',     icon: Trophy24Regular,          iconActive: Trophy24Filled,          testid: 'nav-settings-certifications' },
  { key: 'backup_restore',     label: 'Backup & Restore',    route: '/app/settings/backup',             icon: CloudArrowUp24Regular,    iconActive: CloudArrowUp24Filled,    testid: 'nav-settings-backup',             adminOnly: true },
  { key: 'program_schematic',  label: 'Program Schematic',   route: '/app/settings/schematic',          icon: Diagram24Regular,         iconActive: Diagram24Filled,         testid: 'nav-settings-schematic',          adminOnly: true },
  { key: 'email_outbox',       label: 'Email outbox',        route: '/app/outbox',                      icon: Mail24Regular,            iconActive: Mail24Filled,            testid: 'nav-outbox' },
  { key: 'user_manual',        label: 'User Manual',         route: '/app/help',                        icon: BookOpen24Regular,        iconActive: BookOpen24Filled,        testid: 'nav-help' },
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

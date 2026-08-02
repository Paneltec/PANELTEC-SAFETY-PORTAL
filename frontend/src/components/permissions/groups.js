// v160.3.9.31-4a — Phase 4a resource grouping for RoleMatrixEditor.
//
// PERMISSIONS_SCHEMA in the backend has no `group` metadata (flat dict of
// 25 resources). This file is the FE truth-source that buckets those
// resources into the sidebar-shaped folders admins already know from
// AppShell. If you add a new resource in `backend/permissions.py`, add
// it here too or it will land in the "Other" bucket automatically.
//
// The grouping mirrors the app's main navigation clusters, NOT any DB
// concept — do NOT push these labels back into PERMISSIONS_SCHEMA.

export const RESOURCE_GROUPS = [
  {
    key: 'capture',
    label: 'Capture',
    resources: [
      'swms', 'pre_starts', 'site_diary',
      'hazards', 'incidents', 'inspections',
      'risk_assessments', 'forms',
    ],
  },
  {
    key: 'compliance',
    label: 'Compliance',
    resources: ['audit_exports', 'renewals', 'inductions', 'certifications'],
  },
  {
    key: 'people',
    label: 'Workers & Contractors',
    resources: ['workers', 'contractors', 'suppliers'],
  },
  {
    key: 'assets_sites',
    label: 'Assets & Sites',
    resources: ['vehicles', 'assets', 'sites'],
  },
  {
    key: 'content',
    label: 'Content & Docs',
    resources: ['documents', 'reference_library', 'help'],
  },
  {
    key: 'ops',
    label: 'Integrations & Comms',
    resources: ['integrations', 'notifications', 'ai'],
  },
  {
    key: 'admin',
    label: 'Admin',
    resources: ['users'],
  },
];

// Reverse map for quick lookup + "Other" fallback bucket.
const _KNOWN = new Set(RESOURCE_GROUPS.flatMap((g) => g.resources));

export function bucketResources(allResources) {
  const known = RESOURCE_GROUPS.map((g) => ({
    ...g,
    resources: g.resources.filter((r) => allResources.includes(r)),
  })).filter((g) => g.resources.length > 0);
  const other = (allResources || []).filter((r) => !_KNOWN.has(r));
  if (other.length) {
    known.push({ key: 'other', label: 'Other', resources: other });
  }
  return known;
}

// v160.3.9.31-4a — Visible action columns in the matrix grid.
// `open`, `team_view`, `use` are hidden behind the "Show advanced" toggle
// because most admins never touch them.
export const PRIMARY_ACTIONS = ['view', 'edit', 'delete', 'email', 'approve'];
export const ADVANCED_ACTIONS = ['open', 'team_view', 'use'];

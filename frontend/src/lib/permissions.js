// Permissions context — hydrated from /api/auth/me.
import React, { createContext, useContext } from 'react';

const PermissionsContext = createContext({ effective: {}, role: null });

export function PermissionsProvider({ value, children }) {
  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
}

export function usePermissions() {
  return useContext(PermissionsContext);
}

export function useCan() {
  const { effective } = usePermissions();
  return (resource, action) => Boolean(effective?.[resource]?.[action]);
}

export function Can({ resource, action, fallback = null, children }) {
  const can = useCan();
  return can(resource, action) ? <>{children}</> : fallback;
}

export const RESOURCE_LABELS = {
  swms: 'SWMS', pre_starts: 'Pre-starts', site_diary: 'Site diary',
  hazards: 'Hazards', incidents: 'Incidents', inspections: 'Inspections',
  contractors: 'Contractors', renewals: 'Renewal links',
  audit_exports: 'Audit exports', vehicles: 'Vehicles',
  assets: 'Plant & Vehicles',
  integrations: 'Integrations', users: 'Users & permissions',
  // Phase 3.18 — granular delete-aware resources.
  workers: 'Workers', inductions: 'Inductions', certifications: 'Certifications',
  documents: 'Documents', forms: 'Forms',
  // v58.13.105 — Surface `comms_safe_mode` in the Users & Permissions
  // matrix so admins can grant/revoke the .90 `comms_safe_mode.edit`
  // override via UI checkbox instead of direct API calls. Only the
  // `edit` action is semantically meaningful — the other columns get
  // the "not supported" dash via the support maps below.
  comms_safe_mode: 'Comms Safe Mode',
};

export const EMAIL_SUPPORTED = {
  swms: true, pre_starts: true, site_diary: true, hazards: true,
  incidents: true, inspections: true, contractors: true, renewals: true,
  audit_exports: true, vehicles: false, assets: false, integrations: false, users: false,
  workers: false, inductions: true, certifications: true, documents: false, forms: false,
  comms_safe_mode: false,
};

export const DELETE_SUPPORTED = {
  swms: true, pre_starts: true, site_diary: true, hazards: true,
  incidents: true, inspections: true, contractors: true, renewals: true,
  audit_exports: false, vehicles: true, assets: true, integrations: false, users: true,
  workers: true, inductions: true, certifications: true, documents: true, forms: true,
  comms_safe_mode: false,
};

// v159.2 — `team_view` gates the six team-scoped resources.
export const TEAM_VIEW_SUPPORTED = {
  swms: true, pre_starts: true, site_diary: true,
  hazards: true, incidents: true, inspections: true,
  contractors: false, renewals: false, audit_exports: false,
  vehicles: false, assets: false, integrations: false, users: false,
  workers: false, inductions: false, certifications: false,
  documents: false, forms: false,
  comms_safe_mode: false,
};

// v58.13.105 — Additional support gate for `open` and `view`. Some
// resources (like `comms_safe_mode`) only have a single meaningful
// action (`edit`) — open and view make no sense. The matrix
// consults this to render "—" for those cells.
export const OPEN_VIEW_SUPPORTED = {
  swms: true, pre_starts: true, site_diary: true, hazards: true,
  incidents: true, inspections: true, contractors: true, renewals: true,
  audit_exports: true, vehicles: true, assets: true,
  integrations: true, users: true,
  workers: true, inductions: true, certifications: true,
  documents: true, forms: true,
  comms_safe_mode: false,
};

// 6-action matrix (v159.2 added `team_view`).
export const ACTIONS = ['open', 'view', 'edit', 'delete', 'email', 'team_view'];

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
};

export const EMAIL_SUPPORTED = {
  swms: true, pre_starts: true, site_diary: true, hazards: true,
  incidents: true, inspections: true, contractors: true, renewals: true,
  audit_exports: true, vehicles: false, assets: false, integrations: false, users: false,
  workers: false, inductions: true, certifications: true, documents: false, forms: false,
};

export const DELETE_SUPPORTED = {
  swms: true, pre_starts: true, site_diary: true, hazards: true,
  incidents: true, inspections: true, contractors: true, renewals: true,
  audit_exports: false, vehicles: true, assets: true, integrations: false, users: true,
  workers: true, inductions: true, certifications: true, documents: true, forms: true,
};

// 5-action matrix (Phase 3.18 added `delete`).
export const ACTIONS = ['open', 'view', 'edit', 'delete', 'email'];

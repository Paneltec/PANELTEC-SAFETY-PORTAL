import AsyncStorage from '@react-native-async-storage/async-storage';
import { getUser } from './auth';

const PERMS_KEY = 'paneltec_perms';

export type PermMatrix = Record<string, Record<string, boolean>>;

// v158 — Resource keys mirroring `PERMISSIONS_SCHEMA` on the backend
// (`/app/backend/permissions.py`). Kept in sync manually; the runtime
// `canDo()` check works against any string, so a drift here is only a
// cosmetic issue for any future mobile permissions viewer.
export const RESOURCE_KEYS = [
  'swms', 'pre_starts', 'site_diary', 'hazards', 'incidents', 'inspections',
  'contractors', 'renewals', 'audit_exports', 'vehicles', 'integrations', 'users',
  // v158 — added to match backend `PERMISSIONS_SCHEMA` (Phase 3.18 + assets).
  'workers', 'inductions', 'certifications', 'documents', 'forms', 'assets',
] as const;

export const RESOURCE_LABELS: Record<string, string> = {
  swms: 'SWMS', pre_starts: 'Pre-starts', site_diary: 'Site diary',
  hazards: 'Hazards', incidents: 'Incidents', inspections: 'Inspections',
  contractors: 'Contractors', renewals: 'Renewal links',
  audit_exports: 'Audit exports', vehicles: 'Vehicles',
  integrations: 'Integrations', users: 'Users & permissions',
  // v158 — added labels.
  workers: 'Workers',
  inductions: 'Inductions',
  certifications: 'Certifications',
  documents: 'Documents',
  forms: 'Forms',
  assets: 'Plant & Vehicles',
};

// Map mobile route keys to backend resource names (routes use dashes, backend uses underscores)
export const ROUTE_TO_RESOURCE: Record<string, string> = {
  swms: 'swms', 'pre-starts': 'pre_starts', 'site-diary': 'site_diary',
  hazards: 'hazards', incidents: 'incidents', inspections: 'inspections',
  contractors: 'contractors',
  // v158 — added mobile route mappings.
  forms: 'forms',
  workers: 'workers',
  certifications: 'certifications',
  'document-library': 'documents',
  vehicles: 'assets',
};

// Email convenience endpoints (same as web)
export const EMAIL_ENDPOINTS: Record<string, string> = {
  swms: '/swms/{id}/email-for-review',
  pre_starts: '/pre-starts/{id}/email',
  site_diary: '/site-diary/{id}/email-daily',
  hazards: '/hazards/{id}/email',
  incidents: '/incidents/{id}/email-summary',
  inspections: '/inspections/{id}/email',
  contractors: '/contractors/{id}/email',
  renewals: '/renewals/{id}/email-link',
  audit_exports: '/audit-exports/{id}/email',
};

export async function getPermissions(): Promise<PermMatrix> {
  try {
    const raw = await AsyncStorage.getItem(PERMS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export async function setPermissions(perms: PermMatrix) {
  await AsyncStorage.setItem(PERMS_KEY, JSON.stringify(perms));
}

export async function clearPermissions() {
  await AsyncStorage.removeItem(PERMS_KEY);
}

/** Check a single permission synchronously against a provided matrix */
export function canDo(perms: PermMatrix, resource: string, action: string): boolean {
  return Boolean(perms?.[resource]?.[action]);
}

/** Check if user has ANY open permission across capture resources */
export function hasAnyCaptureOpen(perms: PermMatrix): boolean {
  const captureResources = ['swms', 'pre_starts', 'site_diary', 'hazards', 'incidents', 'inspections'];
  return captureResources.some(r => canDo(perms, r, 'open'));
}

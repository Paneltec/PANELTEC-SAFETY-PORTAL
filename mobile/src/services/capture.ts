/**
 * Capture API service — generic CRUD client for all 5 capture modules.
 * v58.13.132e
 *
 * Modules: hazards, incidents, pre-starts, site-diary, inspections
 * All share the same CRUD pattern from crud.py::build_router().
 */
import axios from 'axios';
import { Platform } from 'react-native';
import { getStoredJwt } from './auth';
import { enqueue, pending } from './offline-queue';

const API = process.env.EXPO_PUBLIC_BACKEND_URL;

async function authHeaders(): Promise<Record<string, string>> {
  const jwt = await getStoredJwt();
  if (!jwt) return {};
  return { Authorization: `Bearer ${jwt}` };
}

// ── Module config ──

export type CaptureModuleKey = 'hazards' | 'incidents' | 'pre-starts' | 'site-diary' | 'inspections';

export const MODULE_CONFIG: Record<CaptureModuleKey, {
  apiPath: string;
  label: string;
  labelPlural: string;
  icon: string;
  color: string;
  titleField: string;
  subtitleField: string;
  dateField: string;
  statusField: string;
}> = {
  'hazards': {
    apiPath: '/api/hazards',
    label: 'Hazard Report',
    labelPlural: 'Hazard Reports',
    icon: 'warning',
    color: '#EF4444',
    titleField: 'title',
    subtitleField: 'description',
    dateField: 'created_at',
    statusField: 'status',
  },
  'incidents': {
    apiPath: '/api/incidents',
    label: 'Incident Report',
    labelPlural: 'Incident Reports',
    icon: 'alert-circle',
    color: '#DC2626',
    titleField: 'title',
    subtitleField: 'description',
    dateField: 'occurred_at',
    statusField: 'follow_up_status',
  },
  'pre-starts': {
    apiPath: '/api/pre-starts',
    label: 'Pre-Start',
    labelPlural: 'Pre-Start Checks',
    icon: 'clipboard',
    color: '#F97316',
    titleField: 'crew_lead',
    subtitleField: 'work_summary',
    dateField: 'date',
    statusField: 'status',
  },
  'site-diary': {
    apiPath: '/api/site-diary',
    label: 'Site Diary',
    labelPlural: 'Site Diary Entries',
    icon: 'book',
    color: '#2563EB',
    titleField: 'raw_notes',
    subtitleField: 'date',
    dateField: 'date',
    statusField: 'status',
  },
  'inspections': {
    apiPath: '/api/inspections',
    label: 'Inspection',
    labelPlural: 'Inspections',
    icon: 'search',
    color: '#7C3AED',
    titleField: 'template_name',
    subtitleField: 'notes',
    dateField: 'date',
    statusField: 'status',
  },
};

// ── Generic CRUD ──

export interface CaptureItem {
  id: string;
  org_id?: string;
  created_by?: string;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
  status?: string;
  source?: string;
  [key: string]: any;
}

export async function listItems(
  moduleKey: CaptureModuleKey,
  params?: { status?: string; scope?: string; limit?: number; workspace_id?: string },
): Promise<CaptureItem[]> {
  const config = MODULE_CONFIG[moduleKey];
  const headers = await authHeaders();
  const { data } = await axios.get<CaptureItem[]>(`${API}${config.apiPath}`, {
    headers,
    params: { limit: 50, ...params },
  });
  return data;
}

export async function getItem(moduleKey: CaptureModuleKey, id: string): Promise<CaptureItem> {
  const config = MODULE_CONFIG[moduleKey];
  const headers = await authHeaders();
  const { data } = await axios.get<CaptureItem>(`${API}${config.apiPath}/${id}`, { headers });
  return data;
}

export async function createItem(
  moduleKey: CaptureModuleKey,
  body: Record<string, any>,
): Promise<CaptureItem> {
  const config = MODULE_CONFIG[moduleKey];
  const headers = await authHeaders();
  try {
    const { data } = await axios.post<CaptureItem>(`${API}${config.apiPath}`, body, { headers });
    return data;
  } catch (err: any) {
    if (err?.message?.includes('Network') || !err?.response) {
      // Offline — queue
      await enqueue({ method: 'POST', url: config.apiPath, body });
      return { id: `draft_${Date.now()}`, ...body, status: 'queued', _offline: true } as any;
    }
    throw err;
  }
}

export async function updateItem(
  moduleKey: CaptureModuleKey,
  id: string,
  patch: Record<string, any>,
): Promise<CaptureItem> {
  const config = MODULE_CONFIG[moduleKey];
  const headers = await authHeaders();
  try {
    const { data } = await axios.patch<CaptureItem>(`${API}${config.apiPath}/${id}`, patch, { headers });
    return data;
  } catch (err: any) {
    if (err?.message?.includes('Network') || !err?.response) {
      await enqueue({ method: 'PATCH', url: `${config.apiPath}/${id}`, body: patch });
      return { id, ...patch, _offline: true } as any;
    }
    throw err;
  }
}

export async function deleteItem(moduleKey: CaptureModuleKey, id: string): Promise<void> {
  const config = MODULE_CONFIG[moduleKey];
  const headers = await authHeaders();
  await axios.delete(`${API}${config.apiPath}/${id}`, { headers });
}

// ── AI Photo Analysis (Hazards + Incidents) ──

export interface AIAnalysis {
  identified_hazards: string[];
  suggested_controls: string[];
  severity: string;
  summary: string;
  photo_url: string;
}

export async function analyzePhoto(imageUri: string): Promise<AIAnalysis> {
  const headers = await authHeaders();
  const formData = new FormData();

  if (Platform.OS === 'web') {
    // Web: fetch blob from URI
    const resp = await fetch(imageUri);
    const blob = await resp.blob();
    formData.append('file', blob, 'photo.jpg');
  } else {
    // Native: use file URI
    formData.append('file', {
      uri: imageUri,
      type: 'image/jpeg',
      name: 'photo.jpg',
    } as any);
  }

  const { data } = await axios.post<AIAnalysis>(
    `${API}/api/ai/hazard-vision`,
    formData,
    {
      headers: { ...headers, 'Content-Type': 'multipart/form-data' },
      timeout: 30000,
    },
  );
  return data;
}

// ── Offline queue helpers ──

export async function getPendingCount(): Promise<number> {
  const items = await pending();
  return items.length;
}

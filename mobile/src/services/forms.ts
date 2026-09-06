/**
 * Forms API service — v58.13.132h M6-reset
 * Fetches form templates (categorised), runs submissions against existing backend.
 */
import axios from 'axios';
import { getStoredJwt } from './auth';

const API = process.env.EXPO_PUBLIC_BACKEND_URL;

async function authHeaders() {
  const jwt = await getStoredJwt();
  return jwt ? { Authorization: `Bearer ${jwt}` } : {};
}

// ── Types ──

export interface FormField {
  id: string;
  label: string;
  type: string;
  required: boolean;
  options: string[];
  placeholder: string;
  config?: Record<string, unknown>;
}

export interface FormTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  fields: FormField[];
  submission_count: number;
  required_certifications?: string[];
  assigned_positions?: string[];
}

export interface FormSubmission {
  id: string;
  template_id: string;
  template_name_snapshot: string;
  fields: { id: string; label: string; type: string; value: unknown }[];
  submitted_by: string;
  submitted_by_name: string;
  submitted_at: string;
}

export interface AccessCheckResult {
  ok: boolean;
  mode: 'no_gate' | 'admin_bypass' | 'gated';
  template_id: string;
  worker_id: string | null;
  required: { slug: string; label: string; status: string; expiry_date: string | null }[];
}

// ── Category Metadata ──

export interface CategoryMeta {
  key: string;
  label: string;
  color: string;
  bgColor: string;
  icon: string;
}

export const CATEGORY_ORDER: CategoryMeta[] = [
  { key: 'general',   label: 'General',   color: '#475569', bgColor: '#E2E8F0', icon: 'document-text-outline' },
  { key: 'pre_start', label: 'Pre-Start', color: '#0369A1', bgColor: '#E0F2FE', icon: 'clipboard-outline' },
  { key: 'inspection',label: 'Inspection', color: '#1D4ED8', bgColor: '#DBEAFE', icon: 'search-outline' },
  { key: 'near_miss', label: 'Near Miss', color: '#C2410C', bgColor: '#FED7AA', icon: 'alert-circle-outline' },
  { key: 'incident',  label: 'Incident',  color: '#BE123C', bgColor: '#FDE2E4', icon: 'warning-outline' },
  { key: 'toolbox',   label: 'Toolbox',   color: '#92400E', bgColor: '#FEF3C7', icon: 'people-outline' },
  { key: 'admin',     label: 'Admin Only', color: '#64748B', bgColor: '#CBD5E1', icon: 'lock-closed-outline' },
];

export function getCategoryMeta(key: string): CategoryMeta {
  return CATEGORY_ORDER.find((c) => c.key === key) || CATEGORY_ORDER[0];
}

// ── API Calls ──

export async function fetchFormTemplates(): Promise<FormTemplate[]> {
  const headers = await authHeaders();
  const { data } = await axios.get(`${API}/api/forms/templates`, { headers });
  return Array.isArray(data) ? data : [];
}

export async function fetchFormTemplate(templateId: string): Promise<FormTemplate> {
  const headers = await authHeaders();
  const { data } = await axios.get(`${API}/api/forms/templates/${templateId}`, { headers });
  return data;
}

export async function checkTemplateAccess(templateId: string): Promise<AccessCheckResult> {
  const headers = await authHeaders();
  const { data } = await axios.get(`${API}/api/forms/templates/${templateId}/access-check`, { headers });
  return data;
}

export async function submitForm(
  templateId: string,
  fields: { id: string; label: string; type: string; value: unknown }[],
): Promise<FormSubmission> {
  const headers = await authHeaders();
  const { data } = await axios.post(
    `${API}/api/forms/templates/${templateId}/submissions`,
    { fields },
    { headers },
  );
  return data;
}

export async function uploadFormPhotos(
  submissionId: string,
  fieldId: string,
  photoDataUrls: string[],
): Promise<void> {
  const headers = await authHeaders();
  // Convert data URLs to blobs for FormData
  const formData = new FormData();
  formData.append('field_id', fieldId);
  for (let i = 0; i < photoDataUrls.length; i++) {
    const resp = await fetch(photoDataUrls[i]);
    const blob = await resp.blob();
    formData.append('files', blob, `photo_${i}.jpg`);
  }
  await axios.post(
    `${API}/api/forms/submissions/${submissionId}/photos`,
    formData,
    { headers: { ...headers, 'Content-Type': 'multipart/form-data' } },
  );
}

/**
 * Group templates by category, preserving CATEGORY_ORDER.
 * Returns only categories that have at least 1 template.
 * Hides 'admin' category for non-admin users.
 */
export function groupByCategory(
  templates: FormTemplate[],
  userRole: string,
): { meta: CategoryMeta; forms: FormTemplate[] }[] {
  const byKey: Record<string, FormTemplate[]> = {};
  for (const t of templates) {
    const cat = t.category || 'general';
    if (!byKey[cat]) byKey[cat] = [];
    byKey[cat].push(t);
  }

  return CATEGORY_ORDER
    .filter((cat) => {
      if (cat.key === 'admin' && userRole !== 'admin' && userRole !== 'owner') return false;
      return (byKey[cat.key] || []).length > 0;
    })
    .map((cat) => ({
      meta: cat,
      forms: (byKey[cat.key] || []).sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

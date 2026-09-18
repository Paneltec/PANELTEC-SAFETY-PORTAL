/**
 * Picker API helpers — fetch data for form picker fields.
 * Uses the same endpoints as the web frontend.
 */
import { getStoredJwt } from './auth';

const API = process.env.EXPO_PUBLIC_BACKEND_URL;

async function headers() {
  const jwt = await getStoredJwt();
  return jwt ? { Authorization: `Bearer ${jwt}` } : {};
}

export interface WorkerItem {
  id: string;
  name: string;
  trade: string;
  phone: string;
  email: string;
  active: boolean;
  simpro_company_id: string;
  company_name: string;
}

export interface VehicleItem {
  id: string;
  label: string;
  plate: string;
  registration: string;
  vehicle_type: string;
  tags: string[];
  source: string;
}

export interface CustomerItem {
  id: string;
  simpro_customer_id: string;
  simpro_company_id: string;
  company_label: string;
  name: string;
}

export interface SiteItem {
  id: string;
  simpro_site_id: string;
  name: string;
  address: string;
  customer_id: string;
  lat: number | null;
  lng: number | null;
  customer_name?: string;
  distance_km?: number;
  jobs?: number;
}

export interface JobItem {
  id: string;
  simpro_job_id: string;
  name: string;
  site_id: string;
  site_name: string;
  customer_id: string;
  customer_name: string;
  stage: string;
}

export interface AssetItem {
  id: string;
  kind: string;
  navixy_device_id: string | null;
  scan_token: string;
  name: string;
  asset_type: string;
  rego_serial: string;
}

export async function fetchWorkers(q?: string, companyId?: string): Promise<WorkerItem[]> {
  const h = await headers();
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (companyId) params.set('company_id', companyId);
  const qs = params.toString();
  const resp = await fetch(`${API}/api/forms/pickers/workers${qs ? `?${qs}` : ''}`, { headers: h });
  if (!resp.ok) return [];
  const data = await resp.json();
  return data.workers || [];
}

export async function fetchVehicles(): Promise<{ vehicles: VehicleItem[]; status: string; message?: string }> {
  const h = await headers();
  const resp = await fetch(`${API}/api/forms/fleet/vehicles`, { headers: h });
  if (!resp.ok) return { vehicles: [], status: 'error' };
  const data = await resp.json();
  return { vehicles: data.vehicles || [], status: data.status || 'ok', message: data.message };
}

export async function fetchCustomers(q?: string): Promise<CustomerItem[]> {
  const h = await headers();
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  const qs = params.toString();
  const resp = await fetch(`${API}/api/forms/pickers/customers${qs ? `?${qs}` : ''}`, { headers: h });
  if (!resp.ok) return [];
  const data = await resp.json();
  return data.customers || [];
}

export async function fetchSites(q?: string, customerId?: string, lat?: number, lng?: number): Promise<SiteItem[]> {
  const h = await headers();
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (customerId) params.set('customer_id', customerId);
  if (lat != null && lng != null) { params.set('lat', String(lat)); params.set('lng', String(lng)); }
  const qs = params.toString();
  const resp = await fetch(`${API}/api/forms/pickers/sites${qs ? `?${qs}` : ''}`, { headers: h });
  if (!resp.ok) return [];
  const data = await resp.json();
  return data.sites || [];
}

export async function fetchJobs(q?: string, params?: Record<string, string>): Promise<JobItem[]> {
  const h = await headers();
  const sp = new URLSearchParams();
  if (q) sp.set('q', q);
  if (params) Object.entries(params).forEach(([k, v]) => sp.set(k, v));
  const qs = sp.toString();
  const resp = await fetch(`${API}/api/forms/pickers/jobs${qs ? `?${qs}` : ''}`, { headers: h });
  if (!resp.ok) return [];
  const data = await resp.json();
  return data.jobs || [];
}

export async function fetchAssets(q?: string): Promise<AssetItem[]> {
  const h = await headers();
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  const qs = params.toString();
  const resp = await fetch(`${API}/api/forms/assets/picker${qs ? `?${qs}` : ''}`, { headers: h });
  if (!resp.ok) return [];
  const data = await resp.json();
  return data.assets || [];
}

export async function lookupAsset(token: string): Promise<AssetItem | null> {
  const h = await headers();
  const resp = await fetch(`${API}/api/forms/assets/lookup?token=${encodeURIComponent(token)}`, { headers: h });
  if (!resp.ok) return null;
  return resp.json();
}

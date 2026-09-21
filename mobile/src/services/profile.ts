/**
 * Profile API service — v58.13.132iu
 * Fetches worker profile, SWMS, fleet data from existing backend endpoints.
 */
import axios from 'axios';
import { getStoredJwt } from './auth';
import { getSimulateHeaders } from './simulateRole';

const API = process.env.EXPO_PUBLIC_BACKEND_URL;

async function authHeaders() {
  const jwt = await getStoredJwt();
  const sim = await getSimulateHeaders();
  return jwt ? { Authorization: `Bearer ${jwt}`, ...sim } : {};
}

// ── Types ──

export interface WorkerProfile {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  mobile: string;
  position: string;
  active: boolean;
  company_label: string;
  photo_url?: string;
  birth_date?: string;
  country?: string;
  state?: string;
  street_address?: string;
  suburb?: string;
  postal_code?: string;
}

export interface CertStatus {
  key: 'valid' | 'expired' | 'expiring_soon' | 'no_expiry' | 'missing_file';
  label: string;
  days: number | null;
}

export interface Certification {
  id: string;
  name: string;
  issuer: string;
  issue_date: string | null;
  expiry_date: string | null;
  notes: string;
  doc_file_id: string | null;
  doc_seed_folder: string;
  status: CertStatus;
  worker_id: string;
}

export interface WorkerProfileResponse {
  worker: WorkerProfile | null;
  certifications: Certification[];
  clients: { id: string; name: string; company_label: string | null }[];
}

export interface SwmsDoc {
  id: string;
  title: string;
  code?: string;
  version?: string;
  status: string;
  scope?: string;
  job_description?: string;
  review_date?: string;
  ppe?: string[];
  applies_to?: {
    worker_ids?: string[];
    asset_types?: string[];
    roles?: string[];
  };
  created_at?: string;
  updated_at?: string;
}

export interface FleetAsset {
  id: string;
  kind: string;
  asset_type?: string;
  sub_type?: string;
  rego_serial?: string;
  name?: string;
  make?: string;
  model?: string;
  status?: string;
  odo_km?: number;
  hours_meter?: number;
  navixy_device_id?: number;
  last_known_lat?: number;
  last_known_lng?: number;
  photos?: { url?: string; data_url?: string }[];
}

export interface FleetAssetDetail {
  asset: FleetAsset;
  history: any[];
  history_truncated: boolean;
  counters: {
    total_records: number;
    total_spend: number;
    last_service_date: string | null;
    open_hazards: number;
    open_incidents: number;
  };
}

// ── API Calls ──

export async function fetchWorkerProfile(): Promise<WorkerProfileResponse> {
  const headers = await authHeaders();
  const { data } = await axios.get(`${API}/api/me/worker-profile`, { headers });
  return data;
}

export async function fetchMySwms(workerId: string): Promise<SwmsDoc[]> {
  const headers = await authHeaders();
  try {
    const { data } = await axios.get(`${API}/api/swms`, { headers });
    // Filter client-side to only show SWMS assigned to this worker
    const items = Array.isArray(data) ? data : (data.items || []);
    return items.filter((s: SwmsDoc) => {
      const workerIds = s.applies_to?.worker_ids || [];
      return workerIds.includes(workerId);
    });
  } catch {
    // If user lacks swms.view permission, return empty
    return [];
  }
}

export async function fetchFleetRegister(): Promise<FleetAsset[]> {
  // v58.13.132jo — Bumped `limit` 50 → 200 so the mobile Fleet tab
  // matches the web Compliance/Fleet & Service Register master
  // source. 200 is the backend's hard cap (`fleet.py::register`
  // `Query(50, ge=1, le=200)`) — 500 was rejected with 422. 200 is
  // comfortably above the current 115-asset register with headroom.
  // The 50-cap was truncating the register down to page 1
  // alphabetically, which then made the client-side tag enrichment
  // under-count every tag (e.g. Vac Truck Dumping showed 4 instead
  // of the real 14). The Navixy tag map (from
  // `/api/fleet/navixy/tags`) was already correct — the only
  // missing piece was letting the mobile see all 115 assets so the
  // tag mapping could land on every one of them.
  const headers = await authHeaders();
  try {
    const { data } = await axios.get(`${API}/api/fleet/register`, {
      headers,
      params: { limit: 200, page: 1 },
    });
    return data.items || [];
  } catch {
    // If fleet is disabled or user lacks permission, return empty
    return [];
  }
}

export async function fetchFleetAssetDetail(assetId: string): Promise<FleetAssetDetail> {
  const headers = await authHeaders();
  const { data } = await axios.get(`${API}/api/fleet/assets/${assetId}`, { headers });
  return data;
}

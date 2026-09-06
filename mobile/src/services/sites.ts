/**
 * Sites API service — v58.13.132c
 */
import axios from 'axios';
import { getStoredJwt } from './auth';

const API = process.env.EXPO_PUBLIC_BACKEND_URL;

async function authHeaders(): Promise<Record<string, string>> {
  const jwt = await getStoredJwt();
  if (!jwt) return {};
  return { Authorization: `Bearer ${jwt}` };
}

export interface Site {
  id: string;
  simpro_site_id: string;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  distance_km: number | null;
  is_nearest: boolean;
  user_signed_in: boolean;
  signed_in_at: string | null;
  company_ids: string[];
  ppe_requirements: string[];
  induction_video_url: string | null;
  emergency_contact: string | null;
  active: boolean;
}

export interface SitesResponse {
  sites: Site[];
  user_active_sign_in_site_id: string | null;
}

export interface SignInRecord {
  id: string;
  site_id: string;
  site_name: string;
  user_id: string;
  kind: 'worker' | 'visitor';
  signed_in_at: string;
  signed_out_at: string | null;
}

export interface OccupancyEntry {
  sign_in_id: string;
  user_id: string;
  name: string;
  kind: string;
  signed_in_at: string;
  visitor_company?: string;
}

export interface OccupancyResponse {
  site_id: string;
  workers: OccupancyEntry[];
  visitors: OccupancyEntry[];
  total_count: number;
}

export async function fetchSites(lat?: number, lng?: number): Promise<SitesResponse> {
  const headers = await authHeaders();
  const params: Record<string, string> = {};
  if (lat != null) params.lat = String(lat);
  if (lng != null) params.lng = String(lng);
  const { data } = await axios.get<SitesResponse>(`${API}/api/mobile/sites`, { headers, params });
  return data;
}

export async function workerSignIn(siteId: string, gps?: { lat: number; lng: number }, photoDataUri?: string): Promise<SignInRecord> {
  const headers = await authHeaders();
  const { data } = await axios.post<SignInRecord>(
    `${API}/api/mobile/sites/${siteId}/sign-in`,
    { kind: 'worker', gps: gps || null, photo_data_uri: photoDataUri || null },
    { headers },
  );
  return data;
}

export async function workerSignOut(siteId: string, gps?: { lat: number; lng: number }): Promise<void> {
  const headers = await authHeaders();
  await axios.post(`${API}/api/mobile/sites/${siteId}/sign-out`, { gps: gps || null }, { headers });
}

export interface VisitorSignInPayload {
  visitor_details: {
    name: string;
    company: string;
    phone: string;
    purpose: string;
    host_user_id: string;
    escort_required: boolean;
  };
  ppe_ack: string[];
  induction_ack: boolean;
  photo_data_uri?: string;
  gps?: { lat: number; lng: number };
}

export async function visitorSignIn(siteId: string, payload: VisitorSignInPayload): Promise<SignInRecord> {
  const headers = await authHeaders();
  const { data } = await axios.post<SignInRecord>(
    `${API}/api/mobile/sites/${siteId}/visitor-sign-in`,
    payload,
    { headers },
  );
  return data;
}

export async function visitorSignOut(siteId: string, signInId: string, gps?: { lat: number; lng: number }): Promise<void> {
  const headers = await authHeaders();
  await axios.post(`${API}/api/mobile/sites/${siteId}/visitor-sign-out`,
    { sign_in_id: signInId, gps: gps || null }, { headers });
}

export async function fetchOccupancy(siteId: string): Promise<OccupancyResponse> {
  const headers = await authHeaders();
  const { data } = await axios.get<OccupancyResponse>(
    `${API}/api/mobile/sites/${siteId}/current-occupancy`, { headers });
  return data;
}

export async function gpsHeartbeat(lat: number, lng: number): Promise<void> {
  const headers = await authHeaders();
  await axios.post(`${API}/api/mobile/gps/heartbeat`, { lat, lng }, { headers });
}

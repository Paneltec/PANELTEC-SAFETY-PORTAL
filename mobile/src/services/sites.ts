/**
 * Sites API service — v58.13.132d (reconciled to existing web endpoints)
 *
 * Uses:
 *   GET  /api/sites                          — list sites
 *   POST /api/sites/{id}/signon-v127         — worker sign-in
 *   POST /api/me/signoff-active              — worker sign-off
 *   POST /api/public/visitor/site/{token}/signin — visitor sign-in
 */
import axios from 'axios';
import { getStoredJwt } from './auth';

const API = process.env.EXPO_PUBLIC_BACKEND_URL;

async function authHeaders(): Promise<Record<string, string>> {
  const jwt = await getStoredJwt();
  if (!jwt) return {};
  return { Authorization: `Bearer ${jwt}` };
}

// ── Types ──

/** Raw site from GET /api/sites (sites_qr.py::list_sites) */
export interface RawSite {
  simpro_site_id: string;
  name: string;
  address_full?: string;
  address?: string;
  suburb?: string;
  state?: string;
  scan_token?: string;
  latitude?: number | null;
  longitude?: number | null;
  kind?: string;
  signon_questions?: any[];
  active_signons_count?: number;
}

/** Mobile-enriched site with distance + sign-in status */
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
  scan_token: string | null;
  active_signons_count: number;
  kind: string;
}

export interface SitesResponse {
  sites: Site[];
  user_active_sign_in_site_id: string | null;
}

// ── Haversine distance (client-side) ──

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371.0;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lng2 - lng1) * Math.PI) / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ── Fetch sites + enrich with GPS distance + sign-in status ──

export async function fetchSites(
  userLat?: number,
  userLng?: number,
  activeSiteId?: string | null,
  activeSiteSignedAt?: string | null,
): Promise<SitesResponse> {
  const headers = await authHeaders();
  const { data: rawSites } = await axios.get<RawSite[]>(`${API}/api/sites`, { headers });

  // Enrich with distance + sign-in status
  const sites: Site[] = rawSites.map((s) => {
    const sLat = s.latitude ?? null;
    const sLng = s.longitude ?? null;
    let distKm: number | null = null;
    if (userLat != null && userLng != null && sLat != null && sLng != null) {
      distKm = Math.round(haversineKm(userLat, userLng, sLat, sLng) * 10) / 10;
    }
    const siteId = s.simpro_site_id;
    return {
      id: siteId,
      simpro_site_id: siteId,
      name: s.name || '',
      address: s.address_full || s.address || '',
      latitude: sLat,
      longitude: sLng,
      distance_km: distKm,
      is_nearest: false,
      user_signed_in: activeSiteId === siteId,
      signed_in_at: activeSiteId === siteId ? activeSiteSignedAt || null : null,
      scan_token: s.scan_token || null,
      active_signons_count: s.active_signons_count || 0,
      kind: s.kind || 'simpro',
    };
  });

  // Sort by distance if GPS available, else alphabetically
  if (userLat != null && userLng != null) {
    sites.sort((a, b) => (a.distance_km ?? 9999) - (b.distance_km ?? 9999));
  } else {
    sites.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  }

  // Mark nearest
  if (sites.length > 0 && sites[0].distance_km != null) {
    sites[0].is_nearest = true;
  }

  return {
    sites,
    user_active_sign_in_site_id: activeSiteId || null,
  };
}

// ── Worker sign-in (POST /api/sites/{id}/signon-v127) ──

export async function workerSignIn(
  siteId: string,
  gps?: { lat: number; lng: number },
): Promise<any> {
  const headers = await authHeaders();
  const { data } = await axios.post(
    `${API}/api/sites/${siteId}/signon-v127`,
    {
      gps_lat: gps?.lat ?? null,
      gps_long: gps?.lng ?? null,
      answers: [],
    },
    { headers },
  );
  return data;
}

// ── Worker sign-off (POST /api/me/signoff-active) ──

export async function workerSignOut(): Promise<any> {
  const headers = await authHeaders();
  const { data } = await axios.post(`${API}/api/me/signoff-active`, {}, { headers });
  return data;
}

// ── Visitor sign-in (POST /api/public/visitor/site/{token}/signin) ──

export interface VisitorSignInPayload {
  name: string;
  company?: string;
  phone?: string;
  purpose?: string;
  visiting_person?: string;
  induction_acknowledged: boolean;
  gps_lat?: number;
  gps_lng?: number;
}

export async function visitorSignIn(
  scanToken: string,
  payload: VisitorSignInPayload,
): Promise<any> {
  // This is a PUBLIC endpoint — no auth header needed
  const { data } = await axios.post(
    `${API}/api/public/visitor/site/${scanToken}/signin`,
    payload,
  );
  return data;
}

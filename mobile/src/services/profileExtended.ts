/**
 * Extended profile API — v58.13.132i
 * Adds self-edit, inductions matrix, QR/ID card endpoints.
 */
import axios from 'axios';
import { getStoredJwt } from './auth';

const API = process.env.EXPO_PUBLIC_BACKEND_URL;

async function authHeaders() {
  const jwt = await getStoredJwt();
  return jwt ? { Authorization: `Bearer ${jwt}` } : {};
}

// ── Self-Edit ──

export interface SelfEditPayload {
  preferred_name?: string;
  phone?: string;
  mobile?: string;
  email?: string;
  street_address?: string;
  suburb?: string;
  state?: string;
  postal_code?: string;
  country?: string;
  next_of_kin?: { name: string; phone: string; relationship: string };
  emergency_contact?: { name: string; phone: string; relationship: string };
}

export async function selfEditWorkerProfile(payload: SelfEditPayload) {
  const headers = await authHeaders();
  const { data } = await axios.patch(`${API}/api/me/worker-profile`, payload, { headers });
  return data;
}

// ── Inductions Matrix ──

export interface InductionCell {
  cert_id: string;
  expiry_date: string | null;
  not_held: boolean;
  held_no_expiry: boolean;
  doc_file_id: string | null;
  status: string;
  import_confidence: string | null;
}

export interface InductionColumn {
  column_key: string;
  header: string;
  category: string;
}

export interface InductionRow {
  id: string;
  name: string;
  email: string;
  cells: Record<string, InductionCell>;
  chip: string;
}

export interface InductionMatrix {
  columns: InductionColumn[];
  rows: InductionRow[];
  summary: { workers: number; columns: number };
}

export async function fetchInductionMatrix(): Promise<InductionMatrix> {
  const headers = await authHeaders();
  const { data } = await axios.get(`${API}/api/workers/inductions/matrix`, { headers });
  return data;
}

// ── QR / ID Card ──

export function getQrPngUrl(workerId: string): string {
  return `${API}/api/workers/${workerId}/qr.png`;
}

export function getIdCardPdfUrl(workerId: string, layout: 'wallet' | 'lanyard' = 'wallet'): string {
  return `${API}/api/workers/${workerId}/id-card.pdf?layout=${layout}`;
}

export async function fetchQrPngBase64(workerId: string): Promise<string> {
  const headers = await authHeaders();
  const { data } = await axios.get(`${API}/api/workers/${workerId}/qr.png`, {
    headers,
    responseType: 'arraybuffer',
  });
  const bytes = new Uint8Array(data);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

// ── Scan token public profile ──

export interface ScanProfile {
  id: string;
  name: string;
  role: string;
  trade: string;
  company: string;
  photo_url: string | null;
  scan_token: string;
  certifications: { name: string; status: string; expires_at: string | null }[];
  assigned_swms: { id: string; title: string; version: string; ack_required: boolean }[];
  active_site_today: { id: string; name: string } | null;
}

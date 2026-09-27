/**
 * Leave service — worker's own leave requests (backend: /api/me/leave).
 */
import axios from 'axios';
import { Platform } from 'react-native';
import { getStoredJwt } from './auth';

const API = process.env.EXPO_PUBLIC_BACKEND_URL;

async function headers() {
  const jwt = await getStoredJwt();
  return jwt ? { Authorization: `Bearer ${jwt}` } : {};
}

export type LeaveCategory = 'annual' | 'sick' | 'long_service' | 'unpaid' | 'other';
export type LeaveStatus = 'pending' | 'info_requested' | 'approved' | 'rejected' | 'cancelled';

export interface MyLeave {
  id: string;
  leave_type: string;
  category: LeaveCategory;
  start_date: string;   // YYYY-MM-DD
  end_date: string;
  hours: number;
  reason: string | null;
  status: LeaveStatus;
  status_label: string;
  has_certificate: boolean;
  created_at: string;
  decided_at: string | null;
  in_payroll: boolean;
  can_cancel: boolean;
}

export interface MyLeaveResponse {
  requests: MyLeave[];
  balances: Partial<Record<LeaveCategory, { hours: number; as_at: string | null }>>;
  hours_per_day: number;
}

export const CATEGORIES: { key: LeaveCategory; label: string; icon: string; desc: string }[] = [
  { key: 'annual', label: 'Annual leave', icon: 'sunny', desc: 'Holidays and time off' },
  { key: 'sick', label: "Sick / Carer's", icon: 'medkit', desc: 'You or family unwell' },
  { key: 'long_service', label: 'Long service', icon: 'ribbon', desc: 'Long service leave' },
  { key: 'unpaid', label: 'Unpaid', icon: 'wallet', desc: 'Leave without pay' },
  { key: 'other', label: 'Other', icon: 'ellipsis-horizontal-circle', desc: 'Anything else' },
];

export function apiMessage(e: any): string {
  return e?.response?.data?.detail || (e?.response ? 'Something went wrong — try again.' : "Can't reach the office server. Check your signal and try again.");
}

export async function fetchMyLeave(): Promise<MyLeaveResponse> {
  const { data } = await axios.get(`${API}/api/me/leave`, { headers: await headers(), timeout: 15000 });
  return data;
}

export async function requestLeave(body: {
  category: LeaveCategory; start_date: string; end_date: string; hours?: number | null; reason?: string | null;
}): Promise<MyLeave> {
  const { data } = await axios.post(`${API}/api/me/leave`, body, { headers: await headers(), timeout: 15000 });
  return data;
}

export async function cancelLeave(id: string): Promise<MyLeave> {
  const { data } = await axios.post(`${API}/api/me/leave/${id}/cancel`, {}, { headers: await headers(), timeout: 15000 });
  return data;
}

export async function uploadCertificate(id: string, uri: string): Promise<void> {
  const form = new FormData();
  if (Platform.OS === 'web') {
    const blob = await (await fetch(uri)).blob();
    form.append('file', blob, 'certificate.jpg');
  } else {
    form.append('file', { uri, type: 'image/jpeg', name: 'certificate.jpg' } as any);
  }
  await axios.post(`${API}/api/me/leave/${id}/certificate`, form, {
    headers: { ...(await headers()), 'Content-Type': 'multipart/form-data' }, timeout: 30000,
  });
}

// ── Date helpers (local dates, no timezone drift) ──
export const toIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const fromIso = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const niceDate = (s: string) =>
  fromIso(s).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
export function workingDays(a: string, b: string): number {
  let n = 0; const d = fromIso(a); const end = fromIso(b);
  while (d <= end) { const w = d.getDay(); if (w !== 0 && w !== 6) n++; d.setDate(d.getDate() + 1); }
  return n;
}

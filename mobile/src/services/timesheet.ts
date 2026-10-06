/**
 * Timesheet service — the worker's own hours (backend: /api/me/payroll).
 * A day can be split across clients: each block of time is a "line".
 */
import axios from 'axios';
import { getStoredJwt } from './auth';

const API = process.env.EXPO_PUBLIC_BACKEND_URL;

async function headers() {
  const jwt = await getStoredJwt();
  return jwt ? { Authorization: `Bearer ${jwt}` } : {};
}

export interface TimeLine {
  id?: string;
  client_id?: string | null;
  client_name: string;
  job_ref?: string | null;
  start: string;          // HH:MM
  finish: string;
  break_minutes: number;
  notes?: string | null;
  hours?: number;
}

export interface DayEntry {
  id: string;
  date: string;
  kind: 'work' | 'rdo' | 'no_work' | 'leave' | 'public_holiday';
  status: 'draft' | 'submitted' | 'approved' | 'rejected' | 'locked';
  hours: number;
  lines?: TimeLine[];
  start?: string | null;
  finish?: string | null;
  break_minutes?: number;
  site_name?: string | null;
  job_ref?: string | null;
  notes?: string | null;
  rejected_reason?: string | null;
}

export interface MyWeek {
  period: { id: string; start: string; end: string };
  days: string[];
  entries: DayEntry[];
  defaults: { start: string; finish: string; break_minutes: number };
}

export interface ClientJob { ref: string; name?: string | null; site?: string | null }
export interface Client { id: string; name: string; source: 'recent' | 'simpro' | 'internal'; jobs: ClientJob[]; recent: boolean }

export function apiMessage(e: any): string {
  const d = e?.response?.data?.detail;
  if (typeof d === 'string') return d;
  return e?.response ? 'Something went wrong — try again.' : "Can't reach the office server. Check your signal and try again.";
}

export async function fetchMyWeek(periodId?: string): Promise<MyWeek> {
  const { data } = await axios.get(`${API}/api/me/payroll/timesheets`, {
    headers: await headers(), params: periodId ? { period_id: periodId } : {}, timeout: 15000,
  });
  return data;
}

export async function fetchClients(q?: string): Promise<{ clients: Client[]; internal: Client[] }> {
  const { data } = await axios.get(`${API}/api/me/payroll/clients`, {
    headers: await headers(), params: q ? { q } : {}, timeout: 15000,
  });
  return data;
}

/** Save the whole day (all client blocks). An empty list clears the day's times. */
export async function saveDay(day: string, lines: TimeLine[], notes?: string | null): Promise<DayEntry> {
  const body = {
    date: day, kind: 'work', lines: lines.map(({ hours, ...l }) => l),
    break_minutes: 0, notes: notes ?? null,
    ...(lines.length === 0 ? { hours: 0 } : {}),
  };
  const { data } = await axios.put(`${API}/api/me/payroll/timesheets/${day}`, body, { headers: await headers(), timeout: 15000 });
  return data;
}

export async function submitWeek(periodId: string): Promise<{ submitted: number }> {
  const { data } = await axios.post(`${API}/api/me/payroll/submit`, null, {
    headers: await headers(), params: { period_id: periodId }, timeout: 15000,
  });
  return data;
}

// ── time helpers ─────────────────────────────────────────────
export const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
export const fromMin = (m: number) => {
  const c = Math.max(0, Math.min(23 * 60 + 45, m));
  return `${String(Math.floor(c / 60)).padStart(2, '0')}:${String(c % 60).padStart(2, '0')}`;
};
export const lineHours = (l: Pick<TimeLine, 'start' | 'finish' | 'break_minutes'>) =>
  Math.max(0, (toMin(l.finish) - toMin(l.start) - (l.break_minutes || 0)) / 60);
export const fmtHours = (h: number) => `${(Math.round(h * 100) / 100).toString()} h`;
export function fmt12(t: string) {
  const [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'pm' : 'am';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, '0')} ${ap}`;
}
export function dayLabel(iso: string, style: 'short' | 'long' = 'short') {
  const d = new Date(iso + 'T00:00:00');
  return style === 'short'
    ? d.toLocaleDateString('en-AU', { weekday: 'short' })
    : d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });
}
export const toIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function shiftIso(iso: string, days: number) {
  const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + days); return toIso(d);
}

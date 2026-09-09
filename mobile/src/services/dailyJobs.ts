/**
 * Daily-job assignment service — v58.13.132n.
 *
 * Wraps the /api/mobile/daily-jobs endpoints. The mobile Home screen uses
 * `today_job` from GET /mobile/home (already batched) — this module only
 * exposes accept/decline for the pending-accept state.
 */
import axios from 'axios';
import { getStoredJwt } from './auth';

const API = process.env.EXPO_PUBLIC_BACKEND_URL;

export interface TodayJob {
  id: string;
  site_id: string;
  site_name: string | null;
  site_address: string | null;
  site_coords: { lat: number; lng: number } | null;
  assigned_at: string;
  sms_sent_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  status: 'pending_accept' | 'accepted' | 'declined';
}

async function authHeaders(): Promise<Record<string, string>> {
  const jwt = await getStoredJwt();
  return jwt ? { Authorization: `Bearer ${jwt}` } : {};
}

// v58.13.132ab — direct today-job fetch (in addition to the batched
// /api/mobile/home payload). Poll callers can hit either — /home is
// the canonical source of truth but is heavier.
export async function fetchTodayDailyJob(): Promise<{
  assignment: TodayJob | null;
  status: 'no_job' | 'pending_accept' | 'accepted' | 'declined';
}> {
  const headers = await authHeaders();
  const { data } = await axios.get(
    `${API}/api/mobile/daily-jobs/today`, { headers },
  );
  return data;
}

export async function acceptDailyJob(assignmentId: string): Promise<TodayJob> {
  const headers = await authHeaders();
  const { data } = await axios.post(
    `${API}/api/mobile/daily-jobs/${assignmentId}/accept`, {}, { headers },
  );
  return data.assignment;
}

export async function declineDailyJob(assignmentId: string): Promise<TodayJob> {
  const headers = await authHeaders();
  const { data } = await axios.post(
    `${API}/api/mobile/daily-jobs/${assignmentId}/decline`, {}, { headers },
  );
  return data.assignment;
}

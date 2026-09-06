/**
 * Home data service — fetches dashboard payload from /api/mobile/home.
 * v58.13.132b
 */
import axios from 'axios';
import { getStoredJwt } from './auth';

const API = process.env.EXPO_PUBLIC_BACKEND_URL;

export interface HomeCompany {
  id: string;
  name: string;
}

export interface HomeUser {
  name: string;
  avatar_initials: string;
  company_id: string;
  company_name: string;
  employee_number: string | null;
}

export interface HomeSite {
  signed_in: boolean;
  site_id: string | null;
  site_name: string | null;
  signed_in_at: string | null;
  nearest: { site_id: string; name: string; distance_km: number | null } | null;
}

export interface HomeWeather {
  temperature_c: number | null;
  condition: string;
  wind_kmh: number | null;
  wind_dir: string;
  location_source: string;
}

export interface HomeModule {
  key: string;
  label: string;
  icon: string;
  badge: number | null;
  route: string;
}

export interface HomeData {
  user: HomeUser;
  companies: HomeCompany[];
  active_company_id: string;
  can_switch_company: boolean;
  today: {
    date_iso: string;
    day_name: string;
    greeting: string;
  };
  site: HomeSite;
  weather: HomeWeather;
  modules: HomeModule[];
}

async function authHeaders(): Promise<Record<string, string>> {
  const jwt = await getStoredJwt();
  if (!jwt) return {};
  return { Authorization: `Bearer ${jwt}` };
}

export async function fetchHome(): Promise<HomeData> {
  const headers = await authHeaders();
  const { data } = await axios.get<HomeData>(`${API}/api/mobile/home`, { headers });
  return data;
}

export async function setActiveCompany(companyId: string): Promise<void> {
  const headers = await authHeaders();
  await axios.post(`${API}/api/mobile/user/active-company`, { company_id: companyId }, { headers });
}

export async function fetchNotificationCount(): Promise<number> {
  const headers = await authHeaders();
  const { data } = await axios.get<{ count: number }>(`${API}/api/mobile/notifications/count`, { headers });
  return data.count;
}

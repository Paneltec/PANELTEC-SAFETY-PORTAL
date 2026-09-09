/**
 * BOM Australia weather service — v58.13.132ab.
 *
 * Fetches the backend proxy at /api/mobile/weather which itself hits
 * BOM's public JSON observation endpoints. Client-side we just cache
 * for 30 min in memory and hand results to the home hero.
 */
import axios from 'axios';
import { getStoredJwt } from './auth';

const API = process.env.EXPO_PUBLIC_BACKEND_URL;

export interface BomWeather {
  available: boolean;
  station_name?: string;
  station_wmo?: string;
  product?: string;
  temperature_c?: number | null;
  apparent_c?: number | null;
  condition?: string;
  wind_kmh?: number | null;
  wind_dir?: string;
  humidity_pct?: number | null;
  rain_since_9am_mm?: number | string | null;
  observed_at?: string;
  today_max_c?: number | null;
  today_min_c?: number | null;
  rain_probability_pct?: number | null;
  error?: string;
}

let _cache: { at: number; key: string; data: BomWeather } | null = null;
const TTL_MS = 30 * 60 * 1000;

async function authHeaders(): Promise<Record<string, string>> {
  const jwt = await getStoredJwt();
  return jwt ? { Authorization: `Bearer ${jwt}` } : {};
}

export async function fetchWeather(lat?: number, lng?: number): Promise<BomWeather> {
  const key = `${lat ?? 'x'}:${lng ?? 'x'}`;
  const now = Date.now();
  if (_cache && _cache.key === key && (now - _cache.at) < TTL_MS) {
    return _cache.data;
  }
  const headers = await authHeaders();
  const params: Record<string, number> = {};
  if (lat != null) params.lat = lat;
  if (lng != null) params.lng = lng;
  try {
    const { data } = await axios.get<BomWeather>(`${API}/api/mobile/weather`, {
      params, headers, timeout: 8000,
    });
    _cache = { at: now, key, data };
    return data;
  } catch (e) {
    return { available: false, error: 'network' };
  }
}

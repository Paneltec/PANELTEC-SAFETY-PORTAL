import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;
export const API_BASE = `${BASE}/api`;

export const TOKEN_KEY = 'paneltec_token';
export const USER_KEY = 'paneltec_user';

const api = axios.create({ baseURL: API_BASE, timeout: 120000 });

api.interceptors.request.use(async (config) => {
  const t = await AsyncStorage.getItem(TOKEN_KEY);
  if (t) config.headers.Authorization = `Bearer ${t}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  async (err) => {
    const status = err?.response?.status;
    if (status === 401) {
      await AsyncStorage.removeItem(TOKEN_KEY);
      await AsyncStorage.removeItem(USER_KEY);
    }
    return Promise.reject(err);
  },
);

export default api;

export function apiError(e: any): string {
  const d = e?.response?.data?.detail;
  if (!d) return e?.message || 'Something went wrong';
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) return d.map((x: any) => x?.msg || JSON.stringify(x)).join(' · ');
  if (d?.msg) return d.msg;
  return JSON.stringify(d);
}

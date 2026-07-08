import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { previewToken, isPreviewMode } from './preview';

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;
export const API_BASE = `${BASE}/api`;

export const TOKEN_KEY = 'paneltec_token';
export const USER_KEY = 'paneltec_user';

const api = axios.create({ baseURL: API_BASE, timeout: 120000 });

// v160.0.9 — Explicit platform header lets the backend enforce the
// mobile_modules toggle matrix (Cycle 2). Web callers do not set this,
// so they bypass the module gate.
api.defaults.headers.common['x-client-platform'] = 'mobile';

// Global logout handler — set by AuthContext
let _forceLogout: ((reason: string) => void) | null = null;
export function setForceLogoutHandler(fn: (reason: string) => void) { _forceLogout = fn; }

api.interceptors.request.use(async (config) => {
  // Preview mode: use the injected token directly (never read from storage)
  if (isPreviewMode && previewToken) {
    config.headers.Authorization = `Bearer ${previewToken}`;
    return config;
  }
  // Normal mode: read stored token
  const t = await AsyncStorage.getItem(TOKEN_KEY);
  if (t) config.headers.Authorization = `Bearer ${t}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  async (err) => {
    const status = err?.response?.status;
    const reason = err?.response?.headers?.['x-auth-reason'];
    // In preview mode, don't wipe storage or force-logout — just reject
    if (isPreviewMode) return Promise.reject(err);
    if (status === 401) {
      await AsyncStorage.removeItem(TOKEN_KEY);
      await AsyncStorage.removeItem(USER_KEY);
      await AsyncStorage.removeItem('paneltec_perms');
      if (reason && _forceLogout) {
        const msg = reason === 'token-revoked'
          ? 'Your session was ended by an administrator. Please log in again.'
          : reason === 'jwt-expired'
          ? 'Your session has expired. Please log in again.'
          : 'Your session is no longer valid. Please log in again.';
        _forceLogout(msg);
      }
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

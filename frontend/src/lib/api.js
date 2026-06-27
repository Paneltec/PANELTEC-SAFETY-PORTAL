// Axios instance for Paneltec Civil API.
// Bearer token in localStorage; 401 → drop token + redirect to /login.
import axios from 'axios';

const BASE = process.env.REACT_APP_BACKEND_URL;
export const API_BASE = `${BASE}/api`;

export const TOKEN_KEY = 'paneltec_token';
export const USER_KEY = 'paneltec_user';

const api = axios.create({ baseURL: API_BASE, timeout: 120000 });

api.interceptors.request.use((config) => {
  const t = localStorage.getItem(TOKEN_KEY);
  if (t) config.headers.Authorization = `Bearer ${t}`;
  return config;
});

// Only platform-JWT auth failures should force a sign-out. Anything else
// (upstream provider 401s, stale PDF tokens, expired share links, etc.) is
// surfaced as a regular API error and must NOT log the user out.
const PLATFORM_AUTH_REASONS = new Set([
  'jwt-missing',
  'jwt-invalid',
  'jwt-expired',
  'token-revoked',
  'account-disabled',
]);

api.interceptors.response.use(
  (r) => r,
  (err) => {
    const status = err?.response?.status;
    const reason = err?.response?.headers?.['x-auth-reason'];
    if (status === 401 && PLATFORM_AUTH_REASONS.has(reason)) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        window.location.assign('/login');
      }
    }
    return Promise.reject(err);
  },
);

export default api;

// Helper for FastAPI's varied error shapes
export function apiError(e) {
  const d = e?.response?.data?.detail;
  if (!d) return e?.message || 'Something went wrong';
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) return d.map((x) => x?.msg || JSON.stringify(x)).join(' · ');
  if (d?.msg) return d.msg;
  return JSON.stringify(d);
}

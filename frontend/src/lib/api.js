// Axios instance for Paneltec Civil API.
// Bearer token in localStorage; 401 → drop token + redirect to /.
//
// ── v58.13.63 — localStorage storage decision (documented) ───────────
//
// The platform JWT (`paneltec_token`) intentionally lives in
// `localStorage`, not `sessionStorage` or an HttpOnly cookie. This
// note captures WHY so future security reviews don't try to move it
// without appreciating the blast radius.
//
// Why localStorage is acceptable HERE, TODAY:
//   1. The JWT is SHORT-LIVED. `auth.py` mints tokens with a bounded
//      TTL; expired tokens fail with `x-auth-reason: jwt-expired`
//      and the interceptor below drops the local copy + redirects.
//   2. Every user record has a monotonic `token_version` field.
//      Rotating a password (seed_stephen.py, admin reset, etc.) bumps
//      the version and INVALIDATES every token minted before the bump
//      — server-side revocation with no client cooperation needed.
//   3. Refresh is server-mediated. Clients POST to `/api/auth/refresh`
//      with the current token; the server returns a new one and
//      updates `token_version` accordingly. See `lib/auth.js`.
//
// Why NOT sessionStorage:
//   · Would sign every user out on tab close — a known-hostile UX
//     regression for a WHS platform that field workers use on shared
//     iPads and back-office admins keep pinned across shifts.
//   · Would break `BulkImportPill` cross-tab sync, which relies on
//     `storage` events fired against `localStorage` explicitly.
//
// Why NOT HttpOnly cookies + in-memory JWT (the "real" XSS fix):
//   · The correct answer to "XSS could steal a localStorage token" is
//     an HttpOnly refresh cookie + short-lived in-memory access JWT.
//     That refactor touches every fetch call, every interceptor, CORS,
//     CSRF token handling, and the SW auth passthrough. Estimated
//     multi-week effort. TRACKED as a follow-up candidate; deliberately
//     NOT shipped in v58.13.63.
//
// Whitelist (enforced by `tests/frontend_smoke/test_localStorage_whitelist_v58_13_63.py`):
//   · Only `lib/auth.js` and `lib/api.js` may WRITE `paneltec_token`.
//   · Only files that IMPORT `TOKEN_KEY` from `lib/api` may READ it.
//   · The `bulkImport.*` job-UUID keys may only appear under
//     `pages/prestarts/BulkImport/*`.
//   · No literal `'paneltec_token'` string is allowed anywhere else.
//
// If you're adding a new page that needs to call the API, DO NOT read
// `localStorage` directly — import the shared `api` axios instance
// from this module and it will attach the Bearer for you.

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
      if (typeof window !== 'undefined' && window.location.pathname !== '/' && !window.location.pathname.startsWith('/login')) {
        // Preserve where the user was so the login screen can send them back.
        const here = window.location.pathname + window.location.search;
        const safeHere = here.startsWith('/') && !here.startsWith('//') ? here : '/app/dashboard';
        window.location.assign(`/?next=${encodeURIComponent(safeHere)}`);
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

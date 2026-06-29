// Real JWT auth — replaces the Phase 1 localStorage mock.
import api, { TOKEN_KEY, USER_KEY } from './api';

/**
 * Read a `next` query param from the current location and return a safe
 * same-origin relative path. Rejects:
 *   - absolute URLs (`http://…`, `https://…`)
 *   - protocol-relative URLs (`//evil.com`)
 *   - anything not starting with `/`
 *   - paths starting with `\` (backslash quirks)
 * Falls back to `defaultPath` ("/app/dashboard") when invalid or absent.
 */
export function safeNext(search, defaultPath = '/app/dashboard') {
  try {
    const sp = new URLSearchParams(typeof search === 'string' ? search : (search?.toString?.() ?? ''));
    const raw = sp.get('next');
    if (!raw) return defaultPath;
    if (raw.length > 512) return defaultPath;
    // Disallow absolute / protocol-relative.
    if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return defaultPath;
    // Disallow encoded scheme tricks like `/%2F%2Fevil`.
    const decoded = decodeURIComponent(raw);
    if (decoded.startsWith('//') || /^[a-z]+:/i.test(decoded.replace(/^\/+/, ''))) return defaultPath;
    return raw;
  } catch {
    return defaultPath;
  }
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function getUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function persist(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export async function login(email, password, options = {}) {
  const { remember_me = false } = options;
  const { data } = await api.post('/auth/login', { email, password, remember_me });
  persist(data.access_token, data.user);
  return data.user;
}

export async function loginWithSimpro(email) {
  const { data } = await api.post('/auth/login-with-simpro', { email });
  persist(data.access_token, data.user);
  return data.user;
}

export async function refreshToken() {
  // Silent rolling refresh. Called on app mount. Fails silently if invalid.
  try {
    const { data } = await api.post('/auth/refresh');
    if (data?.access_token) {
      localStorage.setItem(TOKEN_KEY, data.access_token);
      if (data.user) localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    }
    return true;
  } catch {
    return false;
  }
}

export async function signup(payload) {
  const { data } = await api.post('/auth/signup', payload);
  persist(data.access_token, data.user);
  return data.user;
}

export async function fetchMe() {
  const { data } = await api.get('/auth/me');
  localStorage.setItem(USER_KEY, JSON.stringify(data));
  return data;
}

export async function signOut() {
  try { await api.post('/auth/logout'); } catch { /* stateless */ }
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function initials(u) {
  if (!u) return 'U';
  return (u.name || u.email || 'User')
    .split(/[\s@.]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('');
}

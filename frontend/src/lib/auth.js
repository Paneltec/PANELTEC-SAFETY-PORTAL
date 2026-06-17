// Real JWT auth — replaces the Phase 1 localStorage mock.
import api, { TOKEN_KEY, USER_KEY } from './api';

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

export async function login(email, password) {
  const { data } = await api.post('/auth/login', { email, password });
  persist(data.access_token, data.user);
  return data.user;
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

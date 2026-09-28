/**
 * Phase 4 — Civil API service.
 * Uses JWT from email/password login (paneltec_token).
 * Mirrors the web frontend's API patterns exactly.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const API = process.env.EXPO_PUBLIC_BACKEND_URL;
const TOKEN_KEY = 'paneltec_token';
const USER_KEY = 'paneltec_user';

let SecureStore: any = {};
if (Platform.OS !== 'web') {
  try { SecureStore = require('expo-secure-store'); } catch {}
}

async function getToken(): Promise<string | null> {
  if (SecureStore.getItemAsync && Platform.OS !== 'web') {
    try { return await SecureStore.getItemAsync(TOKEN_KEY); } catch {}
  }
  return AsyncStorage.getItem(TOKEN_KEY);
}

async function setToken(token: string): Promise<void> {
  if (SecureStore.setItemAsync && Platform.OS !== 'web') {
    try { await SecureStore.setItemAsync(TOKEN_KEY, token); return; } catch {}
  }
  return AsyncStorage.setItem(TOKEN_KEY, token);
}

async function deleteToken(): Promise<void> {
  if (SecureStore.deleteItemAsync && Platform.OS !== 'web') {
    try { await SecureStore.deleteItemAsync(TOKEN_KEY); return; } catch {}
  }
  return AsyncStorage.removeItem(TOKEN_KEY);
}

export async function getStoredCivilUser(): Promise<any | null> {
  const raw = await AsyncStorage.getItem(USER_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// Get first workspace_id for creating records
export async function getDefaultWorkspaceId(): Promise<string | null> {
  const user = await getStoredCivilUser();
  if (user?.workspace_ids?.length > 0) return user.workspace_ids[0];
  return null;
}

export async function getCivilToken(): Promise<string | null> {
  return getToken();
}

export async function hasCivilSession(): Promise<boolean> {
  const t = await getToken();
  return !!t;
}

// Login with email + password
export async function civilLogin(email: string, password: string): Promise<{
  ok: boolean;
  user?: any;
  error?: string;
}> {
  try {
    const resp = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (resp.status === 401 || resp.status === 403) {
      return { ok: false, error: 'Invalid email or password.' };
    }
    if (resp.status === 429) {
      return { ok: false, error: 'Too many attempts. Try again in a minute.' };
    }
    if (resp.status >= 500) {
      return { ok: false, error: 'Server unavailable. Try again shortly.' };
    }
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      return { ok: false, error: body?.detail || `Error ${resp.status}` };
    }
    const data = await resp.json();
    await setToken(data.access_token);
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(data.user));
    return { ok: true, user: data.user };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Network error' };
  }
}

export async function civilLogout(): Promise<void> {
  const token = await getToken();
  if (token) {
    try {
      await fetch(`${API}/api/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {}
  }
  await deleteToken();
  await AsyncStorage.removeItem(USER_KEY);
}

// Authenticated GET
export async function civilGet<T = any>(path: string, params?: Record<string, string>): Promise<{
  ok: boolean;
  data?: T;
  error?: string;
  expired?: boolean;
}> {
  const token = await getToken();
  if (!token) return { ok: false, expired: true };
  try {
    let url = `${API}/api${path}`;
    if (params) {
      const sp = new URLSearchParams(params);
      url += `?${sp.toString()}`;
    }
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (resp.status === 401) return { ok: false, expired: true };
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      return { ok: false, error: body?.detail || `HTTP ${resp.status}` };
    }
    const data = await resp.json();
    return { ok: true, data };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Network error' };
  }
}

// Authenticated POST (JSON)
export async function civilPost<T = any>(path: string, body: any): Promise<{
  ok: boolean;
  data?: T;
  error?: string;
  expired?: boolean;
}> {
  const token = await getToken();
  if (!token) return { ok: false, expired: true };
  try {
    const resp = await fetch(`${API}/api${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (resp.status === 401) return { ok: false, expired: true };
    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({}));
      return { ok: false, error: errBody?.detail || `HTTP ${resp.status}` };
    }
    const data = await resp.json();
    return { ok: true, data };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Network error' };
  }
}

// Authenticated POST (FormData — for file uploads)
export async function civilPostForm<T = any>(path: string, formData: FormData): Promise<{
  ok: boolean;
  data?: T;
  error?: string;
  expired?: boolean;
  status?: number;
}> {
  const token = await getToken();
  if (!token) return { ok: false, expired: true };
  try {
    const resp = await fetch(`${API}/api${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    if (resp.status === 401) return { ok: false, expired: true };
    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({}));
      return { ok: false, error: errBody?.detail || `HTTP ${resp.status}`, status: resp.status };
    }
    const data = await resp.json();
    return { ok: true, data };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Network error' };
  }
}

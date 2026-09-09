/**
 * Mobile auth service — v58.13.132cj rewrite.
 *
 * PIN-login flow using POST /api/auth/mobile/pin-login.
 * Role auto-detection from backend response.
 * Session token stored in expo-secure-store (native) / AsyncStorage (web).
 * Device ID persisted across sessions; session cleared on logout.
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
const API = process.env.EXPO_PUBLIC_BACKEND_URL;

// ── Storage abstraction ──────────────────────────────────────────
// expo-secure-store for native (encrypted keychain), AsyncStorage for web.
let SecureStore: {
  getItemAsync?: (k: string) => Promise<string | null>;
  setItemAsync?: (k: string, v: string) => Promise<void>;
  deleteItemAsync?: (k: string) => Promise<void>;
} = {};

if (Platform.OS !== 'web') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    SecureStore = require('expo-secure-store');
  } catch {
    SecureStore = {};
  }
}

const Storage = {
  async getItem(key: string): Promise<string | null> {
    if (SecureStore.getItemAsync && Platform.OS !== 'web') {
      try { return await SecureStore.getItemAsync(key); }
      catch { return AsyncStorage.getItem(key); }
    }
    return AsyncStorage.getItem(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    if (SecureStore.setItemAsync && Platform.OS !== 'web') {
      try { await SecureStore.setItemAsync(key, value); return; }
      catch { /* fall through */ }
    }
    return AsyncStorage.setItem(key, value);
  },
  async deleteItem(key: string): Promise<void> {
    if (SecureStore.deleteItemAsync && Platform.OS !== 'web') {
      try { await SecureStore.deleteItemAsync(key); return; }
      catch { /* fall through */ }
    }
    return AsyncStorage.removeItem(key);
  },
};

// ── Keys ─────────────────────────────────────────────────────────
const KEYS = {
  sessionToken:    'paneltec_session_token',
  user:            'paneltec_user',
  roleId:          'paneltec_role_id',
  roleLabel:       'paneltec_role_label',
  deviceId:        'paneltec_device_id',
  orgId:           'paneltec_org_id',
  orgName:         'paneltec_org_name',
  permissions:     'paneltec_permissions',
  // Legacy keys for backward compat (preview mode, etc.)
  jwt:             'paneltec_jwt',
  employeeId:      'paneltec_employee_id',
} as const;

// ── Types ────────────────────────────────────────────────────────
export type RoleId = 'admin' | 'paneltec_civil' | 'viatec_traffic' | 'external_contractor';

export interface PinLoginResponse {
  user_id: string;
  name: string;
  email: string;
  role_id: RoleId;
  role_label: string;
  org_id: string;
  org_name: string;
  session_token: string;
  session_token_expires_at: string;
  permissions_snapshot: Record<string, Record<string, boolean>>;
}

export interface PinLoginError {
  error: 'invalid_pin' | 'account_disabled' | 'pin_expired';
}

export interface RateLimitError {
  error: 'rate_limited';
  retry_after_seconds: number;
}

// ── Device ID ────────────────────────────────────────────────────
export async function getDeviceId(): Promise<string | null> {
  return Storage.getItem(KEYS.deviceId);
}

export async function setDeviceId(id: string): Promise<void> {
  await Storage.setItem(KEYS.deviceId, id);
}

export async function isProvisioned(): Promise<boolean> {
  const id = await getDeviceId();
  return !!id;
}

// ── PIN Login ────────────────────────────────────────────────────
export async function pinLogin(
  pin: string,
  deviceId?: string,
): Promise<
  | { ok: true; data: PinLoginResponse }
  | { ok: false; error: 'invalid_pin' | 'account_disabled' | 'pin_expired' }
  | { ok: false; error: 'rate_limited'; retryAfterSeconds: number }
  | { ok: false; error: 'network' }
> {
  const device = deviceId || (await getDeviceId()) || undefined;
  try {
    const body: Record<string, unknown> = { pin };
    if (device) body.device_id = device;

    const resp = await fetch(`${API}/api/auth/mobile/pin-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (resp.status === 429) {
      const retryHeader = resp.headers.get('Retry-After');
      let retryAfterSeconds = retryHeader ? parseInt(retryHeader, 10) : 60;
      try {
        const errBody = await resp.json();
        if (errBody?.detail?.retry_after_seconds) retryAfterSeconds = errBody.detail.retry_after_seconds;
      } catch { /* ignore */ }
      return { ok: false, error: 'rate_limited' as const, retryAfterSeconds };
    }

    if (resp.status === 401) {
      try {
        const errBody = await resp.json();
        const errorCode = errBody?.detail?.error || 'invalid_pin';
        return { ok: false, error: errorCode as 'invalid_pin' | 'account_disabled' | 'pin_expired' };
      } catch {
        return { ok: false, error: 'invalid_pin' as const };
      }
    }

    if (!resp.ok) {
      return { ok: false, error: 'network' as const };
    }

    const data: PinLoginResponse = await resp.json();
    // Store session
    await Storage.setItem(KEYS.sessionToken, data.session_token);
    await Storage.setItem(KEYS.jwt, data.session_token); // legacy compat
    await Storage.setItem(KEYS.user, JSON.stringify({
      id: data.user_id,
      name: data.name,
      email: data.email,
      role_id: data.role_id,
      role_label: data.role_label,
      org_id: data.org_id,
      org_name: data.org_name,
    }));
    await Storage.setItem(KEYS.roleId, data.role_id);
    await Storage.setItem(KEYS.roleLabel, data.role_label);
    await Storage.setItem(KEYS.orgId, data.org_id);
    await Storage.setItem(KEYS.orgName, data.org_name);
    if (data.permissions_snapshot) {
      await Storage.setItem(KEYS.permissions, JSON.stringify(data.permissions_snapshot));
    }
    return { ok: true, data };
  } catch {
    return { ok: false, error: 'network' as const };
  }
}

// ── Session Accessors ────────────────────────────────────────────
export async function getStoredJwt(): Promise<string | null> {
  // Preview session takes precedence on web
  if (Platform.OS === 'web') {
    try {
      const preview = sessionStorage.getItem('paneltec_preview_jwt');
      if (preview) return preview;
    } catch { /* noop */ }
  }
  return Storage.getItem(KEYS.sessionToken);
}

export function isPreviewSession(): boolean {
  if (Platform.OS !== 'web') return false;
  try { return !!sessionStorage.getItem('paneltec_preview_jwt'); }
  catch { return false; }
}

export async function getStoredUser(): Promise<any | null> {
  if (Platform.OS === 'web') {
    try {
      const raw = sessionStorage.getItem('paneltec_preview_user');
      if (raw) return JSON.parse(raw);
    } catch { /* noop */ }
  }
  const raw = await Storage.getItem(KEYS.user);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function getStoredRole(): Promise<RoleId | null> {
  const role = await Storage.getItem(KEYS.roleId);
  if (role === 'admin' || role === 'paneltec_civil' || role === 'viatec_traffic' || role === 'external_contractor') {
    return role;
  }
  return null;
}

export async function getStoredRoleLabel(): Promise<string | null> {
  return Storage.getItem(KEYS.roleLabel);
}

export async function getPermissions(): Promise<Record<string, Record<string, boolean>> | null> {
  const raw = await Storage.getItem(KEYS.permissions);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function hasValidSession(): Promise<boolean> {
  const token = await Storage.getItem(KEYS.sessionToken);
  return !!token;
}

export async function isOnboarded(): Promise<boolean> {
  return hasValidSession();
}

// ── Logout ───────────────────────────────────────────────────────
// Clears session + role but PRESERVES device_id (device stays provisioned)
export async function clearSession(): Promise<void> {
  await Storage.deleteItem(KEYS.sessionToken);
  await Storage.deleteItem(KEYS.jwt);
  await Storage.deleteItem(KEYS.user);
  await Storage.deleteItem(KEYS.roleId);
  await Storage.deleteItem(KEYS.roleLabel);
  await Storage.deleteItem(KEYS.orgId);
  await Storage.deleteItem(KEYS.orgName);
  await Storage.deleteItem(KEYS.permissions);
  await Storage.deleteItem(KEYS.employeeId);
}

// Full wipe — also removes device_id (re-provisioning required)
export async function fullWipe(): Promise<void> {
  await clearSession();
  await Storage.deleteItem(KEYS.deviceId);
}

// ── Legacy shims (keep existing consumers working) ───────────────
export async function logout(): Promise<void> {
  return clearSession();
}

/**
 * Mobile auth service — v58.13.132cl.
 *
 * PIN-login flow using POST /api/auth/mobile/pin-login.
 * Device-hint flow using GET /api/auth/mobile/device-hint.
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

export interface DeviceHintResponse {
  bound: boolean;
  user_first_name?: string;
  role_label?: string;
  org_name?: string;
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

// ── Device Hint (v58.13.132cl) ───────────────────────────────────
// GET /api/auth/mobile/device-hint?device_id=<uuid>
// No auth. Returns {bound, user_first_name?, role_label?, org_name?}.
// In-memory cache for current session — doesn't re-fetch on every render.
let _hintCache: { deviceId: string; result: DeviceHintResponse } | null = null;

export async function fetchDeviceHint(deviceId?: string): Promise<DeviceHintResponse> {
  const id = deviceId || (await getDeviceId());
  if (!id) return { bound: false };

  // Return cached if same device_id
  if (_hintCache && _hintCache.deviceId === id) {
    return _hintCache.result;
  }

  try {
    const resp = await fetch(
      `${API}/api/auth/mobile/device-hint?device_id=${encodeURIComponent(id)}`,
      { method: 'GET' },
    );

    if (resp.status === 429) {
      // Rate limited — skip greeting, fall back to generic
      return { bound: false };
    }
    if (!resp.ok) {
      return { bound: false };
    }

    const data: DeviceHintResponse = await resp.json();
    _hintCache = { deviceId: id, result: data };
    return data;
  } catch {
    // Network error — skip greeting silently
    return { bound: false };
  }
}

/** Invalidate the in-memory hint cache (e.g. after "Not you?" reset). */
export function clearDeviceHintCache(): void {
  _hintCache = null;
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
    // Invalidate hint cache so next login picks up the new binding
    clearDeviceHintCache();
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
  clearDeviceHintCache();
}

// Full wipe — also removes device_id (re-provisioning required)
export async function fullWipe(): Promise<void> {
  await clearSession();
  await Storage.deleteItem(KEYS.deviceId);
  clearDeviceHintCache();
}

// ── Legacy shims (keep existing consumers working) ───────────────
export async function logout(): Promise<void> {
  return clearSession();
}

// ── Onboarding (QR card → app) ───────────────────────────────────────
// Restored in the takeover (post-.132cx). The web landing page at
// /m/onboard/<token> hands the app `paneltec://onboard?token=…`; the app
// redeems the token for a temp session, lets the worker choose a 4-digit
// PIN, then signs in with that PIN so the normal pin-login session is used.

export function generateDeviceId(): string {
  const rnd = () => Math.random().toString(36).slice(2, 10);
  return `dev_${Date.now().toString(36)}_${rnd()}${rnd()}`;
}

/** Return the stored device id, creating and storing one if this phone has none yet. */
export async function ensureDeviceId(): Promise<string> {
  const existing = await getDeviceId();
  if (existing) return existing;
  const id = generateDeviceId();
  await setDeviceId(id);
  return id;
}

export interface OnboardingRedeemResponse {
  user: { name: string; simpro_employee_id: string; company_id: string; company_name: string };
  temp_session: string;
}

export async function redeemOnboardingToken(token: string, deviceId: string): Promise<OnboardingRedeemResponse> {
  let resp: Response;
  try {
    resp = await fetch(`${API}/api/mobile/onboarding/redeem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: token.trim(), device_id: deviceId }),
    });
  } catch {
    throw new Error("Couldn't reach the Paneltec server. Check your internet connection and try again.");
  }
  if (!resp.ok) {
    let detail = 'This setup code is not valid or has already been used. Ask the office for a new one.';
    try { const b = await resp.json(); if (typeof b?.detail === 'string') detail = b.detail; } catch { /* ignore */ }
    throw new Error(detail);
  }
  return resp.json();
}

/** Store the worker's chosen PIN using the onboarding temp session. */
export async function setPinWithTempSession(pin: string, tempSession: string, deviceId: string): Promise<void> {
  const resp = await fetch(`${API}/api/mobile/auth/pin-set`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tempSession}` },
    body: JSON.stringify({ pin_hash: pin, device_id: deviceId }),
  });
  if (!resp.ok) {
    let detail = 'Could not save your PIN. Please try again.';
    try { const b = await resp.json(); if (typeof b?.detail === 'string') detail = b.detail; } catch { /* ignore */ }
    throw new Error(detail);
  }
}

/** Pull a setup token out of whatever a QR scan returned (web link or app link). */
export function extractOnboardingToken(raw: string): string | null {
  const v = (raw || '').trim();
  if (!v) return null;
  const m1 = v.match(/[?&]token=([^&#\s]+)/);
  if (m1) return decodeURIComponent(m1[1]);
  const m2 = v.match(/\/m\/onboard\/([^/?#\s]+)/);
  if (m2) return decodeURIComponent(m2[1]);
  if (/^[A-Za-z0-9_-]{6,64}$/.test(v)) return v; // typed setup code
  return null;
}

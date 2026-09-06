/**
 * Mobile auth service — PIN + JWT flow.
 * Uses expo-secure-store on native, localStorage on web.
 */
import { Platform } from 'react-native';
import axios from 'axios';

const API = process.env.EXPO_PUBLIC_BACKEND_URL;

// Web-safe storage wrapper (SecureStore is native-only)
const Storage = {
  async getItem(key: string): Promise<string | null> {
    if (Platform.OS === 'web') {
      return localStorage.getItem(key);
    }
    const SS = require('expo-secure-store');
    return SS.getItemAsync(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') {
      localStorage.setItem(key, value);
      return;
    }
    const SS = require('expo-secure-store');
    return SS.setItemAsync(key, value);
  },
  async deleteItem(key: string): Promise<void> {
    if (Platform.OS === 'web') {
      localStorage.removeItem(key);
      return;
    }
    const SS = require('expo-secure-store');
    return SS.deleteItemAsync(key);
  },
};

const KEYS = {
  jwt: 'paneltec_jwt',
  user: 'paneltec_user',
  deviceId: 'paneltec_device_id',
  employeeId: 'paneltec_employee_id',
  pinAttempts: 'paneltec_pin_attempts',
  lockUntil: 'paneltec_lock_until',
  biometricEnabled: 'paneltec_biometric',
} as const;

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 60_000;

function getDeviceId(): string {
  return `dev_${Math.random().toString(36).slice(2, 12)}`;
}

export async function ensureDeviceId(): Promise<string> {
  let id = await Storage.getItem(KEYS.deviceId);
  if (!id) {
    id = getDeviceId();
    await Storage.setItem(KEYS.deviceId, id);
  }
  return id;
}

export async function redeemOnboardingToken(token: string): Promise<any> {
  const deviceId = await ensureDeviceId();
  const { data } = await axios.post(`${API}/api/mobile/onboarding/redeem`, {
    token,
    device_id: deviceId,
  });
  return data;
}

export async function setPin(pinHash: string, tempSession: string): Promise<any> {
  const deviceId = await ensureDeviceId();
  const { data } = await axios.post(`${API}/api/mobile/auth/pin-set`, {
    pin_hash: pinHash,
    device_id: deviceId,
  }, {
    headers: { Authorization: `Bearer ${tempSession}` },
  });
  if (data.token) {
    await Storage.setItem(KEYS.jwt, data.token);
    await Storage.setItem(KEYS.user, JSON.stringify(data.user));
    if (data.user?.simpro_employee_id) {
      await Storage.setItem(KEYS.employeeId, data.user.simpro_employee_id);
    }
  }
  return data;
}

export async function verifyPin(pin: string): Promise<{ ok: boolean; locked?: boolean; lockSeconds?: number; data?: any }> {
  // Check lockout
  const lockUntil = await Storage.getItem(KEYS.lockUntil);
  if (lockUntil) {
    const lockTime = parseInt(lockUntil, 10);
    if (Date.now() < lockTime) {
      return { ok: false, locked: true, lockSeconds: Math.ceil((lockTime - Date.now()) / 1000) };
    }
    await Storage.deleteItem(KEYS.lockUntil);
    await Storage.deleteItem(KEYS.pinAttempts);
  }

  const deviceId = await ensureDeviceId();
  const employeeId = await Storage.getItem(KEYS.employeeId);

  try {
    const { data } = await axios.post(`${API}/api/mobile/auth/pin-verify`, {
      device_id: deviceId,
      simpro_employee_id: employeeId || undefined,
      pin_hash: pin,
    });
    await Storage.deleteItem(KEYS.pinAttempts);
    await Storage.deleteItem(KEYS.lockUntil);
    if (data.token) {
      await Storage.setItem(KEYS.jwt, data.token);
      await Storage.setItem(KEYS.user, JSON.stringify(data.user));
    }
    return { ok: true, data };
  } catch {
    const attempts = parseInt((await Storage.getItem(KEYS.pinAttempts)) || '0', 10) + 1;
    await Storage.setItem(KEYS.pinAttempts, String(attempts));
    if (attempts >= MAX_ATTEMPTS) {
      await Storage.setItem(KEYS.lockUntil, String(Date.now() + LOCKOUT_MS));
      return { ok: false, locked: true, lockSeconds: LOCKOUT_MS / 1000 };
    }
    return { ok: false };
  }
}

export async function getStoredJwt(): Promise<string | null> {
  return Storage.getItem(KEYS.jwt);
}

export async function getStoredUser(): Promise<any | null> {
  const raw = await Storage.getItem(KEYS.user);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function isOnboarded(): Promise<boolean> {
  // Onboarded = has device and employee binding (PIN was set)
  const emp = await Storage.getItem(KEYS.employeeId);
  const devId = await Storage.getItem(KEYS.deviceId);
  return !!emp && !!devId;
}

export async function hasValidSession(): Promise<boolean> {
  const jwt = await getStoredJwt();
  return !!jwt;
}

export async function logout(): Promise<void> {
  await Storage.deleteItem(KEYS.jwt);
  await Storage.deleteItem(KEYS.user);
  await Storage.deleteItem(KEYS.pinAttempts);
  await Storage.deleteItem(KEYS.lockUntil);
}

export async function setBiometricEnabled(enabled: boolean): Promise<void> {
  await Storage.setItem(KEYS.biometricEnabled, enabled ? '1' : '0');
}

export async function isBiometricEnabled(): Promise<boolean> {
  return (await Storage.getItem(KEYS.biometricEnabled)) === '1';
}

/**
 * Role Simulator — v58.13.132iu
 * Admin-only: injects X-Simulate-Role header on all API calls.
 * Persisted in AsyncStorage so it survives reloads.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'paneltec_simulate_role';

export type SimulateRoleId = '' | 'paneltec_civil' | 'viatec_traffic' | 'external_contractor';

export const ROLE_OPTIONS: { id: SimulateRoleId; label: string }[] = [
  { id: '',                     label: 'Off (Admin)' },
  { id: 'paneltec_civil',      label: 'Paneltec Civil' },
  { id: 'viatec_traffic',      label: 'Viatec Traffic' },
  { id: 'external_contractor', label: 'External Contractor' },
];

// In-memory cache so we don't hit AsyncStorage on every fetch
let _cached: SimulateRoleId | null = null;

/** Read the current simulated role ('' = off). */
export async function getSimulateRole(): Promise<SimulateRoleId> {
  if (_cached !== null) return _cached;
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  _cached = (raw as SimulateRoleId) || '';
  return _cached;
}

/** Set (or clear) the simulated role. */
export async function setSimulateRole(role: SimulateRoleId): Promise<void> {
  _cached = role;
  if (role) {
    await AsyncStorage.setItem(STORAGE_KEY, role);
  } else {
    await AsyncStorage.removeItem(STORAGE_KEY);
  }
}

/** Returns extra headers to merge into every API call. */
export async function getSimulateHeaders(): Promise<Record<string, string>> {
  const role = await getSimulateRole();
  if (role) return { 'X-Simulate-Role': role };
  return {};
}

/** Sync getter for banner display (returns cached value, may be null on first render). */
export function getCachedSimulateRole(): SimulateRoleId {
  return _cached || '';
}

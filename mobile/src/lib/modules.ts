import AsyncStorage from '@react-native-async-storage/async-storage';
import api from './api';

const MODULES_KEY = 'paneltec_mobile_modules';

/** All 13 module IDs the backend can return */
export type ModuleId =
  | 'pre_start' | 'site_diary' | 'hazard' | 'incident' | 'inspection'
  | 'swms' | 'inductions' | 'plant_vehicles' | 'service_maintenance'
  | 'certifications' | 'ask_intel' | 'sign_on' | 'profile';

export type ModuleMap = Record<ModuleId, boolean>;

/** Minimal safe fallback — sign_on + profile only */
export const SAFE_FALLBACK: ModuleMap = {
  pre_start: false,
  site_diary: false,
  hazard: false,
  incident: false,
  inspection: false,
  swms: false,
  inductions: false,
  plant_vehicles: false,
  service_maintenance: false,
  certifications: false,
  ask_intel: false,
  sign_on: true,
  profile: true,
};

const ALL_KEYS: ModuleId[] = Object.keys(SAFE_FALLBACK) as ModuleId[];

/** Normalise a raw API response — missing keys default to false */
function normalise(raw: Record<string, boolean> | undefined): ModuleMap {
  if (!raw) return { ...SAFE_FALLBACK };
  const out = { ...SAFE_FALLBACK };
  for (const k of ALL_KEYS) {
    out[k] = raw[k] === true;
  }
  return out;
}

/** Fetch from backend, normalise, and persist to AsyncStorage */
export async function fetchModules(): Promise<ModuleMap> {
  const { data } = await api.get('/me/mobile-modules');
  const map = normalise(data?.modules);
  await AsyncStorage.setItem(MODULES_KEY, JSON.stringify(map));
  return map;
}

/** Read cached modules from AsyncStorage */
export async function getCachedModules(): Promise<ModuleMap | null> {
  try {
    const raw = await AsyncStorage.getItem(MODULES_KEY);
    if (!raw) return null;
    return normalise(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Clear cached modules (on sign-out) */
export async function clearModules(): Promise<void> {
  await AsyncStorage.removeItem(MODULES_KEY);
}

/** Check if at least one non-profile module is enabled */
export function hasAnyModule(m: ModuleMap): boolean {
  return ALL_KEYS.some(k => k !== 'profile' && m[k]);
}

/** Check if any "capture" module is on */
export function hasAnyCaptureModule(m: ModuleMap): boolean {
  return m.pre_start || m.site_diary || m.hazard || m.incident || m.inspection;
}

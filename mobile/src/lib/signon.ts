import AsyncStorage from '@react-native-async-storage/async-storage';

const SIGNON_KEY = 'paneltec_active_signon';

export interface ActiveSignOn {
  signon_id: string;
  site_name: string;
  signed_at: string;
}

type Listener = () => void;
const _listeners: Listener[] = [];
function notify() { _listeners.forEach(fn => fn()); }

export function onSignOnChange(fn: Listener) {
  _listeners.push(fn);
  return () => {
    const i = _listeners.indexOf(fn);
    if (i >= 0) _listeners.splice(i, 1);
  };
}

export async function getActiveSignOn(): Promise<ActiveSignOn | null> {
  try {
    const raw = await AsyncStorage.getItem(SIGNON_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export async function setActiveSignOn(data: ActiveSignOn): Promise<void> {
  await AsyncStorage.setItem(SIGNON_KEY, JSON.stringify(data));
  notify();
}

export async function clearActiveSignOn(): Promise<void> {
  await AsyncStorage.removeItem(SIGNON_KEY);
  notify();
}

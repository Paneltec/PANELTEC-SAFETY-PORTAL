import AsyncStorage from '@react-native-async-storage/async-storage';
import api, { TOKEN_KEY, USER_KEY } from './api';
import { setPermissions, clearPermissions } from './permissions';

export async function getToken(): Promise<string | null> {
  return AsyncStorage.getItem(TOKEN_KEY);
}

export async function getUser(): Promise<any | null> {
  try {
    const raw = await AsyncStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function persist(token: string, user: any) {
  await AsyncStorage.setItem(TOKEN_KEY, token);
  await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
}

export async function login(email: string, password: string) {
  const { data } = await api.post('/auth/login', { email, password });
  await persist(data.access_token, data.user);
  // Immediately fetch effective_permissions from /me
  try {
    const { data: me } = await api.get('/auth/me');
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(me));
    if (me.effective_permissions) {
      await setPermissions(me.effective_permissions);
    }
    if (me.token_version !== undefined) {
      await AsyncStorage.setItem('paneltec_token_version', String(me.token_version));
    }
    return me;
  } catch {
    return data.user;
  }
}

export async function signup(payload: { name: string; org_name: string; email: string; password: string }) {
  const { data } = await api.post('/auth/signup', payload);
  await persist(data.access_token, data.user);
  try {
    const { data: me } = await api.get('/auth/me');
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(me));
    if (me.effective_permissions) {
      await setPermissions(me.effective_permissions);
    }
    return me;
  } catch {
    return data.user;
  }
}

export async function fetchMe() {
  const { data } = await api.get('/auth/me');
  await AsyncStorage.setItem(USER_KEY, JSON.stringify(data));
  if (data.effective_permissions) {
    await setPermissions(data.effective_permissions);
  }
  return data;
}

export async function signOut() {
  try { await api.post('/auth/logout'); } catch { /* stateless */ }
  await AsyncStorage.removeItem(TOKEN_KEY);
  await AsyncStorage.removeItem(USER_KEY);
  await clearPermissions();
  await AsyncStorage.removeItem('paneltec_token_version');
}

export function initials(u: any): string {
  if (!u) return 'U';
  return (u.name || u.email || 'User')
    .split(/[\s@.]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s: string) => s[0]?.toUpperCase())
    .join('');
}

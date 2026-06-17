// MOCKED: Phase 1 auth is fake — no backend calls. Replace in Phase 2.
const KEY = 'paneltec_user';

export function getUser() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function signIn({ email, name, org }) {
  const user = {
    email: email || 'demo@paneltec.com',
    name: name || 'Demo User',
    org: org || 'Paneltec Civil Demo',
    initials: (name || email || 'Demo User')
      .split(/[\s@.]/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase())
      .join(''),
  };
  localStorage.setItem(KEY, JSON.stringify(user));
  return user;
}

export function signOut() {
  localStorage.removeItem(KEY);
}

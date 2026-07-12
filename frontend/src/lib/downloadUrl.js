// v160.3.4b — Short-lived download-token helper.
//
// File-serving endpoints (`<a href>`, `<img src>`) cannot attach a Bearer
// header. Instead we fetch a 15-minute JWT via `POST /api/auth/download-token`
// and append it to the URL as `?token=<jwt>`.
//
// The token is cached in-memory and re-fetched once it's within a 90-second
// safety margin of expiry. If a fetch fails we fall back to a rejected
// promise — callers should still render a "file unavailable" state rather
// than a broken image / 401 page.
import api, { API_BASE } from './api';

let cached = null; // { token, expiresAt (ms epoch) }
let inflight = null;
const SAFETY_MARGIN_MS = 90 * 1000;

async function fetchToken() {
  const { data } = await api.post('/auth/download-token');
  const ttlMs = (data?.expires_in_seconds || 900) * 1000;
  cached = {
    token: data.token,
    expiresAt: Date.now() + ttlMs,
  };
  return cached.token;
}

export async function getDownloadToken() {
  if (cached && Date.now() < cached.expiresAt - SAFETY_MARGIN_MS) {
    return cached.token;
  }
  // De-dupe concurrent callers so one fetch serves everyone.
  if (!inflight) {
    inflight = fetchToken().finally(() => { inflight = null; });
  }
  return inflight;
}

// Compose a full, tokenised URL for an API-relative path.
// Example: filesUrl('/workers/abc/photo/xyz') → 'https://.../api/workers/abc/photo/xyz?token=...'
export async function filesUrl(pathOrRelative) {
  const token = await getDownloadToken();
  const path = pathOrRelative.startsWith('http')
    ? pathOrRelative
    : pathOrRelative.startsWith('/api/')
      ? `${API_BASE.replace(/\/api$/, '')}${pathOrRelative}`
      : `${API_BASE}${pathOrRelative.startsWith('/') ? pathOrRelative : '/' + pathOrRelative}`;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}token=${encodeURIComponent(token)}`;
}

// Force-invalidate the cache — useful when logging out.
export function clearDownloadToken() {
  cached = null;
}

/**
 * Shared mobile API client — v58.13.132iu.
 *
 * Wraps fetch with:
 * - Auto-attach Bearer token from getStoredJwt()
 * - Auto-attach X-Simulate-Role header when admin role sim is active
 * - 401 detection → returns { expired: true } so screens can redirect to PIN
 * - 429 detection → returns { rateLimited: true, retryAfter }
 */
import { getStoredJwt } from './auth';
import { getSimulateHeaders } from './simulateRole';

const API = process.env.EXPO_PUBLIC_BACKEND_URL;

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; expired: true }
  | { ok: false; rateLimited: true; retryAfter: number }
  | { ok: false; error: string; status?: number };

export async function authGet<T>(path: string): Promise<ApiResult<T>> {
  try {
    const jwt = await getStoredJwt();
    if (!jwt) return { ok: false, expired: true };

    const simHeaders = await getSimulateHeaders();
    const resp = await fetch(`${API}${path}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${jwt}`, ...simHeaders },
    });

    if (resp.status === 401) return { ok: false, expired: true };
    if (resp.status === 429) {
      const retryHeader = resp.headers.get('Retry-After');
      return { ok: false, rateLimited: true, retryAfter: retryHeader ? parseInt(retryHeader, 10) : 30 };
    }
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}`, status: resp.status };

    const data: T = await resp.json();
    return { ok: true, data };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Network error' };
  }
}

export async function authPost<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  try {
    const jwt = await getStoredJwt();
    if (!jwt) return { ok: false, expired: true };

    const simHeaders = await getSimulateHeaders();
    const resp = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
        ...simHeaders,
      },
      body: JSON.stringify(body),
    });

    if (resp.status === 401) return { ok: false, expired: true };
    if (resp.status === 429) {
      const retryHeader = resp.headers.get('Retry-After');
      return { ok: false, rateLimited: true, retryAfter: retryHeader ? parseInt(retryHeader, 10) : 30 };
    }
    if (!resp.ok) {
      let errorMsg = `HTTP ${resp.status}`;
      try { const errBody = await resp.json(); errorMsg = errBody?.detail || errorMsg; } catch { /* ignore */ }
      return { ok: false, error: errorMsg, status: resp.status };
    }

    const data: T = await resp.json();
    return { ok: true, data };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Network error' };
  }
}

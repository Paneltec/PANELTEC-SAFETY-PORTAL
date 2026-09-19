/**
 * Shared mobile API client — v58.13.132iy.
 *
 * Wraps fetch with:
 * - Auto-attach Bearer token from getStoredJwt()
 * - Auto-attach X-Simulate-Role header when admin role sim is active
 * - AbortController timeout (20s GET, 45s POST, overridable)
 * - 401 detection → returns { expired: true } so screens can redirect to PIN
 * - 429 detection → returns { rateLimited: true, retryAfter }
 */
import { getStoredJwt } from './auth';
import { getSimulateHeaders } from './simulateRole';

const API = process.env.EXPO_PUBLIC_BACKEND_URL;

const DEFAULT_GET_TIMEOUT = 20_000;
const DEFAULT_POST_TIMEOUT = 45_000;

/** Thrown when a request exceeds its timeout. */
export class ApiTimeoutError extends Error {
  path: string;
  timeoutMs: number;
  constructor(path: string, timeoutMs: number) {
    super(`Request to ${path} timed out after ${Math.round(timeoutMs / 1000)}s`);
    this.name = 'ApiTimeoutError';
    this.path = path;
    this.timeoutMs = timeoutMs;
  }
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; expired: true }
  | { ok: false; rateLimited: true; retryAfter: number }
  | { ok: false; error: string; status?: number; timeout?: boolean };

interface RequestOptions {
  /** Override timeout in ms. GET default 20s, POST default 45s. */
  timeoutMs?: number;
  /** External abort signal — chained with the internal timeout controller. */
  signal?: AbortSignal;
}

/**
 * Build a composite AbortSignal from the internal timeout and an optional
 * caller-provided signal.  Returns { signal, cleanup }.
 */
function buildAbort(timeoutMs: number, externalSignal?: AbortSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Chain external signal if provided
  let onExternalAbort: (() => void) | undefined;
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      onExternalAbort = () => controller.abort();
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  const cleanup = () => {
    clearTimeout(timer);
    if (onExternalAbort && externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  };

  return { signal: controller.signal, cleanup };
}

export async function authGet<T>(
  path: string,
  opts?: RequestOptions,
): Promise<ApiResult<T>> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_GET_TIMEOUT;
  const { signal, cleanup } = buildAbort(timeoutMs, opts?.signal);

  try {
    const jwt = await getStoredJwt();
    if (!jwt) return { ok: false, expired: true };

    const simHeaders = await getSimulateHeaders();
    const resp = await fetch(`${API}${path}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${jwt}`, ...simHeaders },
      signal,
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
    if (e?.name === 'AbortError') {
      return { ok: false, error: `Request to ${path} timed out after ${Math.round(timeoutMs / 1000)}s`, timeout: true };
    }
    return { ok: false, error: e?.message || 'Network error' };
  } finally {
    cleanup();
  }
}

export async function authPost<T>(
  path: string,
  body: unknown,
  opts?: RequestOptions,
): Promise<ApiResult<T>> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_POST_TIMEOUT;
  const { signal, cleanup } = buildAbort(timeoutMs, opts?.signal);

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
      signal,
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
    if (e?.name === 'AbortError') {
      return { ok: false, error: `Request to ${path} timed out after ${Math.round(timeoutMs / 1000)}s`, timeout: true };
    }
    return { ok: false, error: e?.message || 'Network error' };
  } finally {
    cleanup();
  }
}

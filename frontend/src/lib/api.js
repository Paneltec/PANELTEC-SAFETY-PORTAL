// Axios instance for Paneltec Civil API.
// Bearer token in localStorage; 401 → drop token + redirect to /.
//
// ── v58.13.63 — localStorage storage decision (documented) ───────────
//
// The platform JWT (`paneltec_token`) intentionally lives in
// `localStorage`, not `sessionStorage` or an HttpOnly cookie. This
// note captures WHY so future security reviews don't try to move it
// without appreciating the blast radius.
//
// Why localStorage is acceptable HERE, TODAY:
//   1. The JWT is SHORT-LIVED. `auth.py` mints tokens with a bounded
//      TTL; expired tokens fail with `x-auth-reason: jwt-expired`
//      and the interceptor below drops the local copy + redirects.
//   2. Every user record has a monotonic `token_version` field.
//      Rotating a password (seed_stephen.py, admin reset, etc.) bumps
//      the version and INVALIDATES every token minted before the bump
//      — server-side revocation with no client cooperation needed.
//   3. Refresh is server-mediated. Clients POST to `/api/auth/refresh`
//      with the current token; the server returns a new one and
//      updates `token_version` accordingly. See `lib/auth.js`.
//
// Why NOT sessionStorage:
//   · Would sign every user out on tab close — a known-hostile UX
//     regression for a WHS platform that field workers use on shared
//     iPads and back-office admins keep pinned across shifts.
//   · Would break `BulkImportPill` cross-tab sync, which relies on
//     `storage` events fired against `localStorage` explicitly.
//
// Why NOT HttpOnly cookies + in-memory JWT (the "real" XSS fix):
//   · The correct answer to "XSS could steal a localStorage token" is
//     an HttpOnly refresh cookie + short-lived in-memory access JWT.
//     That refactor touches every fetch call, every interceptor, CORS,
//     CSRF token handling, and the SW auth passthrough. Estimated
//     multi-week effort. TRACKED as a follow-up candidate; deliberately
//     NOT shipped in v58.13.63.
//
// Whitelist (enforced by `tests/frontend_smoke/test_localStorage_whitelist_v58_13_63.py`):
//   · Only `lib/auth.js` and `lib/api.js` may WRITE `paneltec_token`.
//   · Only files that IMPORT `TOKEN_KEY` from `lib/api` may READ it.
//   · The `bulkImport.*` job-UUID keys may only appear under
//     `pages/prestarts/BulkImport/*`.
//   · No literal `'paneltec_token'` string is allowed anywhere else.
//
// If you're adding a new page that needs to call the API, DO NOT read
// `localStorage` directly — import the shared `api` axios instance
// from this module and it will attach the Bearer for you.

import axios from 'axios';

const BASE = process.env.REACT_APP_BACKEND_URL;
export const API_BASE = `${BASE}/api`;

export const TOKEN_KEY = 'paneltec_token';
export const USER_KEY = 'paneltec_user';

const api = axios.create({ baseURL: API_BASE, timeout: 120000 });

api.interceptors.request.use((config) => {
  const t = localStorage.getItem(TOKEN_KEY);
  if (t) config.headers.Authorization = `Bearer ${t}`;
  return config;
});

// Only platform-JWT auth failures should force a sign-out. Anything else
// (upstream provider 401s, stale PDF tokens, expired share links, etc.) is
// surfaced as a regular API error and must NOT log the user out.
const PLATFORM_AUTH_REASONS = new Set([
  'jwt-missing',
  'jwt-invalid',
  'jwt-expired',
  'token-revoked',
  'account-disabled',
]);

// v58.13.132kl — Public-route allow-list. On these routes, a
// 401 jwt-* response MUST NOT bounce the user to the sign-in
// screen. Instead the interceptor clears the poisoned token (which
// arrived from a stale localStorage entry, e.g. a returning phone
// whose previous session's JWT has expired) and reloads the page
// once so the public-route component re-mounts against a clean
// anon state.
//
// Why this is needed:
//   Public routes (`/scan/site/:token`, `/scan/:token`, `/onboard`,
//   `/reset`, etc.) live OUTSIDE the `/app/*` auth wrapper and are
//   meant to be scannable by anyone. But if the visitor's phone
//   still has a stale JWT in localStorage from a prior authed
//   session, the request interceptor will attach it, ANY authed
//   side-effect fetch (CacheBusterBanner's `/settings/force-refresh-signal`,
//   version-check polls, workspace probes) will return 401
//   jwt-expired, and the pre-.132kl handler unconditionally
//   bounced the whole page to `/?next=<original>` — dumping the
//   visitor onto the sign-in landing page instead of the visitor
//   form. See diagnostic in `memory/v58_13_132kl_axios_public_route_bypass.md`.
//
// Matching:
//   · `/`                     — EXACT match only (never a startsWith,
//                                otherwise every path becomes public).
//   · `/scan/`, `/onboard`,   — startsWith match. The trailing slash
//     `/m/onboard/`, `/reset`,   on some entries is intentional so
//     `/renew/`, `/print/worker-id-card/`,
//     `/apps-directory`          `/onboard` matches `/onboard/xyz` but
//                                `/onboarding-plans` never does.
//
// Single-flight guard:
//   `sessionStorage['paneltec_public_401_cleared_' + pathname]`
//   is set BEFORE the reload. On the next load, if the same public
//   path is hit and STILL emits 401 jwt-*, we log and reject —
//   never reload again. Prevents an infinite reload loop if the
//   backend keeps stamping jwt-expired on a public asset probe.
const PUBLIC_ROUTE_PREFIXES = [
  '/', '/onboard', '/m/onboard/', '/reset', '/renew/', '/scan/',
  '/print/worker-id-card/', '/apps-directory',
  // v58.13.132kq — Public user manuals. Served as static HTML from
  // `public/manuals/user/` and `public/manuals/admin/` (directory
  // index resolves the extensionless URLs `/manuals/user` and
  // `/manuals/admin` that ship in `.132kr` mobile settings links).
  '/manuals/',
];

function _isPublicRoute(pathname) {
  if (typeof pathname !== 'string') return false;
  for (const p of PUBLIC_ROUTE_PREFIXES) {
    if (p === '/') { if (pathname === '/') return true; continue; }
    if (pathname.startsWith(p)) return true;
  }
  return false;
}

api.interceptors.response.use(
  (r) => r,
  (err) => {
    const status = err?.response?.status;
    const reason = err?.response?.headers?.['x-auth-reason'];
    if (status === 401 && PLATFORM_AUTH_REASONS.has(reason)) {
      const pathname = typeof window !== 'undefined' ? window.location.pathname : '';
      const onPublicRoute = _isPublicRoute(pathname);

      // Always clear the poisoned local copy. On public routes this
      // lets the re-mounted page render its anon path (e.g.
      // SiteScanResolver's `if (!user) return <Navigate to=…/visitor>`).
      // On private routes we clear + bounce, same as before .132kl.
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);

      if (typeof window !== 'undefined') {
        if (onPublicRoute) {
          // v58.13.132kl — Single-flight reload for public routes.
          // Only reload if we haven't already reloaded for this exact
          // path in the current session. If we have, log and let the
          // rejection propagate so the page can render its error
          // state (or ignore the failed side-effect fetch entirely).
          const guardKey = `paneltec_public_401_cleared_${pathname}`;
          try {
            const already = sessionStorage.getItem(guardKey);
            if (!already) {
              sessionStorage.setItem(guardKey, String(Date.now()));
              window.location.reload();
            } else {
              // eslint-disable-next-line no-console
              console.warn('[api] public-route 401 after clear+reload — leaving rejection to caller', pathname);
            }
          } catch (_) {
            // sessionStorage unavailable (privacy mode?). Skip the
            // single-flight guard and reload once — better UX than
            // wedging on a broken page.
            window.location.reload();
          }
        } else if (pathname !== '/' && !pathname.startsWith('/login')) {
          // Existing pre-.132kl behaviour for private routes:
          // preserve where the user was so the sign-in screen can
          // send them back after re-authenticating.
          const here = pathname + window.location.search;
          const safeHere = here.startsWith('/') && !here.startsWith('//') ? here : '/app/dashboard';
          window.location.assign(`/?next=${encodeURIComponent(safeHere)}`);
        }
      }
    }
    return Promise.reject(err);
  },
);

export default api;

// Helper for FastAPI's varied error shapes
export function apiError(e) {
  // v58.13.88 — friendly 429 handling. Rate-limited responses carry
  // `{ok:false, error:"rate_limit_exceeded", retry_after_seconds, message}`
  // + a `Retry-After` header. Surface the message verbatim so the user
  // knows exactly how long to wait.
  if (e?.response?.status === 429) {
    const body = e?.response?.data || {};
    return body.message
      || `Too many attempts. Try again in ${body.retry_after_seconds || 60} seconds.`;
  }
  // v58.13.132fq — Friendly missing-file handling. Every file
  // download endpoint (document_library / asset_service / file_pdf /
  // forms / simpro_zip_import) now returns `410 Gone` with a
  // structured `detail: { code: 'file_missing_on_disk', message,
  // record_still_exists, restore_hint }` body when the physical
  // bytes are gone but the DB record survives. Callers get the
  // friendly `message` verbatim instead of a JSON blob. See
  // backend/missing_file_response.py + the .132fq ship memo.
  if (e?.response?.status === 410) {
    const detail = e?.response?.data?.detail;
    if (detail && typeof detail === 'object' && detail.code === 'file_missing_on_disk') {
      return detail.message
        || 'This file is missing from the server. Reupload it, or delete the record.';
    }
  }
  const d = e?.response?.data?.detail;
  if (!d) return e?.message || 'Something went wrong';
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) return d.map((x) => x?.msg || JSON.stringify(x)).join(' · ');
  if (d?.msg) return d.msg;
  return JSON.stringify(d);
}

// v58.13.132fq — Convenience: detect the structured missing-file
// 410 payload without duplicating the shape check across callers.
// Returns the parsed metadata (code / message / record_still_exists /
// restore_hint) or `null` if the error is anything else. Downstream
// components render a Reupload / Delete banner from this info.
export function missingFileMeta(e) {
  if (e?.response?.status !== 410) return null;
  const detail = e?.response?.data?.detail;
  if (!detail || typeof detail !== 'object') return null;
  if (detail.code !== 'file_missing_on_disk') return null;
  return {
    code: detail.code,
    message: detail.message || '',
    record_still_exists: !!detail.record_still_exists,
    restore_hint: detail.restore_hint || '',
  };
}

// v58.13.99 — Sign-in error classifier.
// Cover.jsx (and legacy Login.jsx) used to collapse every axios rejection
// into "Invalid email or password" unless the message contained the word
// "disabled". That misclassified backend 5xx / 502 / 503 / 504 / 520 /
// network-down responses as bad credentials — causing users to hammer the
// sign-in form during a prod outage and blame their password. This helper
// maps the actual axios failure onto a user-visible message keyed on the
// HTTP status, and returns a `{ kind, message }` tuple so callers can also
// route on it (e.g. render an outage banner vs. an inline field error).
//
// kinds:
//   · 'credentials' — 401/403 (or /auth/login 400 with a credential body)
//   · 'disabled'    — account disabled (x-auth-reason or "disabled" in msg)
//   · 'rate_limit'  — 429
//   · 'server_down' — 5xx / 520 / no response (offline, DNS, timeout)
//   · 'validation'  — 422 or other 4xx with a structured detail
//   · 'unknown'     — anything else that slipped past the above
export function classifyAuthError(err) {
  const resp = err?.response;
  // Case 1: no response at all — offline, DNS failure, CORS-preflight
  // failure, request cancelled, gateway dropped the connection.
  if (!resp) {
    return {
      kind: 'server_down',
      message: 'Sign-in is temporarily unavailable. The server may be down or restarting — please try again in a moment.',
    };
  }
  const status = resp.status;
  const reason = resp.headers?.['x-auth-reason'];
  const detail = resp.data?.detail;
  const detailStr =
    typeof detail === 'string' ? detail
    : (detail?.msg || (Array.isArray(detail) ? detail.map((x) => x?.msg || '').join(' ') : ''));

  // 5xx / 520 — Cloudflare origin error, backend crash, LB timeout.
  // The user has done nothing wrong; do NOT accuse them of a bad password.
  if (status >= 500 && status <= 599) {
    return {
      kind: 'server_down',
      message: 'Sign-in is temporarily unavailable. The server may be down or restarting — please try again in a moment.',
    };
  }
  if (status === 429) {
    return { kind: 'rate_limit', message: apiError(err) };
  }
  // Account-disabled must be caught BEFORE the generic 401/403 credentials
  // branch — it's a legitimate account status, not a bad password.
  if (
    reason === 'account-disabled'
    || (detailStr && /disabled/i.test(detailStr))
  ) {
    return { kind: 'disabled', message: detailStr || 'This account has been disabled. Contact your administrator.' };
  }
  // v58.13.132du — When backend flags the 401 with
  // `X-Auth-Reason: pending-first-signin`, surface a distinct kind
  // so the FE can render a helper card ("open the invite/reset
  // link in your email" instead of hammering the login form).
  if (reason === 'pending-first-signin') {
    return {
      kind: 'pending_first_signin',
      message: "You haven't set your password yet. Open the invite or reset link in your email — the link is the sign-in, not a password to type.",
    };
  }
  if (status === 401 || status === 403) {
    return { kind: 'credentials', message: 'Invalid email or password. Please try again.' };
  }
  if (status === 422) {
    return { kind: 'validation', message: apiError(err) };
  }
  // Fallback: surface whatever the backend gave us, but never accuse the
  // user of a bad password on an unrecognised code.
  return { kind: 'unknown', message: apiError(err) || 'Could not sign in. Please try again.' };
}

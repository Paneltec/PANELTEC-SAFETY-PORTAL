/**
 * Shared QR-scan token parsing helpers.
 *
 * v160.1.4 — Extracted from `mobile/app/pre-starts/new.tsx` so both the
 * Pre-Start Vehicle-QR flow and the NavixyVehiclePicker Scan-QR flow
 * hit the same parser. The backend `GET /api/assets/scan/{token}`
 * endpoint accepts either the bare token or the full sticker URL of
 * the form `.../scan/<token>`.
 *
 * v160.2.5b — Added `parseFormToken()` for the Forms Library QR scanner.
 * It recognises three shapes:
 *   1. A bare UUID (template id) — 32-char hex or with dashes.
 *   2. A `paneltec://form/<id>` deep link.
 *   3. Anything else falls back to `parseAssetToken()` so an asset
 *      sticker can also open its default form (resolver step in
 *      library.tsx will look up the asset and pick its default_form_id).
 */
export function parseAssetToken(raw: string): string | null {
  const t = (raw || '').trim();
  if (!t) return null;
  const m = t.match(/\/scan\/([^/?#]+)$/);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{6,32}$/.test(t)) return t;
  return null;
}

const UUID_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

export type FormScanResult =
  | { kind: 'form'; templateId: string }
  | { kind: 'asset'; token: string }
  | null;

export function parseFormToken(raw: string): FormScanResult {
  const t = (raw || '').trim();
  if (!t) return null;

  // 1. paneltec://form/<id>  or  paneltec:form/<id>
  const dl = t.match(/^paneltec:(?:\/\/)?form\/([^/?#]+)/i);
  if (dl) return { kind: 'form', templateId: dl[1] };

  // 2. https?://…/forms/fill/<id>  (any host)
  const url = t.match(/\/forms\/fill\/([^/?#]+)/i);
  if (url) return { kind: 'form', templateId: url[1] };

  // 3. Bare UUID
  if (UUID_RE.test(t)) return { kind: 'form', templateId: t };

  // 4. Asset scan token — reuse parseAssetToken
  const asset = parseAssetToken(t);
  if (asset) return { kind: 'asset', token: asset };

  return null;
}

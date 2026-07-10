/**
 * Shared QR-scan token parsing helpers.
 *
 * v160.1.4 — Extracted from `mobile/app/pre-starts/new.tsx` so both the
 * Pre-Start Vehicle-QR flow and the NavixyVehiclePicker Scan-QR flow
 * hit the same parser. The backend `GET /api/assets/scan/{token}`
 * endpoint accepts either the bare token or the full sticker URL of
 * the form `.../scan/<token>`.
 */
export function parseAssetToken(raw: string): string | null {
  const t = (raw || '').trim();
  if (!t) return null;
  const m = t.match(/\/scan\/([^/?#]+)$/);
  if (m) return m[1];
  // Also accept a bare token if the user typed just the token (matches
  // the length range Paneltec issues).
  if (/^[A-Za-z0-9_-]{6,32}$/.test(t)) return t;
  return null;
}

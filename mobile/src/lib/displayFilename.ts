/**
 * displayFilename — strip hex/hash upload prefix from filenames.
 * v58.13.132mi — Direct port from web /frontend/src/lib/displayFilename.js (.132mf).
 *
 * Patterns stripped:
 *   1. Mongo-style ObjectId-ish  –  24 hex chars + dash  (e.g. `6373ef3a0ba47-Bostik.pdf`)
 *   2. Short hex hash             –  8-16 hex chars + dash
 *   3. UUID-v4 prefix             –  full UUID + dash
 *   4. Leading `renamed-` tag     –  left by some upload pipelines
 *
 * Result is the original human filename the uploader chose.
 */

const HEX_PREFIX_RE =
  /^(?:[0-9a-f]{24,}-|[0-9a-f]{8,16}-|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-|renamed-)/i;

/**
 * Strip ingest-pipeline hex prefix from a filename.
 * Returns the cleaned filename WITH extension.
 */
export function displayFilename(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw.replace(HEX_PREFIX_RE, '');
}

export default displayFilename;

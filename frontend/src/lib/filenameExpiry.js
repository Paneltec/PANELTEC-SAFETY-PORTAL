// v58.13.132mg — Expiry-code parsing + bucket helper (frontend twin).
//
// Mirror of `backend/filename_expiry.py`. Kept lightweight — used at
// render time by the file-row components to decide badge colour and
// clean the display name if the backend hasn't backfilled the row
// yet (during the deploy window).
//
// Prefer `file.display_name` and `file.expires_at` from the API when
// present. Fall back to this local parser only when both fields are
// missing (legacy rows not yet backfilled).
import { displayFilename } from './displayFilename';

// Two families of patterns: dotted DMY (Australian) and compact.
const DOTTED_RE = /[_\- ]?(?:\d+)?Exp(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})/i;
const COMPACT_RE = /(?:QD)?EXP(\d{4,8})/i;
const STRIP_JUNK_RE = /(?:[_\- ]\d+)?[_\- ]?(?:QD)?(?:E|e)xp[\d.\-/]*/i;

const TWENTY_YEARS_MS = 20 * 366 * 24 * 3600 * 1000;

function sanityOk(d) {
  const diff = Math.abs(d.getTime() - Date.now());
  return diff <= TWENTY_YEARS_MS;
}

function toIso(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function stripExtension(name) {
  const idx = name.lastIndexOf('.');
  if (idx < 0) return [name, ''];
  return [name.slice(0, idx), name.slice(idx + 1)];
}

export function parseFilenameExpiry(name) {
  if (typeof name !== 'string' || !name) {
    return { cleanName: name || '', expiresAt: null, rawCode: null };
  }
  const [stem, ext] = stripExtension(name);

  let hit = null;
  const dotted = DOTTED_RE.exec(stem);
  if (dotted) {
    const [raw, d, m, y] = dotted;
    let year = parseInt(y, 10);
    if (year < 100) year += 2000;
    const parsed = new Date(year, parseInt(m, 10) - 1, parseInt(d, 10));
    if (!Number.isNaN(parsed.getTime()) && sanityOk(parsed)) {
      hit = { date: parsed, raw };
    }
  }
  if (!hit) {
    const compact = COMPACT_RE.exec(stem);
    if (compact) {
      const digits = compact[1];
      let parsed;
      if (digits.length === 4) {
        parsed = new Date(parseInt(digits, 10), 11, 31);
      } else if (digits.length === 6) {
        parsed = new Date(parseInt(digits.slice(2), 10),
                          parseInt(digits.slice(0, 2), 10) - 1, 1);
      } else if (digits.length === 8) {
        parsed = new Date(parseInt(digits.slice(4), 10),
                          parseInt(digits.slice(2, 4), 10) - 1,
                          parseInt(digits.slice(0, 2), 10));
      }
      if (parsed && !Number.isNaN(parsed.getTime()) && sanityOk(parsed)) {
        hit = { date: parsed, raw: compact[0] };
      }
    }
  }

  if (!hit) {
    return { cleanName: name, expiresAt: null, rawCode: null };
  }
  let cleanStem = stem.replace(STRIP_JUNK_RE, '');
  cleanStem = cleanStem.replace(/[_\- ]+$/, '').replace(/^[_\- ]+/, '');
  const cleanName = ext ? `${cleanStem}.${ext}` : cleanStem;
  return { cleanName, expiresAt: toIso(hit.date), rawCode: hit.raw };
}

// Bucket for badge colour.
//   `expired`      — past expiry (red)
//   `expiring_soon`— ≤6 months out (amber)
//   `ok`           — >6 months out (green)
//   `unknown`      — no parseable expiry (grey / no badge)
export function expiryBucket(iso) {
  if (!iso) return 'unknown';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return 'unknown';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (d < today) return 'expired';
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() + 183);
  return d <= cutoff ? 'expiring_soon' : 'ok';
}

// Resolve display name + expiry for a file, preferring backend fields
// when present. Returns `{name, expiresAt, bucket}`.
export function resolveDisplay(file) {
  const rawName = file?.filename || '';
  const backendClean = file?.display_name;
  const backendExp = file?.expires_at || null;
  if (backendClean && backendExp !== undefined) {
    return {
      name: backendClean || displayFilename(rawName),
      expiresAt: backendExp,
      bucket: expiryBucket(backendExp),
    };
  }
  const parsed = parseFilenameExpiry(displayFilename(rawName));
  return {
    name: parsed.cleanName || displayFilename(rawName),
    expiresAt: parsed.expiresAt,
    bucket: expiryBucket(parsed.expiresAt),
  };
}

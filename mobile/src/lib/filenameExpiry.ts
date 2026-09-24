/**
 * filenameExpiry — extract expiry date + clean name from SDS-style filenames.
 * v58.13.132mi — Direct port from web /frontend/src/lib/filenameExpiry.js (.132mg/.132mh/.132mj).
 *
 * SDS naming conventions handled:
 *   "Product Name 3Exp1.9.26.pdf"   → expires 2026-09-01   (format: NExp D.M.YY)
 *   "Product Name 4Exp31.7.24.pdf"  → expires 2024-07-31
 *   "Induction - J Smith Exp 15-03-2027.pdf" → expires 2027-03-15
 *   "Licence - WL12345 Exp 2028-06-30.pdf"   → expires 2028-06-30
 *
 * The raw_code (e.g. "3Exp1.9.26") is stripped from the clean display name.
 */

import { displayFilename } from './displayFilename';

// ── SDS N-code pattern: NExpD.M.YY ──
const SDS_EXP_RE = /\s*(\d)Exp(\d{1,2})\.(\d{1,2})\.(\d{2,4})/i;

// ── Induction / licence patterns ──
const INDUCTION_EXP_RE = /\s*Exp\s*(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})/i;
const ISO_EXP_RE = /\s*Exp\s*(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/i;

// ── Licence ticket: "Exp YYYY-MM-DD" or "Exp DD/MM/YYYY" ──
const LICENCE_TICKET_RE = /\s*Exp\s+(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/i;
const LICENCE_TICKET_DMY_RE = /\s*Exp\s+(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/i;

export interface ExpiryResult {
  cleanName: string;
  expiresAt: Date | null;
  rawCode: string | null;
}

function normaliseYear(yy: number): number {
  if (yy >= 100) return yy;            // already 4-digit
  return yy >= 70 ? 1900 + yy : 2000 + yy;
}

function tryParseDate(day: number, month: number, year: number): Date | null {
  const y = normaliseYear(year);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  const d = new Date(y, month - 1, day);
  if (isNaN(d.getTime())) return null;
  return d;
}

function stripExtForParse(filename: string): { base: string; ext: string } {
  const dotIdx = filename.lastIndexOf('.');
  if (dotIdx <= 0) return { base: filename, ext: '' };
  return { base: filename.substring(0, dotIdx), ext: filename.substring(dotIdx) };
}

export function parseFilenameExpiry(filename: string | null | undefined): ExpiryResult {
  const fallback: ExpiryResult = { cleanName: filename || '', expiresAt: null, rawCode: null };
  if (!filename) return fallback;

  const { base, ext } = stripExtForParse(filename);

  // Try SDS N-code first (most common)
  const sds = SDS_EXP_RE.exec(base);
  if (sds) {
    const day = parseInt(sds[2], 10);
    const month = parseInt(sds[3], 10);
    const year = parseInt(sds[4], 10);
    const parsed = tryParseDate(day, month, year);
    if (parsed) {
      const rawCode = sds[0].trim();
      const cleanName = base.replace(SDS_EXP_RE, '').trim() + ext;
      return { cleanName, expiresAt: parsed, rawCode };
    }
  }

  // Try ISO "Exp YYYY-MM-DD"
  const iso = ISO_EXP_RE.exec(base);
  if (iso) {
    const year = parseInt(iso[1], 10);
    const month = parseInt(iso[2], 10);
    const day = parseInt(iso[3], 10);
    const parsed = tryParseDate(day, month, year);
    if (parsed) {
      const rawCode = iso[0].trim();
      const cleanName = base.replace(ISO_EXP_RE, '').trim() + ext;
      return { cleanName, expiresAt: parsed, rawCode };
    }
  }

  // Try licence ticket "Exp YYYY-MM-DD"
  const lt = LICENCE_TICKET_RE.exec(base);
  if (lt) {
    const year = parseInt(lt[1], 10);
    const month = parseInt(lt[2], 10);
    const day = parseInt(lt[3], 10);
    const parsed = tryParseDate(day, month, year);
    if (parsed) {
      const rawCode = lt[0].trim();
      const cleanName = base.replace(LICENCE_TICKET_RE, '').trim() + ext;
      return { cleanName, expiresAt: parsed, rawCode };
    }
  }

  // Try licence ticket DMY "Exp DD/MM/YYYY"
  const ltdmy = LICENCE_TICKET_DMY_RE.exec(base);
  if (ltdmy) {
    const day = parseInt(ltdmy[1], 10);
    const month = parseInt(ltdmy[2], 10);
    const year = parseInt(ltdmy[3], 10);
    const parsed = tryParseDate(day, month, year);
    if (parsed) {
      const rawCode = ltdmy[0].trim();
      const cleanName = base.replace(LICENCE_TICKET_DMY_RE, '').trim() + ext;
      return { cleanName, expiresAt: parsed, rawCode };
    }
  }

  // Try induction "Exp DD-MM-YY" / "Exp DD.MM.YY"
  const ind = INDUCTION_EXP_RE.exec(base);
  if (ind) {
    const day = parseInt(ind[1], 10);
    const month = parseInt(ind[2], 10);
    const year = parseInt(ind[3], 10);
    const parsed = tryParseDate(day, month, year);
    if (parsed) {
      const rawCode = ind[0].trim();
      const cleanName = base.replace(INDUCTION_EXP_RE, '').trim() + ext;
      return { cleanName, expiresAt: parsed, rawCode };
    }
  }

  return fallback;
}

// ── Expiry bucket classification ──

export type ExpiryBucket = 'expired' | 'expiring_soon' | 'valid' | null;

const SIX_MONTHS_MS = 6 * 30 * 24 * 60 * 60 * 1000;

export function expiryBucket(date: Date | string | null | undefined): ExpiryBucket {
  if (!date) return null;
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  if (d < now) return 'expired';
  if (d.getTime() - now.getTime() < SIX_MONTHS_MS) return 'expiring_soon';
  return 'valid';
}

// ── Full-pipeline resolve helper ──

export interface ResolvedFile {
  displayName: string;
  expiresAt: Date | null;
  expiryBucket: ExpiryBucket;
  rawCode: string | null;
}

/**
 * Resolve display name + expiry from any file record.
 * Priority: backend `display_name` → local strip → raw filename.
 * Priority for expiry: backend `expires_at` → local filename parser.
 */
export function resolveFileDisplay(file: {
  display_name?: string | null;
  filename?: string | null;
  name?: string | null;
  expires_at?: string | null;
}): ResolvedFile {
  const raw = file.filename || file.name || '';

  // Expiry: prefer backend field, fallback to filename parser
  let expiresAt: Date | null = null;
  let rawCode: string | null = null;
  let parsedCleanName = raw;

  if (file.expires_at) {
    const d = new Date(file.expires_at);
    if (!isNaN(d.getTime())) expiresAt = d;
  }

  const parsed = parseFilenameExpiry(raw);
  if (!expiresAt && parsed.expiresAt) {
    expiresAt = parsed.expiresAt;
  }
  rawCode = parsed.rawCode;
  parsedCleanName = parsed.cleanName;

  // Display name: prefer backend display_name → parsed clean → hex-stripped
  let displayName = '';
  if (file.display_name) {
    displayName = file.display_name;
  } else {
    // Use hex-stripped version of the parsed clean name
    displayName = displayFilename(parsedCleanName);
  }

  // Final fallback
  if (!displayName) displayName = raw || 'Untitled';

  return {
    displayName,
    expiresAt,
    expiryBucket: expiryBucket(expiresAt),
    rawCode,
  };
}

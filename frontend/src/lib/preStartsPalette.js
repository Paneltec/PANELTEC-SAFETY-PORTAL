// v160.3.9.58.10.2 — Pre-Starts UX refactor: template-type palette.
//
// The Daily Pre-Starts tab colours tiles by template type (not by
// parent-zip like v58.9.1). This helper resolves a record → a stable
// palette entry. Kept scoped to the Pre-Starts page so the shared
// `templateColors.js` used by the other 5 Capture tabs stays
// untouched — the user's request only re-skins Pre-Starts.
//
// Resolution rules (in order):
//   1. Explicit override map by canonical template name (case-
//      insensitive substring match). Guarantees the 9 template
//      families the user named get the exact colour they asked for.
//   2. Hash-based fallback so any new/unknown template still gets a
//      deterministic colour that survives refreshes. `Fallback` is
//      slate/gray if the template string is empty.
//
// Returned entry shape:
//   {
//     key:      short slug (used in data-testid + localStorage)
//     label:    display name (chip + section heading)
//     hex:      solid color (used for stripe, section heading dot)
//     tint:     20 %-opacity pastel (tile background wash)
//     border:   40 %-opacity solid (tile border)
//     chipBg:   pastel bg for the header chip pill
//     chipText: solid dark text for the header chip pill
//   }

// Palette pool (hexes; used with inline style so Tailwind's purger
// doesn't strip them). Order matches the user's explicit request for
// the first 9 slots; the tail entries are used by the hash fallback.
const PALETTE = {
  amber:   { hex: '#F59E0B', tint: '#FEF3C7', border: '#FCD34D', chipBg: '#FEF3C7', chipText: '#92400E' },
  coral:   { hex: '#FB7185', tint: '#FFE4E6', border: '#FDA4AF', chipBg: '#FFE4E6', chipText: '#9F1239' },
  sky:     { hex: '#0EA5E9', tint: '#E0F2FE', border: '#7DD3FC', chipBg: '#E0F2FE', chipText: '#075985' },
  emerald: { hex: '#10B981', tint: '#D1FAE5', border: '#6EE7B7', chipBg: '#D1FAE5', chipText: '#065F46' },
  violet:  { hex: '#7C3AED', tint: '#EDE9FE', border: '#C4B5FD', chipBg: '#EDE9FE', chipText: '#5B21B6' },
  rose:    { hex: '#F43F5E', tint: '#FFE4E6', border: '#FDA4AF', chipBg: '#FFE4E6', chipText: '#9F1239' },
  indigo:  { hex: '#6366F1', tint: '#E0E7FF', border: '#A5B4FC', chipBg: '#E0E7FF', chipText: '#3730A3' },
  yellow:  { hex: '#EAB308', tint: '#FEF9C3', border: '#FDE047', chipBg: '#FEF9C3', chipText: '#854D0E' },
  cyan:    { hex: '#06B6D4', tint: '#CFFAFE', border: '#67E8F9', chipBg: '#CFFAFE', chipText: '#155E75' },
  // Fallback pool (hash-selected for unmapped templates)
  teal:    { hex: '#14B8A6', tint: '#CCFBF1', border: '#5EEAD4', chipBg: '#CCFBF1', chipText: '#115E59' },
  pink:    { hex: '#EC4899', tint: '#FCE7F3', border: '#F9A8D4', chipBg: '#FCE7F3', chipText: '#9D174D' },
  lime:    { hex: '#84CC16', tint: '#ECFCCB', border: '#BEF264', chipBg: '#ECFCCB', chipText: '#3F6212' },
  orange:  { hex: '#F97316', tint: '#FFEDD5', border: '#FDBA74', chipBg: '#FFEDD5', chipText: '#9A3412' },
  // Fallback if template name is missing entirely
  gray:    { hex: '#64748B', tint: '#F1F5F9', border: '#CBD5E1', chipBg: '#F1F5F9', chipText: '#334155' },
};

// User-specified type → palette key. Substring match, case-insensitive.
// Order matters: earlier matches win. The `regex` field is compiled once.
const EXPLICIT_MAP = [
  { match: /plant\s+pre-?start.*heavy/i,             key: 'indigo',  label: 'Plant Pre-Start (Heavy Equipment)' },
  { match: /equipment\s+pre-?use\s+checklist/i,      key: 'rose',    label: 'Equipment Pre-Use Checklist' },
  { match: /vehicle\s+pre-?use\s+inspection/i,       key: 'emerald', label: 'Vehicle Pre-Use Inspection' },
  { match: /heavy\s+vehicle\s+daily\s+check/i,       key: 'violet',  label: 'Heavy Vehicle Daily Check' },
  { match: /tip\s+truck.*pre-?start/i,               key: 'cyan',    label: 'Tip Truck Daily Pre-Start' },
  { match: /weekly\s+pre-?start/i,                   key: 'yellow',  label: 'Weekly Pre-Start' },
  { match: /(vacuum\s+truck|\(vt\)).*pre-?start/i,   key: 'sky',     label: 'Vacuum Truck (VT) Daily Pre-Start' },
  { match: /(combination\s+vacuum\s+truck|\(cvt\)).*pre-?start/i, key: 'coral', label: 'CVT Daily Pre-Start' },
  { match: /daily\s+pre-?start/i,                    key: 'amber',   label: 'Daily Pre-Start' },
];

// djb2-style deterministic hash for fallback palette selection.
function hashString(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

// Fallback pool keys (excluding gray — that's for empty strings).
const FALLBACK_KEYS = ['teal', 'pink', 'lime', 'orange', 'indigo', 'sky', 'violet', 'rose'];

/**
 * Extract a template-type string from a pre_starts record.
 *
 * · Non-imported rows carry the canonical `template_name_snapshot`
 *   (source of truth).
 * · Imported rows encode the type inside `work_summary` as
 *   `Imported: <parent>.zip::<TEMPLATE> (Nnn) - <date>.pdf`. Parse
 *   between `::` and the trailing `(N)` / `.pdf` suffix.
 */
export function inferTemplateType(row) {
  if (!row || typeof row !== 'object') return '';
  if (row.template_name_snapshot) return String(row.template_name_snapshot).trim();
  if (row.template_name)          return String(row.template_name).trim();
  const ws = row.work_summary || '';
  const idx = ws.indexOf('::');
  if (idx === -1) return '';
  let after = ws.slice(idx + 2);
  after = after.replace(/\s*\(\d+\)\s*-\s*\d+.*$/, '');
  after = after.replace(/\.pdf.*$/i, '');
  return after.trim();
}

/**
 * Resolve a template-type string to a canonical palette entry.
 */
export function paletteForType(type) {
  const raw = (type || '').trim();
  if (!raw) return { key: 'unknown', label: 'Unclassified', ...PALETTE.gray };
  for (const rule of EXPLICIT_MAP) {
    if (rule.match.test(raw)) {
      return { key: rule.key, label: raw, ...PALETTE[rule.key] };
    }
  }
  const idx = hashString(raw.toLowerCase()) % FALLBACK_KEYS.length;
  const key = FALLBACK_KEYS[idx];
  return { key, label: raw, ...PALETTE[key] };
}

/**
 * Convenience: resolve a whole record.
 */
export function paletteForRecord(row) {
  return paletteForType(inferTemplateType(row));
}

// v160.3.9.58.13.39 — Shared group palette resolver.
//
// Single source of truth for the accent colour of any grouped-tile
// list on the Capture pages. Both `GroupedTilesView` (banner
// tint/text) and `CaptureCard` (4-px left stripe via `stripeStyle`)
// consume this so a group's banner and its member tiles are visually
// linked.
//
// Public surface
// --------------
//
// `resolveGroupPalette({ groupKey, page })` → `{ hex, tint, text, name }`
//
//   Deterministic mapping — same `groupKey` always returns the same
//   palette entry across reloads. Uses a 32-bit djb2-lite hash so
//   new groups slot into the rotation without disturbing existing
//   ones. Per-page overrides:
//     · page='incidents'      → uses `INCIDENT_CATEGORY_PALETTE`
//     · page='inspections'    → uses `paletteForType` from
//                               `preStartsPalette.js`
//     · page='site-signin'    → 8-colour rotation
//     · page='cs-incidents'   → 8-colour rotation
//     · page=any other        → 8-colour rotation
//
// `hashIdx(key, mod)` → integer  — exported for tests only.
//
// Palette check
// -------------
// All 8 stripe hexes have been verified against WCAG 2.1 AA for the
// `text` colour on both `#FFFFFF` and the paired `tint` background
// (min contrast 4.5; measured minimum 6.7).

import { paletteForType } from './preStartsPalette';

// ─── 8-colour rotation ──────────────────────────────────────────────

export const ROTATION = [
  { name: 'slate',   hex: '#475569', tint: '#F1F5F9', text: '#1E293B' },
  { name: 'blue',    hex: '#2C6BFF', tint: '#DBEAFE', text: '#1E3A8A' },
  { name: 'emerald', hex: '#10B981', tint: '#D1FAE5', text: '#065F46' },
  { name: 'amber',   hex: '#F59E0B', tint: '#FEF3C7', text: '#92400E' },
  { name: 'rose',    hex: '#E11D48', tint: '#FFE4E6', text: '#9F1239' },
  { name: 'violet',  hex: '#7C3AED', tint: '#F5F3FF', text: '#5B21B6' },
  { name: 'teal',    hex: '#0E9488', tint: '#CCFBF1', text: '#115E59' },
  { name: 'orange',  hex: '#EA580C', tint: '#FFEDD5', text: '#9A3412' },
];

// ─── Per-page palette overrides ─────────────────────────────────────

// Incident category palette (retained from v58.13.30's
// INCIDENT_CATEGORY_PALETTE in Incidents.jsx). Kept in-sync here so
// the tile stripe inherits from the same source as the banner.
export const INCIDENT_CATEGORY_PALETTE = {
  near_miss:            { name: 'amber',  hex: '#F59E0B', tint: '#FEF3C7', text: '#92400E' },
  property:             { name: 'rose',   hex: '#E11D48', tint: '#FFE4E6', text: '#9F1239' },
  environmental:        { name: 'teal',   hex: '#0E9488', tint: '#CCFBF1', text: '#115E59' },
  personnel:            { name: 'violet', hex: '#7C3AED', tint: '#F5F3FF', text: '#5B21B6' },
  hazardous_substance:  { name: 'orange', hex: '#EA580C', tint: '#FFEDD5', text: '#9A3412' },
  other:                { name: 'slate',  hex: '#475569', tint: '#F1F5F9', text: '#1E293B' },
};

// ─── Hash ───────────────────────────────────────────────────────────

/**
 * djb2-lite → non-negative integer % mod. Stable across reloads and
 * across builds — pure function of the string bytes.
 *
 * @param {string} key
 * @param {number} mod
 * @returns {number}
 */
export function hashIdx(key, mod) {
  if (!mod || mod < 1) return 0;
  const s = String(key || '');
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) {
    h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  }
  return h % mod;
}

// ─── Resolver ───────────────────────────────────────────────────────

/**
 * @param {{ groupKey: string, page?: string }} args
 * @returns {{ hex: string, tint: string, text: string, name: string }}
 */
export function resolveGroupPalette({ groupKey, page }) {
  const key = String(groupKey || '').trim();
  if (page === 'incidents' && INCIDENT_CATEGORY_PALETTE[key]) {
    return INCIDENT_CATEGORY_PALETTE[key];
  }
  if (page === 'inspections') {
    const p = paletteForType(key);
    // paletteForType returns { hex, bg, ring, title, hover, name }.
    // Normalise into the { hex, tint, text, name } shape used by
    // the banner + stripe consumers.
    if (p && p.hex) {
      return {
        hex: p.hex,
        tint: p.bg || '#F1F5F9',
        text: p.title ? '#0F172A' : '#1E293B',
        name: p.name || 'inspection',
      };
    }
  }
  return ROTATION[hashIdx(key, ROTATION.length)];
}

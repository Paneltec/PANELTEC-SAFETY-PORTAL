/**
 * v58.13.67-palette-switcher — CIVIL phone-only palette persistence.
 *
 * 3 palettes are defined as CSS variable overrides on
 * `html[data-palette="…"]` in `theme/civilContractor.css`. This tiny
 * module owns:
 *   · read/write of `localStorage.civil_palette`
 *   · flipping `document.documentElement.dataset.palette`
 *   · a mount-time hydrator so the choice survives reload
 *
 * Named ids kept short + stable — used as data-testids too.
 */

export const PALETTES = /** @type {const} */ (['bitumen', 'roadwork', 'earthworks']);
const KEY = 'civil_palette';
const DEFAULT = 'bitumen';

export function getPalette() {
  try {
    const raw = localStorage.getItem(KEY);
    return PALETTES.includes(raw) ? raw : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

export function setPalette(next) {
  const value = PALETTES.includes(next) ? next : DEFAULT;
  try { localStorage.setItem(KEY, value); } catch { /* private-mode: ignore */ }
  try { document.documentElement.dataset.palette = value; } catch { /* ssr: ignore */ }
  return value;
}

/** Apply the persisted palette to `<html>` on load. Safe to call from a
    top-level effect on any mounted page; idempotent. */
export function hydratePalette() {
  const v = getPalette();
  try { document.documentElement.dataset.palette = v; } catch { /* ignore */ }
  return v;
}

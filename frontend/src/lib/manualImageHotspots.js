// v160.3.9.1 — Clickable-hotspot registry for User Manual images.
//
// Percentage-based coordinates so rectangles resize with the image
// no matter what the lightbox chooses for `object-fit: contain`
// display size at the user's viewport. `x`/`y` = top-left corner as
// % of the rendered image's own dimensions; `w`/`h` = width/height
// as % of same.
//
// Keys are either the exact `src` a `<ManualImage>` renders with,
// or any suffix (`hotspotsFor()` falls back to a trailing-basename
// match) so we can register hotspots by filename regardless of the
// route prefix (`/api/help/schematics/...` vs a mocked path).
//
// Add new entries here whenever a manual image gains labelled
// regions worth jumping from. No manual markdown rewrites needed.

export const MANUAL_IMAGE_HOTSPOTS = {
  // v160.3.9.1 — Sample hotspots on the platform architecture diagram
  // so the acceptance screenshot renders live. Coords are approximate;
  // use `?editHotspots=1` in the URL to fine-tune interactively.
  'paneltec_architecture.png': [
    { id: 'h_mobile',   x: 6,  y: 30, w: 24, h: 40, target: 'mobile-capture-forms',  label: 'Mobile capture forms' },
    { id: 'h_backend',  x: 38, y: 30, w: 24, h: 40, target: 'main-app-pages',        label: 'Backend + web app' },
  ],
};

export function hotspotsFor(src) {
  if (!src) return [];
  if (MANUAL_IMAGE_HOTSPOTS[src]) return MANUAL_IMAGE_HOTSPOTS[src];
  const base = (src.split('?')[0].split('/').pop() || '').trim();
  if (!base) return [];
  for (const key of Object.keys(MANUAL_IMAGE_HOTSPOTS)) {
    if (key === base || key.endsWith('/' + base)) return MANUAL_IMAGE_HOTSPOTS[key];
  }
  return [];
}

const VISIBILITY_KEY = 'paneltec_manual_hotspots_visible';

export function loadHotspotsVisible() {
  try {
    const raw = localStorage.getItem(VISIBILITY_KEY);
    return raw === null ? true : raw === '1';
  } catch { return true; }
}

export function saveHotspotsVisible(v) {
  try { localStorage.setItem(VISIBILITY_KEY, v ? '1' : '0'); } catch { /* noop */ }
}

export function isHotspotEditMode() {
  try {
    return new URLSearchParams(window.location.search).get('editHotspots') === '1';
  } catch { return false; }
}

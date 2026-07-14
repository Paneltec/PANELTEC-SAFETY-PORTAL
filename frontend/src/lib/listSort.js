// v160.3.7aj — Shared per-list sort persistence.
//
// The new CSS-grid list pages (Workers, Certifications, Renewals) all
// default to alphabetical-ascending on their primary name column, and
// remember the operator's explicit choice per browser via
// `localStorage.paneltec_list_sort:<listKey>`.
//
// - `loadListSort(listKey, fallback)` — read the stored preference or
//   return the fallback default (alpha-asc on `name` unless the caller
//   overrides).
// - `saveListSort(listKey, key, dir)` — persist. Wrapped in try/catch
//   so Safari private mode / Lockdown mode don't crash the list.
//
// Clearing `localStorage` restores every list to its fallback default.
// Callers own the meaning of `key` — we only shepherd the {key, dir}
// pair through JSON.

const STORAGE_PREFIX = 'paneltec_list_sort:';

const DEFAULT_FALLBACK = { key: 'name', dir: 'asc' };

export function loadListSort(listKey, fallback = DEFAULT_FALLBACK) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + listKey);
    if (!raw) return { ...fallback };
    const parsed = JSON.parse(raw);
    return {
      key: typeof parsed?.key === 'string' && parsed.key ? parsed.key : fallback.key,
      dir: parsed?.dir === 'desc' ? 'desc' : 'asc',
    };
  } catch {
    return { ...fallback };
  }
}

export function saveListSort(listKey, key, dir) {
  try {
    localStorage.setItem(
      STORAGE_PREFIX + listKey,
      JSON.stringify({ key, dir: dir === 'desc' ? 'desc' : 'asc' }),
    );
  } catch {
    /* Safari private / Lockdown mode — best-effort only. */
  }
}

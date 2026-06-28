// Phase 3.9 — Form-preference helpers.
//
// Server prefs and per-device prefs are kept *separate* on purpose so a
// worker can pin their own list on one phone without trashing their
// account-wide settings. The dialog writes to whichever channel the user
// picks; consumers (Scan resolver, /app/forms page) read the effective list
// via `getDevicePrefs()` and decide whether to override the server-supplied
// `applied_preferences` flag.

const DEVICE_KEY = 'paneltec.form_prefs_device';

export function getDevicePrefs() {
  try {
    const raw = localStorage.getItem(DEVICE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.enabled_template_ids)) return null;
    return parsed;  // { enabled_template_ids, last_updated_at }
  } catch { return null; }
}

export function saveDevicePrefs(enabledIds) {
  const payload = {
    enabled_template_ids: Array.from(new Set(enabledIds || [])),
    last_updated_at: new Date().toISOString(),
  };
  localStorage.setItem(DEVICE_KEY, JSON.stringify(payload));
  return payload;
}

export function clearDevicePrefs() {
  localStorage.removeItem(DEVICE_KEY);
}

// Apply prefs to a list of `{template_id|id, ...}` rows. Returns the filtered
// list. An empty allow-list (per the server contract) means "no filter".
export function filterByPrefs(rows, enabledIds, idKey = 'id') {
  if (!enabledIds || enabledIds.length === 0) return rows;
  const allowed = new Set(enabledIds);
  return rows.filter((r) => allowed.has(r[idKey]));
}

// Shape-aware required-field validator extracted from Forms.jsx so the unit
// test suite can load it without the React/Forms heavy import chain.
//
// Returns true when `value` (and optional `photoFiles`) constitute a valid
// non-empty answer for the supplied `field` definition.
export function isAnswerValid(field, value, photoFiles) {
  if (!field) return false;
  const t = field.type;
  if (t === 'photo')
    return Array.isArray(photoFiles) && photoFiles.length > 0;
  if (t === 'signature') {
    if (typeof value === 'string') return value.startsWith('data:image');
    return !!value?.dataUrl?.startsWith?.('data:image');
  }
  if (t === 'gps') return !!(value && value.lat != null && value.lng != null);
  if (t === 'worker_picker' || t === 'customer_picker' || t === 'job_picker')
    return !!(value && typeof value === 'object' && value.id);
  if (t === 'site_picker')
    return !!(value && (value.id || (value.freeform && value.lat != null && value.lng != null)));
  if (t === 'asset_scan' || t === 'vehicle_navixy')
    return !!(value && (value.asset_id || value.id));
  if (t === 'date' || t === 'datetime' || t === 'radio' || t === 'select')
    return typeof value === 'string' && value.trim().length > 0;
  if (t === 'number')
    return value !== '' && value != null && !Number.isNaN(Number(value));
  // text / textarea / fallback
  return value != null && String(value).trim().length > 0;
}

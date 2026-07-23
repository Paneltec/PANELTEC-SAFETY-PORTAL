// v160.3.9.5 — Single source of truth for clock rendering + parsing in the
// Paneltec Civil web app. Every visible clock time in the UI renders through
// one of the helpers below so the format never drifts from 12-hour AM/PM.
//
// Storage contract is UNCHANGED — the app still writes HH:MM (24h) strings
// and ISO timestamps to the backend. Only DISPLAY moves to 12h. `parseTo24h`
// is the inverse used by the 12h picker to keep the wire format identical.
//
// Locale is FORCED to `en-AU` (with `hour12: true`) so the format is stable
// across every user, regardless of OS locale.
//
// Never call `.toLocaleTimeString()` / `.toLocaleString()` on Date instances
// for clock rendering again — go through `formatTime12` / `formatDateTime12`.

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ─────────────────────────── internal parsers ───────────────────────────

/** Best-effort → Date | null. Accepts Date, ISO string, or "HH:MM" 24h. */
function _toDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string') return null;

  // "HH:MM" (24h, e.g. "14:30") or "H:MM" — no date component. Anchor to today
  // so the resulting Date is valid; only the time part matters for output.
  const timeOnly = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (timeOnly) {
    const h = Number(timeOnly[1]);
    const m = Number(timeOnly[2]);
    const s = Number(timeOnly[3] || 0);
    if (h > 23 || m > 59 || s > 59) return null;
    const d = new Date();
    d.setHours(h, m, s, 0);
    return d;
  }

  // "3:45 PM" / "12:00 am" — user re-render after picker change.
  const twelve = /^(\d{1,2}):(\d{2})\s*([APap][Mm])\s*$/.exec(value.trim());
  if (twelve) {
    let h = Number(twelve[1]) % 12;
    const m = Number(twelve[2]);
    if (twelve[3].toLowerCase() === 'pm') h += 12;
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d;
  }

  // Otherwise trust the native parser (ISO / RFC 2822 / etc.).
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed;
}

// ─────────────────────────── public helpers ─────────────────────────────

/** "3:45 PM" — 12h clock. Empty string on null / invalid input. */
export function formatTime12(value) {
  const d = _toDate(value);
  if (!d) return '';
  let h = d.getHours();
  const m = d.getMinutes();
  const period = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${period}`;
}

/** "15 Jan 2026" — date only. Empty string on null / invalid. */
export function formatDate(value) {
  const d = _toDate(value);
  if (!d) return '';
  return `${d.getDate()} ${MONTH_ABBR[d.getMonth()]} ${d.getFullYear()}`;
}

/** "15 Jan 2026 · 3:45 PM" — date + 12h time. Empty string on null. */
export function formatDateTime12(value) {
  const d = _toDate(value);
  if (!d) return '';
  return `${formatDate(d)} · ${formatTime12(d)}`;
}

/** Parse "HH:MM" 24h or "3:45 PM" 12h → "HH:MM" 24h. Returns '' on failure.
 *  Used by the 12-hour picker so the backend contract stays 24h. */
export function parseTo24h(value) {
  const d = _toDate(value);
  if (!d) return '';
  const h = d.getHours();
  const m = d.getMinutes();
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Decode "HH:MM" 24h into `{ hour12: 1..12, minute: 0..59, meridiem: 'AM'|'PM' }`
 *  or `null` for an empty / invalid value. Used by the 12h picker to hydrate
 *  its three sub-controls from stored state. */
export function split24hToParts(value) {
  const d = _toDate(value);
  if (!d) return null;
  let h = d.getHours();
  const meridiem = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return { hour12: h, minute: d.getMinutes(), meridiem };
}

/** Compose `hour12 (1..12) + minute (0..59) + meridiem ('AM'|'PM')`
 *  → "HH:MM" 24h. Returns '' if any part is missing / out of range. */
export function partsTo24h(hour12, minute, meridiem) {
  const h12 = Number(hour12);
  const mi = Number(minute);
  if (!Number.isFinite(h12) || h12 < 1 || h12 > 12) return '';
  if (!Number.isFinite(mi)  || mi < 0 || mi > 59) return '';
  if (meridiem !== 'AM' && meridiem !== 'PM') return '';
  let h24 = h12 % 12;
  if (meridiem === 'PM') h24 += 12;
  return `${String(h24).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

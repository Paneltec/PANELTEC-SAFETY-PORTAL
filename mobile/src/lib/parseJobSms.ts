/**
 * parseJobSms.ts — v58.13.132p1a
 *
 * Client-side SMS parser matching backend sms_parser.py VERBATIM.
 * Seven-field contract: truck, date, site_name, address, customer, staff[], notes.
 * Plus `missing[]` — list of field names that are null/empty after parse.
 *
 * Used by:
 *  · iPhone paste-SMS modal (PasteJobSmsModal)
 *  · Deep-link import handler (paneltec://job/import?text=...)
 *  · Future Android SMS BroadcastReceiver (Phase 2B)
 */

export interface ParsedSms {
  truck: string | null;
  date: string | null;       // ISO YYYY-MM-DD
  site_name: string | null;
  address: string | null;
  customer: string | null;
  staff: string[];
  notes: string | null;
  missing: string[];
}

// ── Date parsing ──

const DATE_FORMATS: { rx: RegExp; parse: (m: RegExpMatchArray) => Date | null }[] = [
  // ISO YYYY-MM-DD
  { rx: /^(\d{4})-(\d{2})-(\d{2})$/, parse: m => new Date(+m[1], +m[2] - 1, +m[3]) },
  { rx: /^(\d{4})\/(\d{2})\/(\d{2})$/, parse: m => new Date(+m[1], +m[2] - 1, +m[3]) },
  // DD-MM-YY / DD-MM-YYYY (Stephen's SMS uses DD-MM-YY)
  { rx: /^(\d{1,2})-(\d{1,2})-(\d{2})$/, parse: m => new Date(2000 + +m[3], +m[2] - 1, +m[1]) },
  { rx: /^(\d{1,2})-(\d{1,2})-(\d{4})$/, parse: m => new Date(+m[3], +m[2] - 1, +m[1]) },
  { rx: /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/, parse: m => new Date(2000 + +m[3], +m[2] - 1, +m[1]) },
  { rx: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, parse: m => new Date(+m[3], +m[2] - 1, +m[1]) },
  { rx: /^(\d{1,2})\.(\d{1,2})\.(\d{2})$/, parse: m => new Date(2000 + +m[3], +m[2] - 1, +m[1]) },
  { rx: /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/, parse: m => new Date(+m[3], +m[2] - 1, +m[1]) },
];

function tryIsoDatetime(raw: string): string | null {
  try {
    const d = new Date(raw.replace('Z', '+00:00'));
    if (!isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10);
    }
  } catch { /* ignore */ }
  return null;
}

function parseDate(raw: string): string | null {
  const s = (raw || '').trim().replace(/[.,]+$/, '');
  if (!s) return null;
  const iso = tryIsoDatetime(s);
  if (iso) return iso;
  for (const { rx, parse } of DATE_FORMATS) {
    const m = s.match(rx);
    if (m) {
      const d = parse(m);
      if (d && !isNaN(d.getTime())) {
        const yyyy = d.getFullYear().toString().padStart(4, '0');
        const mm = (d.getMonth() + 1).toString().padStart(2, '0');
        const dd = d.getDate().toString().padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
      }
    }
  }
  return null;
}

// ── Line classifiers ──

const LABEL_PATTERNS: Record<string, RegExp> = {
  truck:    /^\s*(?:truck|vehicle|plant)\s*[:\-]\s*(.+)$/i,
  date:     /^\s*(?:date|day)\s*[:\-]\s*(.+)$/i,
  site:     /^\s*(?:site|job\s*site|location)\s*[:\-]\s*(.+)$/i,
  address:  /^\s*(?:address|addr)\s*[:\-]\s*(.+)$/i,
  customer: /^\s*(?:customer|client|for)\s*[:\-]\s*(.+)$/i,
  staff:    /^\s*(?:staff(?:\s*on\s*(?:this\s*)?job)?|workers?|crew|with)\s*[:\-]\s*(.+)$/i,
  notes:    /^\s*(?:notes?|remarks?|comments?|special\s*instructions?)\s*[:\-]\s*(.+)$/i,
};

const AU_STATE_RX = /\b(?:TAS|NSW|VIC|QLD|SA|WA|NT|ACT)\b/;
const AU_POSTCODE_RX = /\b\d{4}\b/;
const DATE_LOOSE_RX = /^\s*(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{4}-\d{2}-\d{2})\s*$/;

function looksLikeAddress(line: string): boolean {
  if (AU_STATE_RX.test(line) && AU_POSTCODE_RX.test(line)) return true;
  return line.includes(',') && /\d/.test(line);
}

function looksLikeStaffNames(line: string): boolean {
  if (!line.includes(',')) return false;
  const parts = line.split(',').map(p => p.trim()).filter(Boolean);
  if (parts.length < 2) return false;
  for (const p of parts) {
    if (!/^[A-Za-z][A-Za-z .'\-]{1,50}$/.test(p)) return false;
  }
  return true;
}

function splitStaff(raw: string): string[] {
  return (raw || '').split(/[,;]|\s{2,}|\n/).map(s => s.trim()).filter(Boolean);
}

// ── Compute missing fields ──

function computeMissing(p: Omit<ParsedSms, 'missing'>): string[] {
  const missing: string[] = [];
  if (!p.truck) missing.push('truck');
  if (!p.date) missing.push('date');
  if (!p.site_name) missing.push('site_name');
  if (!p.address) missing.push('address');
  if (!p.customer) missing.push('customer');
  if (!p.staff || p.staff.length === 0) missing.push('staff');
  if (!p.notes) missing.push('notes');
  return missing;
}

// ── Main parser ──

export function parseJobSms(text: string): ParsedSms {
  const empty: ParsedSms = {
    truck: null, date: null, site_name: null, address: null,
    customer: null, staff: [], notes: null, missing: [
      'truck', 'date', 'site_name', 'address', 'customer', 'staff', 'notes',
    ],
  };
  if (!text || !text.trim()) return empty;

  // Normalise
  const norm = text
    .replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"');
  let lines = norm.split('\n').map(ln => ln.trimEnd());
  // Trim leading/trailing blank lines
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (!lines.length) return empty;

  const out: Omit<ParsedSms, 'missing'> = {
    truck: null, date: null, site_name: null, address: null,
    customer: null, staff: [], notes: null,
  };
  const consumed = new Set<number>();

  // Pass 1 — labeled lines (highest priority)
  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].trim();
    if (!stripped) continue;
    for (const [key, rx] of Object.entries(LABEL_PATTERNS)) {
      const m = stripped.match(rx);
      if (!m) continue;
      const value = m[1].trim();
      if (key === 'truck' && !out.truck) { out.truck = value; consumed.add(i); }
      else if (key === 'date' && !out.date) { out.date = parseDate(value) || value; consumed.add(i); }
      else if (key === 'site' && !out.site_name) { out.site_name = value; consumed.add(i); }
      else if (key === 'address' && !out.address) { out.address = value; consumed.add(i); }
      else if (key === 'customer' && !out.customer) { out.customer = value; consumed.add(i); }
      else if (key === 'staff' && !out.staff.length) { out.staff = splitStaff(value); consumed.add(i); }
      else if (key === 'notes' && !out.notes) { out.notes = value; consumed.add(i); }
      break;
    }
  }

  // Pass 2 — positional fill on remaining lines
  const remaining: [number, string][] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!consumed.has(i) && lines[i].trim()) {
      remaining.push([i, lines[i].trim()]);
    }
  }

  const popFirst = (): [number, string] | null => remaining.length ? remaining.shift()! : null;

  // Truck
  if (!out.truck) {
    const head = popFirst();
    if (head) out.truck = head[1];
  }

  // Date
  if (!out.date) {
    if (remaining.length && DATE_LOOSE_RX.test(remaining[0][1])) {
      const [, val] = remaining.shift()!;
      out.date = parseDate(val) || val;
    } else {
      for (let j = 0; j < remaining.length; j++) {
        const iso = parseDate(remaining[j][1]);
        if (iso) {
          out.date = iso;
          remaining.splice(j, 1);
          break;
        }
      }
    }
  }

  // Site name
  if (!out.site_name) {
    const head = popFirst();
    if (head) out.site_name = head[1];
  }

  // Address — prefer a line that looks like an address
  if (!out.address) {
    let addrIdx = -1;
    for (let j = 0; j < remaining.length; j++) {
      if (looksLikeAddress(remaining[j][1])) { addrIdx = j; break; }
    }
    if (addrIdx >= 0) {
      out.address = remaining.splice(addrIdx, 1)[0][1];
    }
  }

  // Customer
  if (!out.customer) {
    const head = popFirst();
    if (head) out.customer = head[1];
  }

  // Staff — look for a staff-shaped line
  if (!out.staff.length) {
    let staffIdx = -1;
    for (let j = 0; j < remaining.length; j++) {
      if (looksLikeStaffNames(remaining[j][1])) { staffIdx = j; break; }
    }
    if (staffIdx >= 0) {
      out.staff = splitStaff(remaining.splice(staffIdx, 1)[0][1]);
    }
  }

  // Notes — everything left over
  if (remaining.length && !out.notes) {
    out.notes = remaining.map(x => x[1]).join('\n');
  } else if (remaining.length && out.notes) {
    const extra = remaining.map(x => x[1]).join('\n');
    out.notes = `${out.notes}\n${extra}`;
  }

  return { ...out, missing: computeMissing(out) };
}

/** Quick check if raw text looks like a Paneltec job SMS. */
export function isPaneltecJobSms(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return (
    (lower.includes('you have been allocated') && lower.includes('job')) ||
    (lower.includes('truck') && lower.includes('staff')) ||
    /^\s*(?:cappellotto|isuzu|volvo|hino|kenworth|ute)/im.test(text)
  );
}

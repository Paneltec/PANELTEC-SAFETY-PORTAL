// v160.3.0-adjust-17b — Central template → colour palette. One source
// of truth for Capture-tab card accents; add new templates here as
// they land.
//
// Palette rationale:
//   • Same colour family across all Capture tabs so a Tip Truck record
//     looks the same whether it's on the Pre-Starts tab or (via a link)
//     surfaced elsewhere.
//   • Legacy-import bias: cool tones for pre-starts (blue/violet/teal
//     /amber/indigo) — the routine daily flow; warm tones for
//     risk/safety (rose/red/yellow) — attention-grabbing; cyan for
//     audits; emerald for real (non-legacy, live) submissions.
//   • Each entry provides a `stripe` (600-weight solid, used as the
//     4px left border) and a `chip` bg/text pair for the small type
//     badge next to the date.

const PALETTE = {
  blue:    { stripe: 'bg-blue-500',    chipBg: 'bg-blue-50',    chipText: 'text-blue-700',    ring: 'ring-blue-200' },
  violet:  { stripe: 'bg-violet-500',  chipBg: 'bg-violet-50',  chipText: 'text-violet-700',  ring: 'ring-violet-200' },
  teal:    { stripe: 'bg-teal-500',    chipBg: 'bg-teal-50',    chipText: 'text-teal-700',    ring: 'ring-teal-200' },
  amber:   { stripe: 'bg-amber-500',   chipBg: 'bg-amber-50',   chipText: 'text-amber-700',   ring: 'ring-amber-200' },
  indigo:  { stripe: 'bg-indigo-500',  chipBg: 'bg-indigo-50',  chipText: 'text-indigo-700',  ring: 'ring-indigo-200' },
  rose:    { stripe: 'bg-rose-500',    chipBg: 'bg-rose-50',    chipText: 'text-rose-700',    ring: 'ring-rose-200' },
  red:     { stripe: 'bg-red-500',     chipBg: 'bg-red-50',     chipText: 'text-red-700',     ring: 'ring-red-200' },
  yellow:  { stripe: 'bg-yellow-500',  chipBg: 'bg-yellow-50',  chipText: 'text-yellow-800',  ring: 'ring-yellow-200' },
  cyan:    { stripe: 'bg-cyan-500',    chipBg: 'bg-cyan-50',    chipText: 'text-cyan-700',    ring: 'ring-cyan-200' },
  emerald: { stripe: 'bg-emerald-500', chipBg: 'bg-emerald-50', chipText: 'text-emerald-700', ring: 'ring-emerald-200' },
  slate:   { stripe: 'bg-slate-400',   chipBg: 'bg-slate-100',  chipText: 'text-slate-700',   ring: 'ring-slate-200' },
};

// Template name → palette key. Match on exact `template_name_snapshot`
// (falls through to a heuristic for anything not listed).
const TEMPLATE_COLOR_MAP = {
  // Pre-Starts family — cool.
  'Daily Pre-Start':                              'blue',
  'CVT Daily Pre-Start':                          'violet',
  'Vacuum Truck (VT) Daily Pre-Start':            'teal',
  'Tip Truck Daily Pre-Start':                    'amber',
  'Weekly Pre-Start':                             'indigo',
  // Risk / safety — warm.
  'Construction & Excavation SSRA':               'rose',
  'Viatec Traffic Solutions SSRA':                'red',
  'TTM Risk Assessment & Treatment Register':     'yellow',
  // Audit.
  'VTS Tight Site Audit':                         'cyan',
};

/**
 * Resolve a template name (or a record) to a palette entry. Records
 * flagged `imported: false` (real, live submissions) get emerald
 * regardless of template.
 */
export function templateColor(templateNameOrRecord) {
  let name = '';
  let imported = true;
  if (typeof templateNameOrRecord === 'string') {
    name = templateNameOrRecord;
  } else if (templateNameOrRecord && typeof templateNameOrRecord === 'object') {
    const r = templateNameOrRecord;
    name = r.template_name_snapshot || r.template_name || r.title || '';
    imported = Boolean(r.imported);
    // Live submissions (non-imported) get the emerald tone.
    if (!imported) return PALETTE.emerald;
  }
  if (TEMPLATE_COLOR_MAP[name]) return PALETTE[TEMPLATE_COLOR_MAP[name]];
  // Heuristics for names not in the exact map.
  const low = name.toLowerCase();
  if (low.includes('ssra'))          return PALETTE.rose;
  if (low.includes('tight site'))    return PALETTE.cyan;
  if (low.includes('weekly'))        return PALETTE.indigo;
  if (low.includes('cvt'))           return PALETTE.violet;
  if (low.includes('vacuum'))        return PALETTE.teal;
  if (low.includes('tip truck'))     return PALETTE.amber;
  if (low.includes('pre-start') || low.includes('pre start')) return PALETTE.blue;
  if (low.includes('risk'))          return PALETTE.yellow;
  if (low.includes('hazard'))        return PALETTE.rose;
  if (low.includes('incident'))      return PALETTE.red;
  if (low.includes('inspection'))    return PALETTE.emerald;
  return PALETTE.slate;
}

// v160.3.0-adjust-17e — Per-form-category palette. Extends the Capture
// tab palette so a category color is consistent whether shown on a
// submission (Capture tab) or a template (Forms tab).
//
// `stripe` — 4 px left-border-solid class. `chipBg/chipText` — pill
// colors when the category is used as a badge (mirrors PALETTE entries
// in the map above).
export const CATEGORY_COLORS = {
  pre_start:       PALETTE.blue,
  plant_pre_start: PALETTE.blue,
  inspection:      PALETTE.cyan,
  hazard:          PALETTE.rose,
  near_miss:       PALETTE.amber,
  incident:        PALETTE.red,
  site_diary:      PALETTE.amber,
  risk_assessment: PALETTE.yellow,
  swms:            PALETTE.violet,
  toolbox:         PALETTE.emerald,
  general:         PALETTE.slate,
  admin:           PALETTE.slate,
  all:             PALETTE.slate,
};

/**
 * Resolve a form-template category (or category key on any record) to a
 * palette entry. Falls back to the slate palette for unknown categories.
 */
export function categoryColor(category) {
  return CATEGORY_COLORS[category] || PALETTE.slate;
}
export function templateShortLabel(name) {
  if (!name) return '';
  const low = name.toLowerCase();
  if (low.includes('viatec')) return 'VTS SSRA';
  if (low.includes('construction') && low.includes('ssra')) return 'C&E SSRA';
  if (low.includes('tight site')) return 'Tight Site';
  if (low.includes('cvt')) return 'CVT';
  if (low.includes('vacuum')) return 'VT';
  if (low.includes('tip truck')) return 'Tip Truck';
  if (low.includes('weekly')) return 'Weekly';
  if (low.includes('ttm')) return 'TTM';
  if (low.includes('pre-start') || low.includes('pre start')) return 'Pre-Start';
  // Fallback — first two words.
  return name.split(/\s+/).slice(0, 2).join(' ');
}

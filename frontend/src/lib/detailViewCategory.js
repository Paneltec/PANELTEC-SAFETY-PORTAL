// v160.3.9.58.13.36 — Detail-view category resolver.
//
// Given any submission record (pre_start / form_submission shape),
// return a canonical category token used by `SubmissionViewer` to
// decide which sections (CHECKLIST vs HAZARDS+CREW+SIGNATURES vs
// PERMIT vs fall-through) to render.
//
// Resolution order (first hit wins):
//   1. `record.template_category_snapshot` — the DB-stamped source
//      of truth. Post-v58.13.30 pipeline writes this.
//   2. `record.template_name_snapshot` — keyword sniff so records
//      predating v58.10.3 still land in the right bucket.
//   3. `record.work_summary` — Simpro-imported records encode the
//      template name in "Imported: …zip::<TEMPLATE> (Nnn) - <date>.pdf",
//      so parse the segment between `::` and the trailing `(N)`.
//   4. Fall through → "unknown".
//
// Returned values:
//   'pre_start'       — daily / weekly / plant pre-starts, vehicle
//                       pre-use inspection, equipment checklist
//   'plant_pre_start' — plant-specific pre-start
//   'hazard'          — SSRA, hazard report, risk assessment
//   'swms'            — Safe Work Method Statement
//   'permit'          — excavation permit, hot work permit, etc.
//   'inspection'      — WHSEQ audit, site inspection
//   'unknown'         — nothing matched
//
// Section rendering map (owned by SubmissionViewer):
//   pre_start / plant_pre_start / inspection → CHECKLIST
//   hazard / swms                            → HAZARDS + CREW + SIGNATURES + CHECKLIST
//   permit                                   → HAZARDS + SIGNATURES + CHECKLIST
//   unknown                                  → CHECKLIST only (all fields flat)

const KEYWORD_RULES = [
  { rx: /\bssra\b/i,                          cat: 'hazard' },
  { rx: /safe\s+work\s+method\s+statement/i,  cat: 'swms' },
  { rx: /\bswms\b/i,                          cat: 'swms' },
  { rx: /excavation\s+permit/i,               cat: 'permit' },
  { rx: /hot\s+work\s+permit/i,               cat: 'permit' },
  { rx: /\bpermit\b/i,                        cat: 'permit' },
  { rx: /hazard\s+report/i,                   cat: 'hazard' },
  { rx: /risk\s+assessment/i,                 cat: 'hazard' },
  { rx: /whseq\s+compliance\s+audit/i,        cat: 'inspection' },
  { rx: /plant\s+pre-?start/i,                cat: 'plant_pre_start' },
  { rx: /pre-?start/i,                        cat: 'pre_start' },
  { rx: /prestart/i,                          cat: 'pre_start' },
  { rx: /daily\s+check/i,                     cat: 'pre_start' },
  { rx: /pre-?use\s+(inspection|checklist)/i, cat: 'pre_start' },
  { rx: /checklist/i,                         cat: 'pre_start' },
  { rx: /inspection/i,                        cat: 'inspection' },
];

function categoryFromName(name) {
  if (!name || typeof name !== 'string') return null;
  for (const { rx, cat } of KEYWORD_RULES) {
    if (rx.test(name)) return cat;
  }
  return null;
}

function nameFromWorkSummary(ws) {
  if (!ws || typeof ws !== 'string') return null;
  const idx = ws.indexOf('::');
  if (idx === -1) return null;
  let after = ws.slice(idx + 2);
  after = after.replace(/\s*\(\d+\)\s*-\s*\d+.*$/, '');
  after = after.replace(/\.pdf.*$/i, '');
  return after.trim();
}

/**
 * Resolve a record's category token.
 *
 * @param {object|null|undefined} record
 * @returns {'pre_start'|'plant_pre_start'|'hazard'|'swms'|'permit'|'inspection'|'unknown'}
 */
export function resolveCategory(record) {
  if (!record || typeof record !== 'object') return 'unknown';
  const stamped = (record.template_category_snapshot || '').trim().toLowerCase();
  if (stamped) {
    // Only accept known category tokens; normalise a few common
    // aliases so `general`/`risk_assessment` don't slip through as
    // `unknown` when the pipeline's category stamp is off-canon.
    if (['pre_start', 'plant_pre_start', 'hazard', 'swms',
         'permit', 'inspection'].includes(stamped)) return stamped;
    if (stamped === 'risk_assessment') return 'hazard';
  }
  const nameHit = categoryFromName(
    record.template_name_snapshot || record.template_name || '');
  if (nameHit) return nameHit;
  const wsHit = categoryFromName(nameFromWorkSummary(record.work_summary));
  if (wsHit) return wsHit;
  return 'unknown';
}

const PILL_PALETTE = {
  pre_start:       { label: 'PRE-START',  hex: '#2C6BFF', tint: '#DBEAFE', text: '#1E3A8A' },
  plant_pre_start: { label: 'PLANT',      hex: '#6366F1', tint: '#E0E7FF', text: '#3730A3' },
  hazard:          { label: 'HAZARD',     hex: '#F59E0B', tint: '#FEF3C7', text: '#92400E' },
  swms:            { label: 'SWMS',       hex: '#EF4444', tint: '#FEE2E2', text: '#991B1B' },
  permit:          { label: 'PERMIT',     hex: '#F97316', tint: '#FFEDD5', text: '#9A3412' },
  inspection:      { label: 'INSPECTION', hex: '#10B981', tint: '#D1FAE5', text: '#065F46' },
  unknown:         { label: 'RECORD',     hex: '#64748B', tint: '#F1F5F9', text: '#334155' },
};

/** @param {string} category */
export function paletteForCategory(category) {
  return PILL_PALETTE[category] || PILL_PALETTE.unknown;
}

/**
 * A record has been touched by the v58.13.35 Ship 4b re-extraction
 * (cache-derived, partial) if either its own metadata carries the
 * marker, or its migrated FS row does. Used to render the
 * "Awaiting full re-extraction" empty-state on hazard/permit
 * sections whose SSRA-shape fields (hazards[], crew[], signatures[])
 * were NOT yet populated.
 *
 * @param {object|null|undefined} record
 */
export function isPartialCacheOnlyReextract(record) {
  if (!record || typeof record !== 'object') return false;
  const meta = record.metadata || {};
  if (meta.reextract_reason === 'v58_13_35_partial_cache_only') return true;
  if (record.reextract_target_collection === 'form_submissions'
      && record.reextract_script_version === 'v58.13.35') return true;
  return false;
}

/**
 * Return true iff the value should render as a non-empty answer.
 * Skips: null, undefined, empty string, "None" (the extractor's
 * Python-repr stringified null), empty arrays, empty objects.
 *
 * @param {*} v
 */
export function isMeaningfulValue(v) {
  if (v == null) return false;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return false;
    if (s.toLowerCase() === 'none') return false;
    return true;
  }
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return true;
}

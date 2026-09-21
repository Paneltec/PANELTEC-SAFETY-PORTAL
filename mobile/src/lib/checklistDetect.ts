/**
 * Trinary checklist detection + render-plan builder.
 * Ported from web Forms.jsx (.132kb) → mobile (.132kc).
 *
 * Detects 3-option radios whose labels classify as ✓/✗/NA and
 * pairs them with adjacent "— notes" text fields.
 */

import type { FormField } from '../../services/forms';

// ── Classification ──

const CHECK_RE = /^(✓|tick|check|yes|ok|pass)$/i;
const CROSS_RE = /^(✗|x|cross|repair|fail|no|defective)$/i;
const NA_RE    = /^(n\/a|na|n\.a\.|not applicable)$/i;

// Also match compound labels like "✓ Check", "✗ Repair"
function classifyLabel(raw: string): 'check' | 'cross' | 'na' | null {
  const n = raw.trim().toLowerCase();
  if (CHECK_RE.test(n)) return 'check';
  if (CROSS_RE.test(n)) return 'cross';
  if (NA_RE.test(n)) return 'na';
  // compound: "✓ check", "✗ repair"
  if (n.includes('✓') || n.includes('tick')) return 'check';
  if (n.includes('✗') || n.includes('cross') || n.startsWith('repair')) return 'cross';
  return null;
}

export function classifyTrinaryOption(opt: string): 'check' | 'cross' | 'na' | null {
  return classifyLabel(opt);
}

export function findTrinaryOption(field: FormField, kind: 'check' | 'cross' | 'na'): string | null {
  return (field.options || []).find((o) => classifyTrinaryOption(o) === kind) || null;
}

export function isTrinaryChecklistRadio(f: FormField): boolean {
  if (!f || f.type !== 'radio') return false;
  const opts = Array.isArray(f.options) ? f.options : [];
  if (opts.length !== 3) return false;
  let hasCheck = false, hasCross = false, hasNa = false;
  for (const o of opts) {
    const kind = classifyLabel(String(o));
    if (kind === 'check') hasCheck = true;
    else if (kind === 'cross') hasCross = true;
    else if (kind === 'na') hasNa = true;
  }
  return hasCheck && hasCross && hasNa;
}

// ── Paired notes detection ──

export function findPairedNotesField(
  radio: FormField, allFields: FormField[], idx: number,
): FormField | null {
  const next = allFields[idx + 1];
  if (!next || next.type !== 'text') return null;
  const rl = String(radio.label || '').trim();
  const nl = String(next.label || '').trim();
  // Accept " — notes" (em-dash), " – notes" (en-dash), " - notes" (hyphen)
  const suffix = nl.slice(rl.length);
  const suffixOk = /^ ?[—–\-] ?notes$/i.test(suffix);
  return (nl.startsWith(rl) && suffixOk) ? next : null;
}

// ── Render plan ──

export type RenderEntry =
  | { kind: 'field'; id: string; field: FormField }
  | { kind: 'checklist_row'; id: string; radio: FormField; notes: FormField };

export function buildFieldRenderPlan(fields: FormField[]): RenderEntry[] {
  const plan: RenderEntry[] = [];
  const skip = new Set<string>();
  (fields || []).forEach((f, i) => {
    if (skip.has(f.id)) return;
    if (isTrinaryChecklistRadio(f)) {
      const notes = findPairedNotesField(f, fields, i);
      if (notes) {
        skip.add(notes.id);
        plan.push({ kind: 'checklist_row', id: f.id, radio: f, notes });
        return;
      }
    }
    plan.push({ kind: 'field', id: f.id, field: f });
  });
  return plan;
}

// ── Row tint styles ──

export const CHECKLIST_TINT = {
  check: { bg: '#ECFDF5', border: '#10B981' },  // emerald-50 / 500
  cross: { bg: '#FFF1F2', border: '#F43F5E' },   // rose-50 / 500
  na:    { bg: '#F1F5F9', border: '#64748B' },    // slate-100 / 500
} as const;

export const PILL_COLORS = {
  check:   { bg: '#10B981', text: '#FFFFFF' },  // emerald-500
  cross:   { bg: '#F43F5E', text: '#FFFFFF' },  // rose-500
  na:      { bg: '#475569', text: '#FFFFFF' },  // slate-600
  unset:   { bg: '#FFFFFF', border: '#E2E8F0', text: '#334155' },
} as const;

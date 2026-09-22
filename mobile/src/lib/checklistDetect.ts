/**
 * Trinary checklist detection + render-plan builder.
 * v58.13.132kx — Extended with Pass 2 collapsible section-group folding.
 *
 * Pass 1: Detects 3-option radios as checklist_row + paired notes.
 * Pass 2: Folds section_header fields into collapsible section_group
 *   nodes (unless label matches FLAT_ZONE_RE).
 */

import type { FormField } from '../services/forms';

// ── Classification ──

const CHECK_RE = /^(✓|tick|check|yes|ok|pass)$/i;
const CROSS_RE = /^(✗|x|cross|repair|fail|no|defective)$/i;
const NA_RE    = /^(n\/a|na|n\.a\.|not applicable)$/i;

function classifyLabel(raw: string): 'check' | 'cross' | 'na' | null {
  const n = raw.trim().toLowerCase();
  if (CHECK_RE.test(n)) return 'check';
  if (CROSS_RE.test(n)) return 'cross';
  if (NA_RE.test(n)) return 'na';
  if (n.includes('✓') || n.includes('tick')) return 'check';
  if (n.includes('✗') || n.includes('cross') || n.startsWith('repair')) return 'cross';
  return null;
}

export function classifyTrinaryOption(opt: string | null | undefined): 'check' | 'cross' | 'na' | null {
  if (!opt) return null;
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
  const suffix = nl.slice(rl.length);
  const suffixOk = /^ ?[—–\-] ?notes$/i.test(suffix);
  return (nl.startsWith(rl) && suffixOk) ? next : null;
}

// ── Render plan types ──

export type RenderEntry =
  | { kind: 'field'; id: string; field: FormField }
  | { kind: 'checklist_row'; id: string; radio: FormField; notes: FormField };

export interface SectionGroupEntry {
  kind: 'section_group';
  id: string;
  key: string;
  header: FormField;
  letter: string | null;
  icon: 'gauge' | 'clipboard' | null;
  entries: RenderEntry[];
  hasTrinary: boolean;
}

export type RenderPlanEntry = RenderEntry | SectionGroupEntry;

// ── Pass 2: section-group folding (from web .132kd1) ──

const FLAT_ZONE_RE = /(vehicle details|service level|consumables|parts used|attachments|sign.?off|signatures|follow.?up)/i;

export function buildFieldRenderPlan(fields: FormField[]): RenderPlanEntry[] {
  // Pass 1 — collapse radio + "— notes" pairs into inline checklist rows
  const flat: RenderEntry[] = [];
  const skip = new Set<string>();
  (fields || []).forEach((f, i) => {
    if (skip.has(f.id)) return;
    if (isTrinaryChecklistRadio(f)) {
      const notes = findPairedNotesField(f, fields, i);
      if (notes) {
        skip.add(notes.id);
        flat.push({ kind: 'checklist_row', id: f.id, radio: f, notes });
        return;
      }
    }
    flat.push({ kind: 'field', id: f.id, field: f });
  });

  // Pass 2 — fold section headers into collapsible section_group nodes
  const grouped: RenderPlanEntry[] = [];
  let i = 0;
  while (i < flat.length) {
    const e = flat[i];
    const cfg = (e.kind === 'field') ? (e.field.config || {}) as Record<string, unknown> : null;
    const label = (e.kind === 'field') ? (e.field.label || '') : '';
    const isHeader = e.kind === 'field' && cfg && cfg.section_header;
    const isFlatZone = isHeader && FLAT_ZONE_RE.test(label);

    if (isHeader && !isFlatZone) {
      let j = i + 1;
      const block: RenderEntry[] = [];
      while (j < flat.length) {
        const nx = flat[j];
        const nxCfg = (nx.kind === 'field') ? (nx.field.config || {}) as Record<string, unknown> : null;
        if (nx.kind === 'field' && nxCfg && nxCfg.section_header) break;
        // Also break on flat-zone labels
        if (nx.kind === 'field' && FLAT_ZONE_RE.test(nx.field.label || '')) break;
        block.push(nx);
        j++;
      }
      if (block.length > 0) {
        const letterMatch = label.match(/^([A-K])\.\s/);
        const letter = letterMatch ? letterMatch[1] : null;
        let icon: 'gauge' | 'clipboard' | null = null;
        if (/tread/i.test(label)) icon = 'gauge';
        else if (!letter) icon = 'clipboard';
        const subSection = cfg?.sub_section as string | undefined;
        const key = subSection
          || (letter ? `sub-${letter}` : `hdr-${((e as { field: FormField }).field.id || '').slice(0, 8)}`);
        const hasTrinary = block.some((b) => b.kind === 'checklist_row');
        grouped.push({
          kind: 'section_group',
          id: key,
          key,
          header: (e as { field: FormField }).field,
          letter,
          icon,
          entries: block,
          hasTrinary,
        });
        i = j;
        continue;
      }
    }
    grouped.push(e);
    i += 1;
  }
  return grouped;
}

// ── Section palette (matches web .132kd) ──

export const SCS_SECTION_PALETTE: Record<string, { badge: string; tint: string; accent: string }> = {
  A: { badge: '#F59E0B', tint: '#FFFBEB', accent: '#F59E0B' },
  B: { badge: '#0EA5E9', tint: '#F0F9FF', accent: '#0EA5E9' },
  C: { badge: '#06B6D4', tint: '#ECFEFF', accent: '#06B6D4' },
  D: { badge: '#8B5CF6', tint: '#F5F3FF', accent: '#8B5CF6' },
  E: { badge: '#10B981', tint: '#ECFDF5', accent: '#10B981' },
  F: { badge: '#F43F5E', tint: '#FFF1F2', accent: '#F43F5E' },
  G: { badge: '#6366F1', tint: '#EEF2FF', accent: '#6366F1' },
  H: { badge: '#3B82F6', tint: '#EFF6FF', accent: '#3B82F6' },
  I: { badge: '#14B8A6', tint: '#F0FDFA', accent: '#14B8A6' },
  J: { badge: '#64748B', tint: '#F8FAFC', accent: '#64748B' },
  K: { badge: '#F59E0B', tint: '#FFFBEB', accent: '#F59E0B' },
};
const SCS_NEUTRAL_PALETTE = { badge: '#64748B', tint: '#F8FAFC', accent: '#64748B' };

export function paletteForSection(group: SectionGroupEntry) {
  if (group.letter && SCS_SECTION_PALETTE[group.letter]) return SCS_SECTION_PALETTE[group.letter];
  const st = (group.header?.style || {}) as Record<string, string>;
  if (st.borderColor && st.backgroundColor) {
    return { badge: st.borderColor, tint: st.backgroundColor, accent: st.borderColor };
  }
  return SCS_NEUTRAL_PALETTE;
}

// ── Section status computation ──

export function computeSectionStatus(
  entries: { kind: string; radio?: { id: string }; notes?: { id: string }; field?: FormField }[],
  values: Record<string, unknown>,
): { key: string; bg: string; fg: string } {
  let total = 0;
  let answered = 0;
  let anyCross = false;
  for (const en of entries) {
    if (en.kind === 'checklist_row' && en.radio) {
      total += 1;
      const v = values[en.radio.id] as string | undefined;
      const kind = classifyTrinaryOption(v);
      if (kind === 'cross') anyCross = true;
      if (kind) answered += 1;
    } else if (en.kind === 'field' && en.field) {
      const t = en.field.type;
      if (t === 'number' || t === 'text' || t === 'textarea' || t === 'select' || t === 'date') {
        total += 1;
        const v = values[en.field.id];
        if (v !== undefined && v !== null && v !== '') answered += 1;
      }
    }
  }
  if (anyCross) return { key: 'ATTENTION', bg: '#FEE2E2', fg: '#B91C1C' };
  if (total === 0) return { key: 'NOT STARTED', bg: '#F1F5F9', fg: '#64748B' };
  if (answered === 0) return { key: 'NOT STARTED', bg: '#F1F5F9', fg: '#64748B' };
  if (answered < total) return { key: 'IN PROGRESS', bg: '#FEF3C7', fg: '#B45309' };
  return { key: 'COMPLETE', bg: '#D1FAE5', fg: '#047857' };
}

// ── Row tint styles ──

export const CHECKLIST_TINT = {
  check: { bg: '#ECFDF5', border: '#10B981' },
  cross: { bg: '#FFF1F2', border: '#F43F5E' },
  na:    { bg: '#F1F5F9', border: '#64748B' },
} as const;

export const PILL_COLORS = {
  check:   { bg: '#10B981', text: '#FFFFFF' },
  cross:   { bg: '#F43F5E', text: '#FFFFFF' },
  na:      { bg: '#475569', text: '#FFFFFF' },
  unset:   { bg: '#FFFFFF', border: '#E2E8F0', text: '#334155' },
} as const;

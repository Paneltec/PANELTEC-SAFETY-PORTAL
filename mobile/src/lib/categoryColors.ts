/**
 * categoryColors.ts — Mobile-side palette for Forms tab category tiles.
 * v58.13.132p2f — Option B colour-coded tiles. SVG icons replace PNGs.
 */

export type CategoryKey =
  | 'pre_start' | 'general' | 'inspection' | 'admin' | 'incident'
  | 'swms' | 'risk_assessment' | 'site_diary' | 'hazard' | 'near_miss'
  | 'toolbox' | 'plant_pre_start'
  | string;

export interface CategoryPalette {
  stripe: string;     // LH stripe hex (strong colour)
  chipBg: string;     // Soft tint bg (icon container + chips)
  chipText: string;   // Deep text hex for category label + icon stroke
  iconBg: string;     // Icon container background (slightly stronger tint)
}

export const CATEGORY_PALETTE: Record<string, CategoryPalette> = {
  general:         { stripe: '#64748B', chipBg: '#F1F5F9', chipText: '#334155', iconBg: '#E2E8F0' },
  swms:            { stripe: '#8B5CF6', chipBg: '#F5F3FF', chipText: '#6D28D9', iconBg: '#EDE9FE' },
  pre_start:       { stripe: '#3B82F6', chipBg: '#EFF6FF', chipText: '#1D4ED8', iconBg: '#DBEAFE' },
  inspection:      { stripe: '#06B6D4', chipBg: '#ECFEFF', chipText: '#0E7490', iconBg: '#CFFAFE' },
  hazard:          { stripe: '#F97316', chipBg: '#FFF7ED', chipText: '#C2410C', iconBg: '#FED7AA' },
  near_miss:       { stripe: '#EAB308', chipBg: '#FEFCE8', chipText: '#A16207', iconBg: '#FEF08A' },
  incident:        { stripe: '#EF4444', chipBg: '#FEF2F2', chipText: '#B91C1C', iconBg: '#FECACA' },
  risk_assessment: { stripe: '#A855F7', chipBg: '#FAF5FF', chipText: '#7E22CE', iconBg: '#E9D5FF' },
  ssra:            { stripe: '#0D9488', chipBg: '#F0FDFA', chipText: '#115E59', iconBg: '#CCFBF1' },
  site_diary:      { stripe: '#F59E0B', chipBg: '#FFFBEB', chipText: '#B45309', iconBg: '#FDE68A' },
  toolbox:         { stripe: '#10B981', chipBg: '#ECFDF5', chipText: '#047857', iconBg: '#A7F3D0' },
  admin:           { stripe: '#94A3B8', chipBg: '#F1F5F9', chipText: '#475569', iconBg: '#E2E8F0' },
  plant_pre_start: { stripe: '#3B82F6', chipBg: '#EFF6FF', chipText: '#1D4ED8', iconBg: '#DBEAFE' },
};

const FALLBACK: CategoryPalette = {
  stripe: '#94A3B8',
  chipBg: '#F1F5F9',
  chipText: '#334155',
  iconBg: '#E2E8F0',
};

export function categoryPalette(cat: string | undefined | null): CategoryPalette {
  if (!cat) return FALLBACK;
  return CATEGORY_PALETTE[cat] ?? FALLBACK;
}

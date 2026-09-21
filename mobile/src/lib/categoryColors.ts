/**
 * categoryColors.ts — Mobile-side palette for Forms tab category tiles.
 * Mirrors the web palette from frontend/src/lib/templateColors.js.
 * v58.13.132jm
 */

export type CategoryKey =
  | 'pre_start' | 'general' | 'inspection' | 'admin' | 'incident'
  | 'swms' | 'risk_assessment' | 'site_diary' | 'hazard' | 'near_miss'
  | 'toolbox' | 'plant_pre_start'
  | string;

export interface CategoryPalette {
  stripe: string;     // LH stripe hex
  chipBg: string;     // Light tint bg
  chipText: string;   // Deep text hex for category label
  icon: any;          // require('...') asset
}

const icons = {
  pre_start:       require('../../assets/icons/categories/pre_start.png'),
  general:         require('../../assets/icons/categories/general.png'),
  inspection:      require('../../assets/icons/categories/inspection.png'),
  admin:           require('../../assets/icons/categories/admin.png'),
  incident:        require('../../assets/icons/categories/incident.png'),
  swms:            require('../../assets/icons/categories/swms.png'),
  risk_assessment: require('../../assets/icons/categories/risk_assessment.png'),
  site_diary:      require('../../assets/icons/categories/site_diary.png'),
};

export const CATEGORY_PALETTE: Record<string, CategoryPalette> = {
  pre_start:       { stripe: '#3B82F6', chipBg: '#EFF6FF', chipText: '#1D4ED8', icon: icons.pre_start },
  general:         { stripe: '#94A3B8', chipBg: '#F1F5F9', chipText: '#334155', icon: icons.general },
  inspection:      { stripe: '#06B6D4', chipBg: '#ECFEFF', chipText: '#0E7490', icon: icons.inspection },
  admin:           { stripe: '#94A3B8', chipBg: '#F1F5F9', chipText: '#334155', icon: icons.admin },
  incident:        { stripe: '#EF4444', chipBg: '#FEF2F2', chipText: '#B91C1C', icon: icons.incident },
  swms:            { stripe: '#8B5CF6', chipBg: '#F5F3FF', chipText: '#6D28D9', icon: icons.swms },
  risk_assessment: { stripe: '#EAB308', chipBg: '#FEFCE8', chipText: '#A16207', icon: icons.risk_assessment },
  site_diary:      { stripe: '#F59E0B', chipBg: '#FFFBEB', chipText: '#B45309', icon: icons.site_diary },
  // Extended categories — use general icon as placeholder
  plant_pre_start: { stripe: '#3B82F6', chipBg: '#EFF6FF', chipText: '#1D4ED8', icon: icons.pre_start },
  hazard:          { stripe: '#F43F5E', chipBg: '#FFF1F2', chipText: '#BE123C', icon: icons.general },
  near_miss:       { stripe: '#F59E0B', chipBg: '#FFFBEB', chipText: '#B45309', icon: icons.general },
  toolbox:         { stripe: '#10B981', chipBg: '#ECFDF5', chipText: '#047857', icon: icons.general },
};

const FALLBACK: CategoryPalette = {
  stripe: '#94A3B8',
  chipBg: '#F1F5F9',
  chipText: '#334155',
  icon: icons.general,
};

export function categoryPalette(cat: string | undefined | null): CategoryPalette {
  if (!cat) return FALLBACK;
  return CATEGORY_PALETTE[cat] ?? FALLBACK;
}

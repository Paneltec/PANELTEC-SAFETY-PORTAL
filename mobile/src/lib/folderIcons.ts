/**
 * folderIcons.ts — Name-based icon heuristic for Docs tab folders.
 * v58.13.132jn
 */
import { Ionicons } from '@expo/vector-icons';

export const FOLDER_ICON_RULES: {
  pattern: RegExp;
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
}[] = [
  { pattern: /\bsds\b|\bsafety.?data/i,                  icon: 'flask',               tint: '#EF4444' },
  { pattern: /\btraining\b|\bcompeten/i,                  icon: 'school',              tint: '#3B82F6' },
  { pattern: /\bwork\b|\bjob\b|\bsite\b|\bproject\b/i,    icon: 'briefcase',           tint: '#F59E0B' },
  { pattern: /\bims\b|\bintegrated\b|\bmanagement\b/i,    icon: 'grid',                tint: '#8B5CF6' },
  { pattern: /\barchive/i,                                icon: 'archive',             tint: '#94A3B8' },
  { pattern: /\bequipment\b|\bassets?\b|\btools?\b/i,     icon: 'construct',           tint: '#EF4444' },
  { pattern: /\bcompli|\bsafety\b/i,                      icon: 'shield-checkmark',    tint: '#10B981' },
  { pattern: /\badmin/i,                                  icon: 'settings',            tint: '#64748B' },
  { pattern: /\bcompany\b|\borg\b|\bbusiness\b/i,         icon: 'business',            tint: '#0EA5E9' },
  { pattern: /\bpolicy\b|\bpolic/i,                       icon: 'document-text',       tint: '#7C3AED' },
  { pattern: /\bswms\b|\bsafe.?work/i,                    icon: 'shield-checkmark',    tint: '#8B5CF6' },
  { pattern: /\bincident\b|\bhazard\b|\bnear.?miss/i,     icon: 'warning',             tint: '#EF4444' },
  { pattern: /\bpermit/i,                                 icon: 'key',                 tint: '#F59E0B' },
  { pattern: /\bhr\b|\bpeople\b|\bstaff\b|\bworker/i,     icon: 'people',              tint: '#10B981' },
  { pattern: /\bfinance\b|\baccount\b|\binvoice\b/i,      icon: 'cash',                tint: '#10B981' },
  { pattern: /\blegal\b|\bcontract/i,                     icon: 'reader',              tint: '#64748B' },
  { pattern: /\bphoto\b|\bimage\b|\bmedia\b/i,            icon: 'image',               tint: '#EC4899' },
  { pattern: /\buncategor/i,                              icon: 'file-tray-full',      tint: '#94A3B8' },
];

const FALLBACK = { icon: 'folder' as keyof typeof Ionicons.glyphMap, tint: '#F59E0B' };

export function folderIcon(name: string | undefined | null): {
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
} {
  if (!name) return FALLBACK;
  for (const rule of FOLDER_ICON_RULES) {
    if (rule.pattern.test(name)) return { icon: rule.icon, tint: rule.tint };
  }
  return FALLBACK;
}

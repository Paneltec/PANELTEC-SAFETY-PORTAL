// Dark Navy + Orange Tech Aesthetic — Paneltec Civil Design System
export const Colors = {
  // Core backgrounds
  bg: '#020617',           // slate-950 — deepest bg
  surface: '#0F172A',      // slate-900 — card/section bg
  surfaceLight: '#1E293B', // slate-800 — elevated cards
  surfaceHover: '#334155', // slate-700 — hover/press state

  // Borders
  border: '#334155',       // slate-700
  borderLight: '#1E293B',  // slate-800
  borderFocus: '#F97316',  // orange — focused inputs

  // Text — v160.0.4: brightened secondary/tertiary so field text is
  // readable in bright sun. Primary near-white; secondary light slate;
  // tertiary medium slate — legible, not ghosted.
  ink: '#F8FAFC',          // slate-50 — primary text (light)
  text: '#F8FAFC',         // slate-50
  textSecondary: '#CBD5E1',// slate-300 (was 400 — lifted for readability)
  textTertiary: '#94A3B8', // slate-400 (was 500 — lifted for readability)
  white: '#FFFFFF',

  // Orange accent
  orange: '#F97316',       // orange-500 — primary CTA
  orangeLight: '#FB923C',  // orange-400
  orangeDark: '#EA580C',   // orange-600
  orangeSoft: 'rgba(249,115,22,0.12)', // orange bg tint

  // Legacy blues (still used for certain elements)
  blue: '#F97316',         // REMAPPED to orange for primary actions
  blueSoft: 'rgba(249,115,22,0.12)',

  // Semantic
  emerald: '#10B981',
  emeraldDark: '#047857',
  mint: '#064E3B',         // dark mint for dark theme
  red: '#EF4444',
  redSoft: 'rgba(239,68,68,0.15)',
  amber: '#F59E0B',
  amberSoft: 'rgba(245,158,11,0.15)',
  violet: '#A78BFA',
  violetSoft: 'rgba(167,139,250,0.15)',

  // Gold admin
  gold: '#EAB308',
  goldSoft: 'rgba(234,179,8,0.15)',

  // Paneltec
  paneltecGold: '#F4C430',
};

export const StatusColors: Record<string, { bg: string; text: string; border: string }> = {
  draft: { bg: '#1E293B', text: '#94A3B8', border: '#334155' },
  submitted: { bg: 'rgba(249,115,22,0.12)', text: '#FB923C', border: 'rgba(249,115,22,0.3)' },
  approved: { bg: 'rgba(16,185,129,0.12)', text: '#34D399', border: 'rgba(16,185,129,0.3)' },
  rejected: { bg: 'rgba(239,68,68,0.12)', text: '#F87171', border: 'rgba(239,68,68,0.3)' },
  changes_requested: { bg: 'rgba(245,158,11,0.12)', text: '#FBBF24', border: 'rgba(245,158,11,0.3)' },
  open: { bg: 'rgba(245,158,11,0.12)', text: '#FBBF24', border: 'rgba(245,158,11,0.3)' },
  in_progress: { bg: 'rgba(249,115,22,0.12)', text: '#FB923C', border: 'rgba(249,115,22,0.3)' },
  closed: { bg: 'rgba(16,185,129,0.12)', text: '#34D399', border: 'rgba(16,185,129,0.3)' },
  low: { bg: '#1E293B', text: '#94A3B8', border: '#334155' },
  medium: { bg: 'rgba(245,158,11,0.12)', text: '#FBBF24', border: 'rgba(245,158,11,0.3)' },
  high: { bg: 'rgba(249,115,22,0.12)', text: '#FB923C', border: 'rgba(249,115,22,0.3)' },
  critical: { bg: 'rgba(239,68,68,0.12)', text: '#F87171', border: 'rgba(239,68,68,0.3)' },
  active: { bg: 'rgba(16,185,129,0.12)', text: '#34D399', border: 'rgba(16,185,129,0.3)' },
  inactive: { bg: '#1E293B', text: '#94A3B8', border: '#334155' },
  suspended: { bg: 'rgba(239,68,68,0.12)', text: '#F87171', border: 'rgba(239,68,68,0.3)' },
  pending: { bg: 'rgba(245,158,11,0.12)', text: '#FBBF24', border: 'rgba(245,158,11,0.3)' },
  completed: { bg: 'rgba(16,185,129,0.12)', text: '#34D399', border: 'rgba(16,185,129,0.3)' },
  revoked: { bg: 'rgba(239,68,68,0.12)', text: '#F87171', border: 'rgba(239,68,68,0.3)' },
  valid: { bg: 'rgba(16,185,129,0.12)', text: '#34D399', border: 'rgba(16,185,129,0.3)' },
  expired: { bg: 'rgba(239,68,68,0.12)', text: '#F87171', border: 'rgba(239,68,68,0.3)' },
  expiring_soon: { bg: 'rgba(245,158,11,0.12)', text: '#FBBF24', border: 'rgba(245,158,11,0.3)' },
  queued: { bg: 'rgba(245,158,11,0.12)', text: '#FBBF24', border: 'rgba(245,158,11,0.3)' },
  sent: { bg: 'rgba(16,185,129,0.12)', text: '#34D399', border: 'rgba(16,185,129,0.3)' },
  failed: { bg: 'rgba(239,68,68,0.12)', text: '#F87171', border: 'rgba(239,68,68,0.3)' },
  cancelled: { bg: '#1E293B', text: '#94A3B8', border: '#334155' },
};

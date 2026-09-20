/**
 * Paneltec Civil Field — Design tokens: colour palette.
 * v58.13.132a — Navy + Safety-Orange foundation.
 */
export const Colors = {
  // ── Core brand ──
  navy:           '#0F172A',
  navyLight:      '#1C2C50',   // navy +10 L — unified tab body bg (.132ji)
  orange:         '#F97316',
  orangeLight:    '#FDBA74',
  orangeSoft:     '#FFF7ED',

  // ── Surfaces ──
  bg:             '#F8FAFC',
  surface:        '#FFFFFF',
  surfaceElevated:'#FFFFFF',
  border:         '#E2E8F0',
  borderLight:    '#F1F5F9',

  // ── Text ──
  ink:            '#0F172A',
  textPrimary:    '#0F172A',
  textSecondary:  '#475569',
  textTertiary:   '#94A3B8',
  placeholder:    '#94A3B8',

  // ── Semantic ──
  success:        '#10B981',
  successSoft:    '#D1FAE5',
  warning:        '#F59E0B',
  warningSoft:    '#FEF3C7',
  error:          '#EF4444',
  errorSoft:      '#FEE2E2',
  info:           '#2C6BFF',
  infoSoft:       '#DBEAFE',

  // ── Tab bar ──
  tabActive:      '#F97316',
  tabInactive:    '#94A3B8',
  // v58.13.132m — dedicated light-grey token for the bottom tab bar so it
  // reads as a separator against the navy body of every tab screen.
  tabBar:         '#F1F5F9',
  slate400:       '#94A3B8',
  muted:          '#64748B',

  // ── Misc ──
  white:          '#FFFFFF',
  black:          '#000000',
  overlay:        'rgba(15,23,42,0.5)',

  // ── Company accents ──
  paneltec:       '#F97316',
  viatec:         '#6D28D9',
} as const;

export type ColorKey = keyof typeof Colors;

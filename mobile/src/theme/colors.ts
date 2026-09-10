/**
 * Paneltec Civil Field — Design tokens: colour palette.
 * v58.13.132a — Navy + Safety-Orange foundation.
 */
export const Colors = {
  // ── Option B palette (Sept 2026 redesign) ──
  // Navy screens, off-white bordered cards, orange icons/primary actions,
  // bright green for "go" actions and positive states, grey secondary text.
  screen:         '#1B3D66',
  screenDeep:     '#122E50',
  screenCard:     'rgba(255,255,255,0.06)',
  onScreen:       '#F2F5F9',
  onScreenMuted:  '#B4BFCE',
  onScreenSubtle: '#7F8B9C',
  card:           '#F4F6F9',
  cardBorder:     '#B9C6D6',
  onCard:         '#1A1A1A',
  onCardMuted:    '#4B4B4B',
  onCardSubtle:   '#8A8A8A',
  green:          '#22C55E',
  greenSoft:      'rgba(34,197,94,0.18)',
  onGreen:        '#062B12',
  orangeSoftOnNavy: 'rgba(249,115,22,0.16)',

  // ── Core brand ──
  navy:           '#1B3D66',
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
  tabInactive:    '#D3DCE8',
  // v58.13.132m — dedicated light-grey token for the bottom tab bar so it
  // reads as a separator against the navy body of every tab screen.
  tabBar:         '#122E50',
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

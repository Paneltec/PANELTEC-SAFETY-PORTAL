/**
 * Paneltec Civil — Mobile Design System palette
 *
 * v160.3.9.58.7 — "Airy Construction" palette.
 *   Near-white backgrounds, amber (#F5B301) primary accent,
 *   warm coral secondary, deep near-black text. Modern, premium,
 *   iOS-native aesthetic. White cards with subtle borders + soft shadows.
 *
 * Every colour referenced in the mobile app cascades through these
 * tokens. Never inline `#RRGGBB` strings — import `Colors.<token>`.
 */
export const Colors = {
  // ─── v160.3.9.58.7 Airy Construction palette (SOURCE OF TRUTH) ─────
  imSteel:      '#F0F0F2',   // very light gray — header backdrops, sticky bars
  imBronze:     '#F5B301',   // amber — primary accent (CTAs, active tab, logo)
  imStone:      '#A0A0A0',   // medium gray — muted accents
  imConcrete:   '#F5F5F7',   // near-white gray — page background
  imInk:        '#0A0A0A',   // near-black — primary text
  imInkMuted:   '#6B6B6B',   // secondary text
  imInkSubtle:  '#A0A0A0',   // tertiary text / placeholders
  imBorder:     '#E5E5E5',   // card borders — very subtle
  imSurface:    '#FFFFFF',   // card / tile bg — pure white

  // Status shades — vivid modern semantic colours
  imSuccess:    '#16A34A',   // green
  imWarning:    '#F59E0B',   // amber-orange
  imError:      '#DC2626',   // red

  // ─── Brand accents ─────────────────────────────────────────────────
  paneltecBlue:   '#3B82F6',   // modern blue — info banners
  paneltecViolet: '#6D5CC8',   // AI/intelligence badges
  paneltecGold:   '#F5B301',   // amber

  // ─── Semantic tokens — cascade through the entire app ──────────────
  bg:              '#F5F5F7',   // page background — airy light gray
  surface:         '#FFFFFF',   // cards — pure white
  surfaceLight:    '#F5F5F7',   // secondary surface
  surfaceHover:    '#FAFAFA',   // press state
  surfaceDark:     '#F0F0F2',   // tab bar bg — soft gray
  libraryBg:       '#F5F5F7',
  tileWarm:        '#FFFFFF',
  mutedBg:         '#F5F5F7',

  // HV aliases — all repointed to airy palette
  hvAsphalt:     '#F0F0F2',
  hvOrange:      '#F5B301',
  hvYellow:      '#F5B301',
  hvSurface:     '#FFFFFF',
  hvGreen:       '#16A34A',
  hvRed:         '#DC2626',
  hvInk:         '#0A0A0A',
  hvInkMuted:    '#6B6B6B',
  hvInkSubtle:   '#A0A0A0',
  hvBorder:      '#E5E5E5',
  hvTabInactive: '#A0A0A0',

  // Brand aliases — repointed at airy palette
  brandNavy:       '#F0F0F2',
  brandOrange:     '#F5B301',
  brandBgLight:    '#F5F5F7',
  brandSurface:    '#FFFFFF',
  brandTeal:       '#16A34A',
  brandGrey:       '#6B6B6B',
  brandGreen:      '#16A34A',
  brandAmber:      '#F5B301',
  brandRed:        '#DC2626',
  brandTabBar:     '#FAFAFA',   // very light gray tab bar
  brandTabActive:  '#F5B301',   // amber active tab
  brandTabInactive:'#A0A0A0',   // gray inactive
  brandInk:        '#0A0A0A',
  brandInkMuted:   '#6B6B6B',
  brandInkSubtle:  '#A0A0A0',
  brandBorder:     '#E5E5E5',

  // Light tile aliases
  tileLight:            '#FFFFFF',
  tileLightBorder:      '#E5E5E5',
  tileLightInk:         '#0A0A0A',
  tileLightMuted:       '#6B6B6B',
  tileLightAccentBg:    '#F5B301',
  tileLightAccentIcon:  '#FFFFFF',

  // ─── Borders ───────────────────────────────────────────────────────
  border:      '#E5E5E5',
  borderLight: '#F0F0F2',
  borderMuted: '#E5E5E5',
  borderFocus: '#F5B301',   // amber focus ring

  // ─── Text ──────────────────────────────────────────────────────────
  ink:            '#0A0A0A',
  text:           '#0A0A0A',
  textPrimary:    '#0A0A0A',
  textSecondary:  '#6B6B6B',
  textTertiary:   '#A0A0A0',
  placeholder:    '#A0A0A0',
  textDisabled:   '#C0C0C0',
  white:          '#FFFFFF',

  // ─── Amber accent (primary brand) ─────────────────────────────────
  orange:      '#F5B301',   // amber — primary accent
  orangeLight: '#F5B301',   // amber (unified)
  orangeDark:  '#D49800',   // darker amber
  orangeSoft:  '#FEF3C7',   // warm amber tint bg

  // ─── Blue accent ──────────────────────────────────────────────────
  blue:     '#3B82F6',
  blueSoft: 'rgba(59,130,246,0.08)',

  // ─── Gold (now = amber) ───────────────────────────────────────────
  gold:         '#F5B301',
  goldSoft:     '#FEF3C7',

  // ─── Semantic ─────────────────────────────────────────────────────
  emerald:      '#16A34A',
  emeraldDark:  '#15803D',
  mint:         'rgba(22,163,74,0.08)',
  red:          '#DC2626',
  redSoft:      'rgba(220,38,38,0.08)',
  amber:        '#F59E0B',
  amberSoft:    'rgba(245,158,11,0.08)',
  violet:       '#6D5CC8',
  violetSoft:   'rgba(109,92,200,0.06)',

  // ─── Readable aliases ─────────────────────────────────────────────
  success: '#16A34A',
  error:   '#DC2626',
  warning: '#F59E0B',
  info:    '#3B82F6',
} as const;

/**
 * Status chip palette — v160.3.9.58.7
 *
 * Modern pill colors — white text on saturated backgrounds.
 * Lighter and more vibrant than the old industrial-materials palette.
 */
export const StatusColors: Record<string, { bg: string; text: string; border: string }> = {
  // Draft / muted — soft gray pill
  draft:             { bg: '#D1D5DB', text: '#374151', border: '#9CA3AF' },
  low:               { bg: '#D1D5DB', text: '#374151', border: '#9CA3AF' },
  inactive:          { bg: '#D1D5DB', text: '#374151', border: '#9CA3AF' },
  cancelled:         { bg: '#D1D5DB', text: '#374151', border: '#9CA3AF' },

  // In progress / warning — amber pill
  submitted:         { bg: '#F59E0B', text: '#FFFFFF', border: '#D97706' },
  changes_requested: { bg: '#F59E0B', text: '#FFFFFF', border: '#D97706' },
  open:              { bg: '#F59E0B', text: '#FFFFFF', border: '#D97706' },
  in_progress:       { bg: '#F59E0B', text: '#FFFFFF', border: '#D97706' },
  medium:            { bg: '#F59E0B', text: '#FFFFFF', border: '#D97706' },
  high:              { bg: '#F97316', text: '#FFFFFF', border: '#EA580C' },
  pending:           { bg: '#F59E0B', text: '#FFFFFF', border: '#D97706' },
  queued:            { bg: '#F59E0B', text: '#FFFFFF', border: '#D97706' },
  expiring_soon:     { bg: '#F59E0B', text: '#FFFFFF', border: '#D97706' },

  // Success — green pill
  approved:          { bg: '#16A34A', text: '#FFFFFF', border: '#15803D' },
  closed:            { bg: '#16A34A', text: '#FFFFFF', border: '#15803D' },
  active:            { bg: '#16A34A', text: '#FFFFFF', border: '#15803D' },
  completed:         { bg: '#16A34A', text: '#FFFFFF', border: '#15803D' },
  valid:             { bg: '#16A34A', text: '#FFFFFF', border: '#15803D' },
  sent:              { bg: '#16A34A', text: '#FFFFFF', border: '#15803D' },

  // Error / danger — red pill
  rejected:          { bg: '#DC2626', text: '#FFFFFF', border: '#B91C1C' },
  critical:          { bg: '#DC2626', text: '#FFFFFF', border: '#B91C1C' },
  suspended:         { bg: '#DC2626', text: '#FFFFFF', border: '#B91C1C' },
  revoked:           { bg: '#DC2626', text: '#FFFFFF', border: '#B91C1C' },
  expired:           { bg: '#DC2626', text: '#FFFFFF', border: '#B91C1C' },
  failed:            { bg: '#DC2626', text: '#FFFFFF', border: '#B91C1C' },
};

/**
 * Paneltec Civil — Mobile Design System tokens
 *
 * v160.3.9.58.13.96 — "Modern Light" palette (default).
 *   Off-white cream backgrounds, blue primary accent, white cards with
 *   subtle shadows. Matches the reference mockups (task list + checklist).
 *
 * The `Colors` object is MUTABLE so the ThemeProvider can swap palettes
 * at runtime via `applyPalette()`. Every screen imports `Colors.<token>`
 * — the values cascade automatically on re-render after a palette swap.
 *
 * Token names are preserved from prior iterations so no component
 * import changes are needed.
 */

// Mutable palette object — default is Modern Light
export const Colors: Record<string, string> = {
  // ─── Modern Light palette (DEFAULT) ─────────────────────────────────
  imSteel:      '#E5E7EB',
  imBronze:     '#2563EB',   // primary blue
  imStone:      '#9CA3AF',
  imConcrete:   '#F9F7F2',   // off-white cream page bg
  imInk:        '#111827',   // dark navy text
  imInkMuted:   '#6B7280',
  imInkSubtle:  '#9CA3AF',
  imBorder:     '#E5E7EB',
  imSurface:    '#FFFFFF',   // white cards

  imSuccess:    '#10B981',   // green
  imWarning:    '#F59E0B',   // amber
  imError:      '#EF4444',   // red

  // Brand accents
  paneltecBlue:   '#2563EB',
  paneltecViolet: '#6D5CC8',
  paneltecGold:   '#F59E0B',

  // Semantic tokens
  bg:              '#F9F7F2',
  surface:         '#FFFFFF',
  surfaceLight:    '#F5F3EE',
  surfaceHover:    '#EEECE6',
  surfaceDark:     '#F3F4F6',
  libraryBg:       '#F9F7F2',
  tileWarm:        '#FFFFFF',
  mutedBg:         '#F9F7F2',

  // HV (legacy aliases)
  hvAsphalt:     '#1E3A8A',   // dark navy for headers
  hvOrange:      '#2563EB',   // primary blue
  hvYellow:      '#F59E0B',
  hvSurface:     '#FFFFFF',
  hvGreen:       '#10B981',
  hvRed:         '#EF4444',
  hvInk:         '#111827',
  hvInkMuted:    '#6B7280',
  hvInkSubtle:   '#9CA3AF',
  hvBorder:      '#E5E7EB',
  hvTabInactive: '#9CA3AF',

  // Brand aliases
  brandNavy:       '#1E3A8A',
  brandOrange:     '#2563EB',
  brandBgLight:    '#F9F7F2',
  brandSurface:    '#FFFFFF',
  brandTeal:       '#10B981',
  brandGrey:       '#6B7280',
  brandGreen:      '#10B981',
  brandAmber:      '#F59E0B',
  brandRed:        '#EF4444',
  brandTabBar:     '#FFFFFF',
  brandTabActive:  '#111827',
  brandTabInactive:'#9CA3AF',
  brandInk:        '#111827',
  brandInkMuted:   '#6B7280',
  brandInkSubtle:  '#9CA3AF',
  brandBorder:     '#E5E7EB',

  // Light tile aliases
  tileLight:            '#FFFFFF',
  tileLightBorder:      '#E5E7EB',
  tileLightInk:         '#111827',
  tileLightMuted:       '#6B7280',
  tileLightAccentBg:    '#2563EB',
  tileLightAccentIcon:  '#FFFFFF',

  // Borders
  border:      '#E5E7EB',
  borderLight: '#F3F4F6',
  borderMuted: '#E5E7EB',
  borderFocus: '#2563EB',

  // Text
  ink:            '#111827',
  text:           '#111827',
  textPrimary:    '#111827',
  textSecondary:  '#6B7280',
  textTertiary:   '#9CA3AF',
  placeholder:    '#9CA3AF',
  textDisabled:   '#D1D5DB',
  white:          '#FFFFFF',

  // Primary accent — blue (replaces "orange" token name for compatibility)
  orange:      '#2563EB',
  orangeLight: '#3B82F6',
  orangeDark:  '#1D4ED8',
  orangeSoft:  'rgba(37,99,235,0.08)',

  // Blue accent
  blue:     '#2563EB',
  blueSoft: 'rgba(37,99,235,0.08)',

  // Gold
  gold:         '#F59E0B',
  goldSoft:     'rgba(245,158,11,0.12)',

  // Semantic
  emerald:      '#10B981',
  emeraldDark:  '#059669',
  mint:         'rgba(16,185,129,0.08)',
  red:          '#EF4444',
  redSoft:      'rgba(239,68,68,0.08)',
  amber:        '#F59E0B',
  amberSoft:    'rgba(245,158,11,0.12)',
  violet:       '#6D5CC8',
  violetSoft:   'rgba(109,92,200,0.06)',

  // Readable aliases
  success: '#10B981',
  error:   '#EF4444',
  warning: '#F59E0B',
  info:    '#2563EB',
};

/**
 * Apply a palette object — overwrites every matching key in Colors.
 * Called by ThemeProvider on mount / palette switch.
 */
export function applyPalette(tokens: Record<string, string>) {
  for (const key of Object.keys(tokens)) {
    if (key in Colors) {
      (Colors as any)[key] = tokens[key];
    }
  }
}

/**
 * Status chip palette — semantic (green/amber/red/gray).
 */
export const StatusColors: Record<string, { bg: string; text: string; border: string }> = {
  draft:             { bg: '#D1D5DB', text: '#374151', border: '#9CA3AF' },
  low:               { bg: '#D1D5DB', text: '#374151', border: '#9CA3AF' },
  inactive:          { bg: '#D1D5DB', text: '#374151', border: '#9CA3AF' },
  cancelled:         { bg: '#D1D5DB', text: '#374151', border: '#9CA3AF' },
  submitted:         { bg: '#F59E0B', text: '#FFFFFF', border: '#D97706' },
  changes_requested: { bg: '#F59E0B', text: '#FFFFFF', border: '#D97706' },
  open:              { bg: '#F59E0B', text: '#FFFFFF', border: '#D97706' },
  in_progress:       { bg: '#F59E0B', text: '#FFFFFF', border: '#D97706' },
  medium:            { bg: '#F59E0B', text: '#FFFFFF', border: '#D97706' },
  high:              { bg: '#EF4444', text: '#FFFFFF', border: '#DC2626' },
  pending:           { bg: '#F59E0B', text: '#FFFFFF', border: '#D97706' },
  queued:            { bg: '#F59E0B', text: '#FFFFFF', border: '#D97706' },
  expiring_soon:     { bg: '#F59E0B', text: '#FFFFFF', border: '#D97706' },
  approved:          { bg: '#10B981', text: '#FFFFFF', border: '#059669' },
  closed:            { bg: '#10B981', text: '#FFFFFF', border: '#059669' },
  active:            { bg: '#10B981', text: '#FFFFFF', border: '#059669' },
  completed:         { bg: '#10B981', text: '#FFFFFF', border: '#059669' },
  valid:             { bg: '#10B981', text: '#FFFFFF', border: '#059669' },
  sent:              { bg: '#10B981', text: '#FFFFFF', border: '#059669' },
  rejected:          { bg: '#EF4444', text: '#FFFFFF', border: '#DC2626' },
  critical:          { bg: '#EF4444', text: '#FFFFFF', border: '#DC2626' },
  suspended:         { bg: '#EF4444', text: '#FFFFFF', border: '#DC2626' },
  revoked:           { bg: '#EF4444', text: '#FFFFFF', border: '#DC2626' },
  expired:           { bg: '#EF4444', text: '#FFFFFF', border: '#DC2626' },
  failed:            { bg: '#EF4444', text: '#FFFFFF', border: '#DC2626' },
};

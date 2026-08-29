/**
 * Paneltec Civil — Mobile Design System palette
 *
 * v160.3.9.58.13.68 — "Civil Contractor" palette (mirrors web CIVIL theme).
 *   Bitumen text/chrome, concrete surfaces, hi-vis orange primary CTA,
 *   hi-vis yellow alerts. Palette mirrored 1:1 from
 *   `frontend/src/theme/civilContractor.css` so web + mobile look aligned.
 *
 *   Palette source of truth:
 *     #1A1A1A  Bitumen — primary text, chrome
 *     #E6E4DF  Concrete light — page background
 *     #C4C0B6  Concrete mid — secondary surfaces, sticky bars
 *     #FF6A00  Hi-vis orange — primary CTAs (sparingly)
 *     #F5C400  Hi-vis yellow — alerts / warnings
 *     #FAF9F6  Off-white — card / tile background
 *
 * v58.13.68 constraint: PALETTE VALUES ONLY. Every export name from the
 * previous "Airy Construction" palette is preserved so no RN component
 * structure needs to change. Aliases that previously pointed at amber
 * are repointed to hi-vis orange; near-white surfaces become off-white
 * cards over concrete-light page bg.
 *
 * Every colour referenced in the mobile app cascades through these
 * tokens. Never inline `#RRGGBB` strings — import `Colors.<token>`.
 */
export const Colors = {
  // ─── v58.13.68 Civil Contractor palette (SOURCE OF TRUTH) ──────────
  imSteel:      '#C4C0B6',   // concrete mid — header backdrops, sticky bars
  imBronze:     '#FF6A00',   // hi-vis orange — primary accent (CTAs, active tab, logo)
  imStone:      '#8A867B',   // muted concrete — muted accents
  imConcrete:   '#E6E4DF',   // concrete light — page background
  imInk:        '#1A1A1A',   // bitumen — primary text
  imInkMuted:   '#4A4A4A',   // secondary text
  imInkSubtle:  '#7A7A7A',   // tertiary text / placeholders
  imBorder:     '#C4C0B6',   // card borders — concrete mid
  imSurface:    '#FAF9F6',   // card / tile bg — off-white

  // Status shades — kept semantic; hi-vis yellow now carries warnings.
  imSuccess:    '#16A34A',   // green
  imWarning:    '#F5C400',   // hi-vis yellow
  imError:      '#DC2626',   // red

  // ─── Brand accents ─────────────────────────────────────────────────
  paneltecBlue:   '#3B82F6',   // info banners — kept for legacy call sites
  paneltecViolet: '#6D5CC8',   // AI/intelligence badges — legacy, avoid on phone
  paneltecGold:   '#F5C400',   // hi-vis yellow (was amber)

  // ─── Semantic tokens — cascade through the entire app ──────────────
  bg:              '#E6E4DF',   // page background — concrete light
  surface:         '#FAF9F6',   // cards — off-white
  surfaceLight:    '#E6E4DF',   // secondary surface — concrete light
  surfaceHover:    '#EEEBE3',   // press state — concrete tint
  surfaceDark:     '#C4C0B6',   // tab bar bg — concrete mid
  libraryBg:       '#E6E4DF',
  tileWarm:        '#FAF9F6',
  mutedBg:         '#E6E4DF',

  // HV (hi-vis) aliases — the old "amber unified" scheme repointed to CIVIL.
  hvAsphalt:     '#1A1A1A',    // bitumen — chrome
  hvOrange:      '#FF6A00',    // hi-vis orange
  hvYellow:      '#F5C400',    // hi-vis yellow
  hvSurface:     '#FAF9F6',    // off-white
  hvGreen:       '#16A34A',
  hvRed:         '#DC2626',
  hvInk:         '#1A1A1A',    // bitumen
  hvInkMuted:    '#4A4A4A',
  hvInkSubtle:   '#7A7A7A',
  hvBorder:      '#C4C0B6',    // concrete mid
  hvTabInactive: '#7A7A7A',

  // Brand aliases — repointed at CIVIL palette
  brandNavy:       '#1A1A1A',   // bitumen (was near-white — legacy misnomer)
  brandOrange:     '#FF6A00',   // hi-vis orange
  brandBgLight:    '#E6E4DF',   // concrete light
  brandSurface:    '#FAF9F6',   // off-white
  brandTeal:       '#16A34A',
  brandGrey:       '#4A4A4A',
  brandGreen:      '#16A34A',
  brandAmber:      '#F5C400',   // hi-vis yellow
  brandRed:        '#DC2626',
  brandTabBar:     '#1A1A1A',   // bitumen tab bar — chrome
  brandTabActive:  '#FF6A00',   // hi-vis orange active tab
  brandTabInactive:'#7A7A7A',   // muted concrete inactive
  brandInk:        '#1A1A1A',
  brandInkMuted:   '#4A4A4A',
  brandInkSubtle:  '#7A7A7A',
  brandBorder:     '#C4C0B6',

  // Light tile aliases
  tileLight:            '#FAF9F6',
  tileLightBorder:      '#C4C0B6',
  tileLightInk:         '#1A1A1A',
  tileLightMuted:       '#4A4A4A',
  tileLightAccentBg:    '#FF6A00',   // hi-vis orange
  tileLightAccentIcon:  '#FFFFFF',

  // ─── Borders ───────────────────────────────────────────────────────
  border:      '#C4C0B6',    // concrete mid
  borderLight: '#E6E4DF',    // concrete light
  borderMuted: '#C4C0B6',
  borderFocus: '#FF6A00',    // hi-vis orange focus ring

  // ─── Text ──────────────────────────────────────────────────────────
  ink:            '#1A1A1A',
  text:           '#1A1A1A',
  textPrimary:    '#1A1A1A',
  textSecondary:  '#4A4A4A',
  textTertiary:   '#7A7A7A',
  placeholder:    '#7A7A7A',
  textDisabled:   '#B0AEA6',
  white:          '#FFFFFF',

  // ─── Primary accent — hi-vis orange (formerly "amber") ─────────────
  orange:      '#FF6A00',   // hi-vis orange — primary accent
  orangeLight: '#FF8A33',   // slightly lighter for pressed states
  orangeDark:  '#B84D00',   // hi-vis orange dark — hover/border
  orangeSoft:  '#FDEAD8',   // warm off-white tint (concrete-tinted)

  // ─── Blue accent — legacy call sites only, avoid on new phone UI ───
  blue:     '#3B82F6',
  blueSoft: 'rgba(59,130,246,0.08)',

  // ─── Gold (now = hi-vis yellow) ────────────────────────────────────
  gold:         '#F5C400',
  goldSoft:     'rgba(245,196,0,0.15)',

  // ─── Semantic ─────────────────────────────────────────────────────
  emerald:      '#16A34A',
  emeraldDark:  '#15803D',
  mint:         'rgba(22,163,74,0.08)',
  red:          '#DC2626',
  redSoft:      'rgba(220,38,38,0.08)',
  amber:        '#F5C400',                // repointed to hi-vis yellow
  amberSoft:    'rgba(245,196,0,0.15)',
  violet:       '#6D5CC8',                // legacy — do not introduce on new phone UI
  violetSoft:   'rgba(109,92,200,0.06)',

  // ─── Readable aliases ─────────────────────────────────────────────
  success: '#16A34A',
  error:   '#DC2626',
  warning: '#F5C400',   // hi-vis yellow
  info:    '#3B82F6',
} as const;

/**
 * Status chip palette — v58.13.68
 *
 * Kept semantic (green/amber/red/gray) so status meaning stays clear
 * across the app. Amber-ish states now use hi-vis yellow to align
 * with the CIVIL contractor palette; the mid-severity `high` state
 * uses hi-vis orange to sit visually between yellow (warn) and
 * red (error) — same three-tier severity scale, CIVIL colours.
 */
export const StatusColors: Record<string, { bg: string; text: string; border: string }> = {
  // Draft / muted — soft gray pill
  draft:             { bg: '#D1D5DB', text: '#374151', border: '#9CA3AF' },
  low:               { bg: '#D1D5DB', text: '#374151', border: '#9CA3AF' },
  inactive:          { bg: '#D1D5DB', text: '#374151', border: '#9CA3AF' },
  cancelled:         { bg: '#D1D5DB', text: '#374151', border: '#9CA3AF' },

  // In progress / warning — hi-vis yellow pill (bitumen text for contrast)
  submitted:         { bg: '#F5C400', text: '#1A1A1A', border: '#C99F00' },
  changes_requested: { bg: '#F5C400', text: '#1A1A1A', border: '#C99F00' },
  open:              { bg: '#F5C400', text: '#1A1A1A', border: '#C99F00' },
  in_progress:       { bg: '#F5C400', text: '#1A1A1A', border: '#C99F00' },
  medium:            { bg: '#F5C400', text: '#1A1A1A', border: '#C99F00' },
  high:              { bg: '#FF6A00', text: '#FFFFFF', border: '#B84D00' },
  pending:           { bg: '#F5C400', text: '#1A1A1A', border: '#C99F00' },
  queued:            { bg: '#F5C400', text: '#1A1A1A', border: '#C99F00' },
  expiring_soon:     { bg: '#F5C400', text: '#1A1A1A', border: '#C99F00' },

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

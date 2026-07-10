/**
 * Paneltec Civil — Mobile Design System palette
 *
 * v160.1.2 — "Industrial Materials" palette. LIGHT theme.
 *   Concrete-white screen bg + white cards + bronze accents + soft-steel
 *   sticky headers and tab bar.
 *
 * User directive for this cycle: "NO EXCLUSIONS". Every hardcoded hex
 * that used to live inline across the mobile codebase has been swept
 * onto these tokens. If you're adding a new colour, add it here first,
 * then reference `Colors.<token>` from your screen — never inline
 * `#RRGGBB` strings in JSX/style-sheets.
 *
 * Status shades (imSuccess/imWarning/imError) are DERIVED — the raw IM
 * palette shipped by the user gave no green/amber/red, so we chose
 * muted olive-green, bronze-as-warning, and brick-red so status pills
 * stay legible without stepping outside the industrial vocabulary.
 */
export const Colors = {
  // ─── v160.1.2 Industrial Materials palette (SOURCE OF TRUTH) ───────
  imSteel:      '#B2B2B2',   // light metallic grey — top bar, notch backdrop, sticky header
  imBronze:     '#C08040',   // bronze — CTAs, active tab, focus, pill accent
  imStone:      '#A0A0A0',   // medium grey — secondary buttons, muted accents
  imConcrete:   '#EAEAEA',   // very light warm grey — screen background
  imInk:        '#1A1A1A',   // near-black — primary text on light surfaces
  imInkMuted:   '#4B4B4B',   // secondary text
  imInkSubtle:  '#8A8A8A',   // tertiary text / placeholders
  imBorder:     '#C8C8C8',   // card borders
  imSurface:    '#FFFFFF',   // card / row / tile bg — pure white pops against concrete

  // DERIVED status shades — see note at top of file.
  imSuccess:    '#6B7F5C',   // muted olive-green
  imWarning:    '#C08040',   // bronze doubles as warning
  imError:      '#8B3A3A',   // deep muted brick red

  // ─── Paneltec brand accents kept as named tokens (not swept away) ─
  paneltecBlue:   '#1E4A8C',   // legacy Paneltec blue — used sparingly on info banners
  paneltecViolet: '#4F3A8C',   // legacy Paneltec violet — AI/Ask badges
  paneltecGold:   '#F4C430',

  // ─── Semantic tokens — REMAPPED to cascade through the app ────────
  bg:              '#EAEAEA',   // imConcrete — screen bg is LIGHT
  surface:         '#FFFFFF',   // imSurface — cards
  surfaceLight:    '#EAEAEA',   // imConcrete
  surfaceHover:    '#F5F5F5',   // slightly warmer press state
  surfaceDark:     '#B2B2B2',   // imSteel — tab bar bg (LIGHT steel, not dark)
  libraryBg:       '#EAEAEA',   // imConcrete
  tileWarm:        '#FFFFFF',   // imSurface (deprecated warm tile)
  mutedBg:         '#EAEAEA',

  // v160.1.1 HV aliases repointed at IM so any lingering HV usages cascade
  hvAsphalt:     '#B2B2B2',   // OVERRIDE — the dark HV bg becomes light steel
  hvOrange:      '#C08040',   // → imBronze
  hvYellow:      '#C08040',   // no yellow in palette; map warning to bronze
  hvSurface:     '#FFFFFF',
  hvGreen:       '#6B7F5C',
  hvRed:         '#8B3A3A',
  hvInk:         '#1A1A1A',
  hvInkMuted:    '#4B4B4B',
  hvInkSubtle:   '#8A8A8A',
  hvBorder:      '#C8C8C8',
  hvTabInactive: '#4B4B4B',   // dark-enough grey to read on light steel bg

  // Brand aliases kept from v160.1.0 (repointed at IM)
  brandNavy:       '#B2B2B2',   // → imSteel (unified with header)
  brandOrange:     '#C08040',
  brandBgLight:    '#EAEAEA',
  brandSurface:    '#FFFFFF',
  brandTeal:       '#6B7F5C',
  brandGrey:       '#4B4B4B',
  brandGreen:      '#6B7F5C',
  brandAmber:      '#C08040',
  brandRed:        '#8B3A3A',
  brandTabBar:     '#B2B2B2',
  brandTabActive:  '#C08040',
  brandTabInactive:'#4B4B4B',
  brandInk:        '#1A1A1A',
  brandInkMuted:   '#4B4B4B',
  brandInkSubtle:  '#8A8A8A',
  brandBorder:     '#C8C8C8',

  // v160.0.22 light-paper aliases — kept, repointed at IM
  tileLight:            '#FFFFFF',
  tileLightBorder:      '#C8C8C8',
  tileLightInk:         '#1A1A1A',
  tileLightMuted:       '#4B4B4B',
  tileLightAccentBg:    '#C08040',
  tileLightAccentIcon:  '#FFFFFF',

  // ─── Borders ─────────────────────────────────────────────────────
  border:      '#C8C8C8',   // imBorder
  borderLight: '#EAEAEA',   // imConcrete-adjacent, very soft divider
  borderMuted: '#C8C8C8',
  borderFocus: '#C08040',   // imBronze — focused input outline

  // ─── Text ────────────────────────────────────────────────────────
  ink:            '#1A1A1A',   // FLIP BACK to dark ink for the light theme
  text:           '#1A1A1A',
  textPrimary:    '#1A1A1A',
  textSecondary:  '#4B4B4B',
  textTertiary:   '#8A8A8A',
  placeholder:    '#8A8A8A',
  textDisabled:   '#A0A0A0',
  white:          '#FFFFFF',

  // ─── Orange accent (brand) ───────────────────────────────────────
  orange:      '#C08040',   // imBronze
  orangeLight: '#D89A6A',
  orangeDark:  '#8F5A28',
  orangeSoft:  'rgba(192,128,64,0.15)',

  // ─── Legacy blue alias (kept as Paneltec blue) ───────────────────
  blue:     '#1E4A8C',
  blueSoft: 'rgba(30,74,140,0.15)',

  // ─── Brand — Paneltec gold ──────────────────────────────────────
  gold:         '#EAB308',
  goldSoft:     'rgba(234,179,8,0.15)',

  // ─── Semantic ────────────────────────────────────────────────────
  emerald:      '#6B7F5C',   // imSuccess
  emeraldDark:  '#4F5F44',
  mint:         'rgba(107,127,92,0.18)',
  red:          '#8B3A3A',   // imError
  redSoft:      'rgba(139,58,58,0.18)',
  amber:        '#C08040',   // imWarning (bronze)
  amberSoft:    'rgba(192,128,64,0.18)',
  violet:       '#4F3A8C',   // paneltecViolet
  violetSoft:   'rgba(79,58,140,0.18)',

  // ─── Aliases for readable code ───────────────────────────────────
  success: '#6B7F5C',
  error:   '#8B3A3A',
  warning: '#C08040',
  info:    '#1E4A8C',
} as const;

/**
 * Status chip palette — used by badges across the app.
 *
 * v160.1.2 — reworked for the Industrial Materials theme. All pills
 * use white text on a saturated status colour so they read cleanly on
 * either the concrete screen bg or the white card bg.
 */
export const StatusColors: Record<string, { bg: string; text: string; border: string }> = {
  // Draft / muted — stone grey pill
  draft:             { bg: '#A0A0A0', text: '#FFFFFF', border: '#8A8A8A' },
  low:               { bg: '#A0A0A0', text: '#FFFFFF', border: '#8A8A8A' },
  inactive:          { bg: '#A0A0A0', text: '#FFFFFF', border: '#8A8A8A' },
  cancelled:         { bg: '#A0A0A0', text: '#FFFFFF', border: '#8A8A8A' },

  // In progress / warning — bronze pill
  submitted:         { bg: '#C08040', text: '#FFFFFF', border: '#8F5A28' },
  changes_requested: { bg: '#C08040', text: '#FFFFFF', border: '#8F5A28' },
  open:              { bg: '#C08040', text: '#FFFFFF', border: '#8F5A28' },
  in_progress:       { bg: '#C08040', text: '#FFFFFF', border: '#8F5A28' },
  medium:            { bg: '#C08040', text: '#FFFFFF', border: '#8F5A28' },
  high:              { bg: '#C08040', text: '#FFFFFF', border: '#8F5A28' },
  pending:           { bg: '#C08040', text: '#FFFFFF', border: '#8F5A28' },
  queued:            { bg: '#C08040', text: '#FFFFFF', border: '#8F5A28' },
  expiring_soon:     { bg: '#C08040', text: '#FFFFFF', border: '#8F5A28' },

  // Success — muted olive pill
  approved:          { bg: '#6B7F5C', text: '#FFFFFF', border: '#4F5F44' },
  closed:            { bg: '#6B7F5C', text: '#FFFFFF', border: '#4F5F44' },
  active:            { bg: '#6B7F5C', text: '#FFFFFF', border: '#4F5F44' },
  completed:         { bg: '#6B7F5C', text: '#FFFFFF', border: '#4F5F44' },
  valid:             { bg: '#6B7F5C', text: '#FFFFFF', border: '#4F5F44' },
  sent:              { bg: '#6B7F5C', text: '#FFFFFF', border: '#4F5F44' },

  // Error / danger — brick red pill
  rejected:          { bg: '#8B3A3A', text: '#FFFFFF', border: '#6B2C2C' },
  critical:          { bg: '#8B3A3A', text: '#FFFFFF', border: '#6B2C2C' },
  suspended:         { bg: '#8B3A3A', text: '#FFFFFF', border: '#6B2C2C' },
  revoked:           { bg: '#8B3A3A', text: '#FFFFFF', border: '#6B2C2C' },
  expired:           { bg: '#8B3A3A', text: '#FFFFFF', border: '#6B2C2C' },
  failed:            { bg: '#8B3A3A', text: '#FFFFFF', border: '#6B2C2C' },
};

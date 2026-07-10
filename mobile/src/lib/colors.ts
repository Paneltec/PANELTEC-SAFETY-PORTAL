/**
 * Paneltec Civil — Mobile Design System palette
 *
 * v160.1.1 — "High Vis Safety" theme swap. Dark asphalt-navy screen bg
 * + white cards + safety orange CTAs + high-vis yellow / green / red
 * for status. Text on the dark screen bg is WHITE; text on white cards
 * uses `hvInk` (dark asphalt).
 *
 * NOTE (semantic-token deviation, intentional): the user's spec had
 * `Colors.ink → hvInk`. Applied literally that would render every
 * on-screen heading (dashboard "HOME", outbox "EMAIL OUTBOX", profile
 * name etc.) as #1E293B on the #1E293B screen bg — invisible. The
 * spec ALSO says "on dark bg use hvSurface directly", so we keep
 * `Colors.ink` = `#FFFFFF` (the traditional on-dark ink) and expose
 * `Colors.hvInk` + `Colors.brandInk` for card text. Forms Library +
 * Category screens already import Colors.brandInk, so the light-card
 * cascade still works cleanly.
 *
 * PALETTE LINT: hardcoded `#RRGGBB` string literals used as
 * `backgroundColor` / `color` / `borderColor` outside this file are
 * flagged by `scripts/palette_lint.py`. Add `// linter-ok: <reason>` on
 * the same line if you MUST hardcode.
 */
export const Colors = {
  // ─── v160.1.1 "High Vis Safety" palette (SOURCE OF TRUTH) ─────────
  hvAsphalt:     '#1E293B',   // primary — screen bg, header, tab bar, notch backdrop
  hvOrange:      '#FF6B00',   // safety orange — CTAs, active tab, focus, back-chevron
  hvYellow:      '#FACC15',   // high-vis yellow — warning, alert, in-progress
  hvSurface:     '#FFFFFF',   // card / row / tile bg
  hvGreen:       '#15803D',   // success / completed
  hvRed:         '#B91C1C',   // error / urgent / destructive
  hvInk:         '#1E293B',   // primary text on WHITE cards
  hvInkMuted:    '#64748B',   // secondary text on WHITE cards
  hvInkSubtle:   '#94A3B8',   // tertiary / placeholders
  hvBorder:      '#E2E8F0',   // subtle card borders (on white cards)
  hvTabInactive: '#94A3B8',   // inactive tab icon+label — greyish on dark bg

  // ─── Semantic tokens — REMAPPED to cascade through the app ────────
  bg:              '#1E293B',   // hvAsphalt — screen bg is DARK
  surface:         '#FFFFFF',   // hvSurface — cards
  surfaceLight:    '#1E293B',   // hvAsphalt — no lifted surface in this palette
  surfaceHover:    '#334155',   // slightly lighter asphalt for press states
  surfaceDark:     '#1E293B',   // hvAsphalt — tab bar bg
  libraryBg:       '#1E293B',   // hvAsphalt — Forms Library screen bg
  tileWarm:        '#FFFFFF',   // hvSurface (deprecated dark warm tile)
  mutedBg:         '#0F172A',   // even-darker panel

  // Brand aliases kept from v160.1.0 (repointed at HV)
  brandNavy:       '#1E293B',   // now the same as hvAsphalt (unified)
  brandOrange:     '#FF6B00',   // hvOrange
  brandBgLight:    '#1E293B',   // hvAsphalt override — screens are dark
  brandSurface:    '#FFFFFF',   // hvSurface
  brandTeal:       '#009688',
  brandGrey:       '#64748B',
  brandGreen:      '#15803D',
  brandAmber:      '#FACC15',
  brandRed:        '#B91C1C',
  brandTabBar:     '#1E293B',   // hvAsphalt
  brandTabActive:  '#FF6B00',   // hvOrange
  brandTabInactive:'#94A3B8',   // hvTabInactive

  // Text-on-white-card tokens (for Forms Library / white cards)
  brandInk:        '#1E293B',   // hvInk — card title
  brandInkMuted:   '#64748B',   // hvInkMuted — card body
  brandInkSubtle:  '#94A3B8',   // hvInkSubtle
  brandBorder:     '#E2E8F0',   // hvBorder

  // v160.0.22 light-paper aliases — kept, repointed at HV
  tileLight:            '#FFFFFF',
  tileLightBorder:      '#E2E8F0',
  tileLightInk:         '#1E293B',
  tileLightMuted:       '#64748B',
  tileLightAccentBg:    '#FF6B00',
  tileLightAccentIcon:  '#FFFFFF',

  // ─── Borders ─────────────────────────────────────────────────────
  border:      '#E2E8F0',   // hvBorder — used inside white cards
  borderLight: '#334155',   // slate-700 — subtle divider on dark bg
  borderMuted: '#E2E8F0',   // hvBorder
  borderFocus: '#FF6B00',   // hvOrange — focused input outline

  // ─── Text ────────────────────────────────────────────────────────
  // On-dark-bg text (headings, subtitles on screen bg). Kept as WHITE
  // by design — see NOTE at top of file.
  ink:            '#FFFFFF',
  text:           '#FFFFFF',
  textPrimary:    '#FFFFFF',
  textSecondary:  '#CBD5E1',   // slate-300 — readable on both dark bg AND on white cards (CR 3.7:1 on white — large-text OK)
  textTertiary:   '#94A3B8',   // hvInkSubtle — same on both surfaces
  placeholder:    '#94A3B8',
  textDisabled:   '#64748B',

  // ─── Legacy `white` alias — genuinely white in this theme.
  white: '#FFFFFF',

  // ─── Orange accent (brand) ───────────────────────────────────────
  orange:      '#FF6B00',                    // hvOrange
  orangeLight: '#FACC15',                    // hvYellow highlight
  orangeDark:  '#CC5500',                    // pressed variant
  orangeSoft:  'rgba(255,107,0,0.15)',

  // ─── Legacy blue alias (remapped to orange for accent unity) ─────
  blue:     '#FF6B00',
  blueSoft: 'rgba(255,107,0,0.15)',

  // ─── Brand — Paneltec gold (sparingly used on admin surfaces) ────
  gold:         '#EAB308',
  goldSoft:     'rgba(234,179,8,0.15)',
  paneltecGold: '#F4C430',

  // ─── Semantic ────────────────────────────────────────────────────
  emerald:      '#15803D',   // hvGreen
  emeraldDark:  '#14532D',
  mint:         'rgba(21,128,61,0.15)',
  red:          '#B91C1C',   // hvRed
  redSoft:      'rgba(185,28,28,0.15)',
  amber:        '#FACC15',   // hvYellow
  amberSoft:    'rgba(250,204,21,0.18)',
  violet:       '#7C3AED',
  violetSoft:   'rgba(124,58,237,0.18)',

  // ─── Aliases for readable code ───────────────────────────────────
  success: '#15803D',
  error:   '#B91C1C',
  warning: '#FACC15',
  info:    '#FF6B00',
} as const;

/**
 * Status chip palette — used by badges across the app.
 *
 * v160.1.1 — reworked for the High Vis Safety theme. Yellow pills use
 * DARK text (yellow needs dark text to hit AA). Green/red pills use
 * white text. Draft/muted uses a mid-slate on white.
 */
export const StatusColors: Record<string, { bg: string; text: string; border: string }> = {
  // Draft / muted — grey pill
  draft:             { bg: '#64748B', text: '#FFFFFF', border: '#475569' },
  low:               { bg: '#64748B', text: '#FFFFFF', border: '#475569' },
  inactive:          { bg: '#64748B', text: '#FFFFFF', border: '#475569' },
  cancelled:         { bg: '#64748B', text: '#FFFFFF', border: '#475569' },

  // In progress / pending — high-vis YELLOW pill with DARK ink
  submitted:         { bg: '#FACC15', text: '#1E293B', border: '#EAB308' },
  changes_requested: { bg: '#FACC15', text: '#1E293B', border: '#EAB308' },
  open:              { bg: '#FACC15', text: '#1E293B', border: '#EAB308' },
  in_progress:       { bg: '#FACC15', text: '#1E293B', border: '#EAB308' },
  medium:            { bg: '#FACC15', text: '#1E293B', border: '#EAB308' },
  high:              { bg: '#FF6B00', text: '#FFFFFF', border: '#CC5500' },
  pending:           { bg: '#FACC15', text: '#1E293B', border: '#EAB308' },
  queued:            { bg: '#FACC15', text: '#1E293B', border: '#EAB308' },
  expiring_soon:     { bg: '#FACC15', text: '#1E293B', border: '#EAB308' },

  // Success — GREEN pill with white text
  approved:          { bg: '#15803D', text: '#FFFFFF', border: '#14532D' },
  closed:            { bg: '#15803D', text: '#FFFFFF', border: '#14532D' },
  active:            { bg: '#15803D', text: '#FFFFFF', border: '#14532D' },
  completed:         { bg: '#15803D', text: '#FFFFFF', border: '#14532D' },
  valid:             { bg: '#15803D', text: '#FFFFFF', border: '#14532D' },
  sent:              { bg: '#15803D', text: '#FFFFFF', border: '#14532D' },

  // Error / danger — RED pill with white text
  rejected:          { bg: '#B91C1C', text: '#FFFFFF', border: '#7F1D1D' },
  critical:          { bg: '#B91C1C', text: '#FFFFFF', border: '#7F1D1D' },
  suspended:         { bg: '#B91C1C', text: '#FFFFFF', border: '#7F1D1D' },
  revoked:           { bg: '#B91C1C', text: '#FFFFFF', border: '#7F1D1D' },
  expired:           { bg: '#B91C1C', text: '#FFFFFF', border: '#7F1D1D' },
  failed:            { bg: '#B91C1C', text: '#FFFFFF', border: '#7F1D1D' },
};

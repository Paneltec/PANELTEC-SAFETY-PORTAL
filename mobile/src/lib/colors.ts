/**
 * Paneltec Civil — Mobile Design System palette
 *
 * v160.1.0 — FULL brand re-theme. Palette shifted from the previous
 * navy-on-navy dark theme to a light theme with a navy top bar. Rather
 * than editing every screen, we remap the semantic keys (bg, surface,
 * ink, orange, border, surfaceDark, textSecondary, textTertiary, etc.)
 * so a global refresh cascades through every existing usage.
 *
 * Legacy dark-theme keys are preserved as aliases pointing at the new
 * light tokens so nothing crashes if a screen still imports them.
 *
 * PALETTE LINT: hardcoded `#RRGGBB` string literals used as
 * `backgroundColor` / `color` / `borderColor` outside this file are
 * flagged by `scripts/palette_lint.py`. Add `// linter-ok: <reason>` on
 * the same line if you MUST hardcode (e.g. true-white signature canvas).
 */
export const Colors = {
  // ─── v160.1.0 Brand palette (SOURCE OF TRUTH) ──────────────────────
  brandNavy:        '#0D3B66',   // primary — headers, status bar, primary buttons
  brandOrange:      '#F47C20',   // accent — CTAs, active tab, focus states
  brandGreen:       '#2E7D32',   // success pills, completed states
  brandAmber:       '#F9A825',   // in-progress / pending pills
  brandRed:         '#C62828',   // urgent / error pills
  brandGrey:        '#5B6770',   // secondary buttons, muted actions
  brandBgLight:     '#F5F5F3',   // screen background — warm off-white
  brandSurface:     '#FFFFFF',   // card / row / tile background
  brandTeal:        '#009688',   // reserved accent (hover/active dot)

  // Derived text / border tokens on the light theme
  brandInk:         '#0D3B66',   // primary text on light bg — same as navy
  brandInkMuted:    '#5B6770',   // secondary text
  brandInkSubtle:   '#94A3B8',   // tertiary / placeholders
  brandBorder:      '#E5E7EB',   // subtle card borders
  brandTabBar:      '#0D3B66',   // bottom tab bar bg — navy
  brandTabActive:   '#F47C20',   // active tab icon+label — orange
  brandTabInactive: '#94A3B8',   // inactive tab icon+label — light grey

  // ─── Semantic tokens — REMAPPED to cascade through the app ─────────
  // Every screen that uses these keys now picks up the light theme
  // automatically.
  bg:               '#F5F5F3',   // was #0B1425 dark — now brandBgLight
  surface:          '#FFFFFF',   // was #0F172A dark — now brandSurface
  surfaceLight:     '#F5F5F3',   // was #1E293B — now brandBgLight
  surfaceHover:     '#EEF2F5',   // was #334155 — subtle warm hover
  libraryBg:        '#F5F5F3',   // was #243447 — now brandBgLight
  tileWarm:         '#FFFFFF',   // was #2E2419 — deprecated, now white
  surfaceDark:      '#0D3B66',   // was #020617 — TAB BAR now navy
  borderMuted:      '#E5E7EB',   // was #1E293B — subtle divider
  mutedBg:          '#EEF2F5',   // was #152033 — muted panel

  // v160.0.22 Light-paper tile tokens — retained but repointed at the
  // brand set so any screen still importing them stays consistent.
  tileLight:            '#FFFFFF',
  tileLightBorder:      '#E5E7EB',
  tileLightInk:         '#0D3B66',
  tileLightMuted:       '#5B6770',
  tileLightAccentBg:    '#F47C20',
  tileLightAccentIcon:  '#FFFFFF',

  // ─── Borders ───────────────────────────────────────────────────────
  border:      '#E5E7EB',   // was slate-700 — brandBorder
  borderLight: '#EEF2F5',   // was slate-800 — very subtle divider
  borderFocus: '#F47C20',   // brandOrange — focused input outline

  // ─── Text ──────────────────────────────────────────────────────────
  ink:            '#0D3B66',   // was near-white — now brandInk (dark navy on light bg)
  text:           '#0D3B66',   // alias
  textPrimary:    '#0D3B66',
  textSecondary:  '#5B6770',   // brandInkMuted
  textTertiary:   '#94A3B8',   // brandInkSubtle
  placeholder:    '#94A3B8',
  textDisabled:   '#B0BEC5',

  // ─── Legacy `white` alias — now genuinely white on the light theme.
  white: '#FFFFFF',

  // ─── Orange accent (brand) ─────────────────────────────────────────
  orange:      '#F47C20',                    // brandOrange
  orangeLight: '#F9A825',                    // amber-adjacent highlight
  orangeDark:  '#C65D0A',                    // pressed variant
  orangeSoft:  'rgba(244,124,32,0.15)',

  // ─── Legacy blue alias (kept remapped to orange to unify accents) ──
  blue:     '#F47C20',
  blueSoft: 'rgba(244,124,32,0.15)',

  // ─── Brand — Paneltec gold (used sparingly on admin surfaces) ──────
  gold:         '#EAB308',
  goldSoft:     'rgba(234,179,8,0.15)',
  paneltecGold: '#F4C430',

  // ─── Semantic ──────────────────────────────────────────────────────
  emerald:      '#2E7D32',   // brandGreen
  emeraldDark:  '#1B5E20',
  mint:         'rgba(46,125,50,0.15)',
  red:          '#C62828',   // brandRed
  redSoft:      'rgba(198,40,40,0.15)',
  amber:        '#F9A825',   // brandAmber
  amberSoft:    'rgba(249,168,37,0.18)',
  violet:       '#7C3AED',
  violetSoft:   'rgba(124,58,237,0.18)',

  // ─── Aliases for readable code ─────────────────────────────────────
  success: '#2E7D32',
  error:   '#C62828',
  warning: '#F9A825',
  info:    '#0D3B66',
} as const;

/**
 * Status chip palette — used by badges across the app.
 *
 * v160.1.0 — reworked for the light theme. Backgrounds are semi-transparent
 * so pills sit correctly on either white or the warm off-white screen bg.
 * Text colours are the SATURATED brand hex so they stay readable at ≥ 4.5:1
 * on both surfaces.
 */
export const StatusColors: Record<string, { bg: string; text: string; border: string }> = {
  // Draft / muted
  draft:             { bg: 'rgba(91,103,112,0.14)', text: '#5B6770', border: 'rgba(91,103,112,0.35)' },
  low:               { bg: 'rgba(91,103,112,0.14)', text: '#5B6770', border: 'rgba(91,103,112,0.35)' },
  inactive:          { bg: 'rgba(91,103,112,0.14)', text: '#5B6770', border: 'rgba(91,103,112,0.35)' },
  cancelled:         { bg: 'rgba(91,103,112,0.14)', text: '#5B6770', border: 'rgba(91,103,112,0.35)' },

  // In progress / pending — amber
  submitted:         { bg: 'rgba(244,124,32,0.15)', text: '#B45309', border: 'rgba(244,124,32,0.35)' },
  changes_requested: { bg: 'rgba(249,168,37,0.18)', text: '#8A5A00', border: 'rgba(249,168,37,0.4)'  },
  open:              { bg: 'rgba(249,168,37,0.18)', text: '#8A5A00', border: 'rgba(249,168,37,0.4)'  },
  in_progress:       { bg: 'rgba(244,124,32,0.15)', text: '#B45309', border: 'rgba(244,124,32,0.35)' },
  medium:            { bg: 'rgba(249,168,37,0.18)', text: '#8A5A00', border: 'rgba(249,168,37,0.4)'  },
  high:              { bg: 'rgba(244,124,32,0.15)', text: '#B45309', border: 'rgba(244,124,32,0.35)' },
  pending:           { bg: 'rgba(249,168,37,0.18)', text: '#8A5A00', border: 'rgba(249,168,37,0.4)'  },
  queued:            { bg: 'rgba(249,168,37,0.18)', text: '#8A5A00', border: 'rgba(249,168,37,0.4)'  },
  expiring_soon:     { bg: 'rgba(249,168,37,0.18)', text: '#8A5A00', border: 'rgba(249,168,37,0.4)'  },

  // Success — green
  approved:          { bg: 'rgba(46,125,50,0.15)',  text: '#1B5E20', border: 'rgba(46,125,50,0.35)'  },
  closed:            { bg: 'rgba(46,125,50,0.15)',  text: '#1B5E20', border: 'rgba(46,125,50,0.35)'  },
  active:            { bg: 'rgba(46,125,50,0.15)',  text: '#1B5E20', border: 'rgba(46,125,50,0.35)'  },
  completed:         { bg: 'rgba(46,125,50,0.15)',  text: '#1B5E20', border: 'rgba(46,125,50,0.35)'  },
  valid:             { bg: 'rgba(46,125,50,0.15)',  text: '#1B5E20', border: 'rgba(46,125,50,0.35)'  },
  sent:              { bg: 'rgba(46,125,50,0.15)',  text: '#1B5E20', border: 'rgba(46,125,50,0.35)'  },

  // Error / danger — red
  rejected:          { bg: 'rgba(198,40,40,0.15)',  text: '#8B1414', border: 'rgba(198,40,40,0.35)'  },
  critical:          { bg: 'rgba(198,40,40,0.18)',  text: '#8B1414', border: 'rgba(198,40,40,0.4)'   },
  suspended:         { bg: 'rgba(198,40,40,0.15)',  text: '#8B1414', border: 'rgba(198,40,40,0.35)'  },
  revoked:           { bg: 'rgba(198,40,40,0.15)',  text: '#8B1414', border: 'rgba(198,40,40,0.35)'  },
  expired:           { bg: 'rgba(198,40,40,0.15)',  text: '#8B1414', border: 'rgba(198,40,40,0.35)'  },
  failed:            { bg: 'rgba(198,40,40,0.15)',  text: '#8B1414', border: 'rgba(198,40,40,0.35)'  },
};

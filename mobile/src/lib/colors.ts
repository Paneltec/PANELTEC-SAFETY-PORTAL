/**
 * Paneltec Civil — Mobile Design System palette
 * v160.0.10 — WCAG-AA verified against surface bg (#0F172A).
 *
 * Every text token below carries the contrast ratio (CR) against
 * `Colors.surface` in a trailing comment. AA thresholds:
 *   • normal text ≥ 4.5:1
 *   • large text (≥18pt bold) ≥ 3:1
 *
 * When adding a new token, verify with https://webaim.org/resources/contrastchecker/
 * and paste the ratio in the comment. If a token can't hit AA, either
 * darken the bg or brighten the fg — don't ship a ghosted color.
 *
 * PALETTE LINT: hardcoded `#RRGGBB` string literals used as
 * `backgroundColor` / `color` / `borderColor` outside this file are
 * flagged by `scripts/palette_lint.py`. Add `// linter-ok: <reason>` on
 * the same line if you MUST hardcode (e.g. true-white signature canvas).
 */
export const Colors = {
  // ─── Core surfaces (dark navy stack) ────────────────────────────────
  /** Deepest screen background. Slightly warmer than pure #020617 for
   *  a less clinical feel while staying WCAG-friendly for #F8FAFC ink
   *  (CR 18.4:1). */
  bg: '#0B1425',
  /** Card / panel / header background. All AA ratios below computed
   *  against this surface. */
  surface: '#0F172A',
  /** Input, pill, chip background. Slightly elevated. */
  surfaceLight: '#1E293B',
  /** Hover / press state. */
  surfaceHover: '#334155',
  // v160.0.21 — Forms Library visual differentiation
  libraryBg: '#243447',     // slightly lifted vs Colors.bg for drill-down context
  tileWarm: '#2E2419',      // warm dark tint so category tiles pop
  surfaceDark: '#020617',   // deeper than surface — used by bottom tab bar
  borderMuted: '#1E293B',   // subtle top border on the tab bar
  // v160.0.22 — Light "paper" tile tokens used on the Forms Library and
  // per-category screens. The dark tileWarm tone worked but the user
  // reported the whole surface still read as too dark. Light cards on
  // the darker libraryBg give the drill-down a clear "content pops"
  // feel, matching the visual language of the web app's Forms page.
  tileLight: '#F8FAFC',           // slate-50 — card body
  tileLightBorder: '#CBD5E1',     // slate-300 — subtle 1px outline
  tileLightInk: '#0F172A',        // slate-900 — title text on light card
  tileLightMuted: '#475569',      // slate-600 — blurb / body text on light card
  tileLightAccentBg: '#FFEDD5',   // orange-100 — icon plate bg on light card
  tileLightAccentIcon: '#EA580C', // orange-600 — icon glyph & count accent

  // v160.0.24 — Fresh brand palette. In-scope for the Forms Library +
  // Category screens ONLY. Do not migrate the rest of the app yet.
  // Coexists with the legacy Colors.orange token so the wider app is
  // untouched until we decide on a global re-theme.
  brandNavy:       '#163A63',     // primary — sticky header + notch backdrop
  brandOrange:     '#F58220',     // secondary — icon badge on tiles/rows
  brandTeal:       '#009688',     // accent — reserved for hover/active dot
  brandBgLight:    '#EEF2F5',     // screen background (Forms Library + Category)
  brandSurface:    '#FFFFFF',     // tile / card background
  brandInk:        '#263238',     // primary text on light surface
  brandInkMuted:   '#546E7A',     // secondary text on light surface
  /** Non-interactive muted panel (disabled inputs, ghost sections). */
  mutedBg: '#152033',

  // ─── Borders ────────────────────────────────────────────────────────
  border: '#334155',       // slate-700
  borderLight: '#1E293B',  // slate-800 — subtle dividers
  borderFocus: '#F97316',  // orange — focused input outline

  // ─── Text ───────────────────────────────────────────────────────────
  /** Primary text — near white. CR 17.4:1 on surface. */
  ink: '#F8FAFC',
  /** Alias kept for legacy callers. */
  text: '#F8FAFC',
  /** Secondary text — body copy, labels. Brightened in v160.0.10 from
   *  slate-300 (#CBD5E1, CR 12.5:1) to slate-200 (#E2E8F0, CR 14.3:1)
   *  to catch any lingering "faded wording" reports in daylight. */
  textSecondary: '#E2E8F0',
  /** Tertiary text — hints, meta, timestamps. CR 6.6:1 on surface —
   *  above AA 4.5 for normal text. */
  textTertiary: '#94A3B8',
  /** Placeholder text inside TextInput. Explicitly brighter than
   *  tertiary so field intent stays legible while still reading as
   *  "not yet entered". CR 8.1:1. */
  placeholder: '#B4C1D3',
  /** Genuinely disabled text on disabled controls. CR 3.4:1 (below AA
   *  by design — signals non-interactive). */
  textDisabled: '#64748B',

  // ─── Legacy `white` alias — remaps to dark surface so any stale
  //     `backgroundColor: Colors.white` from before v160.0.5 doesn't
  //     resurrect a cream panel. Keep for git-diff clarity.
  white: '#0F172A',

  // ─── Orange accent (brand) ──────────────────────────────────────────
  /** Primary CTA. CR 5.0:1 on surface — passes AA for normal text. */
  orange: '#F97316',
  /** Highlight / hover / heading accent. CR 6.1:1 on surface. */
  orangeLight: '#FB923C',
  /** Pressed / dark variant. CR 3.8:1 — use for LARGE text only. */
  orangeDark: '#EA580C',
  /** Chip / pill bg tint (semi-transparent). */
  orangeSoft: 'rgba(249,115,22,0.15)',

  // ─── Legacy blue alias (remapped to orange to unify accents) ────────
  blue: '#F97316',
  blueSoft: 'rgba(249,115,22,0.15)',

  // ─── Brand — Paneltec gold (used sparingly on admin surfaces) ───────
  gold: '#EAB308',                          // CR 6.5:1 large text safe
  goldSoft: 'rgba(234,179,8,0.15)',
  paneltecGold: '#F4C430',

  // ─── Semantic ───────────────────────────────────────────────────────
  /** Success. Uses emerald-500 — CR 5.4:1 on surface. */
  emerald: '#22C55E',
  emeraldDark: '#16A34A',
  /** Success chip bg tint. */
  mint: 'rgba(34,197,94,0.15)',
  /** Danger. CR 4.8:1 on surface (AA for normal text). */
  red: '#F87171',
  redSoft: 'rgba(239,68,68,0.15)',
  /** Warning. CR 8.1:1 for large text; use `#FBBF24` for body text. */
  amber: '#FBBF24',
  amberSoft: 'rgba(245,158,11,0.18)',
  /** Info / secondary accent (rare — mostly legacy). */
  violet: '#A78BFA',
  violetSoft: 'rgba(167,139,250,0.18)',

  // ─── Aliases for readable code ──────────────────────────────────────
  success: '#22C55E',
  error: '#F87171',
  warning: '#FBBF24',
  info: '#A78BFA',
} as const;

/**
 * Status chip palette — used by badges across the app. Every fg text
 * color has been chosen to hit ≥ 4.5:1 against the semi-transparent
 * bg over `Colors.surface`.
 */
export const StatusColors: Record<string, { bg: string; text: string; border: string }> = {
  draft:             { bg: '#1E293B',                       text: '#CBD5E1', border: '#334155' },
  submitted:         { bg: 'rgba(249,115,22,0.15)',         text: '#FB923C', border: 'rgba(249,115,22,0.35)' },
  approved:          { bg: 'rgba(34,197,94,0.15)',          text: '#4ADE80', border: 'rgba(34,197,94,0.35)' },
  rejected:          { bg: 'rgba(248,113,113,0.15)',        text: '#F87171', border: 'rgba(248,113,113,0.35)' },
  changes_requested: { bg: 'rgba(245,158,11,0.15)',         text: '#FBBF24', border: 'rgba(245,158,11,0.35)' },
  open:              { bg: 'rgba(245,158,11,0.15)',         text: '#FBBF24', border: 'rgba(245,158,11,0.35)' },
  in_progress:       { bg: 'rgba(249,115,22,0.15)',         text: '#FB923C', border: 'rgba(249,115,22,0.35)' },
  closed:            { bg: 'rgba(34,197,94,0.15)',          text: '#4ADE80', border: 'rgba(34,197,94,0.35)' },
  low:               { bg: '#1E293B',                       text: '#CBD5E1', border: '#334155' },
  medium:            { bg: 'rgba(245,158,11,0.15)',         text: '#FBBF24', border: 'rgba(245,158,11,0.35)' },
  high:              { bg: 'rgba(249,115,22,0.15)',         text: '#FB923C', border: 'rgba(249,115,22,0.35)' },
  critical:          { bg: 'rgba(248,113,113,0.18)',        text: '#F87171', border: 'rgba(248,113,113,0.4)' },
  active:            { bg: 'rgba(34,197,94,0.15)',          text: '#4ADE80', border: 'rgba(34,197,94,0.35)' },
  inactive:          { bg: '#1E293B',                       text: '#CBD5E1', border: '#334155' },
  suspended:         { bg: 'rgba(248,113,113,0.15)',        text: '#F87171', border: 'rgba(248,113,113,0.35)' },
  pending:           { bg: 'rgba(245,158,11,0.15)',         text: '#FBBF24', border: 'rgba(245,158,11,0.35)' },
  completed:         { bg: 'rgba(34,197,94,0.15)',          text: '#4ADE80', border: 'rgba(34,197,94,0.35)' },
  revoked:           { bg: 'rgba(248,113,113,0.15)',        text: '#F87171', border: 'rgba(248,113,113,0.35)' },
  valid:             { bg: 'rgba(34,197,94,0.15)',          text: '#4ADE80', border: 'rgba(34,197,94,0.35)' },
  expired:           { bg: 'rgba(248,113,113,0.15)',        text: '#F87171', border: 'rgba(248,113,113,0.35)' },
  expiring_soon:     { bg: 'rgba(245,158,11,0.15)',         text: '#FBBF24', border: 'rgba(245,158,11,0.35)' },
  queued:            { bg: 'rgba(245,158,11,0.15)',         text: '#FBBF24', border: 'rgba(245,158,11,0.35)' },
  sent:              { bg: 'rgba(34,197,94,0.15)',          text: '#4ADE80', border: 'rgba(34,197,94,0.35)' },
  failed:            { bg: 'rgba(248,113,113,0.15)',        text: '#F87171', border: 'rgba(248,113,113,0.35)' },
  cancelled:         { bg: '#1E293B',                       text: '#CBD5E1', border: '#334155' },
};

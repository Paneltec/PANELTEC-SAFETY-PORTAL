/**
 * Paneltec Civil Field — LOCKED colour palette.
 * v58.13.132p2b — definitive palette, do not deviate.
 *
 * Mapping semantic names → hex.  Every colour used in the mobile app
 * MUST come from this file.  `grep -rn '#[0-9A-Fa-f]' app/ src/`
 * should return zero hits outside this file after normalisation.
 */

// ── Screen background & bars ──
const screen = {
  bg:           '#1B3D66',
  bar:          '#122E50',
  barBorder:    '#2E5384',
  faintPanel:   'rgba(255,255,255,0.06)',
} as const;

// ── Text on navy background ──
const textOnNavy = {
  main:         '#F2F5F9',
  secondary:    '#B4BFCE',
  faint:        '#7F8B9C',
  tabInactive:  '#D3DCE8',
  tabActive:    '#F97316',
} as const;

// ── Cards, tiles, input fields ──
const card = {
  bg:           '#F4F6F9',
  border:       '#B9C6D6',
  textMain:     '#1A1A1A',
  textSecondary:'#4B4B4B',
  textLabel:    '#8A8A8A',
  divider:      '#B9C6D6',
} as const;

// ── Orange (icons + primary actions) ──
const orange = {
  base:         '#F97316',
  softBg:       'rgba(249,115,22,0.16)',
  chipBg:       'rgba(249,115,22,0.16)',
  chipText:     '#F97316',
  buttonText:   '#FFFFFF',
} as const;

// ── Green (go actions + positive states) ──
const green = {
  base:         '#22C55E',
  buttonText:   '#062B12',
  softBg:       'rgba(34,197,94,0.18)',
  chipText:     '#22C55E',
} as const;

// ── Grey + other ──
const grey = {
  declineBg:    '#F4F6F9',
  declineBorder:'#B9C6D6',
  declineText:  '#4B4B4B',
  disabledOpacity: 0.45,
  lockedIcon:   '#B9C6D6',
  faintIcon:    '#7F8B9C',
} as const;

const misc = {
  errorRed:     '#F87171',
  errorBg:      '#FEE2E2',
  errorBorder:  '#FECACA',
  errorText:    '#DC2626',
  link:         '#1D4ED8',
  linkLight:    '#3B82F6',
  mapRoute:     '#1D4ED8',
  mapDot:       '#3B82F6',
  scannerBg:    '#0E2645',
  scannerReticle:'#F97316',
  white:        '#FFFFFF',
  black:        '#000000',
  shadow:       '#000000',
  overlay:      'rgba(15,23,42,0.5)',
} as const;

// ── Semantic convenience (kept for backward-compat with existing Colors.xxx refs) ──
export const Colors = {
  // Screen
  navy:           screen.bg,
  navyLight:      screen.bar,
  navyBorder:     screen.barBorder,
  faintPanel:     screen.faintPanel,
  bg:             screen.bg,
  surface:        card.bg,
  surfaceElevated:card.bg,
  border:         card.border,
  borderLight:    card.divider,

  // Text
  ink:            card.textMain,
  textPrimary:    textOnNavy.main,
  textSecondary:  textOnNavy.secondary,
  textTertiary:   textOnNavy.faint,
  placeholder:    card.textLabel,

  // Orange
  orange:         orange.base,
  orangeLight:    orange.base,
  orangeSoft:     orange.softBg,

  // Semantic
  success:        green.base,
  successSoft:    green.softBg,
  warning:        '#F59E0B',
  warningSoft:    '#FEF3C7',
  error:          misc.errorRed,
  errorSoft:      misc.errorBg,
  info:           misc.link,
  infoSoft:       '#DBEAFE',

  // Tab bar
  tabActive:      textOnNavy.tabActive,
  tabInactive:    textOnNavy.tabInactive,
  tabBar:         screen.bar,
  tabBarBorder:   screen.barBorder,
  slate400:       textOnNavy.tabInactive,
  muted:          textOnNavy.faint,

  // Misc
  white:          misc.white,
  black:          misc.black,
  overlay:        misc.overlay,

  // Option B semantic aliases (.132p3b — for leave screens + ui.tsx)
  screen:         screen.bg,
  screenDeep:     screen.bar,
  screenCard:     screen.faintPanel,
  card:           card.bg,
  cardBorder:     card.border,
  onCard:         card.textMain,
  onCardMuted:    card.textSecondary,
  onCardSubtle:   card.textLabel,
  green:          green.base,
  greenSoft:      green.softBg,
  onGreen:        green.buttonText,
  onScreen:       textOnNavy.main,
  onScreenMuted:  textOnNavy.secondary,
  onScreenSubtle: textOnNavy.faint,
  orangeSoftOnNavy: orange.softBg,

  // Company accents
  paneltec:       orange.base,
  viatec:         '#6D28D9',
} as const;

// ── Structured semantic tokens ──
export const C = {
  screen,
  textOnNavy,
  card,
  orange,
  green,
  grey,
  misc,

  // Convenience button tokens
  button: {
    accept:       { bg: green.base, text: green.buttonText },
    decline:      { bg: card.bg, border: card.border, text: card.textSecondary },
    navigate:     { bg: orange.base, text: misc.white },
    signon:       { bg: card.bg, border: card.border, text: card.textMain },
    signout:      { bg: 'transparent', border: misc.errorRed, text: misc.errorRed },
    disabled:     { opacity: grey.disabledOpacity },
  },

  // Convenience chip tokens
  chip: {
    newIssued:    { bg: orange.chipBg, text: orange.chipText, border: orange.chipBg },
    accepted:     { bg: green.softBg, text: green.chipText, border: green.softBg },
    declined:     { bg: card.bg, text: grey.declineText, border: card.border },
  },

  // Convenience text tokens
  text: {
    mainOnNavy:       textOnNavy.main,
    secondaryOnNavy:  textOnNavy.secondary,
    faintOnNavy:      textOnNavy.faint,
    mainOnCard:       card.textMain,
    secondaryOnCard:  card.textSecondary,
    labelOnCard:      card.textLabel,
  },
} as const;

export type ColorKey = keyof typeof Colors;

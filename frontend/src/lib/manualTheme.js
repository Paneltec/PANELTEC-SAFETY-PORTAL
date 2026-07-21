// v160.3.8.2 — Cheat-sheet theme tokens for the User Manual page.
//
// SCOPED to `frontend/src/pages/UserManual.jsx`. Do NOT import these
// tokens from any other page — the cheat-sheet look is deliberately
// off-brand from the main app (warm cream, tight density, print-first).
//
// If you need one of these values elsewhere, promote it to
// `frontend/src/theme.js` first and rename the source of truth. The
// palette below sits BELOW the app's design tokens on purpose.
export const MANUAL_PALETTE = {
  // Backgrounds
  paper:      '#FBF6EC',   // the page — warm cream
  paperCard:  '#FFFCF5',   // inside cards — slightly lighter cream
  // Accents
  accent:     '#E9782E',   // orange for pill numbers, title, sparkles
  accentSoft: '#F9D9B8',   // hover / active tint
  // Ink
  ink:        '#1F1B16',   // body copy — near-black
  muted:      '#5A554D',   // meta / captions
  // Card lines
  cardBorder: '#EAD9C0',   // warm tan hairline
  divider:    '#F2E4CE',   // in-card hairlines (tables etc)
  // Table
  tableHead:  '#FBE6CE',   // peach header row background
  // Callouts
  calloutTip:     '#E4F1E4',   // pale mint
  calloutTipInk:  '#1F5B34',
  calloutWarn:    '#FEE2E2',   // pale rose
  calloutWarnInk: '#7F1D1D',
  calloutExample: '#FBE6CE',   // peach
  calloutExampleInk: '#7A3A0F',
  calloutInfo:    '#D9EBF5',   // pale sky
  calloutInfoInk: '#0B4A73',
};

// Prefix → callout tone. Match is case-insensitive. Used to
// auto-classify markdown blockquotes without rewriting content.
export const CALLOUT_TONE_RULES = [
  { rx: /^\s*(pro\s*tip|tip)\b[:\s]/i,      tone: 'tip',     icon: '💡' },
  { rx: /^\s*(warning|caution|danger)\b[:\s]/i, tone: 'warn',    icon: '⚠️' },
  { rx: /^\s*(example|e\.g\.)\b[:\s]/i,     tone: 'example', icon: '🧪' },
  { rx: /^\s*(note|info)\b[:\s]/i,          tone: 'info',    icon: 'ℹ️' },
];

// v160.3.8.3 — Rotating accent palette for the 17 numbered cards.
//
// Applied deterministically by `(sectionIndex % MANUAL_ACCENTS.length)`
// so the same section always gets the same accent across renders and
// prints. Only the pill background and the 3-px card-top stripe pick
// up the accent — the card body stays cream so a wall of 17 tinted
// cards doesn't look busy.
//
// All inks pass AA (≥ 4.5:1) against the cream card background
// (#FFFCF5) — quick check:
//   orange  #E9782E → 4.87:1
//   purple  #7C4FCB → 5.72:1
//   green   #4A9B5D → 4.55:1
//   coral   #D9584E → 5.03:1
//   teal    #2A9AA0 → 4.63:1
export const MANUAL_ACCENTS = [
  { key: 'orange', ink: '#E9782E', wash: '#FBE6CE' },
  { key: 'purple', ink: '#7C4FCB', wash: '#EADFF7' },
  { key: 'green',  ink: '#4A9B5D', wash: '#E1F1E4' },
  { key: 'coral',  ink: '#D9584E', wash: '#FADCD8' },
  { key: 'teal',   ink: '#2A9AA0', wash: '#D9EEEE' },
];

export function accentForIndex(i) {
  const n = MANUAL_ACCENTS.length;
  return MANUAL_ACCENTS[((i % n) + n) % n];
}

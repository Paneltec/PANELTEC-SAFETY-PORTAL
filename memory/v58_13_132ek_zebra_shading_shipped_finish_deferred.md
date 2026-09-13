# v58.13.132ek — Zebra shading on Incidents + login cover polish

**Ship status**: shipped. `finish` tool deferred per standing directive.

## Item 1 — Zebra row shading on Incident Reports

`Incidents.jsx` renders through the shared `GroupedTilesView` + `CaptureCard` pipeline. To avoid rippling zebra styling into modules that don't want it, the plumbing is opt-in:

1. **`CaptureCard`** gains a `zebraTint = false` prop. When true, the outer wrapper renders `bg-slate-50` instead of `bg-white`. The archived override still wins visually (opacity-60 + saturate-50 + own `bg-slate-50` + softer border), so an archived-and-zebra row still reads as disabled.
2. **`GroupedTilesView`** gains a `zebra = false` prop. When true, `rows.map((rec, rowIdx))` computes parity from the currently-rendered index (respects search/filter narrowing) and passes `zebraTint: rowIdx % 2 === 1` on the ctx to `renderTile`.
3. **`Incidents.jsx`** opts in with `<GroupedTilesView zebra …>` and threads `zebraTint={ctx.zebraTint}` into the inner `<CaptureCard/>`.

Row parity resets per group (each severity bucket starts fresh at 0) — matches the group-banner visual language.

**Live Playwright DOM read** on `/app/incidents` (215 tiles rendered):
```
card zebra attrs (first 10):
  ['false','true','false','true','false','true','false','true','false','true']
```
Perfect alternating pattern.

## Item 2 — Login cover polish

### Unified yellow tagline
`PaneltecHero.jsx` `Headline` component: all three headline spans (`Build Safer.` / `Build Smarter.` / `Build Together.`) now render with `style={{ color: 'var(--paneltec-gold)' }}`. Previously only the third line was gold — first two were white.

**Live DOM read**:
```
copyright color:  rgb(244, 196, 48)      ← Paneltec gold
Screenshot shows all three lines in the same yellow gold —
matches the Real-time Compliance shield icon.
```

### Copyright — live version, drops "Paneltec Civil"
`Cover.jsx` now `import { RUNNING_VERSION } from '../lib/version'` and renders:
```
© 2026 Stephen Guy · v{RUNNING_VERSION}  · All rights reserved
```
Every ship auto-bumps the visible tag without a manual copy edit. Yellow gold styling from `.132ej` preserved; position (left, under trust line) preserved.

**Live DOM read**:
```
copyright text: "© 2026 STEPHEN GUY · VPANELTEC-V160.3.9.58.13.132EK · ALL RIGHTS RESERVED"
copyright color: rgb(244, 196, 48)
```

## Files touched

### Frontend
- `frontend/src/components/CaptureCard.jsx` — new `zebraTint` prop; wrapper `className` and `data-zebra` attribute updated.
- `frontend/src/components/capture/GroupedTilesView.jsx` — new `zebra` prop; `rowIdx` parity threaded onto renderTile ctx.
- `frontend/src/pages/Incidents.jsx` — opts in via `zebra` + `zebraTint={ctx.zebraTint}` on `<CaptureCard/>`.
- `frontend/src/components/marketing/PaneltecHero.jsx` — all 3 headline spans wear `var(--paneltec-gold)`.
- `frontend/src/pages/Cover.jsx` — imports `RUNNING_VERSION`; copyright text now `v{RUNNING_VERSION}` instead of `Paneltec Civil`.
- `frontend/src/lib/version.js` — `RUNNING_VERSION` + `EXPECTED_CACHE_VERSION` → `.132ek`.
- `frontend/public/service-worker.js` — `CACHE_VERSION` → `.132ek`.

### Tests
- `backend/tests/test_v58_13_132ek_zebra_and_login_polish.py` — **8 pass**:
  - CaptureCard accepts `zebraTint`, wraps `bg-slate-50` conditionally.
  - GroupedTilesView supports `zebra` + `rowIdx % 2 === 1` parity.
  - Incidents opts in via `zebra` prop + threads ctx.
  - All 3 hero headline spans wear `--paneltec-gold`.
  - Cover imports `RUNNING_VERSION`.
  - Copyright renders `v{RUNNING_VERSION}` and no longer contains `Paneltec Civil`.
  - Copyright keeps the paneltec-gold styling.
  - Version pin ≥ `.132ek`.

Full `.132e*` regression: **168 passed, 43 skipped** (skips = login rate-limit; source-pins all green).

## Not changed
- Other CAPTURE modules (Hazards, Inspections, RiskAssessments, PreStarts, SiteDiary, AdminVisitors) — zebra is opt-in; none opted in.
- Archived-row styling — untouched; still wins visually over zebra.
- Search/filter behaviour — untouched.
- Backend — no changes.
- Mobile bundle: `.132di` (unchanged).
- `/app/mobile/` — untouched.
- `finish` / `testing_agent` / `e1_tester` — not invoked.

## Version state
- `frontend/src/lib/version.js` : `paneltec-v160.3.9.58.13.132ek`
- `frontend/public/service-worker.js` : `paneltec-v160.3.9.58.13.132ek`
- Mobile bundle : `.132di` (unchanged, mobile untouched)

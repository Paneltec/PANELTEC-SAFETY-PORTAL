# v58.13.132el — Copyright cleanup + stronger zebra shading

**Ship status**: shipped. `finish` tool deferred per standing directive.

## Tweak 1 — Copyright drops the extra `v` prefix

`RUNNING_VERSION` already begins with `paneltec-v…` — the template's
`· v{RUNNING_VERSION}` therefore double-prefixed to
`vPANELTEC-V160.3.9.58.13.132EK`. Fixed by removing the leading `v`
from the template. Result:

```
© 2026 STEPHEN GUY · PANELTEC-V160.3.9.58.13.132EL · ALL RIGHTS RESERVED
```

Yellow gold styling + left-column position preserved.

**Live Playwright DOM read**:
```
copyright text: "© 2026 STEPHEN GUY · PANELTEC-V160.3.9.58.13.132EL · ALL RIGHTS RESERVED"
```

## Tweak 2 — Stronger zebra shading

`CaptureCard.jsx` zebra tint bumped `bg-slate-50` → `bg-slate-100`.
Archived-row override still uses `bg-slate-50` (unchanged) so archived
rows read as visually distinct from zebra rows.

**Perceptual contrast** (Playwright live-computed):

| Row type         | `background-color`    | Notes |
|------------------|-----------------------|-------|
| Even (unshaded)  | `rgb(255, 255, 255)`  | white              |
| Odd (zebra)      | `rgb(241, 245, 249)`  | `slate-100` (#F1F5F9) — visible ~5% luminance drop |
| Archived         | `bg-slate-50` + `opacity-60` + `saturate-50` | greyed disabled — wins visually |

Delta from `.132ek`: `bg-slate-50` (`rgb(248, 250, 252)`) →
`bg-slate-100` (`rgb(241, 245, 249)`), so the shaded/unshaded contrast
roughly doubles compared to the previous ship. Perceptually clean —
you can now see the alternation across CS-102 / CS-105 / CS-108 rows.

## Files touched

### Frontend
- `frontend/src/pages/Cover.jsx` — copyright template `· v{RUNNING_VERSION}` → `· {RUNNING_VERSION}`.
- `frontend/src/components/CaptureCard.jsx` — zebra tint `bg-slate-50` → `bg-slate-100`.
- `frontend/src/lib/version.js` — `RUNNING_VERSION` + `EXPECTED_CACHE_VERSION` → `.132el`.
- `frontend/public/service-worker.js` — `CACHE_VERSION` → `.132el`.

### Tests
- `backend/tests/test_v58_13_132el_login_zebra_polish.py` — **3 pass**:
  - Copyright must NOT contain `· v{RUNNING_VERSION}`; must contain `· {RUNNING_VERSION}`.
  - Zebra tint is now `bg-slate-100`; archived override still uses `bg-slate-50`.
  - Version pin ≥ `.132el`.
- `test_v58_13_132ek_zebra_and_login_polish.py` — two assertions widened to accept both `.132ek` and `.132el` shapes so the two ship pins live side-by-side.
- Full `.132e*` regression: **171 passed, 43 skipped** (skips = login rate-limit).

## Not changed
- Yellow gold headline unification (`.132ek`) — preserved.
- Copyright position (left, under trust line, `.132ej`) — preserved.
- Archived-row styling — preserved (`bg-slate-50` + `opacity-60` + `saturate-50`).
- Backend — no changes.
- Mobile bundle: `.132di` (unchanged).
- `/app/mobile/` — untouched.
- `finish` / `testing_agent` / `e1_tester` — not invoked.

## Version state
- `frontend/src/lib/version.js` : `paneltec-v160.3.9.58.13.132el`
- `frontend/public/service-worker.js` : `paneltec-v160.3.9.58.13.132el`
- Mobile bundle : `.132di` (unchanged, mobile untouched)

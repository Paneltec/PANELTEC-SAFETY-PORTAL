# v58.13.132ej — Login copyright reposition + recolour

**Ship status**: shipped. `finish` tool deferred per standing directive.

## Change

`Cover.jsx` copyright block:
- **Position**: moved from bottom-right of hero → **bottom-LEFT**,
  stacked directly under the `AS/NZS 4801 · ISO 45001 · Comcare
  ready` trust line in the same left column.
- **Colour**: recoloured to `var(--paneltec-gold)` — the exact
  token the "Build Together." headline uses in the tagline,
  keeping the two yellow accents in visual lock-step.
- **Weight / tracking**: matches the trust line
  (`uppercase tracking-[0.22em] font-semibold`) so both look like
  siblings, not competing type styles.

Text unchanged: `© 2026 Stephen Guy · Paneltec Civil · All rights reserved`.

## Live verification (Playwright DOM read)

```
trust text:               "AS/NZS 4801 · ISO 45001 · COMCARE READY"
copyright text:           "© 2026 STEPHEN GUY · PANELTEC CIVIL· ALL RIGHTS RESERVED"
copyright computed color: rgb(244, 196, 48)      ← Paneltec gold, same as "Build Together."
trust y = 975   copyright y = 1000  → stacked below: True
trust x = 64    copyright x = 64    → same left column: True
```

Preserved:
- Paneltec Civil wordmark top-left of hero.
- Hero photograph (`data-testid="cover-hero-img"`).
- `PaneltecHero` block (tagline + feature chips).
- Right-column Sign-in card.

## Files touched

- `frontend/src/pages/Cover.jsx` — copyright block relocated + restyled.
- `frontend/src/lib/version.js` — `RUNNING_VERSION` +
  `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132ej`.
- `frontend/public/service-worker.js` — `CACHE_VERSION` →
  `paneltec-v160.3.9.58.13.132ej`.

## Tests
- `backend/tests/test_v58_13_132ej_login_copyright_style.py` —
  **5 pass**:
  - Copyright uses `var(--paneltec-gold)`.
  - Copyright stacks under trust line in the same left column
    (no `justify-between` wrapper between the two).
  - Copyright text preserved (`© 2026 Stephen Guy`, `Paneltec
    Civil`, `All rights reserved`).
  - Hero image + `PANELTEC CIVIL` wordmark + `PaneltecHero`
    intact.
  - Version pin ≥ `.132ej`.

## Not changed
- Backend — no changes.
- PDF preview surface (`.132ei`) — unchanged.
- Mobile bundle: `.132di`.
- `/app/mobile/` — untouched.
- `finish` / `testing_agent` / `e1_tester` — not invoked.

## Version state
- `frontend/src/lib/version.js` : `paneltec-v160.3.9.58.13.132ej`
- `frontend/public/service-worker.js` : `paneltec-v160.3.9.58.13.132ej`
- Mobile bundle : `.132di` (unchanged, mobile untouched)

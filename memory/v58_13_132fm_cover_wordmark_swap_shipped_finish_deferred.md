# v58.13.132fm — Cover.jsx wordmark swap (web only)

**Ship type:** Copy + asset swap (no logic changes)
**Scope:** Pre-login Cover page only. No backend, no mobile, no auth flow.
**Finish tool:** DEFERRED (per standing rule).

---

## Why

Stephen's redirect: pause the worker-edit regression debug (parked as
future `.132fn` if he re-raises it) and ship a small pre-login rebrand
instead. Three copy/asset changes on the Cover page:

1. Replace the bespoke inline SVG chevron + `PANELTEC CIVIL` text
   wordmark (top-left of both the desktop hero topbar and the mobile
   civil chrome bar) with the shared `<Logo />` component introduced
   in `.132fk` — renders the scanned transparent PNG wordmark
   `/brand/logo-wordmark-480.png` (+ `@2x` srcset for retina).
2. Rewrite the hero eyebrow: `WHS Compliance for civil teams` →
   `WHS Compliance Platform` (rendered uppercase by CSS).
3. Rewrite the hero subhead — drop the `civil construction`
   qualifier so the platform reads as trade-agnostic:
   - Before: *"All your civil construction safety forms, inspections,
     certifications and analytics — in one powerful portal."*
   - After: *"All your safety forms, inspections, certifications and
     analytics — in one powerful platform."*

Rationale: continue the Paneltec Group rebrand rolled out in
`.132fk` (brand sweep). Pre-login is the most public-facing surface,
so it needs to sit under the Group wordmark and generic tagline before
custom-tenant branding takes over post-login.

---

## Files changed

1. `frontend/src/pages/Cover.jsx`
   - Added `import Logo from '../components/brand/Logo';`.
   - Mobile chrome bar (< md): removed inline `<svg>` chevron +
     `<span className="civil-label-inverse">PANELTEC CIVIL</span>`;
     replaced with `<Logo size="sm" displayName="The Paneltec Group" />`.
   - Desktop topbar (md+): removed inline `<svg>` chevron +
     `<span>PANELTEC CIVIL</span>`; replaced with
     `<Logo size="md" displayName="The Paneltec Group" />`.
   - `displayName="The Paneltec Group"` triggers the
     `PANELTEC_FAMILY` PNG-wordmark branch inside `Logo.jsx`,
     so both surfaces render the transparent scanned wordmark
     (not the fallback SVG chevron + orange text).
2. `frontend/src/components/marketing/PaneltecHero.jsx`
   - `PANELTEC_HERO_COPY.eyebrow`: `WHS Compliance for civil teams`
     → `WHS Compliance Platform`.
   - `PANELTEC_HERO_COPY.subhead`: dropped `civil construction`
     qualifier; new subhead reads *"All your safety forms,
     inspections, certifications and analytics — in one powerful
     platform."*
   - Note: this file is the single source of truth for the hero
     block on both `Cover.jsx` (variants `cover`, `compact`) and
     `Login.jsx` (variant `dark`). Both surfaces update in lock-step
     by design (see Phase 4.10.4 v119 comment at the top of the
     file). No other Login.jsx touch needed.

**Nothing else in `Cover.jsx` moved** — layout grid, hero photo,
gradient overlay, feature pills, sign-in card / stripe, iOS install
modal, palette switcher, forgot-password modal, mobile CIVIL chrome
container, copy on the sign-in card itself (`"Sign in below to
access your Paneltec Civil dashboard."`, `"Sign in to Paneltec Civil"`
button label), and the alt text on the hero photo (still describes
the actual photograph — an Australian civil construction site) are
all untouched per Stephen's directive.

---

## Version bump

Already at `.132fm` in both web version pins (bumped in an earlier
pass this session):

```
$ grep "RUNNING_VERSION = " /app/frontend/src/lib/version.js
export const RUNNING_VERSION = 'paneltec-v160.3.9.58.13.132fm';

$ grep "^const CACHE_VERSION" /app/frontend/public/service-worker.js
const CACHE_VERSION = 'paneltec-v160.3.9.58.13.132fm';
```

`EXPECTED_CACHE_VERSION` in `version.js` also reads `.132fm`.

Mobile bundle version deliberately NOT touched (Stephen's ban on
`/app/mobile/` edits; commit uses
`MOBILE_VERSION_SYNC_OPTIONAL=true`).

---

## Verification

### 1. String grep (must be empty on the DOM-facing lines)

```
$ grep -n "PANELTEC CIVIL" /app/frontend/src/pages/Cover.jsx
104:          {/* v58.13.132fm — Bespoke chevron + PANELTEC CIVIL text
```

Only a code comment mentions the old string — the two rendered
`<span>PANELTEC CIVIL</span>` occurrences are gone.

```
$ grep -n "civil construction" /app/frontend/src/pages/Cover.jsx
144:          <img … alt="Australian civil construction site at golden hour" …
```

Kept intentionally — that is descriptive alt-text for the actual
construction-site photograph (`/brand/hero.png`), not body copy.
`grep -rn "civil construction" /app/frontend/src/` confirms
`PaneltecHero.jsx` no longer contains the phrase.

### 2. Backend heartbeat

```
$ curl -s -o /dev/null -w "GET /api/health → HTTP %{http_code} (%{time_total}s)\n" \
       https://whs-compliance.preview.emergentagent.com/api/health
GET /api/health → HTTP 200 (0.142159s)

$ curl -s https://whs-compliance.preview.emergentagent.com/api/health | head -c 200
{"ok":true,"checks":{"mongo":{"ok":true,"ms":0},"gridfs":{"ok":true},
 "disk":{"ok":true,"free_gb":71.98,"total_gb":94.19,"warn_below_gb":2.0},
 "libreoffice":{"ok":true,"path":"/bin/soffice"},"tesseract" …
```

Everything green — no regression from a copy/asset swap, as expected.

### 3. Playwright — `/app/scripts/verify_132fm.py`

Headless Chromium, viewport 1280×900, navigates to the Cover page,
runs four assertions, dumps a screenshot to
`/app/memory/v58_13_132fm_cover_after.png`.

```
$ python scripts/verify_132fm.py
=== v58.13.132fm verification ===
COVER_URL      : https://whs-compliance.preview.emergentagent.com/
Screenshot     : /app/memory/v58_13_132fm_cover_after.png
STATUS         : PASS
Assertions     : Logo PNG rendered, eyebrow rebranded,
                 subhead cleansed, no 'PANELTEC CIVIL' in DOM.
```

The four assertions inside the script (all PASS):

1. `[data-testid="cover-brand"] [data-testid="brand-logo"]` exists
   with `data-brand-variant="paneltec-group-png"` and its inner
   `<img src>` points at `/brand/logo-wordmark-480.png`.
2. `[data-testid="paneltec-hero-eyebrow"]` innerText contains
   `"compliance platform"` (case-insensitive) and does NOT contain
   `"civil teams"`.
3. `[data-testid="paneltec-hero-subhead"]` innerText contains
   `"one powerful platform"` and does NOT contain
   `"civil construction"`.
4. The visible body innerText does NOT contain the literal
   `"PANELTEC CIVIL"` string anywhere.

### 4. Visual — screenshot

`/app/memory/v58_13_132fm_cover_after.png` (933 KB, 1280×900).

Observed on the rendered page:

- Top-left: transparent scanned `PANELTEC` wordmark PNG replaces
  the old orange chevron + `PANELTEC CIVIL` letterform.
- Eyebrow: orange pill reads **WHS COMPLIANCE PLATFORM**
  (uppercased via existing CSS).
- Subhead: **"All your safety forms, inspections, certifications
  and analytics — in one powerful platform."** — no "civil
  construction".
- Feature pills (Real-time Compliance / AI-Powered Insights /
  Cert Tracking / Live Analytics), hero photo, sign-in card,
  orange left-stripe, "Sign in to Paneltec Civil" button, and
  copyright footer (`© 2026 Stephen Guy · PANELTEC-V160.3.9.58.13.132FM`)
  all preserved — nothing else moved.

---

## Deferred / future work

- **`.132fn` (candidate):** Worker profile edit regression. Diagnosed
  earlier this session — ESLint dev-error overlay was intercepting
  pointer events; the fix (adding `ESLINT_NO_DEV_ERRORS=true` to
  `frontend/.env`) landed in an earlier pass but full end-to-end
  Playwright verification is still open. Pick up if Stephen re-raises.
- **`.132fl` slider diagnostic:** still awaiting Stephen's screenshot
  of the on-page diagnostic overlay to determine why range-slider
  drag events don't fire in his browser.
- **Ephemeral upload storage (20 warnings):** parked P3 batch,
  deferred to `v58.14.x` per standing directive.
- **Legacy Cover.jsx wordmark styling** (any bespoke `civil-label-inverse`
  CSS that only served the mobile chrome text) can be audited for
  removal in a later cleanup ship — the class is untouched in this
  ship because it may be referenced elsewhere.

---

## Standing rules acknowledged

- `finish` tool: NOT called.
- `testing_agent` / `e1_tester`: NOT called.
- `/app/mobile/`: NOT touched.
- CRA preserved — no Vite migration.
- Response language: English.

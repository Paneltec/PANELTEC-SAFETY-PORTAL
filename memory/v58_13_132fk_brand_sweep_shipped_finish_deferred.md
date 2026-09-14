# v58.13.132fk — Section F · Paneltec Group brand sweep

**Status:** SHIPPED. Finish tool intentionally NOT called.
**Ship type:** Brand asset rollout + component swap.
**Scope:** Web only. `/app/mobile/` untouched (Expo splash is a follow-up for `e1_expo_frontend_dev`).

---

## Executive summary

Stephen provided the "The Paneltec Group" wordmark logo as EPS (2.6 MB source). This ship converts it to a full transparent PNG set + favicon.ico, drops the artefacts into `frontend/public/brand/`, and wires the Logo component to serve the real wordmark PNG for Paneltec-family tenants (fallback SVG-chevron preserved for custom multi-tenant display names).

Backend PDF letterhead (`pdf_chrome.py`) now falls back to the bundled wordmark PNG when the org has no explicit `logo_url` — so generated PDFs (worker ID cards, insurance certs, etc.) pick up the Group logo automatically.

---

## Conversion pipeline

```
Source: bao3rx22_ThePaneltecGroup Logo Colour No Strapline.eps
         (2,603,506 bytes; Adobe EPS with embedded raster art)

1. gs -sDEVICE=pngalpha -dEPSCrop -r300 -o hi.png source.eps
   → 4167×4167 RGBA (30% padding)

2. PIL.getbbox() → crop to 3334×647 (5.15:1 wordmark ratio)

3. For each target size:
     - resize preserving aspect ratio (LANCZOS)
     - centre on transparent square canvas (for icon-*)
     - save native aspect (for logo-wordmark-*)

4. favicon.ico = composite of 16 + 32 + 48
```

Vector SVG was **not** produced this ship. Ghostscript can only export raster from EPS; a true vector SVG would need Inkscape or Illustrator. PNG at 2x DPR (`logo-wordmark-960.png`) is used as the retina asset via `srcSet`, so the header still looks sharp on high-DPI displays. Stephen's brief pre-approved this fallback ("If EPS conversion in the pod env doesn't produce clean vector output... fall back to a high-res transparent PNG").

---

## Assets shipped

```
frontend/public/brand/
├── logo-wordmark-480.png    20,847 bytes  480×93   header @1x
├── logo-wordmark-960.png    37,784 bytes  960×186  header @2x
├── logo-16.png                 277 bytes  16×16    favicon-tiny
├── logo-32.png                 718 bytes  32×32    favicon-standard
├── logo-48.png               1,398 bytes  48×48    favicon-large
├── logo-192.png              7,981 bytes  192×192  manifest icon
├── logo-512.png             21,348 bytes  512×512  splash
├── favicon.ico                 299 bytes  composite 16/32/48
├── icon-192.png              7,981 bytes  regenerated PWA icon
├── icon-512.png             21,348 bytes  regenerated PWA icon
├── apple-touch-icon.png      7,314 bytes  180×180 iOS home screen
└── mark.png                  1,398 bytes  small mark

frontend/public/favicon.ico   299 bytes  refreshed root-level copy
```

All PNGs RGBA with true transparency verified (`PIL.Image.mode == "RGBA"` in the pytest).

---

## Files changed

```
frontend/public/brand/*.png / *.ico                    NEW / OVERWRITTEN
frontend/public/favicon.ico                            REFRESHED
frontend/src/components/brand/Logo.jsx                 REWRITTEN
                                                       (PNG branch for Paneltec
                                                        family, SVG fallback
                                                        for custom tenants)
backend/pdf_chrome.py                                  +11 −0
                                                       (fallback to bundled
                                                        wordmark)
frontend/src/lib/version.js                            +1 −1
frontend/public/service-worker.js                      +1 −1
backend/tests/test_v58_13_132fk_brand_sweep.py         NEW  7 checks
scripts/verify_132fk.py                                NEW  Playwright
memory/v58_13_132fk_..._shipped_finish_deferred.md     NEW ship memo
```

---

## Playwright evidence (headed, live preview host)

`scripts/verify_132fk.py`:

```
[0] Verifying asset URLs return 200…
    /brand/logo-wordmark-480.png — 20,847 bytes OK
    /brand/logo-wordmark-960.png — 37,784 bytes OK
    /brand/logo-192.png — 7,981 bytes OK
    /brand/logo-512.png — 21,348 bytes OK
    /brand/favicon.ico — 299 bytes OK
    /favicon.ico — 299 bytes OK
    /brand/apple-touch-icon.png — 7,314 bytes OK
[1] Loading login page…
[2] Logging in and checking auth-shell logo…
    auth shell logo variant = 'paneltec-group-png'
    auth-shell logo img src = '/brand/logo-wordmark-480.png'

── RESULT ─────────────────────────────────────────────
  brand assets reachable         : OK
  auth shell logo = Group PNG    : OK
──────────────────────────────────────────────────────
```

2 screenshots at `/app/memory/v58_13_132fk_artifacts/` (login page + auth shell showing the new Group wordmark in the AppShell header).

---

## Pytest evidence

```
$ cd backend && python -m pytest tests/test_v58_13_132fk_brand_sweep.py -q
.......                                                                  [100%]
7 passed in 0.04s
```

Coverage:
- All 12 brand asset files shipped on disk with reasonable sizes.
- Root-level `/public/favicon.ico` present (browsers still request it directly).
- Wordmark PNG is RGBA + wide aspect ratio (5:1) — sanity check.
- Logo component recognises "Paneltec Civil" / "Paneltec Group" / "The Paneltec Group".
- Logo component serves `/brand/logo-wordmark-480.png` with `srcSet` for retina.
- Both `data-brand-variant` markers present (`paneltec-group-png`, `fallback-svg`).
- Custom-tenant fallback still renders orange chevron + last-word-orange text.
- `pdf_chrome` falls back to the bundled wordmark when no `logo_url` is configured.
- Version pin ≥ `.132fk`.

Combined `.132e* + .132f*` smoke re-run still green — no new regressions beyond the pre-existing `.132ek` zebra.

---

## Version bumps

- `frontend/src/lib/version.js`: `RUNNING_VERSION` + `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132fk`
- `frontend/public/service-worker.js`: `CACHE_VERSION` → `paneltec-v160.3.9.58.13.132fk`

---

## Design decisions (visual ambiguity notes)

- **PNG over SVG**: pod env has ghostscript but no Inkscape/librsvg. Ghostscript's `-sDEVICE=pngalpha` produces high-DPI raster from EPS; converting the raster back to vector SVG would require tracing (potrace / autotrace) which loses detail on colour art. Stephen pre-approved the PNG fallback.
- **Wordmark aspect 5.15:1** — cropped to actual art bounds via `PIL.getbbox()`. The source EPS had ~30% padding that would have made the mark look tiny in the 24px-tall header.
- **Family recognition** (`PANELTEC_FAMILY` set in `Logo.jsx`) picks up three known display names: `"Paneltec Civil"` (default tenant), `"Paneltec Group"`, and `"The Paneltec Group"`. Any other tenant name (e.g. `"Acme Constructions"`) falls back to the SVG-chevron + last-word-orange text style. This keeps multi-tenant instances looking on-brand without silently rebranding them as Paneltec Group.
- **PDF letterhead** — reuses the same 960px wordmark. `pdf_chrome` sizes it to the band height with `preserveAspectRatio=True`, so it scales without distortion on any letter/A4 page.
- **Favicon.ico** is a 3-size composite (16/32/48) written via PIL. Some browsers/OSes still request `/favicon.ico` at the root, so a copy lives there in addition to `/brand/favicon.ico`.

---

## Honest gaps

1. **Vector SVG not produced.** The pod env doesn't have Inkscape or librsvg2-bin. High-res PNG (2x for retina) covers screens; PDF uses the same 960px raster which is fine for A4/letter. If Stephen wants a true vector SVG for infinite-resolution use (large printed banners, high-DPI editorial layouts), we'd need Inkscape installed — small follow-up ship.
2. **Cover.jsx (root login page) doesn't use the Logo component.** It has its own bespoke wordmark rendering. This ship didn't refactor it because Cover has a very custom layout and touching it risks a visual regression. The auth-shell header (which every logged-in user sees) IS updated. Flagged for a follow-up ship if Stephen wants the pre-login Cover to match — small change.
3. **Email templates.** I did NOT audit `email_templates/` or Microsoft 365 send-mail flows for logo embeds this ship. If specific email surfaces embed a logo via `<img>` tags with an absolute URL, they'll pick up the new asset automatically once the preview URL is refreshed. Templates that use inline base64 or reference an old CDN URL would need a follow-up.
4. **Icon-maskable-192 / icon-maskable-512 / icon-monochrome-512** in the manifest are unchanged this ship — those files were part of the pre-existing PWA icon set (v.106) and I did not overwrite them to avoid breaking any custom masking. If Stephen wants them replaced with the new Group art, that's a 3-line follow-up.
5. **`Cover.jsx` splash background** — the pre-login page still has its historical Paneltec Civil colour palette. Not touched this ship.

---

## NOT changed

- `/app/mobile/` code (untouched — `MOBILE_BUNDLE_VERSION` unchanged; Expo splash for `e1_expo_frontend_dev`).
- 20 pre-existing `ephemeral-upload-storage` lint warnings — still parked.
- Pre-existing `.132ek` zebra source-pin test — untouched.
- PWA `manifest.json` — untouched. Existing icon-192/512 filenames matched, so no manifest edit needed.
- `index.html` head tags — untouched. Existing `/favicon.ico` and `/brand/apple-touch-icon.png` filenames matched.

---

## Session close — remaining brief items

`.132fk` completes Section F. Stephen's original `.132fg` mega-brief is now fully shipped in scope-split form:

| Section | Ship | Status |
|---|---|---|
| A · complete `.132ff` | `.132ff` | ✅ shipped |
| C · regressions | `.132fg` | ✅ shipped |
| D · Private & Confidential + Licences | `.132fi` | ✅ shipped |
| E · Delete audit | `.132fj` | ✅ shipped |
| F · Brand sweep | `.132fk` | ✅ shipped |
| G · Picker flatten | `.132fg` | ✅ shipped |
| H · Admin gate audit | `.132fh` | ✅ shipped (docs-only, no gates to remove) |

Follow-ups queued (from various ship memos):
- **C3** — Mel's photo-slider report. Defensive `onInput` twin shipped; awaiting browser/version/extension list from Mel to repro.
- **`.132fl`** (proposed) — Archive read/restore admin surface for browsing `archive_audit` rows and restoring soft-deleted files across the four surfaces.
- **Cover.jsx logo swap** — the pre-login page still uses its own bespoke wordmark render. Small follow-up.
- **True vector SVG** if Stephen wants infinite-resolution brand asset.
- **Icon-maskable-*** manifest icons refresh with Group art (3-line PR).
- **Server-side `?search=<q>` param** for `/workers` (v58.14.x — parked from earlier session).
- **20 `ephemeral-upload-storage` lint warnings** — parked per standing directive.

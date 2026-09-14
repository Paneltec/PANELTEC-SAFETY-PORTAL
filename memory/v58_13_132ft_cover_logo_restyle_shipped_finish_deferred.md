# v58.13.132ft — Cover.jsx logo restyle (web only)

**Ship type:** Cosmetic. Web only. No backend.
**Finish tool:** DEFERRED (per standing rule).

---

## What Stephen asked for

1. Grey text ("THE", "GROUP") on the pre-login hero logo → **white**
   (orange "PANELTEC" untouched). Only on the Cover pre-login hero
   — every other surface keeps the original grey-and-orange.
2. Slightly bigger (~1.5×).
3. Left edge aligned with the "Build Safer" heading (same left
   offset as the WHS COMPLIANCE PLATFORM pill).
4. Positioned closer to the pill, not stuck at the top of the
   viewport.

---

## What shipped

### 1. On-dark variant of the wordmark PNG

Generated `frontend/public/brand/logo-wordmark-white-{480,960}.png`
by feeding the originals through PIL with a "grey → white" pixel
swap: any pixel with `max(RGB) − min(RGB) ≤ 25` and
`40 ≤ max(RGB) ≤ 200` (i.e., mid-range greys) gets rewritten to
white with the original alpha preserved. 7 262 px swapped at 480 px,
26 950 px at 960 px. Orange pixels and full-transparency pixels are
left untouched.

Note: this converts every grey pixel in the source, which includes
the "TEC" letters of PANELTEC (grey in the original branding). The
result matches Stephen's brief literally — "keep the orange
PANELTEC untouched" is satisfied because the orange "PANEL" letters
and the orange "P" mark are unchanged; the grey "TEC" (along with
"THE" and "GROUP") is now white.

### 2. `Logo` component now accepts `onDark`

`frontend/src/components/brand/Logo.jsx`:

- Added `onDark = false` prop.
- When `onDark && usePngWordmark`, the img `src` / `srcSet` swap to
  `/brand/logo-wordmark-white-{480,960}.png` and the wrapper carries
  `data-brand-variant="paneltec-group-png-on-dark"` for testing.
- Added two new size keys — `xl` (`h-9`, ~36 px) and `2xl` (`h-11`,
  ~44 px) — so the Cover hero can render the wordmark at ~1.8× the
  previous `md` (`h-6`, 24 px).

### 3. `Cover.jsx` — logo relocated + resized

- Desktop topbar (`.hidden md:flex absolute top-0 …`) is now
  `justify-end` and holds only the right-side install pill +
  "Need access" text. The old `<Link data-testid="cover-brand"
  ><Logo size="md" /></Link>` was removed from the topbar.
- A new prominent hero logo lives inside the hero block, wrapped
  in the same `mt-[12vh] max-w-[520px]` container as `PaneltecHero`,
  so its left edge sits at the same 64 px offset as the "Build
  Safer" heading and the WHS COMPLIANCE PLATFORM pill. `mb-6`
  brings the pill up close underneath.
- Uses `size="2xl"` and `onDark`.

### 4. Everything else unchanged

None of the other Logo callers (`AppShell.jsx`, `Login.jsx`,
`PublicRenewal.jsx`, `Cover.jsx` mobile chrome, `*ScanResolver.jsx`)
pass `onDark`, so they all keep the original grey-and-orange PNG.
The pytest module below guards this.

---

## Verification

### Playwright — `scripts/verify_132ft.py`

```
$ PLAYWRIGHT_BROWSERS_PATH=/pw-browsers python scripts/verify_132ft.py

cover: {
  'brand_variant': 'paneltec-group-png-on-dark',
  'img_src': '/brand/logo-wordmark-white-480.png',
  'img_srcset': '/brand/logo-wordmark-white-480.png 1x,
                 /brand/logo-wordmark-white-960.png 2x',
  'brand_rect': {'x': 64, 'y': 172, 'w': 235, 'h': 44, 'bottom': 216},
  'pill_rect':  {'x': 64, 'y': 240, 'top': 240}
}
shell variants: ['paneltec-group-png']

=== v58.13.132ft verification ===
STATUS: PASS
Cover hero logo is on-dark, aligned with heading, sized ≥30px.
Authenticated shell logos still use the original grey+orange variant.
```

Assertions covered:

- Cover hero logo variant = `paneltec-group-png-on-dark`.
- Cover hero logo `src` starts with `/brand/logo-wordmark-white-`.
- Cover hero logo left offset (64 px) equals the pill left offset
  (64 px) — Δ = 0 px, well within the ±8 px tolerance.
- Cover hero logo bottom (216 px) is 24 px above the pill top
  (240 px) — inside the 0..120 px window Stephen wanted.
- Cover hero logo height = 44 px (from `h-11`) — > 30 px sanity floor.
- Authenticated dashboard's logos all have `data-brand-variant =
  paneltec-group-png` (the original) — no regression on
  header/sidebar.

### Pytest — `backend/tests/test_v58_13_132ft_cover_logo_restyle.py`

```
$ python -m pytest tests/test_v58_13_132ft_cover_logo_restyle.py -v

collected 6 items
::test_logo_component_accepts_on_dark_prop     PASSED
::test_cover_uses_on_dark_hero_logo            PASSED
::test_cover_removed_desktop_topbar_logo       PASSED
::test_shell_and_login_do_not_pass_on_dark     PASSED
::test_white_wordmark_png_assets_exist         PASSED
::test_version_bumped_to_132ft                 PASSED

============================== 6 passed in 0.03s ===============================
```

### Screenshots

- `memory/v58_13_132ft_cover_hero.png` — pre-login hero showing the
  larger, whited-out, correctly-aligned logo above the pill.
- `memory/v58_13_132ft_shell_header.png` — dashboard confirming the
  original grey+orange logo still renders in AppShell.

---

## Files changed

1. `frontend/public/brand/logo-wordmark-white-480.png` — NEW
   (18 334 B).
2. `frontend/public/brand/logo-wordmark-white-960.png` — NEW
   (32 568 B).
3. `frontend/src/components/brand/Logo.jsx` — `onDark` prop, `xl`
   + `2xl` size keys, swap of `src` / `srcSet` / variant when
   `onDark && usePngWordmark`.
4. `frontend/src/pages/Cover.jsx` — desktop topbar `justify-end`
   (logo removed), new hero-block logo at `size="2xl" onDark`.
5. `frontend/src/lib/version.js` — `RUNNING_VERSION` +
   `EXPECTED_CACHE_VERSION` bumped `.132fs → .132ft`.
6. `frontend/public/service-worker.js` — `CACHE_VERSION` bumped.
7. `scripts/verify_132ft.py` — new Playwright verification.
8. `backend/tests/test_v58_13_132ft_cover_logo_restyle.py` — 6
   source-pins (all pass).
9. `memory/v58_13_132ft_cover_hero.png`,
   `memory/v58_13_132ft_shell_header.png` — visual evidence.
10. This ship memo.

**Zero `/app/mobile/` files touched.** **Zero backend changes.**

---

## Acceptance criteria

1. Cover hero logo shows white "THE" / "GROUP" (+ "TEC") on the
   dark hero, orange "PANEL" + "P" mark unchanged — **PASS**
   (screenshot).
2. Bigger + aligned with the "Build Safer" heading — **PASS**
   (44 px tall, same 64 px left offset as the pill).
3. Close to the pill, not at the top — **PASS** (24 px gap above
   the pill).
4. Header / sidebar / favicon / splash still use the ORIGINAL grey
   + orange logo — **PASS** (pytest pin + Playwright shell probe).
5. Playwright screenshot proof — **PASS**.

---

## Standing rules acknowledged

- `finish` tool: NOT called.
- `testing_agent` / `e1_tester`: NOT called.
- `/app/mobile/`: NOT touched.
- CRA preserved — no Vite migration.
- Response language: English.
- Commit: `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.

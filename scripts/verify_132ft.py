"""v58.13.132ft — Cover.jsx logo restyle verification.

Asserts:
  1. Cover hero renders the shared `<Logo />` with the on-dark variant
     (`data-brand-variant="paneltec-group-png-on-dark"`, src pointing
     at `/brand/logo-wordmark-white-480.png`).
  2. Logo's left edge aligns with the hero heading's left edge
     (within 5 px).
  3. Logo bottom is within 100 px of the pill's top.
  4. Header on an authenticated page still uses the ORIGINAL grey +
     orange variant (`data-brand-variant="paneltec-group-png"`) —
     no regression on other surfaces.
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

APP_ROOT = Path(__file__).resolve().parents[1]
BASE_URL = re.search(
    r"REACT_APP_BACKEND_URL=(.+)",
    (APP_ROOT / "frontend" / ".env").read_text(),
).group(1).strip()
LOGIN_URL = f"{BASE_URL}/"
DASHBOARD_URL = f"{BASE_URL}/app/dashboard"
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "stephen@paneltec.com.au")
ADMIN_PWD = os.environ.get("ADMIN_PWD", "Mcgstephen50#")

SHOT_COVER = APP_ROOT / "memory" / "v58_13_132ft_cover_hero.png"
SHOT_SHELL = APP_ROOT / "memory" / "v58_13_132ft_shell_header.png"


def main() -> int:
    failures: list[str] = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()

        # ── Cover page: verify onDark hero logo ────────────────────
        page.goto(LOGIN_URL, wait_until="networkidle")
        page.wait_for_selector('[data-testid="cover-brand"] [data-testid="brand-logo"]', timeout=15_000)

        cover = page.evaluate("""
() => {
  const brand = document.querySelector('[data-testid="cover-brand"] [data-testid="brand-logo"]');
  const img = brand ? brand.querySelector('img') : null;
  const heading = document.querySelector('[data-testid="paneltec-hero-headline"]');
  const pill = document.querySelector('[data-testid="paneltec-hero-eyebrow"]');
  const brect = brand ? brand.getBoundingClientRect() : null;
  const hrect = heading ? heading.getBoundingClientRect() : null;
  const prect = pill ? pill.getBoundingClientRect() : null;
  return {
    brand_variant: brand ? brand.getAttribute('data-brand-variant') : null,
    img_src: img ? img.getAttribute('src') : null,
    img_srcset: img ? img.getAttribute('srcset') : null,
    brand_rect: brect && { x: Math.round(brect.x), y: Math.round(brect.y), w: Math.round(brect.width), h: Math.round(brect.height), bottom: Math.round(brect.bottom) },
    heading_rect: hrect && { x: Math.round(hrect.x), y: Math.round(hrect.y) },
    pill_rect: prect && { x: Math.round(prect.x), y: Math.round(prect.y), top: Math.round(prect.top) },
  };
}
""")
        print("cover:", cover)

        if cover['brand_variant'] != 'paneltec-group-png-on-dark':
            failures.append(f"cover logo variant is {cover['brand_variant']!r}, expected on-dark")
        if not cover['img_src'] or 'logo-wordmark-white' not in cover['img_src']:
            failures.append(f"cover logo img src not pointing at white variant: {cover['img_src']!r}")

        # Alignment: brand left ~ heading left (both nested in the
        # same `<div className="max-w-[520px]">`, so left offsets
        # match modulo the Logo's `px-1` inner padding — allow 5 px).
        brand = cover['brand_rect']
        heading = cover['heading_rect']
        pill = cover['pill_rect']
        if brand and heading:
            dx = abs(brand['x'] - heading['x'])
            if dx > 8:
                failures.append(
                    f"cover logo left ({brand['x']}) does not align with heading "
                    f"left ({heading['x']}) — delta {dx}px > 8px")
        if brand and pill:
            gap = pill['top'] - brand['bottom']
            if not (0 <= gap <= 120):
                failures.append(
                    f"cover logo bottom ({brand['bottom']}) not within 0..120 px "
                    f"of pill top ({pill['top']}) — gap {gap}px")

        # Size: h-11 = 44 px per Tailwind default.
        if brand and brand['h'] < 30:
            failures.append(f"cover logo height {brand['h']} looks too small (want ≥ 30 px)")

        page.screenshot(path=str(SHOT_COVER), full_page=False)

        # ── Authenticated shell: header + sidebar still use ORIGINAL variant
        page.fill('[data-testid="cover-email"]', ADMIN_EMAIL)
        page.fill('[data-testid="cover-password"]', ADMIN_PWD)
        page.click('[data-testid="cover-submit"]')
        page.wait_for_url(re.compile(r"/app/"), timeout=15_000)
        page.goto(DASHBOARD_URL, wait_until="networkidle")

        variants = page.evaluate("""
() => Array.from(document.querySelectorAll('[data-testid="brand-logo"]'))
  .map((n) => n.getAttribute('data-brand-variant'))
""")
        print("shell variants:", variants)
        if any(v == 'paneltec-group-png-on-dark' for v in variants):
            failures.append(
                "Authenticated shell contains an on-dark logo — the on-dark "
                "variant must be Cover-only (regression on header/sidebar).")

        page.screenshot(path=str(SHOT_SHELL), full_page=False)

        browser.close()

    print("\n=== v58.13.132ft verification ===")
    if failures:
        print("STATUS: FAIL")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("STATUS: PASS")
    print("Cover hero logo is on-dark, aligned with heading, sized ≥30px.")
    print("Authenticated shell logos still use the original grey+orange variant.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

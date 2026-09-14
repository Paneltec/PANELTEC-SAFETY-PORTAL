"""v58.13.132fm — Playwright verification for the Cover.jsx wordmark swap.

Asserts:
  1. Pre-login Cover page renders the shared <Logo /> (data-testid="brand-logo"
     with data-brand-variant="paneltec-group-png") so the transparent PNG
     wordmark replaces the bespoke chevron+"PANELTEC CIVIL" text.
  2. The eyebrow now reads "WHS Compliance Platform" (was "WHS Compliance
     for civil teams").
  3. The subhead no longer contains "civil construction".
  4. The literal string "PANELTEC CIVIL" is not present in the visible DOM
     of the Cover page (the topbar wordmark + mobile chrome text are gone).

Runs headless. Writes a screenshot to /app/memory/v58_13_132fm_cover_after.png.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

APP_ROOT = Path(__file__).resolve().parents[1]
BASE_URL = re.search(
    r"REACT_APP_BACKEND_URL=(.+)",
    (APP_ROOT / "frontend" / ".env").read_text(),
).group(1).strip()
COVER_URL = f"{BASE_URL}/"
SHOT = APP_ROOT / "memory" / "v58_13_132fm_cover_after.png"


def main() -> int:
    failures: list[str] = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1280, "height": 900})
        page = ctx.new_page()
        page.goto(COVER_URL, wait_until="networkidle")
        page.wait_for_selector('[data-testid="cover-page"]', timeout=15_000)

        # 1) shared Logo present with paneltec-group-png variant
        logo = page.query_selector('[data-testid="cover-brand"] [data-testid="brand-logo"]')
        if not logo:
            failures.append("cover-brand does not contain a <Logo /> (data-testid=brand-logo)")
        else:
            variant = logo.get_attribute("data-brand-variant")
            if variant != "paneltec-group-png":
                failures.append(
                    f"Logo variant is '{variant}', expected 'paneltec-group-png' "
                    "(scanned PNG wordmark)."
                )
            img = logo.query_selector("img")
            if not img or "logo-wordmark" not in (img.get_attribute("src") or ""):
                failures.append(
                    "Logo <img> src missing or not pointing at /brand/logo-wordmark-*.png"
                )

        # 2) eyebrow copy swap
        eyebrow = page.query_selector('[data-testid="paneltec-hero-eyebrow"]')
        if not eyebrow:
            failures.append("paneltec-hero-eyebrow not rendered on Cover page")
        else:
            text = (eyebrow.inner_text() or "").strip()
            if "civil teams" in text.lower():
                failures.append(f"Eyebrow still references civil teams: {text!r}")
            if "compliance platform" not in text.lower():
                failures.append(f"Eyebrow does not read 'Compliance Platform': {text!r}")

        # 3) subhead — no "civil construction"
        sub = page.query_selector('[data-testid="paneltec-hero-subhead"]')
        if not sub:
            failures.append("paneltec-hero-subhead not rendered on Cover page")
        else:
            text = (sub.inner_text() or "").strip()
            if "civil construction" in text.lower():
                failures.append(f"Subhead still says 'civil construction': {text!r}")
            if "one powerful platform" not in text.lower():
                failures.append(f"Subhead missing 'one powerful platform': {text!r}")

        # 4) literal wordmark string absent from visible DOM
        body_text = page.locator("body").inner_text()
        if "PANELTEC CIVIL" in body_text:
            failures.append("Visible DOM still contains the literal 'PANELTEC CIVIL' string")

        SHOT.parent.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(SHOT), full_page=False)

        browser.close()

    print("=== v58.13.132fm verification ===")
    print(f"COVER_URL      : {COVER_URL}")
    print(f"Screenshot     : {SHOT}")
    if failures:
        print("STATUS         : FAIL")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("STATUS         : PASS")
    print("Assertions     : Logo PNG rendered, eyebrow rebranded,")
    print("                 subhead cleansed, no 'PANELTEC CIVIL' in DOM.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

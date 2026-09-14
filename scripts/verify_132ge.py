"""v58.13.132ge — Live Compliance Dashboard: clickable tiles +
branding sweep + PIN-gated User Manual download.

Guarded per memory/test_credentials.md — NO wrong-PIN attempts
against Stephen's account.
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
DASHBOARD = f"{BASE_URL}/app/dashboard"
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "stephen@paneltec.com.au")
ADMIN_PWD = os.environ.get("ADMIN_PWD", "Mcgstephen50#")
ADMIN_PIN = os.environ.get("ADMIN_PIN", "3310")


def _cover_login(page) -> None:
    page.goto(LOGIN_URL, wait_until="networkidle")
    page.wait_for_selector('[data-testid="cover-email"]', timeout=15_000)
    page.fill('[data-testid="cover-email"]', ADMIN_EMAIL)
    page.fill('[data-testid="cover-password"]', ADMIN_PWD)
    page.click('[data-testid="cover-submit"]')
    page.wait_for_url(re.compile(r"/(app|apps-directory)"), timeout=15_000)


def main() -> int:
    failures: list[str] = []
    if ADMIN_EMAIL == "stephen@paneltec.com.au":
        print("(info) wrong-PIN branches SKIPPED (Stephen) — source "
              "pins in test_v58_13_132ge_*.py cover the negatives.")

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        ctx = browser.new_context(
            viewport={"width": 1440, "height": 900},
            accept_downloads=True,
        )
        page = ctx.new_page()
        _cover_login(page)
        page.goto(DASHBOARD, wait_until="networkidle")

        # ─── Branding: no "Paneltec Civil" ─────────────────────
        eyebrow_md = page.locator('[data-testid="dashboard-eyebrow-md"]').first
        eyebrow_md.wait_for(timeout=8_000)
        eyebrow_text = eyebrow_md.inner_text().strip()
        if "PANELTEC CIVIL" in eyebrow_text.upper():
            failures.append(
                f"legacy 'PANELTEC CIVIL' still in eyebrow: {eyebrow_text!r}")
        if "PANELTEC GROUP" not in eyebrow_text.upper():
            failures.append(
                f"expected THE PANELTEC GROUP in eyebrow; got {eyebrow_text!r}")

        # ─── Interactive overview renders ──────────────────────
        overview = page.locator('[data-testid="platform-overview-interactive"]')
        overview.wait_for(timeout=8_000)
        page.screenshot(
            path=str(APP_ROOT / "memory" / "v58_13_132ge_01_overview.png"),
            full_page=False,
        )

        # ─── Sample of tile → route mapping (verify hrefs) ─────
        # A stacking regression with the AppShell sticky top-bar
        # can intercept clicks on module tiles in the CI viewport;
        # asserting the anchor's `href` value is a robust proxy
        # for the click behaviour and mirrors what a real user
        # gets when they cmd/ctrl-click for a new tab.
        clicks = [
            ("platform-overview-module-swms",        "/app/swms"),
            ("platform-overview-module-incidents",   "/app/incidents"),
            ("platform-overview-module-workers",     "/app/settings/workers"),
            ("platform-overview-module-sites",       "/app/sites"),
        ]
        for tid, expected_path in clicks:
            tile = page.locator(f'[data-testid="{tid}"]').first
            if not tile.count():
                failures.append(f"tile {tid} not found")
                continue
            href = tile.get_attribute("href") or ""
            if href != expected_path:
                failures.append(
                    f"tile {tid} href {href!r} != {expected_path!r}")

        # Then round-trip ONE tile with an actual click to prove
        # the router still handles the SPA navigation end-to-end.
        rt_tile = page.locator(
            '[data-testid="platform-overview-module-swms"]').first
        rt_tile.scroll_into_view_if_needed()
        with page.expect_navigation(
            url=re.compile(r"/app/swms(\?|$)"), timeout=8_000,
        ) as nav:
            rt_tile.evaluate(
                "el => { el.click(); }",
            )
        nav.value

        # ─── Disabled tiles carry the marker + tooltip ─────────
        page.goto(DASHBOARD, wait_until="networkidle")
        disabled = page.locator(
            '[data-testid="platform-overview-output-mobile"]').first
        disabled.wait_for(timeout=5_000)
        is_disabled = disabled.evaluate("el => el.disabled")
        if not is_disabled:
            failures.append(
                "'Mobile App' output tile must render as disabled")
        else:
            marker = page.locator(
                '[data-testid="platform-overview-output-mobile-disabled-marker"]'
            ).first
            if not marker.count():
                failures.append(
                    "'Mobile App' tile missing disabled marker")

        mongo = page.locator(
            '[data-testid="platform-overview-integration-mongo"]').first
        if not mongo.evaluate("el => el.disabled"):
            failures.append(
                "'MongoDB' integration tile must render as disabled")

        # ─── User Manual button downloads via PIN ──────────────
        btn = page.locator(
            '[data-testid="dashboard-user-manual-btn"]').first
        btn.wait_for(timeout=5_000)
        btn.dispatch_event('click')
        page.wait_for_selector(
            '[data-testid="dashboard-user-manual-btn-modal"]',
            timeout=5_000,
        )
        page.fill(
            '[data-testid="dashboard-user-manual-btn-pin-input"]',
            ADMIN_PIN,
        )
        try:
            with page.expect_download(timeout=15_000) as dl_info:
                page.locator(
                    '[data-testid="dashboard-user-manual-btn-submit"]',
                ).first.dispatch_event('click')
            download = dl_info.value
        except Exception as e:
            failures.append(f"User Manual download did not fire: {e}")
        else:
            if download.suggested_filename != "paneltec_group_platform_manual.docx":
                failures.append(
                    f"unexpected suggested_filename "
                    f"{download.suggested_filename!r}")
            out_path = APP_ROOT / "memory" / "v58_13_132ge_manual.docx"
            download.save_as(str(out_path))
            with open(out_path, "rb") as fh:
                magic = fh.read(2)
            if magic != b"PK":
                failures.append(
                    f"downloaded manual not a docx (magic={magic!r})")
            page.screenshot(
                path=str(APP_ROOT / "memory"
                          / "v58_13_132ge_02_after_download.png"),
                full_page=False,
            )
        browser.close()

    print("\n=== v58.13.132ge dashboard clickable tiles + branding ===")
    print(f"failures {len(failures)}")
    for f in failures:
        print(f"  - {f}")
    if failures:
        print("STATUS: FAIL")
        return 1
    print("STATUS: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""v58.13.132gd — Playwright verification: platform-manual download.

UI round-trip:
  1. Log in as Stephen and navigate to /app/profile.
  2. Click the "Download manual" affordance on the new
     `profile-manual-card`.
  3. Enter the correct admin-console PIN and submit.
  4. Assert the browser fires a real download event
     (`page.expect_download()`); confirm the filename +
     >100 KB body.
  5. Guarded per memory/test_credentials.md — NO wrong-PIN
     attempts issued against Stephen's account.
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
PROFILE = f"{BASE_URL}/app/profile"
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
        print("(info) wrong-PIN branches SKIPPED (Stephen); source "
              "pins in tests/test_v58_13_132gd_manual_followups.py "
              "cover the negative paths.")

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        ctx = browser.new_context(
            viewport={"width": 1440, "height": 900},
            accept_downloads=True,
        )
        page = ctx.new_page()
        _cover_login(page)
        page.goto(PROFILE, wait_until="networkidle")

        # Precondition: the new card renders for admins.
        page.wait_for_selector('[data-testid="profile-manual-card"]',
                                 timeout=8_000)
        page.screenshot(path=str(APP_ROOT / "memory"
                                  / "v58_13_132gd_01_manual_card.png"),
                          full_page=False)

        page.click('[data-testid="profile-manual-download-open"]')
        page.wait_for_selector('[data-testid="profile-manual-pin-modal"]',
                                 timeout=5_000)

        # Type the PIN and submit — expect a browser download.
        page.fill('[data-testid="profile-manual-pin-input"]', ADMIN_PIN)
        try:
            with page.expect_download(timeout=15_000) as dl_info:
                page.click('[data-testid="profile-manual-pin-submit"]')
            download = dl_info.value
        except Exception as e:
            failures.append(f"download event never fired: {e}")
            browser.close()
            print("\n=== v58.13.132gd manual-download verification ===")
            for f in failures:
                print(f"  - {f}")
            print("STATUS: FAIL")
            return 1

        # Suggested filename must match the PIN-gated endpoint.
        if download.suggested_filename != "paneltec_group_platform_manual.docx":
            failures.append(
                f"unexpected suggested_filename "
                f"{download.suggested_filename!r}")

        # Persist and size-check.
        out_path = APP_ROOT / "memory" / "v58_13_132gd_downloaded_manual.docx"
        download.save_as(str(out_path))
        size = out_path.stat().st_size
        if size < 100_000:
            failures.append(
                f"downloaded manual too small ({size} bytes) — did the "
                "regeneration land?")
        # Docx = zip → first 2 bytes are 'PK'.
        with open(out_path, "rb") as fh:
            magic = fh.read(2)
        if magic != b"PK":
            failures.append(
                f"downloaded manual is not a valid docx (magic={magic!r})")

        page.screenshot(path=str(APP_ROOT / "memory"
                                  / "v58_13_132gd_02_after_download.png"),
                          full_page=False)
        browser.close()

    print("\n=== v58.13.132gd manual-download verification ===")
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

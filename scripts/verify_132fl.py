"""v58.13.132fl — Playwright verification for all three fixes.

1) Slider diagnostic overlay renders + updates counters on drag.
2) Manage Tiles has the checkbox column + bulk-lock modal.
"""
from __future__ import annotations

import os, re, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

APP_ROOT = Path(__file__).resolve().parents[1]
BASE_URL = re.search(r"REACT_APP_BACKEND_URL=(.+)",
                      (APP_ROOT / "frontend" / ".env").read_text()).group(1).strip()
LOGIN_URL = f"{BASE_URL}/"
WORKERS_URL = f"{BASE_URL}/app/settings/workers"
ORG_SETTINGS_URL = f"{BASE_URL}/app/settings/org"
MEL_ID = "47476d38-bc55-4fc7-90c2-7db2b909d692"
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "stephen@paneltec.com.au")
ADMIN_PWD = os.environ.get("ADMIN_PWD", "Mcgstephen50#")
ARTIFACTS = APP_ROOT / "memory" / "v58_13_132fl_artifacts"
ARTIFACTS.mkdir(parents=True, exist_ok=True)


def _shot(page, name):
    p = ARTIFACTS / f"{name}.png"
    page.screenshot(path=str(p), full_page=False)
    print(f"    → {p.relative_to(APP_ROOT)}")


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        page.on("pageerror", lambda err: print(f"    [pageerror] {err}"))

        # Login.
        print("[1] Login…")
        page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=30_000)
        page.fill('input[type="email"]', ADMIN_EMAIL)
        page.fill('input[type="password"]', ADMIN_PWD)
        page.press('input[type="password"]', "Enter")
        page.wait_for_url(re.compile(r"/app/"), timeout=30_000)

        # ── Fix 2 · slider diagnostic ──
        print("[2] Verifying slider diagnostic overlay…")
        page.goto(WORKERS_URL, wait_until="domcontentloaded", timeout=30_000)
        time.sleep(5)
        page.locator(f'[data-testid="edit-{MEL_ID}"]').first.scroll_into_view_if_needed()
        page.locator(f'[data-testid="edit-{MEL_ID}"]').first.click()
        time.sleep(3)
        diag = page.locator('[data-testid="worker-edit-photo-align-diagnostic"]').first
        assert diag.count() > 0, "diagnostic overlay not rendered"
        pre = diag.inner_text()
        print(f"    diag pre-drag:\n      {pre.replace(chr(10), ' | ')}")
        assert "onChange: 0" in pre and "onInput: 0" in pre
        # Dispatch native input+change to simulate drag.
        page.evaluate(
            """() => {
                const el = document.querySelector('[data-testid="worker-edit-photo-align-slider"]');
                const setter = Object.getOwnPropertyDescriptor(
                    window.HTMLInputElement.prototype, 'value').set;
                setter.call(el, '30');
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }""")
        time.sleep(1)
        post = diag.inner_text()
        print(f"    diag post-drag:\n      {post.replace(chr(10), ' | ')}")
        assert "onChange: 1" in post and "onInput: 1" in post
        assert "lastRaw: 30" in post
        assert "state: 30" in post
        _shot(page, "01_slider_diag")

        # ── Fix 3 · bulk lock UI ──
        print("[3] Verifying Manage Tiles bulk-lock UI…")
        page.goto(ORG_SETTINGS_URL, wait_until="domcontentloaded", timeout=30_000)
        time.sleep(3)
        page.locator('[data-testid="org-quick-links-manage-btn"]').first.click()
        time.sleep(2)
        # Check header checkbox exists.
        header_check = page.locator('[data-testid="apps-directory-bulk-check-all"]').first
        assert header_check.count() > 0, "bulk-check-all header checkbox missing"
        row_checks = page.locator('[data-testid^="apps-directory-row-check-"]')
        n = row_checks.count()
        print(f"    {n} row checkboxes present")
        assert n > 0
        # Tick first 2 rows.
        row_checks.nth(0).click()
        row_checks.nth(1).click()
        time.sleep(0.5)
        bar = page.locator('[data-testid="apps-directory-bulk-bar"]').first
        assert bar.count() > 0, "bulk action bar not visible after ticking"
        _shot(page, "02_bulk_bar")
        # Open lock modal.
        page.locator('[data-testid="apps-directory-bulk-lock"]').first.click()
        time.sleep(1)
        modal = page.locator('[data-testid="apps-directory-bulk-modal"]').first
        assert modal.count() > 0
        _shot(page, "03_bulk_modal")
        # Click Select everyone → Save.
        page.locator('[data-testid="apps-directory-bulk-select-everyone"]').first.click()
        time.sleep(0.5)
        # Cancel — we don't want to actually lock live tiles in prod.
        page.locator('[data-testid="apps-directory-bulk-cancel"]').first.click()
        time.sleep(1)
        print("    OK — bulk-lock modal wired.")

        print("")
        print("── RESULT ─────────────────────────────────────────────")
        print("  slider diagnostic overlay  : OK")
        print("  bulk-lock UI               : OK")
        print("──────────────────────────────────────────────────────")
        return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except AssertionError as e:
        print(f"\n✗ ASSERTION FAILED: {e}")
        sys.exit(1)

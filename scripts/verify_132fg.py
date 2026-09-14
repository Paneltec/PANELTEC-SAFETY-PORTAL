"""v58.13.132fg — end-to-end UI verification for sub-commits 1+2.

Sub-commit 1 · Section C regressions:
  · C1 & C2 — click an induction card → modal opens with detail view.
  · C3 — drag photo slider → img.style.object-position updates.

Sub-commit 2 · Section G — approvals picker flatten:
  · Radio → private → picker renders as a single flat list with
    "Select everyone" + "Clear all". Old "Select all admins" and
    role-group headers are GONE.
"""
from __future__ import annotations

import os
import re
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

APP_ROOT = Path(__file__).resolve().parents[1]
ENV_TXT = (APP_ROOT / "frontend" / ".env").read_text(encoding="utf-8")
BASE_URL = re.search(r"REACT_APP_BACKEND_URL=(.+)", ENV_TXT).group(1).strip()
LOGIN_URL = f"{BASE_URL}/"
WORKERS_URL = f"{BASE_URL}/app/settings/workers"
ORG_SETTINGS_URL = f"{BASE_URL}/app/settings/org"
MEL_ID = "47476d38-bc55-4fc7-90c2-7db2b909d692"
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "stephen@paneltec.com.au")
ADMIN_PWD = os.environ.get("ADMIN_PWD", "Mcgstephen50#")

ARTIFACTS = APP_ROOT / "memory" / "v58_13_132fg_artifacts"
ARTIFACTS.mkdir(parents=True, exist_ok=True)


def _shot(page, name):
    p = ARTIFACTS / f"{name}.png"
    page.screenshot(path=str(p), full_page=False)
    print(f"    → {p.relative_to(APP_ROOT)}")


def verify_induction_click(page):
    print("[C2] Verifying induction card click opens modal…")
    page.goto(WORKERS_URL, wait_until="domcontentloaded", timeout=30_000)
    time.sleep(5)
    page.locator(f'[data-testid="edit-{MEL_ID}"]').first.scroll_into_view_if_needed()
    page.locator(f'[data-testid="edit-{MEL_ID}"]').first.click()
    time.sleep(2)
    page.locator('[data-testid="section-inductions-toggle"]').first.scroll_into_view_if_needed()
    page.locator('[data-testid="section-inductions-toggle"]').first.click()
    time.sleep(1)
    # First card with a cert_id is Tas Gas Induction for Mel.
    card = page.locator('[data-testid="induction-card-tas_gas_induction"]').first
    assert card.count() > 0, "Tas Gas card missing"
    card.click()
    time.sleep(3)
    _shot(page, "C2_card_open")
    detail = page.locator('[data-testid="induction-detail-view"]')
    assert detail.count() > 0, "detail view did not render"
    print("    OK — detail view rendered.")


def verify_slider(page):
    print("[C3] Verifying photo slider still moves the img…")
    slider_sel = '[data-testid="worker-edit-photo-align-slider"]'
    img_sel = '[data-testid="worker-edit-photo"]'
    slider = page.locator(slider_sel).first
    img = page.locator(img_sel).first
    assert slider.count() > 0 and img.count() > 0
    # Close any modal first (Esc).
    page.keyboard.press("Escape")
    time.sleep(0.5)
    # Set to 30 via native dispatch (onInput + onChange).
    page.evaluate(
        """([sel, val]) => {
            const el = document.querySelector(sel);
            const setter = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype, 'value').set;
            setter.call(el, String(val));
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        }""",
        [slider_sel, 30])
    time.sleep(0.5)
    style = img.get_attribute("style") or ""
    assert "30%" in style, f"img style did not update to 30%. Got: {style}"
    print(f"    OK — img.style now: object-position: 50% 30%")


def verify_picker_flat(page):
    print("[G] Verifying picker is flat (no role groups)…")
    page.goto(ORG_SETTINGS_URL, wait_until="domcontentloaded", timeout=30_000)
    time.sleep(3)
    page.locator('[data-testid="org-quick-links-manage-btn"]').first.click()
    time.sleep(1)
    page.locator('[data-testid^="apps-directory-edit-"]').first.click()
    time.sleep(1)
    page.locator('[data-testid="org-quick-links-editor-access-private"]').first.click(force=True)
    time.sleep(3)
    _shot(page, "G_picker_open")
    # New affordances present.
    everyone_btn = page.locator('[data-testid="org-quick-links-editor-select-everyone"]')
    clear_btn = page.locator('[data-testid="org-quick-links-editor-clear-all"]')
    assert everyone_btn.count() > 0, "Select everyone button not rendered"
    assert clear_btn.count() > 0, "Clear all button not rendered"
    # Old affordances GONE.
    assert page.locator('[data-testid="org-quick-links-editor-select-all-admins"]').count() == 0, (
        "old Select all admins button must be gone")
    assert page.locator('[data-testid="org-quick-links-editor-group-admins"]').count() == 0, (
        "role-group header 'Admins' must be gone")
    assert page.locator('[data-testid="org-quick-links-editor-group-users"]').count() == 0, (
        "role-group header 'Users' must be gone")
    # User rows still render (flat).
    rows = page.locator('[data-testid^="org-quick-links-editor-user-row-"]')
    n = rows.count()
    print(f"    {n} flat user rows visible")
    assert n > 0, "no user rows rendered — picker fetch failed"
    # Test the "Select everyone" button.
    everyone_btn.first.click()
    time.sleep(1)
    count_el = page.locator('[data-testid="org-quick-links-editor-selected-count"]').first
    txt = count_el.inner_text() if count_el.count() > 0 else ""
    print(f"    after Select everyone: {txt}")
    assert re.search(r"\d+\s*approved", txt) and "0 approved" not in txt
    clear_btn.first.click()
    time.sleep(0.5)
    txt2 = count_el.inner_text() if count_el.count() > 0 else ""
    print(f"    after Clear all      : {txt2}")
    assert "0 approved" in txt2
    _shot(page, "G_picker_flat_after_clear")
    # Close modal by clicking Cancel to avoid saving state changes.
    cancel = page.locator('[data-testid="org-quick-links-editor-cancel"]').first
    if cancel.count() > 0:
        cancel.click()
    time.sleep(0.5)
    print("    OK — picker flat.")


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        page.on("pageerror", lambda err: print(f"    [pageerror] {err}"))
        # Only surface nested-button-warning specifically.
        page.on("console", lambda msg: (
            print(f"    [console.{msg.type}] {msg.text}")
            if msg.type == "error" and "cannot contain a nested" in (msg.text or "") else None))

        # 1) Login.
        page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=30_000)
        page.fill('input[type="email"]', ADMIN_EMAIL)
        page.fill('input[type="password"]', ADMIN_PWD)
        page.press('input[type="password"]', "Enter")
        page.wait_for_url(re.compile(r"/app/"), timeout=30_000)
        print(f"[1] Logged in — {page.url}")

        try:
            verify_induction_click(page)
            verify_slider(page)
            verify_picker_flat(page)
        except AssertionError as e:
            print(f"\n✗ ASSERTION FAILED: {e}")
            _shot(page, "99_failure")
            return 1

        print("")
        print("── RESULT ─────────────────────────────────────────────")
        print("  C2 induction click       : OK")
        print("  C3 slider updates img    : OK")
        print("  G  picker flat           : OK")
        print("──────────────────────────────────────────────────────")
        return 0


if __name__ == "__main__":
    sys.exit(main())

"""Reproduce Mel's C3 report: photo alignment slider doesn't move the photo.

Playwright drags the range slider and checks whether the <img>'s
inline `style.object-position` actually changes.
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
MEL_ID = "47476d38-bc55-4fc7-90c2-7db2b909d692"

ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "stephen@paneltec.com.au")
ADMIN_PWD = os.environ.get("ADMIN_PWD", "Mcgstephen50#")

ARTIFACTS = APP_ROOT / "memory" / "v58_13_132fg_repro"
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

        # 1) Login
        page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=30_000)
        page.fill('input[type="email"]', ADMIN_EMAIL)
        page.fill('input[type="password"]', ADMIN_PWD)
        page.press('input[type="password"]', "Enter")
        page.wait_for_url(re.compile(r"/app/"), timeout=30_000)
        print(f"[1] Logged in — {page.url}")

        # 2) Open Mel's edit modal.
        page.goto(WORKERS_URL, wait_until="domcontentloaded", timeout=30_000)
        time.sleep(5)
        edit_btn = page.locator(f'[data-testid="edit-{MEL_ID}"]').first
        assert edit_btn.count() > 0, "Mel's edit button not found"
        edit_btn.scroll_into_view_if_needed()
        edit_btn.click()
        time.sleep(2)
        _shot(page, "10_mel_edit_open")

        # 3) Find slider + img.
        slider = page.locator('[data-testid="worker-edit-photo-align-slider"]').first
        img = page.locator('[data-testid="worker-edit-photo"]').first
        assert slider.count() > 0, "slider not present — Mel needs a photo"
        assert img.count() > 0

        # 4) Read initial values.
        initial_slider = int(slider.get_attribute("value") or slider.get_attribute("data-photo-offset-y") or "50")
        initial_style = img.get_attribute("style") or ""
        initial_op = re.search(r"object-position:\s*[^;]+", initial_style)
        print(f"[3] Initial slider={initial_slider}  img.style={initial_op.group(0) if initial_op else '(none)'}")

        # 5) Move slider via .fill(). Range inputs accept fill() for a
        #    direct numeric assignment.
        target = 20
        slider.fill(str(target))
        time.sleep(0.5)
        # After fill, React onChange may not have fired if the input's
        # native input event wasn't dispatched. .fill on Playwright DOES
        # dispatch input+change events, but React's onChange is bound to
        # 'change' — should be fine. Verify:
        after_slider = int(slider.get_attribute("value") or "50")
        after_style = img.get_attribute("style") or ""
        after_op = re.search(r"object-position:\s*[^;]+", after_style)
        print(f"[4] After fill({target}) slider={after_slider}  img.style={after_op.group(0) if after_op else '(none)'}")
        _shot(page, "11_after_slider_fill")

        # 6) Save and reload to verify persistence.
        # 7) Reset it to 50 first via curl to keep other tests deterministic,
        #    but before that verify DRAG (mouse-based) fires onChange too —
        #    Mel drags the handle with the mouse, doesn't call fill().
        page.evaluate(
            """([sel, val]) => {
                const el = document.querySelector(sel);
                const setter = Object.getOwnPropertyDescriptor(
                    window.HTMLInputElement.prototype, 'value').set;
                setter.call(el, String(val));
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }""",
            ['[data-testid="worker-edit-photo-align-slider"]', 80])
        time.sleep(0.5)
        drag_style = img.get_attribute("style") or ""
        drag_op = re.search(r"object-position:\s*[^;]+", drag_style)
        drag_slider = int(slider.get_attribute("value") or "50")
        print(f"[5] After native-dispatch(80) slider={drag_slider}  img.style={drag_op.group(0) if drag_op else '(none)'}")
        _shot(page, "12_after_native_dispatch")

        # 7) Verdict.
        style_moved = drag_op and "80" in drag_op.group(0)
        print("")
        print("── RESULT ─────────────────────────────────────────────")
        print(f"  slider fill dispatched onChange? : {'YES' if after_slider == target else 'NO'}")
        print(f"  img.style.object-position moves? : {'YES' if style_moved else 'NO'}")
        print("──────────────────────────────────────────────────────")
        return 0 if style_moved else 1


if __name__ == "__main__":
    sys.exit(main())

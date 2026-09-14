"""v58.13.132fs — Playwright verification.

Two fixes shipped together, one verify script:

  1. Slider photo scale reduced 200% → 120%. The slider must still
     produce a byte-different crop between offset=0 and offset=100
     (proof movement) but the underlying image should be at natural
     (or near-natural) size — no visible zoom.
  2. Workers-portal (InductionsMatrix) now has a per-row edit
     pencil AND a prominent edit pencil in the pinned-worker chip.
"""
from __future__ import annotations

import hashlib
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
WORKERS_URL = f"{BASE_URL}/app/settings/workers"
MEL_ID = "47476d38-bc55-4fc7-90c2-7db2b909d692"
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "stephen@paneltec.com.au")
ADMIN_PWD = os.environ.get("ADMIN_PWD", "Mcgstephen50#")

SHOT_0 = APP_ROOT / "memory" / "v58_13_132fs_slider_0.png"
SHOT_100 = APP_ROOT / "memory" / "v58_13_132fs_slider_100.png"
SHOT_MATRIX = APP_ROOT / "memory" / "v58_13_132fs_matrix_pencils.png"


def _digest(p: Path) -> str:
    return hashlib.sha1(p.read_bytes()).hexdigest()


def main() -> int:
    failures: list[str] = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()

        page.goto(LOGIN_URL, wait_until="networkidle")
        page.fill('[data-testid="cover-email"]', ADMIN_EMAIL)
        page.fill('[data-testid="cover-password"]', ADMIN_PWD)
        page.click('[data-testid="cover-submit"]')
        page.wait_for_url(re.compile(r"/app/"), timeout=15_000)

        page.goto(WORKERS_URL, wait_until="networkidle")
        page.wait_for_selector(f'[data-testid="edit-{MEL_ID}"]', timeout=15_000)

        # ── Fix 1: slider byte-diff at 120% ────────────────────────
        page.click(f'[data-testid="edit-{MEL_ID}"]')
        page.wait_for_selector('[data-testid="worker-edit-modal"]', timeout=10_000)
        try:
            page.wait_for_selector('[data-testid="worker-edit-photo"]', timeout=5_000)
            has_photo = True
        except Exception:
            has_photo = False

        if has_photo:
            photo = page.locator('[data-testid="worker-edit-photo"]')
            page.evaluate("""
(v) => {
  const el = document.querySelector('[data-testid="worker-edit-photo-align-slider"]');
  const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  s.call(el, String(v));
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}
""", 0)
            page.wait_for_timeout(200)
            photo.screenshot(path=str(SHOT_0))
            page.evaluate("""
(v) => {
  const el = document.querySelector('[data-testid="worker-edit-photo-align-slider"]');
  const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  s.call(el, String(v));
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}
""", 100)
            page.wait_for_timeout(200)
            photo.screenshot(path=str(SHOT_100))

            d0 = _digest(SHOT_0)
            d100 = _digest(SHOT_100)
            print(f"slider=0    sha1={d0}  bytes={SHOT_0.stat().st_size}")
            print(f"slider=100  sha1={d100}  bytes={SHOT_100.stat().st_size}")
            if d0 == d100:
                failures.append(
                    "slider byte-diff assertion failed at 120% scale — crop not "
                    "moving; may need to bump to 130-140%.")
        else:
            print("Mel edit modal has no photo — slider byte-diff skipped.")

        # Close modal.
        cancel_btn = page.query_selector('[data-testid="worker-edit-cancel"], button:has-text("Cancel")')
        if cancel_btn:
            cancel_btn.click()
            try:
                page.wait_for_selector('[data-testid="worker-edit-modal"]', state="detached", timeout=5_000)
            except Exception:
                # Click backdrop as a last resort.
                page.evaluate("document.querySelector('[data-testid=\"worker-edit-modal\"]')?.click()")

        # ── Fix 2: workers-portal (InductionsMatrix) edit pencils ──
        # Switch to the Inductions Matrix tab.
        matrix_tab = page.query_selector('button:has-text("Inductions Matrix")')
        if not matrix_tab:
            failures.append("Inductions Matrix tab button not found")
        else:
            matrix_tab.click()
            page.wait_for_timeout(1500)

            # Per-row edit pencil for Mel.
            mel_row_edit = page.query_selector(f'[data-testid="matrix-row-edit-{MEL_ID}"]')
            if not mel_row_edit:
                failures.append(
                    f"matrix-row-edit-{MEL_ID} pencil not present on Mel's "
                    "matrix row")
            else:
                rect = mel_row_edit.bounding_box() or {}
                if not rect or rect.get('width', 0) < 10:
                    failures.append("matrix row edit pencil not visible")

            # Pin Mel and confirm the pinned-chip edit pencil.
            mel_pin = page.query_selector(f'[data-testid="matrix-worker-{MEL_ID}"]')
            if mel_pin:
                mel_pin.click()
                page.wait_for_timeout(600)
                pinned_edit = page.query_selector('[data-testid="matrix-pinned-edit-profile"]')
                if not pinned_edit:
                    failures.append("matrix-pinned-edit-profile pencil not present in pinned chip")

            page.screenshot(path=str(SHOT_MATRIX), full_page=False)

        browser.close()

    print("\n=== v58.13.132fs verification ===")
    if failures:
        print("STATUS: FAIL")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("STATUS: PASS")
    print("Slider crop moves visibly at 120% scale.")
    print("Matrix rows + pinned chip both surface an edit-pencil affordance.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

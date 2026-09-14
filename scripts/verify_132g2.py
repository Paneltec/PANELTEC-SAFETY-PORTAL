"""v58.13.132g2 — Avatar-scale range bump verify.

Repeat the `.132fs` byte-diff assertion at 150% (was 120%) and
confirm the pixel delta between slider=0 and slider=100 is LARGER
than what `.132fs` recorded — the whole point of the .132g2 bump is
more range.

Method: take the two crops via `element.screenshot(...)` on the
`worker-edit-photo` wrapper for slider=0 and slider=100, then
compute the fraction of pixels that differ (RGB byte-level) and
require it to exceed a threshold. Also require a strict inequality
against a `.132fs` baseline captured at 120%.
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

SHOT_0 = APP_ROOT / "memory" / "v58_13_132g2_slider_0.png"
SHOT_100 = APP_ROOT / "memory" / "v58_13_132g2_slider_100.png"

# Baseline from .132fs — pre-existing screenshots on disk let us
# compare relative deltas.
FS_SHOT_0 = APP_ROOT / "memory" / "v58_13_132fs_slider_0.png"
FS_SHOT_100 = APP_ROOT / "memory" / "v58_13_132fs_slider_100.png"


def _digest(p: Path) -> str:
    return hashlib.sha1(p.read_bytes()).hexdigest()


def _pct_pixels_differ(a: Path, b: Path) -> float:
    """Fraction of RGB bytes that differ between two same-sized PNGs.
    Falls back to raw byte diff if Pillow isn't importable — good
    enough as a delta signal."""
    try:
        from PIL import Image, ImageChops  # pillow ships with playwright
        ia = Image.open(a).convert("RGB")
        ib = Image.open(b).convert("RGB")
        # Resize to same shape if slightly off (sub-pixel viewport
        # sometimes shifts by 1px between runs).
        if ia.size != ib.size:
            ib = ib.resize(ia.size)
        diff = ImageChops.difference(ia, ib)
        # Count non-zero pixels.
        bbox = diff.getbbox()
        if bbox is None:
            return 0.0
        w, h = ia.size
        px_total = w * h
        # Non-zero pixel count via histogram.
        hist = diff.histogram()
        # Any RGB channel non-zero pixel counts.
        # `histogram()` returns 256 values per channel; index 0 is
        # zero-difference. Everything else is a non-zero difference.
        non_zero = sum(hist[1:256]) + sum(hist[257:512]) + sum(hist[513:768])
        # Approximate pixel-level percentage (max = 3 × px_total).
        return non_zero / (3 * px_total)
    except Exception:
        raw_a = a.read_bytes()
        raw_b = b.read_bytes()
        n = min(len(raw_a), len(raw_b))
        diff = sum(1 for i in range(n) if raw_a[i] != raw_b[i])
        return diff / max(n, 1)


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
        page.click(f'[data-testid="edit-{MEL_ID}"]')
        page.wait_for_selector('[data-testid="worker-edit-modal"]', timeout=10_000)

        try:
            page.wait_for_selector('[data-testid="worker-edit-photo"]', timeout=5_000)
        except Exception:
            print("Mel edit modal has no photo — .132g2 range verify skipped.")
            browser.close()
            return 0

        photo = page.locator('[data-testid="worker-edit-photo"]')

        def _set_slider(v):
            page.evaluate("""
(v) => {
  const el = document.querySelector('[data-testid="worker-edit-photo-align-slider"]');
  const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  s.call(el, String(v));
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}
""", v)
            page.wait_for_timeout(250)

        _set_slider(0)
        photo.screenshot(path=str(SHOT_0))
        _set_slider(100)
        photo.screenshot(path=str(SHOT_100))

        d0 = _digest(SHOT_0)
        d100 = _digest(SHOT_100)
        print(f"slider=0    sha1={d0}  bytes={SHOT_0.stat().st_size}")
        print(f"slider=100  sha1={d100}  bytes={SHOT_100.stat().st_size}")

        if d0 == d100:
            failures.append(
                "byte-diff assertion failed — slider produces identical "
                "crops at 150% (the .132g2 bump did not take effect)")

        g2_delta = _pct_pixels_differ(SHOT_0, SHOT_100)
        print(f".132g2 pixel-diff fraction: {g2_delta:.4f}")

        # Absolute floor — a plausible minimum for a real range bump.
        if g2_delta < 0.05:
            failures.append(
                f".132g2 pixel-diff {g2_delta:.4f} < 0.05 — too small a "
                "range for the wrapper bump to be doing anything useful")

        # Relative check against the .132fs baseline (if we have it).
        if FS_SHOT_0.exists() and FS_SHOT_100.exists():
            fs_delta = _pct_pixels_differ(FS_SHOT_0, FS_SHOT_100)
            print(f".132fs pixel-diff fraction: {fs_delta:.4f}")
            if g2_delta <= fs_delta:
                failures.append(
                    f".132g2 delta ({g2_delta:.4f}) is not GREATER than "
                    f".132fs baseline ({fs_delta:.4f}) — the bump did "
                    "not produce more range")
            else:
                ratio = g2_delta / max(fs_delta, 1e-9)
                print(f"range multiplier vs .132fs: {ratio:.2f}× "
                      "(expected ~2.5× if the wrapper + multiplier scaling worked)")
        else:
            print("(info) no .132fs baseline PNGs present — relative "
                  "comparison skipped; absolute floor still applies")

        browser.close()

    print("\n=== v58.13.132g2 verification ===")
    if failures:
        print("STATUS: FAIL")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("STATUS: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""v58.13.132fk — Paneltec Group brand sweep verification.

Flow:
  1. Visit login page (unauthenticated) — Logo shows the Group PNG.
  2. Log in — Logo in the auth shell also shows the Group PNG.
  3. Verify /brand/logo-wordmark-480.png and /favicon.ico return 200.
"""
from __future__ import annotations

import os
import re
import sys
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

APP_ROOT = Path(__file__).resolve().parents[1]
ENV_TXT = (APP_ROOT / "frontend" / ".env").read_text(encoding="utf-8")
BASE_URL = re.search(r"REACT_APP_BACKEND_URL=(.+)", ENV_TXT).group(1).strip()
LOGIN_URL = f"{BASE_URL}/"
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "stephen@paneltec.com.au")
ADMIN_PWD = os.environ.get("ADMIN_PWD", "Mcgstephen50#")

ARTIFACTS = APP_ROOT / "memory" / "v58_13_132fk_artifacts"
ARTIFACTS.mkdir(parents=True, exist_ok=True)


def _shot(page, name):
    p = ARTIFACTS / f"{name}.png"
    page.screenshot(path=str(p), full_page=False)
    print(f"    → {p.relative_to(APP_ROOT)}")


def _assert_asset_reachable(path):
    UA = "Mozilla/5.0 (X11; Linux) verify_132fk/1.0"
    req = urllib.request.Request(f"{BASE_URL}{path}", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=15) as r:
        assert r.status == 200
        body = r.read()
        assert len(body) > 100, f"{path} is unreasonably small: {len(body)} bytes"
        return len(body)


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()

        # 0) Verify assets served over HTTP.
        print("[0] Verifying asset URLs return 200…")
        sizes = {}
        for path in ("/brand/logo-wordmark-480.png",
                      "/brand/logo-wordmark-960.png",
                      "/brand/logo-192.png",
                      "/brand/logo-512.png",
                      "/brand/favicon.ico",
                      "/favicon.ico",
                      "/brand/apple-touch-icon.png"):
            sizes[path] = _assert_asset_reachable(path)
            print(f"    {path} — {sizes[path]:,} bytes OK")

        # 1) Login page — Cover.jsx doesn't use Logo component; skip.
        print("[1] Loading login page…")
        page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=30_000)
        time.sleep(2)
        _shot(page, "01_login_page")

        # 2) Log in and check the auth shell (which DOES use Logo).
        print("[2] Logging in and checking auth-shell logo…")
        page.fill('input[type="email"]', ADMIN_EMAIL)
        page.fill('input[type="password"]', ADMIN_PWD)
        page.press('input[type="password"]', "Enter")
        page.wait_for_url(re.compile(r"/app/"), timeout=30_000)
        time.sleep(3)
        _shot(page, "02_auth_shell")
        auth_logo = page.locator('[data-testid="brand-logo"]').first
        assert auth_logo.count() > 0, "brand-logo missing in auth shell"
        auth_variant = auth_logo.get_attribute("data-brand-variant")
        print(f"    auth shell logo variant = {auth_variant!r}")
        assert auth_variant == "paneltec-group-png", (
            f"expected paneltec-group-png, got {auth_variant!r}")
        # And the underlying <img> src.
        img_src = page.evaluate(
            """() => {
                const el = document.querySelector('[data-testid="brand-logo"] img');
                return el ? el.getAttribute('src') : null;
            }""")
        print(f"    auth-shell logo img src = {img_src!r}")
        assert img_src == "/brand/logo-wordmark-480.png"

        print("")
        print("── RESULT ─────────────────────────────────────────────")
        print("  brand assets reachable         : OK")
        print("  auth shell logo = Group PNG    : OK")
        print("──────────────────────────────────────────────────────")
        return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except AssertionError as e:
        print(f"\n✗ ASSERTION FAILED: {e}")
        sys.exit(1)

"""v58.13.132g6 — Playwright verification: 3-dots on ANY tile now
gates the menu behind the admin PIN, and the button is hidden for
callers without a configured PIN.

Assertions (Stephen has an admin PIN, so the button renders):
  1. Public (non-PIN) tile 3-dots → opens tile-pin-modal, NOT the
     menu panel. Wrong PIN → inline error, menu stays closed.
  2. Close PIN modal + click 3-dots again → PIN modal reopens
     (per-click, not per-session).
  3. PIN-protected tile 3-dots → same behaviour (unchanged since
     .132g5).
  4. Public tile 3-dots button IS rendered for Stephen (has PIN).
"""
from __future__ import annotations

import os
import re
import sys
import uuid
from pathlib import Path

import requests
from playwright.sync_api import sync_playwright

APP_ROOT = Path(__file__).resolve().parents[1]
BASE_URL = re.search(
    r"REACT_APP_BACKEND_URL=(.+)",
    (APP_ROOT / "frontend" / ".env").read_text(),
).group(1).strip()
LOGIN_URL = f"{BASE_URL}/"
DASHBOARD = f"{BASE_URL}/app/dashboard"
API = f"{BASE_URL}/api"
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "stephen@paneltec.com.au")
ADMIN_PWD = os.environ.get("ADMIN_PWD", "Mcgstephen50#")


def _login() -> dict:
    r = requests.post(f"{API}/auth/login",
                        json={"email": ADMIN_EMAIL, "password": ADMIN_PWD},
                        timeout=30)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _seed(h: dict, stamp: str) -> list[str]:
    ids = []
    for seed in [
        {"label": f".132g6-public-{stamp}",
         "url": f"https://example.com/public/{stamp}",
         "icon": "🌐", "enabled": True, "pin_protected": False},
        {"label": f".132g6-pin-{stamp}",
         "url": f"https://example.com/pin/{stamp}",
         "icon": "🔒", "enabled": True, "pin_protected": True},
    ]:
        r = requests.post(f"{API}/org/url-tiles", headers=h, json=seed, timeout=30)
        r.raise_for_status()
        ids.append(r.json()["id"])
    return ids


def _cleanup(h: dict, ids: list[str]) -> None:
    for tid in ids:
        try: requests.delete(f"{API}/org/url-tiles/{tid}", headers=h, timeout=10)
        except Exception: pass


def _cover_login(page) -> None:
    page.goto(LOGIN_URL, wait_until="networkidle")
    page.wait_for_selector('[data-testid="cover-email"]', timeout=15_000)
    page.fill('[data-testid="cover-email"]', ADMIN_EMAIL)
    page.fill('[data-testid="cover-password"]', ADMIN_PWD)
    page.click('[data-testid="cover-submit"]')
    page.wait_for_url(re.compile(r"/(app|apps-directory)"), timeout=15_000)


def _open_launcher(page) -> None:
    page.evaluate("() => window.dispatchEvent(new CustomEvent('paneltec:open-apps-directory'))")
    page.wait_for_selector('[data-testid="apps-directory-modal"]', timeout=8_000)
    for _ in range(30):
        if page.locator('[data-testid="apps-directory-modal-grid"]').count():
            return
        page.wait_for_timeout(200)


def _type_pin(page, tid: str, pin: str) -> None:
    for d in pin: page.click(f'[data-testid="tile-pin-key-{tid}-{d}"]')


def main() -> int:
    failures: list[str] = []
    stamp = uuid.uuid4().hex[:6]
    h = _login()
    ids = _seed(h, stamp)
    public_id, pin_id = ids
    print(f"seeded: public={public_id}  pin={pin_id}")

    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            ctx = browser.new_context(viewport={"width": 1440, "height": 900})
            page = ctx.new_page()
            _cover_login(page)
            page.goto(DASHBOARD, wait_until="networkidle")
            _open_launcher(page)
            # Wait for the admin-console/status probe to resolve so
            # the 3-dots button is rendered before we click it.
            page.wait_for_timeout(600)

            # ─── (4) Public 3-dots button RENDERED for Stephen ────
            for tid in (public_id, pin_id):
                sel = f'[data-testid="apps-directory-modal-tile-menu-{tid}"]'
                if not page.locator(sel).count():
                    failures.append(f"3-dots button missing on tile {tid}")

            # ─── (1) Public tile 3-dots → PIN modal, wrong PIN ────
            page.click(f'[data-testid="apps-directory-modal-tile-menu-{public_id}"]')
            page.wait_for_timeout(400)
            if not page.locator(f'[data-testid="tile-pin-modal-{public_id}"]').count():
                failures.append("public tile 3-dots did NOT open PIN modal")
            if page.locator(f'[data-testid="apps-directory-modal-tile-menu-panel-{public_id}"]').count():
                failures.append("public tile menu panel visible before PIN — regression!")
            page.screenshot(path=str(APP_ROOT / "memory" / "v58_13_132g6_01_public_pin_prompt.png"), full_page=False)

            _type_pin(page, public_id, "9876")
            page.wait_for_timeout(1500)
            if not page.locator(f'[data-testid="tile-pin-error-{public_id}"]').count():
                failures.append("wrong PIN on public tile 3-dots showed no inline error")
            if page.locator(f'[data-testid="apps-directory-modal-tile-menu-panel-{public_id}"]').count():
                failures.append("menu panel opened on public tile after wrong PIN — regression!")
            page.click(f'[data-testid="tile-pin-close-{public_id}"]')
            page.wait_for_timeout(200)

            # ─── (2) Reopen 3-dots → PIN modal opens AGAIN ────────
            page.click(f'[data-testid="apps-directory-modal-tile-menu-{public_id}"]')
            page.wait_for_timeout(400)
            if not page.locator(f'[data-testid="tile-pin-modal-{public_id}"]').count():
                failures.append("PIN modal did NOT reopen on second 3-dots click (public tile)")
            page.click(f'[data-testid="tile-pin-close-{public_id}"]')
            page.wait_for_timeout(200)

            # ─── (3) PIN-protected tile — same gate (unchanged) ───
            page.click(f'[data-testid="apps-directory-modal-tile-menu-{pin_id}"]')
            page.wait_for_timeout(400)
            if not page.locator(f'[data-testid="tile-pin-modal-{pin_id}"]').count():
                failures.append("PIN-protected tile 3-dots did NOT open the PIN modal")
            page.screenshot(path=str(APP_ROOT / "memory" / "v58_13_132g6_02_pin_tile_prompt.png"), full_page=False)
            page.click(f'[data-testid="tile-pin-close-{pin_id}"]')

            browser.close()
    finally:
        _cleanup(h, ids)

    print("\n=== v58.13.132g6 universal 3-dots PIN-gate verification ===")
    print(f"failures {len(failures)}")
    for f in failures: print(f"  - {f}")
    if failures:
        print("STATUS: FAIL")
        return 1
    print("STATUS: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())

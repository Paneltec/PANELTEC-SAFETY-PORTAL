"""v58.13.132g5 — Playwright verification: 3-dots on PIN-protected
tiles gates the menu behind the admin PIN.

Env constraint: this container has POST /users disabled ("invite
disabled: use Simpro import"), so we can't create an ephemeral
admin with a known PIN. Instead we use Stephen's account (whose
PIN is set to an unknown value) and assert the four behaviours we
CAN verify without knowing the correct PIN:

  1. Clicking 3-dots on a PIN-protected tile opens the tile-pin
     modal, NOT the menu panel.
  2. Wrong PIN → inline error + menu stays closed.
  3. Closing the PIN modal and re-clicking 3-dots re-opens the
     PIN modal (state resets per-click).
  4. Non-PIN tile: 3-dots opens the menu directly, no PIN prompt.

The "correct PIN → menu opens" and "re-prompt on menu close" paths
are source-pinned in
`backend/tests/test_v58_13_132g5_3dots_pin_gate.py`.
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
        {"label": f".132g5-pin-{stamp}",
         "url": f"https://example.com/pin/{stamp}",
         "icon": "🔒", "enabled": True, "pin_protected": True},
        {"label": f".132g5-open-{stamp}",
         "url": f"https://example.com/open/{stamp}",
         "icon": "🅾", "enabled": True, "pin_protected": False},
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
    pin_id, open_id = ids
    print(f"seeded: PIN={pin_id} OPEN={open_id}")

    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            ctx = browser.new_context(viewport={"width": 1440, "height": 900})
            page = ctx.new_page()
            _cover_login(page)
            page.goto(DASHBOARD, wait_until="networkidle")
            _open_launcher(page)

            # ─── (1) PIN tile 3-dots → PIN modal, NOT menu ────────
            page.click(f'[data-testid="apps-directory-modal-tile-menu-{pin_id}"]')
            page.wait_for_timeout(400)
            if not page.locator(f'[data-testid="tile-pin-modal-{pin_id}"]').count():
                failures.append("PIN tile 3-dots did not open the PIN modal")
            if page.locator(f'[data-testid="apps-directory-modal-tile-menu-panel-{pin_id}"]').count():
                failures.append("PIN tile menu panel visible without PIN — regression!")
            page.screenshot(path=str(APP_ROOT / "memory" / "v58_13_132g5_01_pin_prompt.png"), full_page=False)

            # ─── (b) Wrong PIN → shake, no menu ─────────────────────
            # v58.13.132g7 — Do NOT hammer Stephen's PIN — the shared
            # admin_console_pin_attempts collection locks his header
            # admin console AND every tile 3-dots gate. Source pins in
            # tests/test_v58_13_132g5_3dots_pin_gate.py cover this
            # branch when the target account is Stephen's.
            if ADMIN_EMAIL == "stephen@paneltec.com.au":
                print("(info) skipping wrong-PIN branch — source pins cover it. "
                      "See memory/test_credentials.md for the standing rule.")
            else:
                _type_pin(page, pin_id, "9876")
                page.wait_for_timeout(1200)
                if not page.locator(f'[data-testid="tile-pin-error-{pin_id}"]').count():
                    failures.append("wrong-PIN attempt on 3-dots showed no inline error")
                if page.locator(f'[data-testid="apps-directory-modal-tile-menu-panel-{pin_id}"]').count():
                    failures.append("menu panel opened after wrong PIN — regression!")
            page.click(f'[data-testid="tile-pin-close-{pin_id}"]')
            page.wait_for_timeout(200)

            # ─── (3) Reopen 3-dots → PIN modal opens again ────────
            page.click(f'[data-testid="apps-directory-modal-tile-menu-{pin_id}"]')
            page.wait_for_timeout(400)
            if not page.locator(f'[data-testid="tile-pin-modal-{pin_id}"]').count():
                failures.append("PIN modal did NOT reopen on second 3-dots click")
            page.click(f'[data-testid="tile-pin-close-{pin_id}"]')
            page.wait_for_timeout(200)

            # ─── (4) Non-PIN tile 3-dots → menu opens directly ────
            page.click(f'[data-testid="apps-directory-modal-tile-menu-{open_id}"]')
            page.wait_for_timeout(400)
            if page.locator(f'[data-testid="tile-pin-modal-{open_id}"]').count():
                failures.append("non-PIN tile popped a PIN modal — regression!")
            if not page.locator(f'[data-testid="apps-directory-modal-tile-menu-panel-{open_id}"]').count():
                failures.append("non-PIN tile 3-dots did not open the menu directly")
            page.screenshot(path=str(APP_ROOT / "memory" / "v58_13_132g5_02_non_pin_menu.png"), full_page=False)

            browser.close()
    finally:
        _cleanup(h, ids)

    print("\n=== v58.13.132g5 3-dots PIN-gate verification ===")
    print(f"failures {len(failures)}")
    for f in failures: print(f"  - {f}")
    if failures:
        print("STATUS: FAIL")
        return 1
    print("STATUS: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())

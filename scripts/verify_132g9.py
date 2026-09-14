"""v58.13.132g9 — Playwright verification: org-wide hide + restore.

Rolls up:
  · .132g7 lockout-UI countdown (guarded — no wrong-PIN attempts
    against Stephen's account per memory/test_credentials.md).
  · .132g8 restore PIN gate.
  · .132g9 org-wide hide (server field) + Show hidden toggle.

Assertions (Stephen has an admin PIN, so 3-dots + footer render):
  1. Admin hides a tile via 3-dots → PIN modal → correct PIN → tile
     disappears from the modal grid AND a second browser context
     (fresh page load, same admin) also sees it gone. Proves the
     hide is org-wide, not per-session.
  2. Footer shows "Show hidden tiles" button (admin + hasAdminPin).
  3. Clicking Show hidden pops PIN modal → correct PIN → hidden
     tile reappears in the grid AND the 3-dots menu on that tile
     shows "Restore" instead of "Hide".
  4. Clicking Restore from the 3-dots menu (already PIN-gated by
     .132g6, so no second modal at that step) → the tile leaves
     the "hidden set" and Back-to-visible-only shows it in default
     view.
  5. Standing-rule guard: NO wrong-PIN attempts issued for Stephen.
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
# NOTE: real admin PIN — validated in memory/test_credentials.md.
# NEVER submit anything other than this against Stephen's account
# (see .132g7 standing rule).
ADMIN_PIN = os.environ.get("ADMIN_PIN", "3310")


def _login() -> dict:
    r = requests.post(f"{API}/auth/login",
                        json={"email": ADMIN_EMAIL, "password": ADMIN_PWD},
                        timeout=30)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _seed(h: dict, stamp: str) -> str:
    r = requests.post(
        f"{API}/org/url-tiles", headers=h, timeout=30,
        json={
            "label": f".132g9-tile-{stamp}",
            "url": f"https://example.com/g9/{stamp}",
            "icon": "🌐", "enabled": True, "pin_protected": False,
        },
    )
    r.raise_for_status()
    return r.json()["id"]


def _cleanup(h: dict, tid: str) -> None:
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
    page.evaluate(
        "() => window.dispatchEvent(new CustomEvent('paneltec:open-apps-directory'))",
    )
    page.wait_for_selector('[data-testid="apps-directory-modal"]', timeout=8_000)
    for _ in range(30):
        if page.locator('[data-testid="apps-directory-modal-grid"]').count():
            return
        page.wait_for_timeout(200)


def _type_pin(page, tid: str, pin: str) -> None:
    for d in pin:
        page.click(f'[data-testid="tile-pin-key-{tid}-{d}"]')


def main() -> int:
    failures: list[str] = []
    stamp = uuid.uuid4().hex[:6]
    h = _login()
    tid = _seed(h, stamp)
    print(f"seeded tile={tid}")

    # Standing-rule guard (see .132g7 memo).
    if ADMIN_EMAIL == "stephen@paneltec.com.au":
        print("(info) wrong-PIN branches SKIPPED (Stephen). "
              "Source pins in tests/test_v58_13_132g9_org_wide_hide.py "
              "cover the negative paths.")

    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            ctx = browser.new_context(viewport={"width": 1440, "height": 900})
            page = ctx.new_page()
            _cover_login(page)
            page.goto(DASHBOARD, wait_until="networkidle")
            _open_launcher(page)
            # Wait for the admin-console/status probe → 3-dots renders.
            page.wait_for_timeout(600)

            tile_sel = f'[data-testid="apps-directory-modal-tile-{tid}"]'
            menu_btn = f'[data-testid="apps-directory-modal-tile-menu-{tid}"]'
            hide_btn = f'[data-testid="apps-directory-modal-tile-menu-hide-{tid}"]'
            restore_btn = f'[data-testid="apps-directory-modal-tile-menu-restore-{tid}"]'
            pin_modal = f'[data-testid="tile-pin-modal-{tid}"]'
            footer = '[data-testid="apps-directory-modal-footer"]'
            show_all_btn = '[data-testid="apps-directory-modal-show-all"]'

            # ─── Precondition: tile visible + 3-dots rendered ─────
            if not page.locator(tile_sel).count():
                failures.append(f"seeded tile {tid} not visible on initial grid")
            if not page.locator(menu_btn).count():
                failures.append("3-dots button missing (admin PIN probe failed?)")

            # ─── (1) Hide via 3-dots → PIN → tile disappears ──────
            page.click(menu_btn)
            page.wait_for_timeout(400)
            if not page.locator(pin_modal).count():
                failures.append("3-dots click did not open the PIN modal")
            _type_pin(page, tid, ADMIN_PIN)
            page.wait_for_timeout(1500)  # verify-pin round trip
            # Menu panel should be open now.
            if not page.locator(hide_btn).count():
                failures.append("Hide item missing from 3-dots menu after PIN unlock")
            page.click(hide_btn)
            page.wait_for_timeout(1500)  # PATCH + refetch
            if page.locator(tile_sel).count():
                failures.append("tile still visible after hide + refetch")
            page.screenshot(path=str(APP_ROOT / "memory" / "v58_13_132g9_01_after_hide.png"),
                              full_page=False)

            # ─── Verify via API (defensive) ───────────────────────
            gr = requests.get(f"{API}/org/url-tiles", headers=h, timeout=15)
            gr.raise_for_status()
            visible_ids = [t["id"] for t in gr.json()["tiles"]]
            if tid in visible_ids:
                failures.append("backend GET still lists hidden tile in default response")
            gr_inc = requests.get(f"{API}/org/url-tiles?include_hidden=true",
                                    headers=h, timeout=15)
            gr_inc.raise_for_status()
            inc_rows = {t["id"]: t for t in gr_inc.json()["tiles"]}
            if tid not in inc_rows or not inc_rows[tid]["hidden"]:
                failures.append("include_hidden=true did not surface the hidden tile")

            # ─── (2) org-wide check: fresh browser context ────────
            ctx2 = browser.new_context(viewport={"width": 1440, "height": 900})
            page2 = ctx2.new_page()
            _cover_login(page2)
            page2.goto(DASHBOARD, wait_until="networkidle")
            _open_launcher(page2)
            page2.wait_for_timeout(600)
            if page2.locator(tile_sel).count():
                failures.append("second browser context still sees the hidden tile "
                                "— hide is NOT org-wide")
            ctx2.close()

            # ─── (3) Footer + PIN-gated Show hidden reveal ────────
            if not page.locator(footer).count():
                failures.append("footer missing (admin+PIN gate misfiring)")
            if not page.locator(show_all_btn).count():
                failures.append("Show hidden tiles button missing from footer")
            page.click(show_all_btn)
            page.wait_for_timeout(400)
            # The footer PIN modal reuses TilePinModal with the FIRST tile's id
            # (`tiles[0].id`) as its label anchor. Discover which tile modal opened
            # by scanning open modals.
            first_visible_or_hidden = page.evaluate(
                "() => [...document.querySelectorAll('[data-testid^=\"tile-pin-modal-\"]')]"
                ".map(n => n.getAttribute('data-testid'))",
            )
            if not first_visible_or_hidden:
                failures.append("Show hidden did not open a PIN modal")
            else:
                pin_target = first_visible_or_hidden[0].replace("tile-pin-modal-", "")
                _type_pin(page, pin_target, ADMIN_PIN)
                page.wait_for_timeout(1500)
                # Hidden tile now reappears; menu shows Restore.
                if not page.locator(tile_sel).count():
                    failures.append("hidden tile did NOT reappear after Show hidden unlock")
                page.screenshot(path=str(APP_ROOT / "memory" / "v58_13_132g9_02_show_hidden.png"),
                                  full_page=False)

            # ─── (4) Restore via 3-dots menu → default view ───────
            page.click(menu_btn)
            page.wait_for_timeout(400)
            # menu is PIN-gated, so the modal opens again.
            _type_pin(page, tid, ADMIN_PIN)
            page.wait_for_timeout(1500)
            if not page.locator(restore_btn).count():
                failures.append("Restore item missing from 3-dots menu on hidden tile")
            else:
                page.click(restore_btn)
                page.wait_for_timeout(1500)

            # After restore + refetch (loadTiles(showHidden)), the
            # tile is visible with `hidden:false`. Reload the modal
            # to confirm it shows in the DEFAULT view.
            page.evaluate("() => window.dispatchEvent(new CustomEvent('paneltec:close-apps-directory'))")
            page.wait_for_timeout(300)
            _open_launcher(page)
            page.wait_for_timeout(600)
            if not page.locator(tile_sel).count():
                failures.append("restored tile missing from default (non-hidden) view")
            page.screenshot(path=str(APP_ROOT / "memory" / "v58_13_132g9_03_after_restore.png"),
                              full_page=False)

            browser.close()
    finally:
        _cleanup(h, tid)

    print("\n=== v58.13.132g9 org-wide hide/restore verification ===")
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

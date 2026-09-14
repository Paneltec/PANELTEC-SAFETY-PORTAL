"""v58.13.132g3 — Playwright verification for the LAUNCHER MODAL.

`.132g1` shipped 3-dots + reorder + PIN on the standalone
`/apps-directory` page but missed `<AppsDirectoryModal />` — the
launcher modal actually opened from the sidebar. Stephen sent a
screenshot of 10 plain "LAUNCH X" tiles with none of the new
affordances. `.132g3` extracts the tile primitives into
`components/apps-directory/TileCard.jsx` and wires the modal
through them. This script asserts that on the modal specifically.

Flow:
  1. Log in as Stephen.
  2. Seed 3 tiles via API (2 plain, 1 pin_protected).
  3. Open the launcher modal by firing the same CustomEvent the
     sidebar entry uses (`paneltec:open-apps-directory`).
  4. Assert every seeded tile has a `-menu-` button visible.
  5. Open menu on tile A → confirm Open + Copy URL + Hide.
  6. Hide tile B → row disappears from the grid, sessionStorage
     carries the id.
  7. PATCH /reorder [B, A, PIN] via API (Playwright drag on
     @dnd-kit is fiddly and the endpoint is the same one the
     frontend uses on drop) → reopen modal → assert new order.
  8. PIN tile: lock overlay present, 3-dots visible, click Unlock
     → PIN modal opens (portalled). Wrong PIN → shake + inline
     error, no navigation.
  9. Print STATUS.
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


def _login_api() -> dict:
    r = requests.post(f"{API}/auth/login",
                        json={"email": ADMIN_EMAIL, "password": ADMIN_PWD},
                        timeout=30)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _seed(h: dict, stamp: str) -> list[str]:
    ids = []
    for i, seed in enumerate([
        {"label": f".132g3-A-{stamp}", "url": f"https://example.com/a/{stamp}",
         "icon": "🅰", "enabled": True, "pin_protected": False},
        {"label": f".132g3-B-{stamp}", "url": f"https://example.com/b/{stamp}",
         "icon": "🅱", "enabled": True, "pin_protected": False},
        {"label": f".132g3-PIN-{stamp}", "url": f"https://example.com/pin/{stamp}",
         "icon": "🔒", "enabled": True, "pin_protected": True},
    ]):
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


def _open_launcher(page):
    """Fire the same CustomEvent the sidebar entry uses so we don't
    depend on the sidebar's collapse state or a click surface."""
    page.evaluate("() => window.dispatchEvent(new CustomEvent('paneltec:open-apps-directory'))")
    page.wait_for_selector('[data-testid="apps-directory-modal"]', timeout=8_000)
    # Wait for the tiles fetch to resolve — grid mounts after
    # loading. Empty-state also uses a different testid, so a
    # bounded wait for either is enough.
    for _ in range(30):
        if page.locator('[data-testid="apps-directory-modal-grid"]').count() or \
           page.locator('[data-testid="apps-directory-modal-empty"]').count():
            return
        page.wait_for_timeout(200)


def main() -> int:
    failures: list[str] = []
    stamp = uuid.uuid4().hex[:6]
    h = _login_api()
    ids = _seed(h, stamp)
    a_id, b_id, pin_id = ids
    print(f"seeded launcher tiles: {ids}")

    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            ctx = browser.new_context(viewport={"width": 1440, "height": 900})
            page = ctx.new_page()
            _cover_login(page)
            page.goto(DASHBOARD, wait_until="networkidle")

            _open_launcher(page)
            for tid in ids:
                if not page.locator(f'[data-testid="apps-directory-modal-tile-{tid}"]').count():
                    failures.append(f"launcher modal missing tile {tid}")

            # (a) 3-dots visible on every tile.
            for tid in ids:
                sel = f'[data-testid="apps-directory-modal-tile-menu-{tid}"]'
                if not page.locator(sel).count():
                    failures.append(f"launcher modal tile {tid} missing 3-dots menu")

            # (b) menu items present on tile A.
            page.click(f'[data-testid="apps-directory-modal-tile-menu-{a_id}"]')
            page.wait_for_timeout(200)
            for slot in ("open", "copy", "hide"):
                if not page.locator(f'[data-testid="apps-directory-modal-tile-menu-{slot}-{a_id}"]').count():
                    failures.append(f"launcher modal missing menu item {slot!r} on tile A")
            page.screenshot(path=str(APP_ROOT / "memory" / "v58_13_132g3_01_modal_menu.png"), full_page=False)

            # (c) Hide tile B via menu → row disappears + sessionStorage carries id.
            page.click(f'[data-testid="apps-directory-modal-tile-menu-{b_id}"]')
            page.wait_for_timeout(200)
            page.click(f'[data-testid="apps-directory-modal-tile-menu-hide-{b_id}"]')
            page.wait_for_timeout(400)
            if page.locator(f'[data-testid="apps-directory-modal-tile-{b_id}"]').count():
                failures.append("launcher modal: tile B still visible after Hide")
            stored = page.evaluate("""
() => {
  const keys = Object.keys(sessionStorage);
  const hit = keys.find(k => k.startsWith('hidden_tiles_'));
  return hit ? sessionStorage.getItem(hit) : null;
}
""")
            if not stored or b_id not in stored:
                failures.append(f"launcher modal: sessionStorage missing hidden tile B — {stored!r}")

            # (d) PIN tile: lock overlay + 3-dots + Unlock modal.
            pin_tile_sel = f'[data-testid="apps-directory-modal-tile-{pin_id}"]'
            if not page.locator(f'[data-testid="apps-directory-modal-tile-lock-overlay-{pin_id}"]').count():
                failures.append("launcher modal: PIN tile missing lock overlay")
            data_attr = page.locator(pin_tile_sel).first.get_attribute("data-pin-protected")
            if data_attr != "true":
                failures.append(f"launcher modal: PIN tile data-pin-protected={data_attr!r}, expected 'true'")
            if not page.locator(f'[data-testid="apps-directory-modal-tile-menu-{pin_id}"]').is_visible():
                failures.append("launcher modal: 3-dots not visible on PIN-protected tile")

            unlock_btn = page.locator(f'[data-testid="apps-directory-modal-tile-unlock-{pin_id}"]')
            if not unlock_btn.count():
                failures.append("launcher modal: PIN tile missing Unlock affordance")
            else:
                unlock_btn.first.click()
                try:
                    page.wait_for_selector(f'[data-testid="tile-pin-modal-{pin_id}"]', timeout=5_000)
                    page.screenshot(path=str(APP_ROOT / "memory" / "v58_13_132g3_02_pin_modal.png"), full_page=False)
                except Exception:
                    failures.append("launcher modal: PIN modal did not open on Unlock click")
                # Wrong PIN — shake + inline error, no navigation.
                for d in "9876":
                    page.click(f'[data-testid="tile-pin-key-{pin_id}-{d}"]')
                page.wait_for_timeout(1500)
                if not page.locator(f'[data-testid="tile-pin-error-{pin_id}"]').count():
                    failures.append("launcher modal: wrong-PIN attempt showed no inline error")
                if not page.locator(f'[data-testid="tile-pin-modal-{pin_id}"]').count():
                    failures.append("launcher modal: PIN modal closed on wrong PIN (should stay)")
                page.click(f'[data-testid="tile-pin-close-{pin_id}"]')
                page.wait_for_timeout(200)

            # (e) Reorder — same PATCH endpoint as .132g1 (frontend
            # fires it on drop). Confirm the new order sticks in the modal.
            new_order = [b_id, a_id, pin_id]
            r = requests.patch(f"{API}/org/url-tiles/reorder", headers=h,
                                 json={"tile_ids": new_order}, timeout=15)
            if r.status_code != 200:
                failures.append(f"reorder PATCH failed: {r.status_code} {r.text}")
            # Close modal, clear session hide, RELOAD so
            # `useHiddenTiles` re-initialises from the (now empty)
            # sessionStorage (state doesn't sync from external
            # clears; a fresh mount does).
            page.click('[data-testid="apps-directory-modal-close"]')
            page.wait_for_timeout(200)
            page.evaluate("() => sessionStorage.clear()")
            page.reload(wait_until="networkidle")
            _open_launcher(page)
            grid_order = page.evaluate("""
() => {
  // Outer tile cards are the ONLY elements that carry BOTH
  // data-approved-for-me AND data-pin-protected attributes.
  const tiles = Array.from(document.querySelectorAll(
    '[data-testid^="apps-directory-modal-tile-"][data-approved-for-me][data-pin-protected]'
  ));
  return tiles.map(el => el.dataset.testid.replace('apps-directory-modal-tile-', ''));
}
""")
            seeded_positions = [g for g in grid_order if g in set(ids)]
            if seeded_positions != new_order:
                failures.append(f"launcher modal grid after reorder: expected {new_order}, got {seeded_positions}")

            browser.close()
    finally:
        _cleanup(h, ids)

    print("\n=== v58.13.132g3 launcher modal verification ===")
    print(f"tiles seeded: {len(ids)} · failures: {len(failures)}")
    for f in failures:
        print(f"  - {f}")
    if failures:
        print("STATUS: FAIL")
        return 1
    print("STATUS: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())

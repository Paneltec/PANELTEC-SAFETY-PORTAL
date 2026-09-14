"""v58.13.132g4 — Playwright verification: human-like drag on the
Apps Directory launcher modal.

`.132g3` scripted the reorder via the PATCH endpoint directly — that
proved the API but not the browser drag pipeline. Stephen's real
report: "i cant drag the tils around". This script exercises the
DOM drag path end-to-end using slow, human-cadenced mouse moves:

  1. Log in as Stephen · seed 3 disposable tiles.
  2. Open the launcher modal (via CustomEvent).
  3. Assert the prominent drag handle is rendered on each tile.
  4. Locate the seeded tiles A and B (their positions in the grid).
  5. `page.mouse.move(handle A) → mouse.down() → 5 slow intermediate
     moves toward tile B → mouse.up()`.
  6. Assert the seeded tile order changed in the DOM.
  7. Reload the page. Reopen the launcher.
  8. Assert the new order still holds — i.e. the drop actually
     persisted via PATCH /reorder, not just re-rendered locally.
  9. Menu-copy pins: click 3-dots on a tile, assert the new labels
     `"Actions for this tile"` (via aria-label / title on trigger)
     and `"Hide from my view (until logout)"` (in the menu panel).
"""
from __future__ import annotations

import os
import re
import sys
import time
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
    for i in range(3):
        r = requests.post(
            f"{API}/org/url-tiles", headers=h,
            json={"label": f".132g4-tile-{stamp}-{i}",
                  "url": f"https://example.com/{stamp}/{i}",
                  "icon": "🔧", "enabled": True, "pin_protected": False},
            timeout=30,
        )
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


def _grid_order(page, seeded: set[str]) -> list[str]:
    """Return the ordered ids of seeded tiles currently in the grid.
    Uses the two data-* attributes that only the OUTER tile card
    carries (children never have both)."""
    order = page.evaluate("""
() => Array.from(document.querySelectorAll(
  '[data-testid^="apps-directory-modal-tile-"][data-approved-for-me][data-pin-protected]'
)).map(el => el.dataset.testid.replace('apps-directory-modal-tile-', ''))
""")
    return [tid for tid in order if tid in seeded]


def _center(page, testid: str):
    box = page.locator(f'[data-testid="{testid}"]').first.bounding_box()
    if not box:
        return None
    return (box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)


def _slow_drag(page, from_sel: str, to_sel: str, steps: int = 6) -> bool:
    src = _center(page, from_sel)
    dst = _center(page, to_sel)
    if src is None or dst is None:
        return False
    sx, sy = src
    tx, ty = dst
    page.mouse.move(sx, sy)
    page.mouse.down()
    # First micro-move to break the PointerSensor `distance: 3` threshold.
    page.mouse.move(sx + 4, sy + 2)
    time.sleep(0.05)
    for k in range(1, steps + 1):
        page.mouse.move(sx + (tx - sx) * (k / steps),
                          sy + (ty - sy) * (k / steps))
        time.sleep(0.05)
    page.mouse.up()
    return True


def main() -> int:
    failures: list[str] = []
    stamp = uuid.uuid4().hex[:6]
    h = _login_api()
    ids = _seed(h, stamp)
    seeded = set(ids)
    print(f"seeded: {ids}")

    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            ctx = browser.new_context(viewport={"width": 1440, "height": 900})
            page = ctx.new_page()
            _cover_login(page)
            page.goto(DASHBOARD, wait_until="networkidle")

            _open_launcher(page)

            # Every seeded tile must render.
            for tid in ids:
                if not page.locator(f'[data-testid="apps-directory-modal-tile-{tid}"]').count():
                    failures.append(f"tile {tid} missing from modal")

            # Prominent drag handle must be present on every tile.
            for tid in ids:
                sel = f'apps-directory-modal-tile-drag-{tid}'
                if not page.locator(f'[data-testid="{sel}"]').is_visible():
                    failures.append(f"drag handle not visible on tile {tid}")

            # Menu copy pins.
            page.click(f'[data-testid="apps-directory-modal-tile-menu-{ids[0]}"]')
            page.wait_for_timeout(250)
            panel = page.locator(f'[data-testid="apps-directory-modal-tile-menu-panel-{ids[0]}"]')
            if not panel.count():
                failures.append("menu panel did not open")
            else:
                panel_text = panel.first.text_content() or ""
                if "Hide from my view" not in panel_text:
                    failures.append(f"menu missing new Hide label — panel text: {panel_text[:120]}")
                if "Only affects your view" not in panel_text:
                    failures.append("menu missing sub-label 'Only affects your view'")
            # Trigger tooltip / aria-label rewrite.
            menu_trigger = page.locator(f'[data-testid="apps-directory-modal-tile-menu-{ids[0]}"]')
            tooltip = menu_trigger.first.get_attribute("title")
            aria = menu_trigger.first.get_attribute("aria-label")
            if tooltip != "Actions for this tile":
                failures.append(f"trigger tooltip is {tooltip!r}, expected 'Actions for this tile'")
            if aria != "Actions for this tile":
                failures.append(f"trigger aria-label is {aria!r}")
            # Close menu — click the trigger again to toggle
            # (Escape would dismiss the whole modal via the
            # AppsDirectoryModal's global Escape handler).
            page.click(f'[data-testid="apps-directory-modal-tile-menu-{ids[0]}"]')
            page.wait_for_timeout(200)

            # Human-like drag: pick the FIRST-in-grid seeded tile and
            # drop it AFTER the LAST-in-grid seeded tile.
            before = _grid_order(page, seeded)
            print(f"grid before drag: {before}")
            if len(before) < 2:
                failures.append(f"expected >=2 seeded tiles in grid, got {before}")
            else:
                from_id = before[0]
                to_id = before[-1]
                ok = _slow_drag(page,
                    f'apps-directory-modal-tile-drag-{from_id}',
                    f'apps-directory-modal-tile-{to_id}',
                    steps=6)
                if not ok:
                    failures.append("bounding_box lookup failed for drag endpoints")
                page.wait_for_timeout(700)
                after = _grid_order(page, seeded)
                print(f"grid after drag:  {after}")
                if after == before:
                    failures.append(
                        f"drag did NOT change grid order — from {before} to {after}. "
                        "PointerSensor distance may still be too high, or the "
                        "drag handle listeners aren't wired.")

                # Persistence check — reload, reopen, confirm order sticks.
                page.evaluate("() => sessionStorage.clear()")
                page.reload(wait_until="networkidle")
                _open_launcher(page)
                persisted = _grid_order(page, seeded)
                print(f"grid after reload: {persisted}")
                if persisted != after:
                    failures.append(
                        f"drag did not persist across reload — expected {after}, "
                        f"got {persisted}")

            page.screenshot(path=str(APP_ROOT / "memory" / "v58_13_132g4_launcher.png"),
                             full_page=False)
            browser.close()
    finally:
        _cleanup(h, ids)

    print("\n=== v58.13.132g4 launcher drag verification ===")
    print(f"seeded {len(ids)} tiles · failures {len(failures)}")
    for f in failures: print(f"  - {f}")
    if failures:
        print("STATUS: FAIL")
        return 1
    print("STATUS: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())

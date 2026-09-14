"""v58.13.132ga — Playwright verification: hide/restore audit trail.

UI round-trip:
  1. Log in as admin, open the Apps Directory launcher modal.
  2. Hide a seed tile via 3-dots → PIN.
  3. Show hidden tiles via footer → PIN, and restore the tile via
     the 3-dots menu (still PIN-gated by .132g6).
  4. Query `archive_audit` via the same admin credentials (Mongo
     direct — the collection has no HTTP surface yet) and confirm
     one `tile_hidden` row and one `tile_restored` row exist for
     the seeded tile, with the correct denormalised fields.

Guarded per memory/test_credentials.md: NO wrong-PIN attempts
against Stephen's account.
"""
from __future__ import annotations

import asyncio
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
BE_ENV = APP_ROOT / "backend" / ".env"
_env = {}
for m in re.finditer(r"(?m)^([A-Z_][A-Z0-9_]*)=(.+)$", BE_ENV.read_text()):
    _env[m.group(1)] = m.group(2).strip().strip('"').strip("'")
MONGO_URL = _env.get("MONGO_URL") or os.environ.get("MONGO_URL")
DB_NAME = _env.get("DB_NAME") or os.environ.get("DB_NAME")
LOGIN_URL = f"{BASE_URL}/"
DASHBOARD = f"{BASE_URL}/app/dashboard"
API = f"{BASE_URL}/api"
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "stephen@paneltec.com.au")
ADMIN_PWD = os.environ.get("ADMIN_PWD", "Mcgstephen50#")
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
            "label": f".132ga-{stamp}",
            "url": f"https://example.com/ga/{stamp}",
            "icon": "🌐", "enabled": True,
        },
    )
    r.raise_for_status()
    return r.json()["id"]


def _cleanup(h: dict, tid: str) -> None:
    try: requests.delete(f"{API}/org/url-tiles/{tid}", headers=h, timeout=10)
    except Exception: pass


def _audit_rows(tid: str) -> list[dict]:
    import pymongo

    client = pymongo.MongoClient(MONGO_URL)
    db = client[DB_NAME]
    rows = list(db.archive_audit.find(
        {"resource_id": tid, "module": "org_url_tiles"},
    ))
    client.close()
    return rows


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

    if ADMIN_EMAIL == "stephen@paneltec.com.au":
        print("(info) wrong-PIN branches SKIPPED (Stephen); "
              "source pins cover the negatives.")

    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            ctx = browser.new_context(viewport={"width": 1440, "height": 900})
            page = ctx.new_page()
            _cover_login(page)
            page.goto(DASHBOARD, wait_until="networkidle")
            _open_launcher(page)
            page.wait_for_timeout(600)

            menu_btn = f'[data-testid="apps-directory-modal-tile-menu-{tid}"]'
            hide_btn = f'[data-testid="apps-directory-modal-tile-menu-hide-{tid}"]'
            restore_btn = f'[data-testid="apps-directory-modal-tile-menu-restore-{tid}"]'

            # ─── Hide via 3-dots → PIN → hide item ────────────────
            if not page.locator(menu_btn).count():
                failures.append("3-dots button missing")
            page.click(menu_btn)
            page.wait_for_timeout(400)
            _type_pin(page, tid, ADMIN_PIN)
            page.wait_for_timeout(1500)
            if not page.locator(hide_btn).count():
                failures.append("Hide item not present after PIN unlock")
            page.click(hide_btn)
            page.wait_for_timeout(1500)  # PATCH + refetch

            # ─── Audit row present for tile_hidden ────────────────
            rows = _audit_rows(tid)
            hides = [r for r in rows if r["action"] == "tile_hidden"]
            if len(hides) != 1:
                failures.append(
                    f"expected 1 tile_hidden audit row after Hide; "
                    f"got {len(hides)} rows out of {len(rows)} total")
            elif not hides[0].get("pin_verified"):
                failures.append("tile_hidden row missing pin_verified:true marker")
            elif hides[0].get("tile_name") != f".132ga-{stamp}":
                failures.append(
                    f"tile_hidden row tile_name mismatch: "
                    f"got {hides[0].get('tile_name')!r}")

            page.screenshot(path=str(APP_ROOT / "memory" / "v58_13_132ga_01_after_hide.png"),
                              full_page=False)

            # ─── Show hidden + Restore via 3-dots → PIN ───────────
            page.click('[data-testid="apps-directory-modal-show-all"]')
            page.wait_for_timeout(400)
            # Discover which tile's PIN modal opened (footer uses tiles[0]).
            open_pins = page.evaluate(
                "() => [...document.querySelectorAll('[data-testid^=\"tile-pin-modal-\"]')]"
                ".map(n => n.getAttribute('data-testid'))",
            )
            if not open_pins:
                failures.append("Show hidden did not open a PIN modal")
            else:
                pt = open_pins[0].replace("tile-pin-modal-", "")
                _type_pin(page, pt, ADMIN_PIN)
                page.wait_for_timeout(1500)

            page.click(menu_btn)
            page.wait_for_timeout(400)
            _type_pin(page, tid, ADMIN_PIN)
            page.wait_for_timeout(1500)
            if not page.locator(restore_btn).count():
                failures.append("Restore item not present after Show hidden + PIN")
            else:
                page.click(restore_btn)
                page.wait_for_timeout(1500)  # PATCH + refetch

            # ─── Audit row present for tile_restored ──────────────
            rows2 = _audit_rows(tid)
            restores = [r for r in rows2 if r["action"] == "tile_restored"]
            if len(restores) != 1:
                failures.append(
                    f"expected 1 tile_restored audit row after Restore; "
                    f"got {len(restores)} rows out of {len(rows2)} total")
            elif not restores[0].get("pin_verified"):
                failures.append("tile_restored row missing pin_verified:true marker")

            page.screenshot(path=str(APP_ROOT / "memory" / "v58_13_132ga_02_after_restore.png"),
                              full_page=False)
            browser.close()
    finally:
        _cleanup(h, tid)

    print("\n=== v58.13.132ga hide/restore audit-trail verification ===")
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

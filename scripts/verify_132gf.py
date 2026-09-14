"""v58.13.132gf — Deferred flips + GridFS upload/download smoke.

Two UI flips + one storage round-trip:
  1. `Ask Intelligence` tile now renders as a disabled button with
     the "Coming soon" tooltip.
  2. `Live Dashboard` tile now renders as a disabled button with
     the "You're here." tooltip.
  3. Backend curl smoke: any migrated renewals blob is served by
     the `/api/files/renewals/<token>/<name>` endpoint from GridFS
     (post-migration).

Guarded per memory/test_credentials.md — no wrong-PIN attempts.
"""
from __future__ import annotations

import asyncio
import os
import re
import sys
from pathlib import Path

import requests
from playwright.sync_api import sync_playwright

APP_ROOT = Path(__file__).resolve().parents[1]
BASE_URL = re.search(
    r"REACT_APP_BACKEND_URL=(.+)",
    (APP_ROOT / "frontend" / ".env").read_text(),
).group(1).strip()
BE_ENV = APP_ROOT / "backend" / ".env"
_env: dict[str, str] = {}
for m in re.finditer(r"(?m)^([A-Z_][A-Z0-9_]*)=(.+)$", BE_ENV.read_text()):
    _env[m.group(1)] = m.group(2).strip().strip('"').strip("'")
MONGO_URL = _env.get("MONGO_URL") or os.environ.get("MONGO_URL")
DB_NAME = _env.get("DB_NAME") or os.environ.get("DB_NAME")
LOGIN_URL = f"{BASE_URL}/"
DASHBOARD = f"{BASE_URL}/app/dashboard"
API = f"{BASE_URL}/api"
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "stephen@paneltec.com.au")
ADMIN_PWD = os.environ.get("ADMIN_PWD", "Mcgstephen50#")


def _cover_login(page) -> None:
    page.goto(LOGIN_URL, wait_until="networkidle")
    page.wait_for_selector('[data-testid="cover-email"]', timeout=15_000)
    page.fill('[data-testid="cover-email"]', ADMIN_EMAIL)
    page.fill('[data-testid="cover-password"]', ADMIN_PWD)
    page.click('[data-testid="cover-submit"]')
    page.wait_for_url(re.compile(r"/(app|apps-directory)"), timeout=15_000)


def _find_migrated_renewal_key() -> tuple[str, str] | None:
    import pymongo
    client = pymongo.MongoClient(MONGO_URL)
    db = client[DB_NAME]
    doc = db.upload_storage.files.find_one({"metadata.subdir": "renewals"})
    client.close()
    if not doc: return None
    parts = doc["metadata"]["parts"]
    return parts[0], parts[1]


def main() -> int:
    failures: list[str] = []

    # ─── Backend: GridFS-served renewal file ───────────────────
    hit = _find_migrated_renewal_key()
    if hit:
        token, name = hit
        r = requests.get(
            f"{API}/files/renewals/{token}/{name}",
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=30,
        )
        if r.status_code != 200:
            failures.append(
                f"GridFS-served renewal HTTP {r.status_code}: {r.text[:120]}")
        elif not len(r.content):
            failures.append("GridFS-served renewal body empty")
        else:
            print(f"(info) GridFS renewal served OK · "
                  f"{len(r.content)} bytes · {r.headers.get('content-type')}")
    else:
        print("(info) no migrated renewal blobs — GridFS serve check "
              "skipped. Run scripts/migrate_ephemeral_to_gridfs.py --run "
              "first if you have local files to sweep.")

    # ─── UI: flipped tiles render disabled with tooltip ────────
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        _cover_login(page)
        page.goto(DASHBOARD, wait_until="networkidle")
        page.wait_for_selector(
            '[data-testid="platform-overview-interactive"]', timeout=8_000,
        )

        for tid, expected_tooltip in (
            ("platform-overview-module-ask",     "Coming soon"),
            ("platform-overview-output-live",    "You're here."),
        ):
            tile = page.locator(f'[data-testid="{tid}"]').first
            if not tile.count():
                failures.append(f"tile {tid} missing")
                continue
            is_disabled = tile.evaluate("el => el.disabled")
            if not is_disabled:
                failures.append(f"tile {tid} must be disabled after .132gf")
            title_attr = tile.get_attribute("title") or ""
            if expected_tooltip not in title_attr:
                failures.append(
                    f"tile {tid} tooltip {title_attr!r} does not contain "
                    f"{expected_tooltip!r}")
            marker = page.locator(
                f'[data-testid="{tid}-disabled-marker"]').first
            if not marker.count():
                failures.append(
                    f"tile {tid} missing disabled marker")
        page.screenshot(
            path=str(APP_ROOT / "memory" / "v58_13_132gf_01_flipped_tiles.png"),
            full_page=False,
        )
        browser.close()

    print("\n=== v58.13.132gf uploads-to-gridfs + deferred flips ===")
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

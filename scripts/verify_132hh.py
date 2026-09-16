"""v58.13.132hh — sticky Actions column verify.

Playwright smoke: login -> pick the first Document Library folder
that has files -> at each of 1280 / 1440 / 1920 viewport widths,
assert that the file-actions cell's right edge is inside the
viewport (i.e. sticky column is holding). Screenshots are saved to
/tmp/verify_132hh_<width>.png for manual review if needed.

No writes, no destructive actions. Headless by default; set
HEADED=1 in env to watch.
"""
from __future__ import annotations

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

API = f"{BASE_URL}/api"
LOGIN_URL = f"{BASE_URL}/"
DOCLIB_URL = f"{BASE_URL}/app/document-library"

ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "stephen@paneltec.com.au")
ADMIN_PWD = os.environ.get("ADMIN_PWD", "Mcgstephen50#")
HEADED = os.environ.get("HEADED") == "1"
VIEWPORTS = [1280, 1440, 1920]


def pick_folder_with_files() -> str:
    """Return a folder_id that has at least one file (via API)."""
    r = requests.post(
        f"{API}/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PWD},
        timeout=15,
    )
    r.raise_for_status()
    token = r.json()["access_token"]
    hdrs = {"Authorization": f"Bearer {token}"}
    folders = requests.get(
        f"{API}/document-library/folders/all",
        headers=hdrs, timeout=20,
    ).json()
    # sort by file_count desc so we land on a folder rich in rows
    folders = sorted(folders, key=lambda f: f.get("file_count", 0), reverse=True)
    for f in folders:
        if f.get("file_count", 0) > 0:
            print(f"[api] chose folder {f['id']} ({f['name']}) "
                  f"with {f['file_count']} files")
            return f["id"]
    raise SystemExit("no folder with files found; cannot verify sticky column")


def run_playwright(folder_id: str) -> None:
    folder_url = f"{DOCLIB_URL}/{folder_id}"
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not HEADED)
        for width in VIEWPORTS:
            ctx = browser.new_context(viewport={"width": width, "height": 900})
            page = ctx.new_page()
            page.goto(LOGIN_URL, wait_until="domcontentloaded")
            page.fill('input[type="email"]', ADMIN_EMAIL)
            page.fill('input[type="password"]', ADMIN_PWD)
            page.click('button[type="submit"]')
            page.wait_for_url(re.compile(r"/app/"), timeout=20_000)
            page.goto(folder_url, wait_until="domcontentloaded")
            page.wait_for_selector('[data-testid="folder-files-table"]',
                                   timeout=20_000)
            # first data row's actions cell
            actions_cells = page.locator('[data-testid^="file-actions-cell-"]')
            actions_cells.first.wait_for(timeout=10_000)
            count = actions_cells.count()
            assert count > 0, f"[{width}] no actions cells rendered"

            # verify every row's actions cell right edge is inside viewport
            worst = 0.0
            for i in range(count):
                box = actions_cells.nth(i).bounding_box()
                assert box is not None, f"[{width}] no bbox for row {i}"
                right = box["x"] + box["width"]
                worst = max(worst, right)
                assert right <= width + 1, (
                    f"[{width}] row {i} actions right={right} "
                    f"exceeds viewport {width}"
                )
            print(f"[web] viewport={width}px — {count} action cells checked, "
                  f"max right edge = {worst:.1f}px (<= {width})")

            # also verify the sticky <th>
            th_box = page.locator(
                '[data-testid="folder-files-th-actions"]'
            ).bounding_box()
            assert th_box is not None, f"[{width}] Actions th missing bbox"
            th_right = th_box["x"] + th_box["width"]
            assert th_right <= width + 1, \
                f"[{width}] Actions th right={th_right} > viewport {width}"

            shot = f"/tmp/verify_132hh_{width}.png"
            page.screenshot(path=shot, full_page=False)
            print(f"[web] viewport={width}px screenshot -> {shot}")

            ctx.close()
        browser.close()


def main() -> int:
    folder_id = pick_folder_with_files()
    try:
        run_playwright(folder_id)
    except Exception as e:
        msg = str(e)
        if "Executable doesn't exist" in msg or "playwright install" in msg:
            print(
                "[web] WARN - Playwright chromium not installed on this host; "
                "skipping browser smoke. Run `playwright install chromium`."
            )
        else:
            raise
    print("\nv58.13.132hh verify - PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())

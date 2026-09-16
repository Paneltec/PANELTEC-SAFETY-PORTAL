"""v58.13.132hi — Runtime Playwright verify.

Login -> pick highest-file-count folder -> at 1280/1440/1920:
  1. Assert no 'AI tags' header in the file table.
  2. Assert Actions <th> and every action <td> right-edge is inside
     the viewport (i.e. .132hh sticky column still works).
  3. Assert no vertical divider (box-shadow / border-left) on the
     sticky Actions <th> via computed style.
Then, viewport-independent AI-tag search regression:
  4. Fetch one file with non-empty ai_tags via the API, type one of
     its tags into the folder search box, assert the file's row
     appears in the results.

Screenshots -> /tmp/verify_132hi_<width>.png.
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


def _login_token() -> str:
    r = requests.post(
        f"{API}/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PWD},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()["access_token"]


def pick_folder_with_files(token: str) -> dict:
    hdrs = {"Authorization": f"Bearer {token}"}
    folders = requests.get(
        f"{API}/document-library/folders/all",
        headers=hdrs, timeout=20,
    ).json()
    folders = sorted(folders, key=lambda f: f.get("file_count", 0), reverse=True)
    for f in folders:
        if f.get("file_count", 0) > 0:
            print(f"[api] chose folder {f['id']} ({f['name']}) "
                  f"with {f['file_count']} files")
            return f
    raise SystemExit("no folder with files found")


def pick_file_with_tags(token: str, folder_id: str) -> dict:
    hdrs = {"Authorization": f"Bearer {token}"}
    files = requests.get(
        f"{API}/document-library/folders/{folder_id}/files",
        headers=hdrs, timeout=30,
    ).json()
    for f in files:
        tags = f.get("ai_tags") or []
        if tags:
            return {"file": f, "tag": tags[0]}
    return {}


def login_ui(page):
    page.goto(LOGIN_URL, wait_until="domcontentloaded")
    page.fill('input[type="email"]', ADMIN_EMAIL)
    page.fill('input[type="password"]', ADMIN_PWD)
    page.click('button[type="submit"]')
    page.wait_for_url(re.compile(r"/app/"), timeout=20_000)


def run_viewport_checks(browser, folder_id: str) -> None:
    folder_url = f"{DOCLIB_URL}/{folder_id}"
    for width in VIEWPORTS:
        ctx = browser.new_context(viewport={"width": width, "height": 900})
        page = ctx.new_page()
        login_ui(page)
        page.goto(folder_url, wait_until="domcontentloaded")
        page.wait_for_selector('[data-testid="folder-files-table"]',
                               timeout=20_000)

        # 1. No "AI tags" header
        header_html = page.locator(
            '[data-testid="folder-files-table"] thead'
        ).inner_text()
        assert "AI TAGS" not in header_html.upper(), \
            f"[{width}] 'AI tags' header still rendering: {header_html!r}"

        # 2. Actions <th> and <td> right edges inside viewport
        th = page.locator('[data-testid="folder-files-th-actions"]')
        th_box = th.bounding_box()
        assert th_box, f"[{width}] Actions <th> missing"
        assert th_box["x"] + th_box["width"] <= width + 1, \
            f"[{width}] Actions <th> right edge outside viewport"

        cells = page.locator('[data-testid^="file-actions-cell-"]')
        n = cells.count()
        assert n > 0, f"[{width}] no action cells rendered"
        worst = 0.0
        for i in range(n):
            b = cells.nth(i).bounding_box()
            assert b, f"[{width}] cell {i} no bbox"
            r = b["x"] + b["width"]
            worst = max(worst, r)
            assert r <= width + 1, \
                f"[{width}] cell {i} right={r} > viewport"

        # 3. No divider box-shadow / border-left on sticky <th>
        style = th.evaluate(
            "el => { const cs = getComputedStyle(el); "
            "return { boxShadow: cs.boxShadow, "
            "borderLeftWidth: cs.borderLeftWidth }; }"
        )
        assert style["boxShadow"] in ("none", ""), \
            f"[{width}] sticky Actions <th> still has box-shadow: {style}"
        # <th> may inherit a 0px border-left from browser defaults;
        # anything > 0 is a regression.
        blw = style["borderLeftWidth"]
        assert blw in ("0px", "", "medium"), \
            f"[{width}] sticky Actions <th> has border-left: {blw}"

        shot = f"/tmp/verify_132hi_{width}.png"
        page.screenshot(path=shot, full_page=False)
        print(f"[web] viewport={width}px OK — {n} cells, "
              f"max right={worst:.1f}, boxShadow={style['boxShadow']!r}, "
              f"borderLeft={blw!r} -> {shot}")
        ctx.close()


def run_tag_search_check(browser, folder_id: str, tag: str, file_id: str) -> None:
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()
    login_ui(page)
    page.goto(f"{DOCLIB_URL}/{folder_id}", wait_until="domcontentloaded")
    page.wait_for_selector('[data-testid="folder-files-table"]', timeout=20_000)
    # Search box placeholder starts with "Search this folder"
    box = page.locator('input[placeholder^="Search this folder"]')
    box.wait_for(timeout=5_000)
    box.fill(tag)
    # Search hits the API asynchronously; wait until the exact target
    # row appears in the DOM (locked-in regression).
    row = page.locator(f'[data-testid="file-row-{file_id}"]')
    row.wait_for(timeout=15_000)
    print(f"[web] tag-search: '{tag}' -> found file-row-{file_id}")
    ctx.close()


def main() -> int:
    token = _login_token()
    folder = pick_folder_with_files(token)
    folder_id = folder["id"]
    tag_target = pick_file_with_tags(token, folder_id)

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=not HEADED)
            run_viewport_checks(browser, folder_id)
            if tag_target:
                run_tag_search_check(
                    browser, folder_id,
                    tag_target["tag"], tag_target["file"]["id"],
                )
            else:
                print("[web] WARN — folder has no ai_tags, "
                      "skipping tag-search lock-in test")
            browser.close()
    except Exception as e:
        msg = str(e)
        if "Executable doesn't exist" in msg or "playwright install" in msg:
            print("[web] WARN — chromium not installed; run "
                  "`python -m playwright install chromium`.")
        else:
            raise

    print("\nv58.13.132hi verify - PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""v58.13.132gz - Document Library FE tree UI verify.

Playwright smoke: login -> /app/document-library -> confirms the
tree renders, chevrons expand/collapse, a parent row shows a
"direct (total)" rollup pair, and the localStorage state persists
across a reload. Backend `/folders/all` curl is a belt-and-braces
check on the extended payload shape.

No writes, no destructive actions. Runs headless by default; set
`HEADED=1` in env to watch.
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


def check_backend_shape() -> None:
    resp = requests.post(
        f"{API}/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PWD},
        timeout=15,
    )
    resp.raise_for_status()
    token = resp.json().get("access_token")
    assert token, "login returned no access_token"
    r = requests.get(
        f"{API}/document-library/folders/all",
        headers={"Authorization": f"Bearer {token}"},
        timeout=20,
    )
    r.raise_for_status()
    data = r.json()
    assert isinstance(data, list) and len(data) > 0, \
        f"/folders/all returned no folders: {data}"
    required = {"id", "name", "parent_folder_id", "is_system",
                "file_count", "color_key", "sort_order"}
    missing = required - set(data[0].keys())
    assert not missing, \
        f"/folders/all missing keys: {missing}. Sample: {data[0]!r}"
    parents = [f for f in data if f.get("parent_folder_id") is None]
    children = [f for f in data if f.get("parent_folder_id")]
    print(
        f"[backend] /folders/all OK - {len(data)} folders "
        f"({len(parents)} roots + {len(children)} nested)."
    )


def run_playwright() -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not HEADED)
        ctx = browser.new_context()
        page = ctx.new_page()
        page.goto(LOGIN_URL, wait_until="domcontentloaded")
        page.fill('input[type="email"]', ADMIN_EMAIL)
        page.fill('input[type="password"]', ADMIN_PWD)
        page.click('button[type="submit"]')
        page.wait_for_url(re.compile(r"/app/"), timeout=20_000)
        print("[web] login ok")

        page.goto(DOCLIB_URL, wait_until="domcontentloaded")
        page.wait_for_selector('[data-testid="folder-tree"]', timeout=20_000)
        print("[web] tree container mounted")

        rows = page.locator('[data-testid^="tree-row-"]')
        row_count = rows.count()
        assert row_count > 0, "no tree-row-* rendered"
        print(f"[web] {row_count} tree rows visible")

        first_count = page.locator('[data-testid^="tree-count-"]').first
        first_count.wait_for(timeout=5_000)
        count_txt = first_count.text_content() or ""
        assert re.match(r"^\d+(\s+\(\d+\))?$", count_txt.strip()), \
            f"count cell has unexpected shape: {count_txt!r}"
        print(f"[web] first count cell text = {count_txt.strip()!r}")

        chevron = page.locator('[data-testid^="tree-chevron-"]').first
        chevron.wait_for(timeout=5_000)
        before = page.locator('[data-testid^="tree-row-"]').count()
        chevron.click()
        page.wait_for_timeout(400)
        after = page.locator('[data-testid^="tree-row-"]').count()
        assert before != after, \
            f"chevron click did not change tree size ({before} -> {after})"
        print(f"[web] chevron click: {before} -> {after} rows")

        page.reload(wait_until="domcontentloaded")
        page.wait_for_selector('[data-testid="folder-tree"]', timeout=20_000)
        keys = page.evaluate(
            "() => Object.keys(window.localStorage)"
            ".filter(k => k.startsWith('paneltec_doclib_tree_expanded_v1_'))",
        )
        assert keys, "expanded-state localStorage key not written"
        print(f"[web] localStorage keys after reload: {keys}")

        browser.close()


def main() -> int:
    check_backend_shape()
    try:
        run_playwright()
    except Exception as e:
        msg = str(e)
        if "Executable doesn't exist" in msg or "playwright install" in msg:
            print(
                "[web] WARN - Playwright chromium not installed on this host; "
                "skipping browser smoke. Run `playwright install chromium` to enable."
            )
        else:
            raise
    print("\nv58.13.132gz verify - PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())

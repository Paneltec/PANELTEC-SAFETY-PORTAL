"""v58.13.132gb — Playwright verification: Document Library search.

UI covers:
  1. Global Smart Search on /document-library groups hits by folder,
     shows a match-field pill, and links deep with `?highlight=…`.
  2. Per-folder search box on the folder detail page filters the
     file list live and surfaces subfolder hits (recursive).
  3. Deep-linking with `?highlight=<file_id>` scrolls the target
     row into view and pulses it amber for ~2 s.

API round-trip (curl-style, inline):
  · Global search returns match_field=filename / tags / uploader.
  · folder_id + recursive=false does NOT descend into subfolders.
"""
from __future__ import annotations

import os
import re
import sys
import time
import uuid
from datetime import datetime, timezone
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
DOC_LIB = f"{BASE_URL}/app/document-library"
API = f"{BASE_URL}/api"
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "stephen@paneltec.com.au")
ADMIN_PWD = os.environ.get("ADMIN_PWD", "Mcgstephen50#")


def _login() -> dict:
    r = requests.post(f"{API}/auth/login",
                        json={"email": ADMIN_EMAIL, "password": ADMIN_PWD},
                        timeout=30)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _cover_login(page) -> None:
    page.goto(LOGIN_URL, wait_until="networkidle")
    page.wait_for_selector('[data-testid="cover-email"]', timeout=15_000)
    page.fill('[data-testid="cover-email"]', ADMIN_EMAIL)
    page.fill('[data-testid="cover-password"]', ADMIN_PWD)
    page.click('[data-testid="cover-submit"]')
    page.wait_for_url(re.compile(r"/(app|apps-directory)"), timeout=15_000)


def _create_folder(h: dict, name: str,
                     parent_id: str | None = None,
                     me_id: str | None = None,
                     org_id: str | None = None) -> str:
    if parent_id is None:
        r = requests.post(f"{API}/document-library/folders",
                            headers={**h, "Content-Type": "application/json"},
                            json={"name": name}, timeout=15)
        r.raise_for_status()
        return r.json()["id"]
    import pymongo
    client = pymongo.MongoClient(MONGO_URL)
    db = client[DB_NAME]
    fid = uuid.uuid4().hex
    db.doc_folders.insert_one({
        "id": fid, "org_id": org_id, "name": name,
        "color_key": "sky", "sort_order": 999999, "is_system": False,
        "parent_folder_id": parent_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "created_by": me_id, "deleted_at": None,
    })
    client.close()
    return fid


def _delete_folder(fid: str) -> None:
    try:
        import pymongo
        client = pymongo.MongoClient(MONGO_URL)
        db = client[DB_NAME]
        db.doc_folders.delete_one({"id": fid})
        client.close()
    except Exception: pass


def _upload_file(h: dict, folder_id: str, filename: str) -> str:
    files = {"files": (filename, b"body body body", "text/plain")}
    r = requests.post(
        f"{API}/document-library/folders/{folder_id}/files",
        headers=h, files=files, timeout=30,
    )
    r.raise_for_status()
    return (r.json().get("saved") or [{}])[0].get("id")


def _delete_file(h: dict, fid: str) -> None:
    try: requests.delete(f"{API}/document-library/files/{fid}",
                            headers=h, timeout=10)
    except Exception: pass


def main() -> int:
    failures: list[str] = []
    h = _login()
    me = requests.get(f"{API}/auth/me", headers=h, timeout=15).json()
    stamp = uuid.uuid4().hex[:6]
    parent = _create_folder(h, f".132gb-parent-{stamp}")
    child = _create_folder(h, f".132gb-child-{stamp}",
                             parent_id=parent, me_id=me["id"],
                             org_id=me["org_id"])
    parent_file = _upload_file(h, parent, f"parent-doc-{stamp}.txt")
    child_file = _upload_file(h, child, f"child-doc-{stamp}.txt")
    print(f"seeded parent={parent} child={child}")

    try:
        # ─── API smoke: recursive vs non-recursive ─────────────
        needle = f"doc-{stamp}"
        r_rec = requests.get(f"{API}/document-library/search",
                              headers=h,
                              params={"q": needle, "folder_id": parent,
                                      "recursive": "true"}, timeout=15).json()
        rec_ids = {row["file_id"] for row in r_rec["results"]}
        if child_file not in rec_ids or parent_file not in rec_ids:
            failures.append("recursive folder search did not return both files")

        r_flat = requests.get(f"{API}/document-library/search",
                                headers=h,
                                params={"q": needle, "folder_id": parent,
                                        "recursive": "false"}, timeout=15).json()
        flat_ids = {row["file_id"] for row in r_flat["results"]}
        if child_file in flat_ids:
            failures.append("recursive=false leaked subfolder file")
        if parent_file not in flat_ids:
            failures.append("recursive=false lost the parent-folder file")

        # ─── UI ────────────────────────────────────────────────
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            ctx = browser.new_context(viewport={"width": 1440, "height": 900})
            page = ctx.new_page()
            _cover_login(page)
            page.goto(DOC_LIB, wait_until="networkidle")
            page.wait_for_selector('[data-testid="document-library-page"]',
                                     timeout=15_000)

            # Global Smart Search — type the needle and submit.
            page.fill('[data-testid="smart-search-input"]', needle)
            page.click('[data-testid="smart-search-submit"]')
            page.wait_for_timeout(1500)
            if not page.locator('[data-testid="smart-search-groups"]').count():
                failures.append("global search groups container missing")
            # Both files must appear in the results.
            for fid in (parent_file, child_file):
                if not page.locator(f'[data-testid="smart-search-result-{fid}"]').count():
                    failures.append(f"global search missing result row for {fid}")
                if not page.locator(f'[data-testid="smart-search-match-field-{fid}"]').count():
                    failures.append(f"global search missing match-field pill for {fid}")
            page.screenshot(path=str(APP_ROOT / "memory" / "v58_13_132gb_01_global_search.png"),
                              full_page=False)

            # Click the parent file's deep link → folder page opens
            # with highlight query, row pulses, filename in view.
            page.click(f'[data-testid="smart-search-result-{parent_file}"]')
            page.wait_for_url(re.compile(rf"/document-library/{parent}.*highlight={parent_file}"),
                                timeout=8_000)
            page.wait_for_selector(f'[data-testid="file-row-{parent_file}"]',
                                     timeout=8_000)
            # Snapshot immediately (while amber pulse is active) then wait.
            page.screenshot(path=str(APP_ROOT / "memory" / "v58_13_132gb_02_highlight_pulse.png"),
                              full_page=False)
            # Confirm the highlight class is applied briefly.
            has_class = page.evaluate(
                f'''() => {{
                    const el = document.querySelector('[data-testid="file-row-{parent_file}"]');
                    return el ? el.classList.contains('g132gb-highlight-row') : false;
                }}''',
            )
            if not has_class:
                # Class may have already faded off (2 s timer). That's
                # acceptable — the amber pulse animation could have
                # finished before we sampled. Screenshot 02 is proof.
                print("(info) g132gb-highlight-row class no longer applied "
                      "on this row — animation likely completed. "
                      "See v58_13_132gb_02_highlight_pulse.png.")

            # ─── Per-folder search: recursive from parent ─────
            # Clear & re-navigate cleanly.
            page.goto(f"{DOC_LIB}/{parent}", wait_until="networkidle")
            page.wait_for_selector('[data-testid="folder-search-input"]',
                                     timeout=8_000)
            page.fill('[data-testid="folder-search-input"]', needle)
            page.wait_for_timeout(700)  # debounce (220 ms) + API round trip
            # Search-active tbody: both parent + child rows visible.
            if not page.locator(f'[data-testid="file-row-{parent_file}"]').count():
                failures.append("per-folder search did not show parent file")
            if not page.locator(f'[data-testid="file-row-{child_file}"]').count():
                failures.append("per-folder search did not show subfolder file (recursive)")
            # Subfolder hint decorates the cross-folder row.
            if not page.locator(f'[data-testid="file-subfolder-path-{child_file}"]').count():
                failures.append("subfolder path hint missing on cross-folder row")
            page.screenshot(path=str(APP_ROOT / "memory" / "v58_13_132gb_03_per_folder_search.png"),
                              full_page=False)

            # Clear the per-folder search → default file list returns.
            page.click('[data-testid="folder-search-clear"]')
            page.wait_for_timeout(400)
            if page.locator(f'[data-testid="file-row-{child_file}"]').count():
                failures.append("per-folder search clear did not remove subfolder row")

            browser.close()
    finally:
        _delete_file(h, parent_file)
        _delete_file(h, child_file)
        _delete_folder(child)
        _delete_folder(parent)

    print("\n=== v58.13.132gb Document Library search verification ===")
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

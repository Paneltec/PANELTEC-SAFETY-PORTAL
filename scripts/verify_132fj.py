"""v58.13.132fj — Section E delete-audit verification.

Flow: log in as admin, open the Document Library, pick any folder
that has files, click the red trash on a file, verify the
confirmation modal has the standard copy, click Confirm, verify
row removed + toast.

The upload/round-trip test is covered by the pytest suite via
Mongo assertion. This Playwright script only proves the
frontend UX contract.
"""
from __future__ import annotations

import os
import re
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

APP_ROOT = Path(__file__).resolve().parents[1]
ENV_TXT = (APP_ROOT / "frontend" / ".env").read_text(encoding="utf-8")
BASE_URL = re.search(r"REACT_APP_BACKEND_URL=(.+)", ENV_TXT).group(1).strip()
LOGIN_URL = f"{BASE_URL}/"
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "stephen@paneltec.com.au")
ADMIN_PWD = os.environ.get("ADMIN_PWD", "Mcgstephen50#")

ARTIFACTS = APP_ROOT / "memory" / "v58_13_132fj_artifacts"
ARTIFACTS.mkdir(parents=True, exist_ok=True)


def _shot(page, name):
    p = ARTIFACTS / f"{name}.png"
    page.screenshot(path=str(p), full_page=False)
    print(f"    → {p.relative_to(APP_ROOT)}")


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        page.on("pageerror", lambda err: print(f"    [pageerror] {err}"))

        # 1) Login.
        print("[1] Login…")
        page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=30_000)
        page.fill('input[type="email"]', ADMIN_EMAIL)
        page.fill('input[type="password"]', ADMIN_PWD)
        page.press('input[type="password"]', "Enter")
        page.wait_for_url(re.compile(r"/app/"), timeout=30_000)

        # 2) Find any existing file in any folder.
        print("[2] Finding an existing file in the library…")
        import urllib.request, urllib.error, json
        UA = "Mozilla/5.0 (X11; Linux x86_64) verify_132fj/1.0"
        login_body = json.dumps({"email": ADMIN_EMAIL, "password": ADMIN_PWD}).encode()
        login_req = urllib.request.Request(
            f"{BASE_URL}/api/auth/login", data=login_body,
            headers={"Content-Type": "application/json", "User-Agent": UA},
            method="POST")
        login_resp = json.loads(urllib.request.urlopen(login_req, timeout=15).read())
        token = login_resp.get("access_token") or login_resp.get("token")
        assert token

        req = urllib.request.Request(
            f"{BASE_URL}/api/document-library/folders",
            headers={"Authorization": f"Bearer {token}", "User-Agent": UA})
        folders = json.loads(urllib.request.urlopen(req, timeout=15).read())
        rows = folders if isinstance(folders, list) else folders.get("folders") or []
        folder_id = None
        for f in rows:
            if (f.get("file_count") or 0) > 0:
                folder_id = f["id"]; break
        assert folder_id, "no folder with files found"

        # Upload a test file first via multipart with 'files' key.
        boundary = "----132fjboundary"
        blob = b"%PDF-1.4\n.132fj playwright test\n%%EOF\n"
        body = (
            f"--{boundary}\r\n"
            f"Content-Disposition: form-data; name=\"files\"; filename=\"pw_132fj.pdf\"\r\n"
            f"Content-Type: application/pdf\r\n\r\n"
        ).encode() + blob + f"\r\n--{boundary}--\r\n".encode()
        upreq = urllib.request.Request(
            f"{BASE_URL}/api/document-library/folders/{folder_id}/files",
            data=body,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": f"multipart/form-data; boundary={boundary}",
                "User-Agent": UA,
            },
            method="POST",
        )
        try:
            up = json.loads(urllib.request.urlopen(upreq, timeout=15).read())
        except urllib.error.HTTPError as e:
            print(f"    upload failed http={e.code}: {e.read()[:200].decode('utf8', 'ignore')}")
            raise
        # POST returns a list of file rows or a single row wrapped.
        if isinstance(up, list):
            file_id = up[0]["id"]
        elif "id" in up:
            file_id = up["id"]
        else:
            files_arr = up.get("saved") or up.get("files") or up.get("uploaded") or []
            file_id = files_arr[0]["id"] if files_arr else None
        assert file_id, f"upload didn't return an id: {up}"
        print(f"    uploaded file_id={file_id}, folder_id={folder_id}")

        # 3) Navigate to the folder.
        print("[3] Opening the folder view…")
        page.goto(f"{BASE_URL}/app/document-library/{folder_id}",
                   wait_until="domcontentloaded", timeout=30_000)
        time.sleep(4)
        _shot(page, "01_folder_view")

        # 4) Click the delete button on our file.
        del_btn = page.locator(f'[data-testid="file-delete-{file_id}"]').first
        assert del_btn.count() > 0, f"delete button for {file_id} not visible"
        del_btn.scroll_into_view_if_needed()
        del_btn.click()
        time.sleep(1)
        _shot(page, "02_confirm_open")

        # 5) Verify the modal has the expected copy.
        modal = page.locator('[data-testid="file-delete-modal"]').first
        assert modal.count() > 0, "confirmation modal did not open"
        modal_text = modal.inner_text()
        assert "Archive" in modal_text and "30 days" in modal_text, (
            f"modal copy missing Archive/30-days language:\n{modal_text}")
        assert "pw_132fj.pdf" in modal_text, "filename not shown in modal"

        # 6) Confirm.
        confirm = page.locator('[data-testid="file-delete-modal-confirm"]').first
        confirm.click()
        time.sleep(3)
        _shot(page, "03_after_delete")

        # 7) Assert row removed.
        after_del = page.locator(f'[data-testid="file-delete-{file_id}"]')
        assert after_del.count() == 0, "row still present after delete"

        print("")
        print("── RESULT ─────────────────────────────────────────────")
        print("  login                        : OK")
        print("  upload via API               : OK")
        print("  folder view opens            : OK")
        print("  delete button visible        : OK")
        print("  confirmation modal opens     : OK")
        print("  modal copy correct           : OK")
        print("  row removed after confirm    : OK")
        print("──────────────────────────────────────────────────────")
        return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except AssertionError as e:
        print(f"\n✗ ASSERTION FAILED: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n✗ UNEXPECTED: {e}")
        sys.exit(1)

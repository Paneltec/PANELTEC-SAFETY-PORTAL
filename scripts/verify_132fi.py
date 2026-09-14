"""v58.13.132fi — Section D · verification.

Flow:
  1. Login as admin (Stephen).
  2. Open Mel's worker edit modal.
  3. Assert Licences panel renders (filtered view over certifications).
  4. Assert Private & Confidential panel renders with drop-zone.
  5. Upload a small test PDF via the hidden <input type=file>.
  6. Assert the new row appears in the P&C table with the right filename.
  7. Click the delete button, confirm the modal, delete → row gone.
  8. Print OK.
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
WORKERS_URL = f"{BASE_URL}/app/settings/workers"
MEL_ID = "47476d38-bc55-4fc7-90c2-7db2b909d692"

ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "stephen@paneltec.com.au")
ADMIN_PWD = os.environ.get("ADMIN_PWD", "Mcgstephen50#")

ARTIFACTS = APP_ROOT / "memory" / "v58_13_132fi_artifacts"
ARTIFACTS.mkdir(parents=True, exist_ok=True)

TEST_FILE = ARTIFACTS / "sample_132fi.pdf"
TEST_FILE.write_bytes(b"%PDF-1.4\n.132fi playwright test\n%%EOF\n")


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
        page.on("console", lambda msg: (
            print(f"    [console.{msg.type}] {msg.text}")
            if msg.type == "error" else None))

        # 1) Login
        print("[1] Login…")
        page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=30_000)
        page.fill('input[type="email"]', ADMIN_EMAIL)
        page.fill('input[type="password"]', ADMIN_PWD)
        page.press('input[type="password"]', "Enter")
        page.wait_for_url(re.compile(r"/app/"), timeout=30_000)

        # 2) Open Mel's edit modal.
        print("[2] Opening Mel's edit modal…")
        page.goto(WORKERS_URL, wait_until="domcontentloaded", timeout=30_000)
        time.sleep(5)
        edit = page.locator(f'[data-testid="edit-{MEL_ID}"]').first
        assert edit.count() > 0, "Mel's edit button not found"
        edit.scroll_into_view_if_needed()
        edit.click()
        time.sleep(3)
        _shot(page, "01_edit_open")

        # 3) Assert Licences panel renders.
        print("[3] Verifying Licences panel renders…")
        lic = page.locator('[data-testid="section-licences"]').first
        assert lic.count() > 0, "Licences panel not rendered"
        lic.scroll_into_view_if_needed()
        time.sleep(1)
        total = page.locator('[data-testid="section-licences-total"]').first
        total_txt = total.inner_text() if total.count() > 0 else "n/a"
        print(f"    licences total badge: {total_txt}")
        _shot(page, "02_licences_panel")

        # 4) Assert P&C panel renders.
        print("[4] Verifying Private & Confidential panel renders…")
        pnc = page.locator('[data-testid="section-private-confidential"]').first
        assert pnc.count() > 0, "P&C panel not rendered"
        pnc.scroll_into_view_if_needed()
        time.sleep(1)
        _shot(page, "03_pnc_panel")
        assert page.locator('[data-testid="pnc-dropzone"]').count() > 0
        count_before_txt = page.locator('[data-testid="section-private-confidential-count"]').first.inner_text()
        print(f"    initial P&C count: {count_before_txt}")

        # 5) Upload via the hidden <input type=file>.
        print("[5] Uploading sample PDF via <input type=file>…")
        file_input = page.locator('[data-testid="pnc-file-input"]').first
        assert file_input.count() > 0
        file_input.set_input_files(str(TEST_FILE))
        time.sleep(3)
        _shot(page, "04_pnc_after_upload")

        # 6) Assert the new row appears.
        rows = page.locator('[data-testid^="pnc-row-"]')
        n_rows = rows.count()
        print(f"    P&C table row count: {n_rows}")
        assert n_rows > 0, "P&C table has no rows after upload"
        # Find the row referencing sample_132fi.pdf.
        target_row = page.locator('[data-testid^="pnc-row-"]', has_text="sample_132fi.pdf").first
        assert target_row.count() > 0, "uploaded row not visible"
        row_testid = target_row.get_attribute("data-testid")
        doc_id = row_testid.replace("pnc-row-", "")
        print(f"    uploaded doc_id = {doc_id}")

        # 7) Delete → confirm modal → confirm.
        print("[6] Deleting uploaded file…")
        delete_btn = page.locator(f'[data-testid="pnc-delete-{doc_id}"]').first
        assert delete_btn.count() > 0
        delete_btn.click()
        time.sleep(1)
        _shot(page, "05_pnc_confirm_open")
        confirm_modal = page.locator('[data-testid="pnc-delete-confirm"]')
        assert confirm_modal.count() > 0, "confirm modal did not open"
        confirm_yes = page.locator('[data-testid="pnc-delete-confirm-yes"]').first
        assert confirm_yes.count() > 0
        confirm_yes.click()
        time.sleep(3)
        _shot(page, "06_pnc_after_delete")
        row_after = page.locator(f'[data-testid="pnc-row-{doc_id}"]')
        assert row_after.count() == 0, "row still present after delete"
        print("    OK — row removed after delete.")

        print("")
        print("── RESULT ─────────────────────────────────────────────")
        print("  login              : OK")
        print("  edit modal open    : OK")
        print("  Licences renders   : OK")
        print("  P&C renders        : OK")
        print("  upload → row       : OK")
        print("  delete → confirm   : OK")
        print("──────────────────────────────────────────────────────")
        return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except AssertionError as e:
        print(f"\n✗ ASSERTION FAILED: {e}")
        sys.exit(1)

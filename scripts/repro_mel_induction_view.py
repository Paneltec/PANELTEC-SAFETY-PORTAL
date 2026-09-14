"""Reproduce Mel Linford's report: "Induction records won't show when I try to view".

Steps:
  1. Login as admin (Stephen).
  2. Navigate to /app/workers.
  3. Open Melinda Linford's worker edit modal.
  4. Expand the Inductions section.
  5. Click on Tas Gas Induction (known to exist per curl).
  6. Verify InductionCardModal opens AND shows the loaded data
     (not a spinner or blank).
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

ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "stephen@paneltec.com.au")
ADMIN_PWD = os.environ.get("ADMIN_PWD", "Mcgstephen50#")

ARTIFACTS = APP_ROOT / "memory" / "v58_13_132fg_repro"
ARTIFACTS.mkdir(parents=True, exist_ok=True)

MEL_ID = "47476d38-bc55-4fc7-90c2-7db2b909d692"


def _shot(page, name):
    p = ARTIFACTS / f"{name}.png"
    page.screenshot(path=str(p), full_page=False)
    print(f"    → {p.relative_to(APP_ROOT)}")


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()

        def log_response(resp):
            if "/inductions" in resp.url or "/workers/" in resp.url:
                if "/inductions/" in resp.url and resp.request.method == "GET":
                    print(f"    [{resp.status}] {resp.request.method} {resp.url}")

        page.on("response", log_response)
        page.on("console", lambda msg: print(f"    [console.{msg.type}] {msg.text}")
                if msg.type in ("error",) else None)
        page.on("pageerror", lambda err: print(f"    [pageerror] {err}"))

        # 1) Login
        print("[1] Login…")
        page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=30_000)
        page.fill('input[type="email"]', ADMIN_EMAIL)
        page.fill('input[type="password"]', ADMIN_PWD)
        page.press('input[type="password"]', "Enter")
        page.wait_for_url(re.compile(r"/app/"), timeout=30_000)
        print(f"    landed {page.url}")

        # 2) Open ANY worker with induction cards.
        print("[2] Opening a worker (edit modal)…")
        page.goto(WORKERS_URL, wait_until="domcontentloaded", timeout=30_000)
        time.sleep(5)
        print(f"    at URL {page.url}")
        _shot(page, "01_workers_list")
        # Print any visible testids for debug.
        all_testids = page.evaluate(
            "() => Array.from(document.querySelectorAll('[data-testid]')).slice(0, 60).map(el => el.getAttribute('data-testid'))")
        print(f"    first 60 testids on page: {all_testids}")
        edit_btns = page.locator('[data-testid^="edit-"]')
        n_edit = edit_btns.count()
        print(f"    {n_edit} edit buttons visible")
        target = page.locator(f'[data-testid="edit-{MEL_ID}"]').first
        if target.count() == 0 and n_edit > 0:
            target = edit_btns.first
            print(f"    Mel not visible — falling back to first edit button")
        if target.count() == 0:
            print("    NO edit buttons visible at all. Aborting.")
            return 1
        target.scroll_into_view_if_needed()
        target.click()
        time.sleep(3)
        _shot(page, "02_edit_modal_open")

        # 3) Find the Inductions section toggle.
        print("[3] Locating Inductions section…")
        sec = page.locator('[data-testid="section-inductions"]')
        if sec.count() == 0:
            # Maybe the drawer opened as view — try to click an "Edit" button.
            print("    section not found — looking for edit button")
            edit_btn = page.locator('button:has-text("Edit")').first
            if edit_btn.count() > 0:
                edit_btn.click()
                time.sleep(2)
                sec = page.locator('[data-testid="section-inductions"]')
        print(f"    section-inductions count = {sec.count()}")
        if sec.count() == 0:
            _shot(page, "02_no_inductions_section")
            print("[FAIL] Inductions section not found. Check screenshot.")
            return 1

        # 4) Locate an induction card. First expand the section
        #    (Section component defaults to closed).
        print("[3.5] Expanding Inductions section…")
        toggle = page.locator('[data-testid="section-inductions-toggle"]').first
        assert toggle.count() > 0, "section-inductions-toggle not found"
        toggle.scroll_into_view_if_needed()
        toggle.click()
        time.sleep(2)
        _shot(page, "03a_inductions_expanded")
        cards = page.locator('[data-testid^="induction-card-"]')
        n = cards.count()
        print(f"    found {n} induction cards")
        if n > 0:
            # Log all card testids to see if tas_gas_induction is there
            for i in range(min(n, 25)):
                tid = cards.nth(i).get_attribute("data-testid")
                print(f"       #{i}: {tid}")
        _shot(page, "03_induction_cards_visible")

        # 5) Click Tas Gas Induction card.
        tas_gas = page.locator('[data-testid="induction-card-tas_gas_induction"]')
        if tas_gas.count() == 0:
            print("[FAIL] Tas Gas Induction card not present")
            _shot(page, "04_tas_gas_missing")
            return 1
        print("[5] Clicking Tas Gas Induction card…")
        tas_gas.first.scroll_into_view_if_needed()
        time.sleep(0.3)
        tas_gas.first.click()
        time.sleep(2)
        _shot(page, "05_after_click")

        # 6) Look for the modal.
        modal = page.locator('[data-testid="induction-card-modal"]')
        add_mode = page.locator('[data-testid="induction-add-mode"]')
        detail = page.locator('[data-testid="induction-detail-view"]')
        loading = page.locator("text=Loading…").first
        print(f"    modal count       = {modal.count()}")
        print(f"    add-mode count    = {add_mode.count()}")
        print(f"    detail-view count = {detail.count()}")
        print(f"    loading indicator = {loading.count()}")
        # Wait a bit more if still loading.
        time.sleep(3)
        _shot(page, "06_final_state")
        modal2 = page.locator('[data-testid="induction-card-modal"]')
        detail2 = page.locator('[data-testid="induction-detail-view"]')
        print(f"    (after 3s) modal={modal2.count()} detail={detail2.count()}")
        if detail2.count() > 0:
            print("[OK] Detail view visible.")
            return 0
        print("[FAIL] Detail view never appeared.")
        # Dump body inner HTML around the modal for debug.
        try:
            body_html = page.locator("body").inner_html()
            idx = body_html.find("induction-card-modal")
            if idx == -1:
                idx = body_html.find("induction-add-mode")
            snippet = body_html[max(0, idx - 200): idx + 1500] if idx >= 0 else "(no modal in DOM)"
            print("    body snippet around modal:")
            print("    " + snippet.replace("\n", "\n    ")[:3000])
        except Exception as e:
            print(f"    dump failed: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())

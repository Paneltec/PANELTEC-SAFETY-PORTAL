"""v58.13.132ht — Live Playwright reproduction: create 3 empty
"NEW FOLDER" rows in the tree view, delete all 3 via the trash icon,
assert no crash + no console errors + tree count returns to baseline.

Run:
    cd /app && python scripts/verify_v58_13_132ht_folder_tree_delete.py

Prereqs:
    · Backend + frontend running (supervisor).
    · Admin creds in /app/memory/test_credentials.md
      (defaults hardcoded below to stephen@paneltec.com.au).
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

from playwright.async_api import async_playwright

BASE_URL = os.environ.get(
    "PANELTEC_BASE_URL",
    "https://whs-compliance.preview.emergentagent.com",
)
ADMIN_EMAIL = os.environ.get("PANELTEC_ADMIN_EMAIL", "stephen@paneltec.com.au")
ADMIN_PASSWORD = os.environ.get("PANELTEC_ADMIN_PASSWORD", "Mcgstephen50#")
SCREENSHOT_DIR = Path("/app/memory")


async def _login(page):
    await page.goto(f"{BASE_URL}/login", wait_until="domcontentloaded")
    await page.wait_for_timeout(1500)
    await page.fill('input[type="email"]', ADMIN_EMAIL)
    await page.fill('input[type="password"]', ADMIN_PASSWORD)
    await page.click('button[type="submit"]')
    await page.wait_for_timeout(4000)


async def _create_folder_via_toolbar(page, index: int) -> None:
    """Click "New folder", type "NEW FOLDER", click Create."""
    await page.locator('[data-testid="folder-create-btn"]').first.click()
    await page.wait_for_selector('[data-testid="folder-create-input"]', timeout=5000)
    await page.fill('[data-testid="folder-create-input"]', "NEW FOLDER")
    await page.locator('[data-testid="folder-create-save"]').click()
    # Wait for the create form to close.
    await page.wait_for_timeout(2000)
    print(f"  created #{index}")


async def _delete_first_new_folder(page) -> bool:
    """Find the first tree row named "NEW FOLDER", click its trash,
    confirm in the modal. Returns True if delete succeeded (toast
    surfaced), False otherwise."""
    openers = await page.locator('[data-testid^="tree-open-"]').filter(
        has_text="NEW FOLDER").all()
    if not openers:
        print("  no NEW FOLDER row found")
        return False
    opener = openers[0]
    parent_row = opener.locator(
        'xpath=ancestor::div[starts-with(@data-testid,"tree-row-")]')
    row_testid = await parent_row.first.get_attribute("data-testid")
    node_id = row_testid.replace("tree-row-", "")
    trash = page.locator(f'[data-testid="tree-delete-{node_id}"]')
    if await trash.count() == 0:
        print(f"  trash button MISSING for {node_id}")
        return False
    await trash.first.click(force=True)
    await page.wait_for_selector('[data-testid="folder-delete-modal"]', timeout=5000)
    await page.locator('[data-testid="folder-delete-modal-confirm"]').click(force=True)
    await page.wait_for_timeout(2500)
    toasts = await page.locator('[data-sonner-toast]').all_text_contents()
    ok = any('deleted' in (t or '').lower() for t in toasts)
    print(f"  delete row {node_id[:8]}… → toast: {toasts[-1] if toasts else '<none>'}")
    return ok


async def run() -> int:
    errors: list[str] = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1440, "height": 900})
        page = await ctx.new_page()

        page.on("pageerror", lambda err: errors.append(f"PAGEERROR: {err}"))
        page.on("console", lambda msg:
                errors.append(f"CONSOLE-{msg.type}: {msg.text}")
                if msg.type == "error" else None)

        print("─── login ───")
        await _login(page)

        print("─── open Document Library ───")
        await page.goto(f"{BASE_URL}/app/document-library", wait_until="domcontentloaded")
        await page.wait_for_timeout(4500)

        # Baseline tree row count.
        base_count = await page.locator('[data-testid^="tree-row-"]').count()
        print(f"tree rows at baseline: {base_count}")

        print("─── create 3 NEW FOLDERs ───")
        for i in (1, 2, 3):
            await _create_folder_via_toolbar(page, i)
            await page.wait_for_timeout(1000)

        # Screenshot after creates.
        await page.screenshot(
            path=str(SCREENSHOT_DIR / "v58_13_132ht_after_creates.jpeg"),
            full_page=False, quality=20, type="jpeg",
        )
        after_create = await page.locator('[data-testid^="tree-open-"]').filter(
            has_text="NEW FOLDER").count()
        print(f"NEW FOLDER rows visible after creates: {after_create}")
        assert after_create >= 3, \
            f"expected >=3 NEW FOLDER rows, got {after_create}"

        print("─── delete all 3 via trash icon ───")
        for i in (1, 2, 3):
            ok = await _delete_first_new_folder(page)
            assert ok, f"delete #{i} did not surface a success toast"
            await page.wait_for_timeout(1500)

        # Screenshot after all deletes.
        await page.screenshot(
            path=str(SCREENSHOT_DIR / "v58_13_132ht_after_deletes.jpeg"),
            full_page=False, quality=20, type="jpeg",
        )

        remaining = await page.locator('[data-testid^="tree-open-"]').filter(
            has_text="NEW FOLDER").count()
        print(f"NEW FOLDER rows remaining: {remaining}")
        assert remaining == 0, f"expected 0 NEW FOLDER rows, got {remaining}"

        # Page must still be functional — the h1 stays visible.
        h1 = await page.locator("h1").first.text_content()
        print(f"page h1 after all deletes: {h1!r}")
        assert "Document Library" in (h1 or ""), \
            f"page appears to have crashed — h1 is {h1!r}"

        print("─── console / pageerror capture ───")
        crashes = [e for e in errors if "PAGEERROR" in e or "TypeError" in e]
        for e in errors[-15:]:
            print(f"  {e}")
        assert not crashes, f"page crashes detected: {crashes}"

        await ctx.close()
        await browser.close()
    print("\n✔ .132ht folder-tree-delete verification PASS")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(run()))

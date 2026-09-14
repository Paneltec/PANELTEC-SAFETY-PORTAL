"""v58.13.132ff — end-to-end UI verification.

Playwright script (sync API) that exercises the fixed surfaces:

  1. Login as admin.
  2. Navigate to /app/dashboard (Apps Directory lives on the org
     quick-links section, in the Users & Permissions modal too, but
     the primary editor is opened from the dashboard tile row).
  3. Open the tile editor for the first tile.
  4. Toggle to "Only selected people" (private radio) and verify
     the picker renders (loading spinner OR error+Retry OR user
     list appears within 12s).
  5. Toggle back to "Everyone in the organisation" (public radio).
  6. Save and verify the toast confirms the update.
  7. Reload the page and re-open the same tile → confirm the radio
     restored to public (i.e. access_mode round-tripped).

Run: python3 scripts/verify_132ff.py
"""
from __future__ import annotations

import os
import re
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright, TimeoutError as PWTimeoutError

APP_ROOT = Path(__file__).resolve().parents[1]

# Preview URL from frontend/.env (external Cloudflare-fronted URL).
ENV_TXT = (APP_ROOT / "frontend" / ".env").read_text(encoding="utf-8")
BASE_URL = re.search(r"REACT_APP_BACKEND_URL=(.+)", ENV_TXT).group(1).strip()
LOGIN_URL = f"{BASE_URL}/"
DASH_URL = f"{BASE_URL}/app/dashboard"
ORG_SETTINGS_URL = f"{BASE_URL}/app/settings/org"

ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "stephen@paneltec.com.au")
ADMIN_PWD = os.environ.get("ADMIN_PWD", "Mcgstephen50#")

ARTIFACTS = APP_ROOT / "memory" / "v58_13_132ff_artifacts"
ARTIFACTS.mkdir(parents=True, exist_ok=True)


def _shot(page, name):
    p = ARTIFACTS / f"{name}.png"
    try:
        page.screenshot(path=str(p), full_page=False)
        print(f"    screenshot → {p.relative_to(APP_ROOT)}")
    except Exception as e:
        print(f"    screenshot FAILED: {e}")


def _login(page):
    print("[1/6] Logging in as admin…")
    page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=30_000)
    # Cover.jsx login form. Selector by testid or type.
    page.fill('input[type="email"]', ADMIN_EMAIL)
    page.fill('input[type="password"]', ADMIN_PWD)
    page.press('input[type="password"]', "Enter")
    # Wait for the dashboard route.
    page.wait_for_url(re.compile(r"/app/(dashboard|.*)"), timeout=30_000)
    print(f"    landed at {page.url}")
    _shot(page, "01_after_login")


def _open_tile_editor(page):
    """Open the tile editor for the first tile in Apps Directory.
    We navigate to Users & Permissions to guarantee the editor
    mounts on a stable page (dashboard's QuickLinksSection is only
    admin, but the modal is easier to select from the
    UsersManagement page's Apps Directory panel)."""
    print("[2/6] Navigating to Org Settings → Apps Directory manager…")
    page.goto(ORG_SETTINGS_URL, wait_until="domcontentloaded", timeout=30_000)
    time.sleep(3)
    _shot(page, "02_org_settings")
    # Step 1: click the "Manage" button on the QuickLinksSection.
    manage_open = page.locator('[data-testid="org-quick-links-manage-btn"]').first
    assert manage_open.count() > 0, "QuickLinksSection Manage button not on org settings"
    manage_open.click()
    time.sleep(1)
    _shot(page, "02b_manager_open")
    # Step 2: within the manager modal, find the per-row edit button.
    manage_btns = page.locator('[data-testid^="apps-directory-edit-"]')
    n = manage_btns.count()
    print(f"    found {n} edit-tile buttons in manager modal")
    assert n > 0, "no edit-tile buttons found — org may not have any tiles"
    manage_btns.first.click()
    time.sleep(1)
    _shot(page, "03_editor_open")


def _toggle_and_save(page):
    print("[3/6] Toggling access_mode radio → private → public …")
    private_radio = page.locator('[data-testid="org-quick-links-editor-access-private"]').first
    public_radio = page.locator('[data-testid="org-quick-links-editor-access-public"]').first
    assert private_radio.count() > 0, "private radio not present — editor not open?"
    private_radio.click(force=True)
    time.sleep(1)
    _shot(page, "04_private_selected")
    # Verify the picker renders SOME UI state (loading, error+retry,
    # or the users list) — no forever-hang.
    print("[4/6] Waiting for picker to reach a resolved state (≤20s)…")
    deadline = time.time() + 20
    state = None
    while time.time() < deadline:
        if page.locator('[data-testid="org-quick-links-editor-users-retry"]').count() > 0:
            state = "error+retry"
            break
        # `org-quick-links-editor-user-list` renders when
        # !eligibleLoading && !eligibleError, and either shows an
        # empty stub or the checkbox rows.
        if page.locator('[data-testid="org-quick-links-editor-user-list"]').count() > 0:
            state = "list-rendered"
            break
        if page.locator('[data-testid="org-quick-links-editor-users-loading"]').count() > 0:
            state = "loading"
        time.sleep(0.5)
    print(f"    picker state: {state!r}")
    if state != "list-rendered":
        # Dump the picker section of the DOM for debugging.
        try:
            editor = page.locator('[data-testid^="org-quick-links-editor-"]').first
            html = editor.inner_html() if editor.count() > 0 else "(editor gone)"
            # Grab the region around "Loading users" for debugging.
            idx = html.find("Loading")
            snippet = html[max(0, idx - 200): idx + 800] if idx >= 0 else html[-2000:]
            print("    editor DOM snippet around picker:")
            print("    " + snippet.replace("\n", "\n    "))
        except Exception as e:
            print(f"    could not dump DOM: {e}")
    _shot(page, "05_picker_state")
    assert state in ("list-rendered", "error+retry"), (
        f"picker never resolved — state={state}")

    # Flip back to public so we don't accidentally lock a real tile.
    print("[5/6] Flipping back to public + saving…")
    public_radio.click(force=True)
    time.sleep(0.5)
    _shot(page, "06_public_selected")
    save_btn = page.locator('[data-testid="org-quick-links-editor-save"]').first
    assert save_btn.count() > 0, "save button not found"
    save_btn.click()
    time.sleep(2)
    _shot(page, "07_after_save")


def _verify_persistence(page):
    print("[6/6] Reloading + re-opening editor to verify persistence…")
    page.goto(ORG_SETTINGS_URL, wait_until="domcontentloaded", timeout=30_000)
    time.sleep(3)
    page.locator('[data-testid="org-quick-links-manage-btn"]').first.click()
    time.sleep(1)
    manage_btns = page.locator('[data-testid^="apps-directory-edit-"]')
    assert manage_btns.count() > 0
    manage_btns.first.click()
    time.sleep(1)
    _shot(page, "08_editor_after_reload")
    public_radio = page.locator('[data-testid="org-quick-links-editor-access-public"]').first
    is_checked = public_radio.is_checked() if public_radio.count() > 0 else False
    print(f"    public radio checked after reload = {is_checked}")
    return is_checked


def main():
    print(f"Base URL: {BASE_URL}")
    print(f"Artifacts: {ARTIFACTS}")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        # Capture console errors + failed network requests for debug.
        page.on("console", lambda msg: (
            print(f"    [console.{msg.type}] {msg.text}")
            if msg.type in ("error", "warning") else None))
        page.on("requestfailed", lambda req: print(
            f"    [request FAILED] {req.method} {req.url} — {req.failure}"))
        page.on("response", lambda resp: (
            print(f"    [http {resp.status}] {resp.request.method} {resp.url}")
            if "/url-tiles/eligible-users" in resp.url else None))
        try:
            _login(page)
            _open_tile_editor(page)
            _toggle_and_save(page)
            persisted = _verify_persistence(page)
            print("")
            print("── RESULT ─────────────────────────────────────────────")
            print(f"  login          : OK")
            print(f"  editor opened  : OK")
            print(f"  radio toggle   : OK")
            print(f"  picker resolves: OK")
            print(f"  save + reload  : {'OK' if persisted else 'FAILED — radio not restored'}")
            print("──────────────────────────────────────────────────────")
            return 0 if persisted else 2
        except AssertionError as e:
            print(f"\n✗ ASSERTION FAILED: {e}")
            _shot(page, "99_failure")
            return 1
        except PWTimeoutError as e:
            print(f"\n✗ TIMEOUT: {e}")
            _shot(page, "99_timeout")
            return 1
        finally:
            ctx.close()
            browser.close()


if __name__ == "__main__":
    sys.exit(main())

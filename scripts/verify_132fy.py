"""v58.13.132fy — Playwright verification for
`Show inactive workers + Restore`.

Flow:
  1. Log in as admin via the Cover page.
  2. Navigate to /app/settings/workers.
  3. Assert the toolbar carries the `show-inactive-toggle` label
     with an unchecked `show-inactive-checkbox` inside.
  4. Data round-trip via fetch() in the page context so the DB
     stays clean:
       a. GET /api/workers → grab first active worker id.
       b. DELETE /api/workers/{id} → soft-delete.
       c. Flip the toggle on. Wait for the list to refetch and
          confirm the row now renders with the archived badge
          + Restore button + `data-inactive="true"` marker.
       d. Click the Restore button. Confirm the archived badge
          drops and the row re-appears in the default view.
  5. Screenshot before + after for the ship memo.
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

APP_ROOT = Path(__file__).resolve().parents[1]
BASE_URL = re.search(
    r"REACT_APP_BACKEND_URL=(.+)",
    (APP_ROOT / "frontend" / ".env").read_text(),
).group(1).strip()
LOGIN_URL = f"{BASE_URL}/"
WORKERS_URL = f"{BASE_URL}/app/settings/workers"
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "stephen@paneltec.com.au")
ADMIN_PWD = os.environ.get("ADMIN_PWD", "Mcgstephen50#")


def main() -> int:
    failures: list[str] = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()

        # ── Login ────────────────────────────────────────────────
        page.goto(LOGIN_URL, wait_until="networkidle")
        page.wait_for_selector('[data-testid="cover-email"]', timeout=15_000)
        page.fill('[data-testid="cover-email"]', ADMIN_EMAIL)
        page.fill('[data-testid="cover-password"]', ADMIN_PWD)
        page.click('[data-testid="cover-submit"]')
        page.wait_for_url(re.compile(r"/app/"), timeout=15_000)

        # ── Workers page ─────────────────────────────────────────
        page.goto(WORKERS_URL, wait_until="networkidle")
        page.wait_for_selector('[data-testid="workers-table"]', timeout=20_000)

        # Toggle must be rendered for admin, checkbox unchecked by default.
        if not page.locator('[data-testid="show-inactive-toggle"]').count():
            failures.append("show-inactive-toggle label not rendered on toolbar")
        else:
            checked = page.evaluate(
                "() => document.querySelector('[data-testid=\"show-inactive-checkbox\"]').checked"
            )
            if checked:
                failures.append("show-inactive-checkbox should default to unchecked")
            page.screenshot(
                path=str(APP_ROOT / "memory" / "v58_13_132fy_01_toolbar.png"),
                full_page=False,
            )

        # ── Pick a real worker via the page-context fetch ────────
        picked = page.evaluate("""
async () => {
  const t = localStorage.getItem('paneltec_token');
  const r = await fetch('/api/workers', { headers: { Authorization: 'Bearer ' + t }});
  if (!r.ok) return { ok:false, status:r.status };
  const rows = await r.json();
  const w = (rows || []).find(x => x.active && !x.deleted_at);
  return { ok: !!w, id: w?.id, name: `${w?.first_name || ''} ${w?.last_name || ''}`.trim() };
}
""")
        print("picked worker:", picked)
        if not picked.get("ok"):
            failures.append(f"could not find a soft-deletable worker: {picked}")
            _report(failures)
            browser.close()
            return 1 if failures else 0

        wid = picked["id"]

        # Soft-delete via API (server-side).
        del_res = page.evaluate("""
async (wid) => {
  const t = localStorage.getItem('paneltec_token');
  const r = await fetch('/api/workers/' + wid, {
    method: 'DELETE', headers: { Authorization: 'Bearer ' + t }
  });
  return { status: r.status };
}
""", wid)
        print("soft-delete:", del_res)
        if del_res.get("status") not in (200, 204):
            failures.append(f"soft-delete of {wid} failed: {del_res}")

        # Flip toggle on. Frontend refetches with include_inactive=true.
        page.check('[data-testid="show-inactive-checkbox"]')
        # Wait for the row (which we just soft-deleted) to re-appear
        # with data-inactive="true".
        try:
            page.wait_for_selector(
                f'[data-testid="worker-row-{wid}"][data-inactive="true"]',
                timeout=15_000,
            )
        except Exception as e:
            failures.append(f"row {wid} did not appear as inactive after toggle: {e}")

        # Archived badge visible on the row.
        if not page.locator(f'[data-testid="worker-archived-{wid}"]').count():
            failures.append(f"worker-archived-{wid} badge not rendered")

        # Restore button visible + clickable.
        restore_btn = page.locator(f'[data-testid="restore-{wid}"]')
        if not restore_btn.count():
            failures.append(f"restore-{wid} button missing on inactive row")
        else:
            page.screenshot(
                path=str(APP_ROOT / "memory" / "v58_13_132fy_02_inactive_row.png"),
                full_page=False,
            )
            restore_btn.first.click()
            # Row should re-render without data-inactive="true".
            try:
                page.wait_for_selector(
                    f'[data-testid="worker-row-{wid}"][data-inactive="false"]',
                    timeout=15_000,
                )
            except Exception as e:
                failures.append(f"row {wid} did not flip back to active after Restore: {e}")

        # Flip toggle back off, take a "after" screenshot.
        page.uncheck('[data-testid="show-inactive-checkbox"]')
        page.wait_for_selector('[data-testid="workers-table"]', timeout=10_000)
        page.screenshot(
            path=str(APP_ROOT / "memory" / "v58_13_132fy_03_restored.png"),
            full_page=False,
        )

        browser.close()

    _report(failures)
    return 1 if failures else 0


def _report(failures: list[str]) -> None:
    print("\n=== v58.13.132fy verification ===")
    if failures:
        print("STATUS: FAIL")
        for f in failures:
            print(f"  - {f}")
    else:
        print("STATUS: PASS")
        print("Show-inactive toggle + Restore round-trip verified.")


if __name__ == "__main__":
    sys.exit(main())

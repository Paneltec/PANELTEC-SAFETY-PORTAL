"""v58.13.132fp — Playwright verification for the edit-pencil visibility
hotfix.

Root cause identified via `scripts/probe_132fp.py`:
  * The `<button data-testid="edit-{id}">` pencil is UNCONDITIONAL in
    the JSX at Workers.jsx line ~2604 — no per-worker gate.
  * BUT the row's fixed 190px actions column + `flex-wrap` on the
    action cluster meant a 6th button always wrapped onto a second
    line. On rows with the wider `+ Login` button (e.g. Melinda
    Linford's row — 62 px wide instead of the ~28 px `AccessKebab`
    dots menu), earlier Edit + Delete were being pushed off-canvas
    on stale bundles / narrower viewports.
  * `.132fp` widens the actions column to 260 px and switches the
    cluster to `flex-nowrap` so all six buttons stay on one line
    unconditionally.

This script asserts:
  1. Every visible worker row has a `data-testid="edit-<id>"` button.
  2. For 5 workers with distinct row states (Melinda + others), the
     edit pencil is on the SAME visual line as the other actions
     (y-coordinate matches the first action button of that row) —
     no wrapping.
  3. Clicking Melinda's pencil opens the edit modal with her data.
  4. Typing into `worker-mobile` and clicking Save persists on
     reload.
"""
from __future__ import annotations

import json
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
MEL_ID = "47476d38-bc55-4fc7-90c2-7db2b909d692"
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "stephen@paneltec.com.au")
ADMIN_PWD = os.environ.get("ADMIN_PWD", "Mcgstephen50#")

SHOT_BEFORE = APP_ROOT / "memory" / "v58_13_132fp_workers_before.png"
SHOT_AFTER = APP_ROOT / "memory" / "v58_13_132fp_workers_after.png"


def main() -> int:
    failures: list[str] = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()

        page.goto(LOGIN_URL, wait_until="networkidle")
        page.fill('[data-testid="cover-email"]', ADMIN_EMAIL)
        page.fill('[data-testid="cover-password"]', ADMIN_PWD)
        page.click('[data-testid="cover-submit"]')
        page.wait_for_url(re.compile(r"/app/"), timeout=15_000)

        page.goto(WORKERS_URL, wait_until="networkidle")
        page.wait_for_selector(f'[data-testid="worker-row-{MEL_ID}"]', timeout=15_000)
        page.screenshot(path=str(SHOT_BEFORE), full_page=False)

        # 1) Every rendered worker row has an edit pencil.
        summary = page.evaluate("""
() => {
  const rows = document.querySelectorAll('[data-testid^="worker-row-"]');
  const missing = [];
  const measured = [];
  rows.forEach((row) => {
    const tid = row.getAttribute('data-testid') || '';
    // Filter out inner elements from <WorkerRowPhoto /> which also
    // carry a `worker-row-photo(-placeholder)-<id>` testid. Only the
    // row *container* has a testid matching worker-row-<uuid>.
    if (tid.startsWith('worker-row-photo')) return;
    const wid = tid.replace('worker-row-', '');
    const edit = row.querySelector(`[data-testid="edit-${wid}"]`);
    if (!edit) { missing.push(wid); return; }
    const editRect = edit.getBoundingClientRect();
    const cluster = row.querySelector(`[data-testid="worker-actions-cluster-${wid}"]`);
    const first = cluster ? cluster.querySelector('button') : null;
    const firstRect = first ? first.getBoundingClientRect() : null;
    // The edit button and the FIRST action button in the cluster
    // must share the same visual line (delta < 3 px). If they do
    // not, the cluster wrapped and the pencil landed on a
    // separate row.
    const sameLine = firstRect ? Math.abs(editRect.y - firstRect.y) < 3 : null;
    measured.push({
      wid,
      edit_visible: editRect.width > 0 && editRect.height > 0,
      edit_y: Math.round(editRect.y),
      first_y: firstRect ? Math.round(firstRect.y) : null,
      first_testid: first ? first.getAttribute('data-testid') : null,
      same_line: sameLine,
    });
  });
  return { rowCount: rows.length, missing, measured };
}
""")
        print(f"rows scanned  : {summary['rowCount']}")
        print(f"missing pencil: {summary['missing']}")
        # 1) Zero rows may be missing the edit pencil.
        if summary['missing']:
            failures.append(f"missing edit pencil on {len(summary['missing'])} rows: {summary['missing'][:5]}")
        # 2) Every measured row must have edit on the same line as its
        #    first action button.
        wrapped = [m for m in summary['measured'] if m['same_line'] is False]
        if wrapped:
            failures.append(f"edit pencil wrapped off-line on {len(wrapped)} rows (first 3): {wrapped[:3]}")

        # 3) Melinda-specific probe.
        mel = next((m for m in summary['measured'] if m['wid'] == MEL_ID), None)
        print(f"Melinda row   : {json.dumps(mel)}")
        if not mel:
            failures.append("Melinda row not in scanned set")
        elif not mel['edit_visible']:
            failures.append("Melinda's edit pencil not visible")
        elif mel['same_line'] is not True:
            failures.append(f"Melinda edit not on same visual line as first action: {mel}")

        # 4) Click Melinda's pencil and prove the modal opens with her
        #    data + a save round-trips.
        page.click(f'[data-testid="edit-{MEL_ID}"]')
        page.wait_for_selector('[data-testid="worker-edit-modal"]', timeout=10_000)
        page.wait_for_selector('[data-testid="worker-first-name"]', timeout=10_000)
        first_name = page.eval_on_selector('[data-testid="worker-first-name"]', "el => el.value")
        print(f"first_name in modal: {first_name!r}")
        if first_name.upper() != "MELINDA":
            failures.append(f"expected MELINDA in first_name field, got {first_name!r}")

        original_mobile = page.eval_on_selector('[data-testid="worker-mobile"]', "el => el.value")
        probe = "0400000133"  # deliberate diagnostic value
        page.fill('[data-testid="worker-mobile"]', probe)
        page.click('[data-testid="org-quick-links-editor-save"], form button[type="submit"]')
        try:
            page.wait_for_selector('[data-testid="worker-edit-modal"]', state="detached", timeout=10_000)
        except Exception as e:
            failures.append(f"modal did not detach after Save: {e}")

        page.reload(wait_until="networkidle")
        page.wait_for_selector(f'[data-testid="edit-{MEL_ID}"]', timeout=15_000)
        page.click(f'[data-testid="edit-{MEL_ID}"]')
        page.wait_for_selector('[data-testid="worker-mobile"]', timeout=10_000)
        persisted = page.eval_on_selector('[data-testid="worker-mobile"]', "el => el.value")
        print(f"mobile after reload: {persisted!r}")
        if persisted != probe:
            failures.append(f"mobile did not persist: got {persisted!r}, expected {probe!r}")

        # 5) Restore original mobile value
        page.fill('[data-testid="worker-mobile"]', original_mobile)
        page.click('form button[type="submit"]')
        try:
            page.wait_for_selector('[data-testid="worker-edit-modal"]', state="detached", timeout=10_000)
        except Exception:
            pass

        page.screenshot(path=str(SHOT_AFTER), full_page=False)
        browser.close()

    print("\n=== v58.13.132fp verification ===")
    if failures:
        print("STATUS: FAIL")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("STATUS: PASS")
    print("Assertions: every worker row shows the edit pencil,")
    print("            Melinda's pencil opens the modal, edit persists.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

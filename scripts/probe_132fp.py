"""v58.13.132fp — Diagnostic probe: capture Melinda's Workers row DOM
state to see why the edit pencil isn't visible."""
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


def main() -> int:
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

        # Snapshot Melinda's row + one non-Melinda row for comparison.
        state = page.evaluate("""
(melId) => {
  const rows = document.querySelectorAll('[data-testid^="worker-row-"]');
  const results = [];
  let firstNonMel = null;
  rows.forEach((row) => {
    const tid = row.getAttribute('data-testid');
    if (tid.endsWith(melId)) {
      results.push({ label: 'Melinda', row: dump(row) });
    } else if (!firstNonMel) {
      firstNonMel = row;
      results.push({ label: 'FirstNonMel:' + tid, row: dump(row) });
    }
  });
  function dump(row) {
    const rect = row.getBoundingClientRect();
    const actionsCol = row.lastElementChild;
    const arect = actionsCol ? actionsCol.getBoundingClientRect() : null;
    const cluster = actionsCol ? actionsCol.querySelector('.inline-flex') : null;
    const crect = cluster ? cluster.getBoundingClientRect() : null;
    const buttons = [];
    if (cluster) {
      cluster.querySelectorAll('button').forEach((b) => {
        const br = b.getBoundingClientRect();
        buttons.push({
          testid: b.getAttribute('data-testid'),
          title: b.getAttribute('title'),
          text: (b.innerText || '').slice(0, 15),
          x: Math.round(br.x), y: Math.round(br.y),
          w: Math.round(br.width), h: Math.round(br.height),
          visible: br.width > 0 && br.height > 0 && br.right <= innerWidth + 1,
          clipped: arect ? br.right > arect.right + 1 : null,
        });
      });
    }
    return {
      rowRect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
      actionsColRect: arect ? { x: arect.x, y: arect.y, w: arect.width, h: arect.height } : null,
      clusterRect: crect ? { x: crect.x, y: crect.y, w: crect.width, h: crect.height } : null,
      buttonsCount: buttons.length,
      buttons,
    };
  }
  return results;
}
""", MEL_ID)
        print(json.dumps(state, indent=2))

        page.screenshot(path="/app/memory/v58_13_132fp_workers_list_before.png", full_page=False)
        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())

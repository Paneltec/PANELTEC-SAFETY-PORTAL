"""v58.13.132fn — Playwright reproduction of Stephen's "cannot edit
worker profile" bug.

Runs headless (playwright headed is not available in this pod, but
DOM state / pointer-events / elementFromPoint / activeElement is the
same in headless). Steps:

  1. Log in as Stephen (real JWT via cover login form).
  2. Navigate to /app/settings/workers, then to Mel Linford's Edit modal.
  3. Snapshot the modal's DOM state — modal open? which inputs? their
     disabled / readOnly / computed pointer-events / parent fieldset
     disabled state?
  4. `document.elementFromPoint(rect.center)` on the first_name input —
     is the DOM path back to the input, or is another element covering
     it?
  5. Programmatic .click() + activeElement + typing check.
  6. Attempt to type ".132fn diag" into the Mobile field, click Save,
     reload the modal, assert the value persisted.
  7. Capture console errors / warnings emitted during the flow.

All raw output is printed. Screenshots dropped into /app/memory/.
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

SHOT_INITIAL = APP_ROOT / "memory" / "v58_13_132fn_mel_edit_initial.png"
SHOT_AFTER_TYPE = APP_ROOT / "memory" / "v58_13_132fn_mel_edit_after_type.png"
SHOT_AFTER_SAVE = APP_ROOT / "memory" / "v58_13_132fn_mel_edit_after_save.png"


def dumpjson(label: str, obj) -> None:
    print(f"\n=== {label} ===")
    print(json.dumps(obj, indent=2, default=str))


def main() -> int:
    console_lines: list[dict] = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        page.on(
            "console",
            lambda msg: console_lines.append({"type": msg.type, "text": msg.text[:400]}),
        )
        page.on(
            "pageerror",
            lambda exc: console_lines.append({"type": "pageerror", "text": str(exc)[:400]}),
        )

        # 1) log in via the Cover page
        page.goto(LOGIN_URL, wait_until="networkidle")
        page.fill('[data-testid="cover-email"]', ADMIN_EMAIL)
        page.fill('[data-testid="cover-password"]', ADMIN_PWD)
        page.click('[data-testid="cover-submit"]')
        page.wait_for_url(re.compile(r"/app/"), timeout=15_000)
        print(f"logged in — landed at {page.url}")

        # 2) go straight to workers
        page.goto(WORKERS_URL, wait_until="networkidle")
        page.wait_for_selector(f'[data-testid="edit-{MEL_ID}"]', timeout=15_000)
        print(f"workers list rendered — edit button for Mel visible")

        # 3) open edit modal
        page.click(f'[data-testid="edit-{MEL_ID}"]')
        page.wait_for_selector('[data-testid="worker-edit-modal"]', timeout=10_000)
        page.wait_for_selector('[data-testid="worker-first-name"]', timeout=10_000)
        page.screenshot(path=str(SHOT_INITIAL), full_page=True)
        print(f"edit modal opened — screenshot → {SHOT_INITIAL}")

        # 4) DOM state snapshot
        state = page.evaluate("""
() => {
  const modal = document.querySelector('[data-testid="worker-edit-modal"]');
  const inputs = ['worker-first-name','worker-last-name','worker-email','worker-phone','worker-mobile'];
  const rows = inputs.map((tid) => {
    const el = document.querySelector(`[data-testid="${tid}"]`);
    if (!el) return {tid, present:false};
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const cx = Math.floor(rect.left + rect.width/2);
    const cy = Math.floor(rect.top + rect.height/2);
    const hit = document.elementFromPoint(cx, cy);
    // Find nearest disabled fieldset ancestor
    let fs = el.closest('fieldset');
    let fsDisabled = null;
    while (fs) { if (fs.disabled) { fsDisabled = fs; break; } fs = fs.parentElement?.closest('fieldset'); }
    return {
      tid,
      present: true,
      disabled: el.disabled,
      readOnly: el.readOnly,
      pointerEvents: cs.pointerEvents,
      opacity: cs.opacity,
      display: cs.display,
      rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height, visible: rect.width>0 && rect.height>0 },
      hitTarget: hit ? {
        tag: hit.tagName,
        testid: hit.getAttribute('data-testid'),
        cls: (hit.className||'').toString().slice(0,120),
        isSameNode: hit === el,
        isAncestor: hit.contains(el),
        isDescendant: el.contains(hit),
      } : null,
      fieldsetDisabled: !!fsDisabled,
      currentValue: el.value,
    };
  });
  // Any overlay covering the modal?
  const modalRect = modal?.getBoundingClientRect();
  const overlayHit = modal ? document.elementFromPoint(modalRect.left + 40, modalRect.top + 40) : null;
  return {
    modalPresent: !!modal,
    inputs: rows,
    overlayTopLeftHit: overlayHit ? {
      tag: overlayHit.tagName,
      testid: overlayHit.getAttribute('data-testid'),
      cls: (overlayHit.className||'').toString().slice(0,120),
    } : null,
    docActive: document.activeElement?.tagName + ':' + (document.activeElement?.getAttribute('data-testid') || ''),
  };
}
""")
        dumpjson("DOM STATE — inputs / hit-test / fieldsets", state)

        # 5) click + type on Mobile field, verify value updates in React state
        page.focus('[data-testid="worker-mobile"]')
        active_after_focus = page.evaluate(
            "() => document.activeElement?.getAttribute('data-testid')"
        )
        print(f"activeElement after focus('worker-mobile'): {active_after_focus}")

        # Read current mobile value BEFORE we type, so we can restore.
        original_mobile = page.eval_on_selector('[data-testid="worker-mobile"]', "el => el.value")
        probe_mobile = "0400000132"  # deliberate diagnostic value
        page.fill('[data-testid="worker-mobile"]', probe_mobile)
        val_after_type = page.eval_on_selector('[data-testid="worker-mobile"]', "el => el.value")
        print(f"mobile before  : {original_mobile!r}")
        print(f"mobile typed   : {probe_mobile!r}")
        print(f"mobile readback: {val_after_type!r}")
        page.screenshot(path=str(SHOT_AFTER_TYPE), full_page=True)

        # 6) click Save
        save_btn = page.query_selector('[data-testid="worker-edit-save"], button[type="submit"]')
        if not save_btn:
            # Fallback: last button inside the form
            save_btn = page.query_selector('form button[type="submit"]')
        if save_btn:
            save_btn.click()
            # Wait for modal to close (onSaved → setEditing(null))
            try:
                page.wait_for_selector('[data-testid="worker-edit-modal"]', state="detached", timeout=10_000)
                print("modal closed after Save — save flow completed")
            except Exception as e:
                print(f"modal did NOT detach after save: {e}")
        else:
            print("!! no Save button found")

        page.screenshot(path=str(SHOT_AFTER_SAVE), full_page=True)

        # 7) reopen the modal and check the value persisted server-side
        page.reload(wait_until="networkidle")
        page.wait_for_selector(f'[data-testid="edit-{MEL_ID}"]', timeout=10_000)
        page.click(f'[data-testid="edit-{MEL_ID}"]')
        page.wait_for_selector('[data-testid="worker-mobile"]', timeout=10_000)
        persisted = page.eval_on_selector('[data-testid="worker-mobile"]', "el => el.value")
        print(f"mobile after reload: {persisted!r}")
        persisted_ok = persisted == probe_mobile

        # Restore original mobile value so we don't leave probe data in prod DB
        page.fill('[data-testid="worker-mobile"]', original_mobile)
        restore_btn = page.query_selector('form button[type="submit"]')
        if restore_btn:
            restore_btn.click()
            try:
                page.wait_for_selector(
                    '[data-testid="worker-edit-modal"]', state="detached", timeout=10_000
                )
                print(f"restored mobile to original {original_mobile!r}")
            except Exception:
                pass

        # Console log dump
        dumpjson("CONSOLE LOG (first 40)", console_lines[:40])

        browser.close()

    print("\n=== RESULT ===")
    if persisted_ok:
        print("PASS — admin can type + Save + value persists on reload.")
        return 0
    print(f"FAIL — expected mobile={probe_mobile!r}, got {persisted!r}")
    return 1


if __name__ == "__main__":
    sys.exit(main())

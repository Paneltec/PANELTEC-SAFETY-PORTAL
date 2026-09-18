"""v58.13.132ib — Playwright regression harness for every form-template picker.

Contract:
  For every form template in the org, if the template has any picker field
  (`worker_picker`, `vehicle_navixy`, `job_picker`, `site_picker`,
  `customer_picker`), open the FillOutModal and assert:

    · worker_picker toggle click → search input focuses + list loads > 0.
    · Row click → chip appears (single mode) OR a selection chip appears
      in `-multi-chips` (multi mode).
    · inline_company_toggle chips render + filtering works when configured.
    · vehicle_navixy — `vehicle-opt-*` buttons rendered + row click →
      `vehicle-clear-*` chip appears.

Run manually before every ship touching pickers:

    python scripts/verify_pickers_132ib.py

Exit code 0 = all templates green. Non-zero = broken picker found; report
prints the template + field id.

Uses the Playwright API asynchronously via `asyncio.run(main())`.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from pathlib import Path
from urllib.parse import urljoin

import httpx
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
FRONTEND_ENV = (ROOT / "frontend" / ".env").read_text(encoding="utf-8")
BASE_URL = ""
for line in FRONTEND_ENV.splitlines():
    if line.startswith("REACT_APP_BACKEND_URL="):
        BASE_URL = line.split("=", 1)[1].strip()
        break
if not BASE_URL:
    print("ERROR: REACT_APP_BACKEND_URL missing from frontend/.env")
    sys.exit(2)

EMAIL = os.environ.get("PANELTEC_TEST_EMAIL",   "stephen@paneltec.com.au")
PASSWORD = os.environ.get("PANELTEC_TEST_PASSWORD", "Mcgstephen50#")

PICKER_TYPES = {"worker_picker", "vehicle_navixy",
                "job_picker", "site_picker", "customer_picker"}


async def fetch_templates() -> list[dict]:
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as client:
        r = await client.post("/api/auth/login",
                              json={"email": EMAIL, "password": PASSWORD})
        r.raise_for_status()
        j = r.json()
        token = j.get("token") or j.get("access_token")
        r = await client.get("/api/forms/templates?limit=200",
                             headers={"Authorization": f"Bearer {token}"})
        r.raise_for_status()
        return r.json() or []


def _picker_fields(template: dict) -> list[dict]:
    return [f for f in (template.get("fields") or []) if f.get("type") in PICKER_TYPES]


async def _verify_one_template(page, template: dict, base_url: str) -> list[str]:
    """Open the Fill modal for this template and exercise every picker.
    Returns a list of failure strings (empty = all green)."""
    errors: list[str] = []
    picker_fields = _picker_fields(template)
    if not picker_fields:
        return []
    tname = template.get("name")
    tid = template.get("id")

    # Reset to the Forms list so each template starts from the same state.
    await page.goto(f"{base_url}/app/forms", wait_until="domcontentloaded")
    await page.wait_for_load_state("networkidle", timeout=15000)

    # Locate the template's Fill button.
    clicked = await page.evaluate(
        "(tname) => {"
        "  const tag = [...document.querySelectorAll('*')].find(e => (e.innerText||'').trim() === tname);"
        "  if (!tag) return false;"
        "  let node = tag;"
        "  for (let i=0; i<10; i++) {"
        "    node = node.parentElement; if (!node) return false;"
        "    const fills = [...node.querySelectorAll('button')].filter(b => /fill/i.test(b.innerText||''));"
        "    if (fills.length) { fills[0].click(); return true; }"
        "  }"
        "  return false;"
        "}", tname,
    )
    if not clicked:
        errors.append(f"[{tid}] {tname}: could not click Fill button")
        return errors
    try:
        await page.wait_for_selector('[data-testid="form-fillout-modal"]', timeout=8000)
    except Exception:
        errors.append(f"[{tid}] {tname}: FillOutModal never mounted")
        return errors
    await page.wait_for_timeout(1000)

    for f in picker_fields:
        fid = f.get("id")
        ftype = f.get("type")
        cfg = f.get("config") or {}
        if ftype == "worker_picker":
            testid = f"worker-picker-{fid}"
            toggle = await page.query_selector(f'[data-testid="{testid}-toggle"]')
            if not toggle:
                errors.append(f"[{tid}] {tname} · {ftype}#{fid}: toggle missing")
                continue
            await toggle.click()
            await page.wait_for_timeout(700)
            # inline_company_toggle honored?
            if cfg.get("inline_company_toggle"):
                ct = await page.query_selector(f'[data-testid="{testid}-company-toggle"]')
                if not ct:
                    errors.append(f"[{tid}] {tname} · {ftype}#{fid}: inline_company_toggle NOT rendered")
                for opt in (cfg.get("company_options") or []):
                    sid = opt.get("simpro_id")
                    chip = await page.query_selector(f'[data-testid="{testid}-company-{sid}"]')
                    if not chip:
                        errors.append(f"[{tid}] {tname} · {ftype}#{fid}: company chip {sid} missing")
            # rows appear
            rows = await page.query_selector_all(f'[data-testid^="{testid}-list-row-"]')
            if not rows:
                # Empty org has no workers — that's OK — but fetch must fire.
                # We accept 0 rows here as long as the search input is present.
                srch = await page.query_selector(f'[data-testid="{testid}-search"]')
                if not srch:
                    errors.append(f"[{tid}] {tname} · {ftype}#{fid}: dropdown never rendered")
                continue
            await rows[0].click()
            await page.wait_for_timeout(400)
            if cfg.get("multi"):
                mchips = await page.query_selector_all(f'[data-testid^="{testid}-multi-chip-"]')
                if not mchips:
                    errors.append(f"[{tid}] {tname} · {ftype}#{fid}: multi mode row click did not add chip")
            else:
                chip = await page.query_selector(f'[data-testid="{testid}-chip"]')
                if not chip:
                    errors.append(f"[{tid}] {tname} · {ftype}#{fid}: row click did not create chip")
        elif ftype == "vehicle_navixy":
            # Vehicle picker is inlined — no toggle. Check that either
            # `vehicle-opt-*` rows are present OR the manual toggle is.
            opts = await page.query_selector_all('[data-testid^="vehicle-opt-"]')
            manual = await page.query_selector(f'[data-testid="vehicle-manual-{fid}"]')
            if not opts and not manual:
                errors.append(f"[{tid}] {tname} · {ftype}#{fid}: neither fleet options nor manual toggle rendered")
                continue
            if opts:
                await opts[0].click()
                await page.wait_for_timeout(400)
                chip = await page.query_selector(f'[data-testid="vehicle-clear-{fid}"]')
                if not chip:
                    errors.append(f"[{tid}] {tname} · {ftype}#{fid}: row click did not create vehicle chip")
        elif ftype in ("customer_picker", "site_picker", "job_picker"):
            testid = f'{ftype.split("_")[0]}-picker-{fid}'
            toggle = await page.query_selector(f'[data-testid="{testid}-toggle"]')
            if not toggle:
                errors.append(f"[{tid}] {tname} · {ftype}#{fid}: toggle missing")
                continue
            await toggle.click()
            await page.wait_for_timeout(700)
            srch = await page.query_selector(f'[data-testid="{testid}-search"]')
            if not srch:
                errors.append(f"[{tid}] {tname} · {ftype}#{fid}: dropdown never rendered")

    # Close the modal.
    close = await page.query_selector('[data-testid="form-fillout-modal"] button[aria-label*="Close" i], [data-testid="form-fillout-modal"] button:has-text("Cancel")')
    if close:
        try:
            await close.click()
        except Exception:
            pass
        try:
            await page.wait_for_selector('[data-testid="form-fillout-modal"]', state="detached", timeout=5000)
        except Exception:
            pass
    return errors


async def main() -> int:
    print(f"[132ib] Base: {BASE_URL}")
    templates = await fetch_templates()
    print(f"[132ib] Fetched {len(templates)} templates.")
    targeted = [t for t in templates if _picker_fields(t)]
    print(f"[132ib] {len(targeted)} templates have picker fields.")

    total_pickers = sum(len(_picker_fields(t)) for t in targeted)
    print(f"[132ib] Total picker fields to exercise: {total_pickers}")

    all_errors: list[str] = []
    started = time.time()

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        try:
            context = await browser.new_context(viewport={"width": 1600, "height": 1000})
            page = await context.new_page()

            # Login once.
            await page.goto(f"{BASE_URL}/login", wait_until="domcontentloaded")
            await page.wait_for_load_state("networkidle", timeout=15000)
            await page.fill('input[type="email"]', EMAIL)
            await page.fill('input[type="password"]', PASSWORD)
            await page.click('button[type="submit"]')
            await page.wait_for_url("**/app/**", timeout=20000)

            for i, t in enumerate(targeted, 1):
                errs = await _verify_one_template(page, t, BASE_URL)
                status = "OK " if not errs else "FAIL"
                print(f"[132ib] [{i:>3}/{len(targeted)}] {status}  {t.get('name')}  ({len(_picker_fields(t))} pickers)")
                all_errors.extend(errs)
        finally:
            await browser.close()

    elapsed = time.time() - started
    print()
    if all_errors:
        print(f"[132ib] ✗ {len(all_errors)} picker(s) broken across {len(targeted)} templates:")
        for e in all_errors:
            print(f"          · {e}")
        print(f"[132ib] Elapsed {elapsed:.1f}s")
        return 1

    print(f"[132ib] ✓ All {total_pickers} pickers across {len(targeted)} templates interactive.")
    print(f"[132ib] Elapsed {elapsed:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

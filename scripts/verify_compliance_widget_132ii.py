"""v58.13.132ii — Playwright visual sweep for the compliance widget.

Seeds a synthetic form template with three questions modelled on:
  · Pre-Start compliance check
  · SSRA hazard control
  · Inspection walkthrough
…each rendered as a `compliance` field with `help_text` so the
info popover is visible in the screenshots. Opens the Fill modal,
captures four snapshots:

  1. compliance_widget_132ii__1_default.png   — pristine (no answers).
  2. compliance_widget_132ii__2_compliant.png — first row set to
     COMPLIANT + info popover open.
  3. compliance_widget_132ii__3_atrisk_notes.png — second row set to
     AT RISK + note textarea populated.
  4. compliance_widget_132ii__4_na.png — third row set to N/A.

Screenshots land in `/app/scripts/screenshots/`.

Then deletes the synthetic template so we don't pollute the prod
template list.

Run:
    python scripts/verify_compliance_widget_132ii.py

Exit code 0 = clean visual pass. Non-zero = screenshot or seed failed.
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

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

EMAIL = os.environ.get("PANELTEC_TEST_EMAIL", "stephen@paneltec.com.au")
PASSWORD = os.environ.get("PANELTEC_TEST_PASSWORD", "Mcgstephen50#")

OUT_DIR = ROOT / "scripts" / "screenshots"
OUT_DIR.mkdir(parents=True, exist_ok=True)

TEMPLATE_NAME = "v58.13.132ii — Synthetic Compliance Widget Sweep"

SYNTHETIC_FIELDS = [
    {
        "id": "cq_prestart",
        "label": "Vehicle exterior — is the vehicle free from visible defects, leaks, or damage?",
        "type": "compliance",
        "required": True,
        "options": [],
        "placeholder": "",
        "help_text": (
            "Walk around the vehicle. Check tyres for cuts/wear, look for "
            "fluid leaks on the ground, and inspect body panels for damage."
        ),
        "config": {},
    },
    {
        "id": "cq_ssra",
        "label": "SSRA hazard control — are all required controls in place before starting the task?",
        "type": "compliance",
        "required": True,
        "options": [],
        "placeholder": "",
        "help_text": (
            "Cross-check the SSRA control matrix. PPE worn, exclusion zone "
            "established, spotter briefed, permit signed off."
        ),
        "config": {},
    },
    {
        "id": "cq_inspection",
        "label": "Site inspection — housekeeping standard maintained across the work area?",
        "type": "compliance",
        "required": False,
        "options": [],
        "placeholder": "",
        "help_text": "",
        "config": {},
    },
]


async def _login(client: httpx.AsyncClient) -> str:
    r = await client.post("/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
    r.raise_for_status()
    j = r.json()
    return j.get("token") or j.get("access_token") or ""


async def _seed_template(client: httpx.AsyncClient, token: str) -> str:
    payload = {
        "name": TEMPLATE_NAME,
        "category": "other",
        "description": "Synthetic — deleted after screenshot sweep.",
        "fields": SYNTHETIC_FIELDS,
    }
    r = await client.post(
        "/api/forms/templates", json=payload,
        headers={"Authorization": f"Bearer {token}"},
    )
    r.raise_for_status()
    return r.json()["id"]


async def _delete_template(client: httpx.AsyncClient, token: str, tid: str) -> None:
    try:
        await client.delete(
            f"/api/forms/templates/{tid}",
            headers={"Authorization": f"Bearer {token}"},
        )
    except Exception as e:                                         # pragma: no cover
        print(f"WARN: delete failed for {tid}: {e}")


async def _login_ui_and_open_fill(page, base_url: str) -> None:
    """Drive the login form UI and open the Fill modal for our template."""
    await page.goto(f"{base_url}/login", wait_until="domcontentloaded")
    await page.wait_for_load_state("networkidle", timeout=15000)
    await page.fill('input[type="email"]', EMAIL)
    await page.fill('input[type="password"]', PASSWORD)
    async with page.expect_navigation(wait_until="networkidle", timeout=20000):
        await page.click('button[type="submit"]')
    # Land on /app/forms so the template card is on screen. Force a
    # reload so the newly-seeded template appears in the list.
    await page.goto(f"{base_url}/app/forms", wait_until="domcontentloaded")
    await page.wait_for_load_state("networkidle", timeout=15000)
    await page.reload(wait_until="networkidle")
    await page.wait_for_timeout(800)


async def _click_fill(page, tname: str, tid: str) -> bool:
    """Click the Fill button for this template. Uses the stable
    `card-fill-<id>` testid; falls back to a name-search if the card
    isn't visible in the default view."""
    sel = f'[data-testid="card-fill-{tid}"]'
    try:
        await page.wait_for_selector(sel, timeout=8000)
        await page.click(sel)
    except Exception:
        # Category filter may be hiding the card. Widen to "all".
        try:
            await page.click('button:has-text("All")', timeout=2000)
            await page.wait_for_timeout(400)
        except Exception:
            pass
        # Type into the search box to force the card visible.
        try:
            search = await page.query_selector(
                '[data-testid="forms-search"], input[type="search"], input[placeholder*="Search"]',
            )
            if search:
                await search.fill(tname[:30])
                await page.wait_for_timeout(500)
        except Exception:
            pass
        try:
            await page.wait_for_selector(sel, timeout=6000)
            await page.click(sel)
        except Exception:
            return False
    try:
        await page.wait_for_selector('[data-testid="form-fillout-modal"]', timeout=8000)
    except Exception:
        return False
    return True


async def _snap(page, name: str) -> None:
    path = OUT_DIR / name
    await page.screenshot(path=str(path), full_page=False)
    print(f"  → {path.name}")


async def main() -> int:
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as client:
        token = await _login(client)
        if not token:
            print("ERROR: login failed"); return 2
        tid = await _seed_template(client, token)
        print(f"seeded synthetic template: {tid}")

    exit_code = 0
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=True, args=["--no-sandbox", "--disable-gpu"],
        )
        try:
            context = await browser.new_context(
                viewport={"width": 1440, "height": 900},
            )
            page = await context.new_page()

            await _login_ui_and_open_fill(page, BASE_URL)
            if not await _click_fill(page, TEMPLATE_NAME, tid):
                # Capture a debug screenshot so we can see what the
                # page actually rendered before giving up.
                await _snap(page, "compliance_widget_132ii__FAILURE_state.png")
                url = page.url
                title = await page.title()
                print(f"ERROR: FillOutModal never opened. url={url!r} title={title!r}")
                exit_code = 3
            else:
                await page.wait_for_timeout(600)
                # 1) pristine
                await _snap(page, "compliance_widget_132ii__1_default.png")

                # 2) COMPLIANT + info popover
                await page.click('[data-testid="compliance-btn-compliant-cq_prestart"]')
                await page.click('[data-testid="compliance-info-cq_prestart"]')
                await page.wait_for_timeout(300)
                await _snap(page, "compliance_widget_132ii__2_compliant.png")
                # Close popover so it doesn't overlap the next widget.
                await page.click('[data-testid="compliance-info-cq_prestart"]')
                await page.wait_for_timeout(100)

                # 3) AT RISK + notes
                await page.click('[data-testid="compliance-btn-at_risk-cq_ssra"]')
                await page.click('[data-testid="compliance-notes-cq_ssra"]')
                await page.wait_for_timeout(200)
                await page.fill(
                    '[data-testid="compliance-notes-input-cq_ssra"]',
                    "Spotter not briefed — pausing task until pre-start sign-off.",
                )
                await page.evaluate(
                    "() => document.activeElement && document.activeElement.blur()",
                )
                await page.wait_for_timeout(200)
                await _snap(page, "compliance_widget_132ii__3_atrisk_notes.png")

                # 4) N/A on the third widget
                await page.click('[data-testid="compliance-btn-na-cq_inspection"]')
                await page.wait_for_timeout(200)
                await _snap(page, "compliance_widget_132ii__4_na.png")
                print("screenshots captured OK")
        finally:
            await browser.close()

    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as client:
        token = await _login(client)
        await _delete_template(client, token, tid)
        print(f"deleted synthetic template: {tid}")

    return exit_code


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

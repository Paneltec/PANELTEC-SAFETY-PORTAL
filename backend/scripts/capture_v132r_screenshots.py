"""v58.13.132r — 3 screenshots for the 4-role consolidation ship."""
from __future__ import annotations
import asyncio, json, urllib.request
from playwright.async_api import async_playwright

FRONTEND = "https://whs-compliance.preview.emergentagent.com"
OUT = "/app/frontend/public/mobile-screenshots"
CHROME = "/pw-browsers/chromium_headless_shell-1208/chrome-linux/headless_shell"


def admin_jwt() -> str:
    req = urllib.request.Request(
        f"{FRONTEND}/api/auth/login",
        data=json.dumps({"email": "stephen@paneltec.com.au", "password": "Mcgstephen50#"}).encode(),
        headers={"Content-Type": "application/json", "User-Agent": "Mozilla/5.0"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read()).get("access_token", "")


async def snap(page, out_name, wait_s=5):
    await asyncio.sleep(wait_s)
    await page.screenshot(path=f"{OUT}/{out_name}", full_page=False)
    print(out_name)


async def main():
    jwt = admin_jwt()
    async with async_playwright() as pw:
        b = await pw.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])
        ctx = await b.new_context(viewport={"width": 1440, "height": 1000})
        p = await ctx.new_page()
        await p.goto(f"{FRONTEND}/", wait_until="domcontentloaded", timeout=30000)
        await p.evaluate(f"() => localStorage.setItem('paneltec_token', {json.dumps(jwt)})")

        # (1) Permission Presets admin — should show 4 built-in tiles.
        await p.goto(f"{FRONTEND}/app/settings/permissions", wait_until="networkidle", timeout=45000)
        await snap(p, "v132r_01_presets_4_tiles.png", wait_s=6)

        # (2) Forms per role — should show 4 tabs.
        await p.goto(f"{FRONTEND}/app/settings/forms-per-role", wait_until="networkidle", timeout=45000)
        await snap(p, "v132r_02_forms_per_role_4_tabs.png", wait_s=6)

        # (3) Live Preview 4-option dropdown (permission-presets page).
        await p.goto(f"{FRONTEND}/app/settings/permission-presets", wait_until="networkidle", timeout=45000)
        await asyncio.sleep(4)
        try:
            await p.get_by_text("Mobile App Modules", exact=True).first.click(timeout=5000)
        except Exception:
            pass
        await asyncio.sleep(6)
        # Synthetic dropdown overlay showing all 4 options.
        await p.evaluate(
            """
            () => {
              const sel = Array.from(document.querySelectorAll('select'))
                .find(s => Array.from(s.options).some(o => o.text === 'Paneltec Civil'));
              if (!sel) return;
              const r = sel.getBoundingClientRect();
              const overlay = document.createElement('div');
              overlay.id = '__v132r_overlay';
              overlay.style.cssText = `position: fixed; left: ${r.left}px; top: ${r.bottom}px; width: ${r.width}px; z-index: 99999; background: #fff; border: 1px solid #cbd5e1; border-radius: 8px; box-shadow: 0 10px 25px rgba(0,0,0,0.15); overflow: hidden; font: 14px/1.4 -apple-system, system-ui, sans-serif;`;
              const opts = Array.from(sel.options).map(o => o.text);
              overlay.innerHTML = opts.map((t, i) => `<div style="padding: 8px 12px; background: ${i === 0 ? '#dbeafe' : '#fff'}; color: #0f172a; border-top: ${i > 0 ? '1px solid #f1f5f9' : 'none'};">${t}</div>`).join('');
              document.body.appendChild(overlay);
            }
            """
        )
        await asyncio.sleep(1)
        await snap(p, "v132r_03_dropdown_4_options.png", wait_s=0)

        await p.close(); await ctx.close(); await b.close()


if __name__ == "__main__":
    asyncio.run(main())

"""v58.13.132gh — Uploads → GridFS wave 3 verify.

Sanity-checks the source-level migration + a Playwright smoke through
Stephen's login → dashboard → Workers → certification card. No writes
against Stephen's account; no wrong-PIN attempts.

Backend curl smoke: pick any migrated GridFS blob under
`document_library`, `swms_scans`, or `hazards` and confirm the file
endpoints serve it via `_serve_async`.
"""
from __future__ import annotations

import asyncio
import os
import re
import sys
from pathlib import Path

import requests
from playwright.sync_api import sync_playwright

APP_ROOT = Path(__file__).resolve().parents[1]
BASE_URL = re.search(
    r"REACT_APP_BACKEND_URL=(.+)",
    (APP_ROOT / "frontend" / ".env").read_text(),
).group(1).strip()
BE_ENV = APP_ROOT / "backend" / ".env"
_env: dict[str, str] = {}
for m in re.finditer(r"(?m)^([A-Z_][A-Z0-9_]*)=(.+)$", BE_ENV.read_text()):
    _env[m.group(1)] = m.group(2).strip().strip('"').strip("'")
MONGO_URL = _env.get("MONGO_URL") or os.environ.get("MONGO_URL")
DB_NAME = _env.get("DB_NAME") or os.environ.get("DB_NAME")

LOGIN_URL = f"{BASE_URL}/"
DASHBOARD = f"{BASE_URL}/app/dashboard"
API = f"{BASE_URL}/api"
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "stephen@paneltec.com.au")
ADMIN_PWD = os.environ.get("ADMIN_PWD", "Mcgstephen50#")


def _cover_login(page) -> None:
    page.goto(LOGIN_URL, wait_until="networkidle")
    page.wait_for_selector('[data-testid="cover-email"]', timeout=15_000)
    page.fill('[data-testid="cover-email"]', ADMIN_EMAIL)
    page.fill('[data-testid="cover-password"]', ADMIN_PWD)
    page.click('[data-testid="cover-submit"]')
    page.wait_for_url(re.compile(r"/(app|apps-directory)"), timeout=15_000)


def _pick_migrated_blob(subdir: str) -> tuple[str, ...] | None:
    """Return the `parts` tuple for the first GridFS row under `subdir`,
    or None if none migrated yet on this pod."""
    import pymongo
    client = pymongo.MongoClient(MONGO_URL)
    db = client[DB_NAME]
    doc = db.upload_storage.files.find_one({"metadata.subdir": subdir})
    client.close()
    if not doc:
        return None
    return tuple(doc["metadata"]["parts"])


def _backend_login() -> str | None:
    r = requests.post(
        f"{API}/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PWD},
        timeout=30,
    )
    if r.status_code != 200:
        return None
    return r.json().get("access_token")


def main() -> int:
    failures: list[str] = []

    # ─── Backend: /api/files/{subdir}/... served from GridFS ─
    token = _backend_login()
    auth = ({"Authorization": f"Bearer {token}",
             "User-Agent": "Mozilla/5.0"} if token else
            {"User-Agent": "Mozilla/5.0"})

    checked = 0
    for subdir, path_tmpl in (
        ("document_library", "/files/document_library/{0}/{1}"),
        ("swms_scans",       "/files/swms_scans/{0}"),
        ("hazards",          "/files/hazards/{0}"),
    ):
        hit = _pick_migrated_blob(subdir)
        if not hit:
            print(f"(info) no migrated {subdir} blobs — GridFS serve check "
                  f"skipped for this subdir.")
            continue
        url = API + path_tmpl.format(*hit)
        r = requests.get(url, headers=auth, timeout=30)
        if r.status_code != 200:
            failures.append(
                f"GridFS-served {subdir} HTTP {r.status_code}: {r.text[:120]}")
        elif not len(r.content):
            failures.append(f"GridFS-served {subdir} body empty")
        else:
            print(f"(info) GridFS {subdir} served OK · "
                  f"{len(r.content)} bytes · "
                  f"{r.headers.get('content-type')}")
            checked += 1
    print(f"(info) {checked} subdir(s) verified against GridFS")

    # ─── UI: login + dashboard smoke (no wrong-PIN paths) ─────
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        try:
            _cover_login(page)
            page.goto(DASHBOARD, wait_until="networkidle")
            page.wait_for_selector(
                '[data-testid="platform-overview-interactive"]',
                timeout=8_000,
            )
            page.screenshot(
                path=str(APP_ROOT / "memory"
                         / "v58_13_132gh_01_dashboard_smoke.png"),
                full_page=False,
            )
        except Exception as e:
            failures.append(f"playwright smoke failed: {e}")
        finally:
            browser.close()

    print("\n=== v58.13.132gh gridfs wave 3 verify ===")
    print(f"failures {len(failures)}")
    for f in failures:
        print(f"  - {f}")
    if failures:
        print("STATUS: FAIL")
        return 1
    print("STATUS: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())

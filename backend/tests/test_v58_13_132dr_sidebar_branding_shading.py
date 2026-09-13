"""v58.13.132dr — Sidebar branding editable + shading dial-up."""
from __future__ import annotations

import re
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[2]
LOGO = APP_ROOT / "frontend" / "src" / "components" / "brand" / "Logo.jsx"
APPSHELL = APP_ROOT / "frontend" / "src" / "components" / "layout" / "AppShell.jsx"
ORG_JSX = APP_ROOT / "frontend" / "src" / "pages" / "OrgSettings.jsx"
ORG_MOD = APP_ROOT / "backend" / "org_settings.py"
VERSION_JS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


def test_logo_accepts_display_name_and_orange_tail():
    src = LOGO.read_text(encoding="utf-8")
    assert "132dr" in src
    # Signature accepts `displayName` prop.
    assert "displayName" in src
    # Splits on last whitespace: head + tail, tail rendered in orange.
    assert 'lastIndexOf(\' \')' in src
    assert '<span className="text-orange-500">{tail}</span>' in src
    # Default fallback preserved.
    assert "'Paneltec Civil'" in src


def test_appshell_threads_org_brand_name():
    src = APPSHELL.read_text(encoding="utf-8")
    assert "132dr" in src
    # Fetches /org once + refreshes on `paneltec_org_updated`.
    assert "paneltec_org_updated" in src
    # Lookup order: display_name → trading_name → name → default.
    m = re.search(
        r"data\?\.display_name\s*\|\|\s*data\?\.trading_name\s*\|\|\s*data\?\.name",
        src,
    )
    assert m, "AppShell must read display_name → trading_name → name"
    # Threaded into both desktop sidebar + mobile sheet.
    assert "brandName={brandName}" in src
    assert 'displayName={brandName}' in src


def test_org_patch_carries_display_name():
    src = ORG_MOD.read_text(encoding="utf-8")
    assert "display_name: Optional[str] = None" in src


def test_org_settings_page_exposes_display_name_field():
    src = ORG_JSX.read_text(encoding="utf-8")
    # `IDENTITY` array carries `display_name`.
    assert "key: 'display_name'" in src
    # Save fires the reload event so sidebar refreshes.
    assert "paneltec_org_updated" in src


def test_shading_dialled_up():
    src = ORG_JSX.read_text(encoding="utf-8")
    # `Section(..., elevated=true)` now uses ring-2 + emerald-200 +
    # gradient background.
    assert "ring-2 ring-emerald-100" in src
    assert "from-emerald-50/40" in src
    assert "border-emerald-200" in src
    # Emphasis banner promoted to border-2 + shadow-md + absolute-
    # positioned chip.
    assert 'border-2 border-emerald-300' in src
    assert "absolute -top-2.5 right-4" in src
    # Email popup dialled up: ring-4 emerald-200 + border-2 emerald-300.
    assert "ring-4 ring-emerald-200" in src
    assert "from-emerald-100 via-emerald-50 to-white" in src


def test_version_sync_at_132dr():
    running = re.search(r"^export const RUNNING_VERSION = '([^']+)'",
                        VERSION_JS.read_text(), re.MULTILINE).group(1)
    expected = re.search(r"^export const EXPECTED_CACHE_VERSION = '([^']+)'",
                         VERSION_JS.read_text(), re.MULTILINE).group(1)
    cache = re.search(r"^const CACHE_VERSION = '([^']+)'",
                      SW.read_text(), re.MULTILINE).group(1)
    assert running == expected == cache
    tail = re.search(r"132([a-z]+)", running).group(1)
    assert tail >= "dr"

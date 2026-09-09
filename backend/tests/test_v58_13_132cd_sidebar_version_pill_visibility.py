"""v58.13.132cd — Sidebar version pill: raise + darken · pytests.

Locks the .132cd contract:
  · The version footer testid `app-version-footer` is still present
    (backward compat for prior source-pin tests).
  · A new inner `app-version-pill` testid is present.
  · Pill sits ABOVE PwaInstallButton in SidebarShell (the .132cd
    reorder — was previously below it).
  · Pill uses the darkened / bordered styling (`bg-slate-100`,
    `border-slate-300`, `text-slate-700`).
  · Full RUNNING_VERSION string is still exposed via `title={...}`
    so hover tooltip surfaces the source of truth.
  · Version-sync forward-safe pin ≥ .132cd on version.js +
    service-worker.js.
"""
from __future__ import annotations

import re
from pathlib import Path


REPO = Path(__file__).resolve().parent.parent.parent
FRONTEND = REPO / "frontend"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


APP_SHELL = FRONTEND / "src" / "components" / "layout" / "AppShell.jsx"


def test_app_version_footer_testid_preserved():
    src = _read(APP_SHELL)
    assert 'data-testid="app-version-footer"' in src, \
        "wrapper testid must remain for backward compat"


def test_app_version_pill_testid_present():
    src = _read(APP_SHELL)
    assert 'data-testid="app-version-pill"' in src, \
        "inner pill must carry its own testid so tests can target the visual badge"


def test_pill_uses_dark_high_contrast_classes():
    src = _read(APP_SHELL)
    # Find the SidebarShell version pill block (200 chars each side).
    idx = src.find('data-testid="app-version-pill"')
    assert idx > -1, "app-version-pill block not found"
    block = src[max(0, idx - 400): idx + 400]
    # WCAG-AA readable palette: slate-700 text on slate-100 bg with a
    # slate-300 border. Reject the .132cc-era `text-slate-400`.
    assert "bg-slate-100" in block
    assert "border-slate-300" in block
    assert "text-slate-700" in block
    assert "text-slate-400" not in block, \
        "the pale slate-400 palette was the .132cc regression — must be gone"


def test_pill_sits_above_pwa_install_button():
    """Reorder assertion: in the file source, the wrapper containing
    the app-version-pill must appear BEFORE the `<PwaInstallButton `
    line inside SidebarShell."""
    src = _read(APP_SHELL)
    # Only look inside SidebarShell to avoid catching the mobile drawer
    # copy (which also renders <PwaInstallButton />).
    shell_start = src.index("const SidebarShell")
    shell_end = src.index("export default function AppShell")
    section = src[shell_start:shell_end]
    pill_pos = section.find('data-testid="app-version-pill"')
    pwa_pos = section.find("<PwaInstallButton ")
    assert pill_pos > -1, "version pill missing from SidebarShell"
    assert pwa_pos > -1, "PwaInstallButton missing from SidebarShell"
    assert pill_pos < pwa_pos, \
        "version pill must render ABOVE PwaInstallButton in SidebarShell"


def test_pill_preserves_running_version_tooltip():
    src = _read(APP_SHELL)
    m = re.search(r'data-testid="app-version-footer"[\s\S]{0,200}?title=\{RUNNING_VERSION\}', src)
    assert m, "full RUNNING_VERSION string must still surface via title tooltip"


def test_pill_strips_paneltec_prefix_when_expanded():
    """The expanded (non-collapsed) pill drops the `paneltec-` prefix
    so the version tail is the readable bit; collapsed variant keeps
    the last hyphen-segment (as before)."""
    src = _read(APP_SHELL)
    assert "replace(/^paneltec-/, '')" in src, \
        "expanded pill must strip the leading `paneltec-` for readability"
    assert "RUNNING_VERSION.split('-').pop()" in src, \
        "collapsed sidebar path must still show the version tail"


# ── Version-sync ──────────────────────────────────────────────────

def test_version_js_bumped_to_at_least_132cd():
    src = _read(FRONTEND / "src" / "lib" / "version.js")
    m = re.search(r"v160\.3\.9\.58\.13\.(\d+[a-z]*)", src)
    assert m and m.group(1) >= "132cd", f"version.js token = {m.group(1) if m else None}"


def test_service_worker_bumped_to_at_least_132cd():
    src = _read(FRONTEND / "public" / "service-worker.js")
    m = re.search(r"CACHE_VERSION\s*=\s*'paneltec-v160\.3\.9\.58\.13\.(\d+[a-z]*)'", src)
    assert m and m.group(1) >= "132cd", f"SW token = {m.group(1) if m else None}"

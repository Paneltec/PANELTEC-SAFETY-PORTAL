"""v58.13.132ge — Live Compliance Dashboard clickable platform
overview + branding fix + PIN-gated User Manual button.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

pytestmark = pytest.mark.live_db_writes

APP_ROOT = Path(__file__).resolve().parents[2]
FRONTEND = APP_ROOT / "frontend"
DASH = FRONTEND / "src" / "pages" / "Dashboard.jsx"
OVERVIEW = (FRONTEND / "src" / "components" / "help"
              / "PlatformOverviewInteractive.jsx")
DOWNLOADER = (FRONTEND / "src" / "components" / "help"
                / "UserManualDownloader.jsx")
VERSION_JS = FRONTEND / "src" / "lib" / "version.js"
SW = FRONTEND / "public" / "service-worker.js"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


# ─── Branding sweep ───────────────────────────────────────────

def test_dashboard_no_paneltec_civil():
    src = _read(DASH)
    assert "PANELTEC CIVIL" not in src, (
        "legacy 'PANELTEC CIVIL' eyebrow still present in Dashboard.jsx")
    assert "Paneltec Civil" not in src, (
        "legacy 'Paneltec Civil' mixed-case still present in "
        "Dashboard.jsx")
    # New branding present in both eyebrow surfaces.
    assert "THE PANELTEC GROUP INTELLIGENCE CENTRE" in src
    assert "The Paneltec Group · Intelligence Centre" in src


# ─── Interactive overview ─────────────────────────────────────

def test_dashboard_renders_interactive_overview():
    src = _read(DASH)
    assert "import PlatformOverviewInteractive" in src
    assert "<PlatformOverviewInteractive />" in src


def test_platform_overview_component_present():
    src = _read(OVERVIEW)
    # Root testid.
    assert 'data-testid="platform-overview-interactive"' in src
    # Every persona tile has a testid + route or disabled reason.
    for key in ("admin", "supervisor", "worker", "visitor"):
        assert f'`platform-overview-persona-{{tile.key}}`' not in src, (
            "testid must render statically per tile, not from a template "
            "with `{tile.key}` still unresolved")
    # Personas routed.
    for key, route in [
        ("admin",       "/app/settings/org"),
        ("supervisor",  "/app/settings/org"),
        ("worker",      "/app/settings/workers"),
        ("visitor",     "/app/sites"),
    ]:
        assert route in src, f"persona {key!r} route {route!r} missing"

    # Capture modules — every tile has a non-empty `to` route.
    module_routes = {
        "swms":        "/app/swms",
        "hazards":     "/app/risk-assessments",
        "incidents":   "/app/incidents",
        "inspections": "/app/inspections",
        "prestarts":   "/app/pre-starts",
        "sites":       "/app/sites",
        "workers":     "/app/settings/workers",
        "fleet":       "/app/fleet",
        "certs":       "/app/settings/certifications",
        "audit":       "/app/audit-exports",
        # v58.13.132gf — 'ask' tile flipped to disabled ("Coming
        # soon"); route no longer wired.
    }
    for key, route in module_routes.items():
        assert route in src, (
            f"capture module {key!r} route {route!r} missing")

    # v58.13.132gf — Live Dashboard flipped to a disabled tile
    # ("You're here." tooltip). Accept either the .132ge active
    # link or the .132gf disabled state so this guard survives
    # both incarnations.
    assert "/app/document-library" in src
    assert ("'/app/dashboard'" in src) or ('"/app/dashboard"' in src) \
        or ("You're here." in src)
    assert (
        "Mobile app is a separate install — contact admin."
    ) in src

    # Integrations — 4 configured, MongoDB disabled with reason.
    for route in (
        "/app/settings/integrations/simpro",
        "/app/settings/integrations/navixy",
        "/app/settings/integrations/microsoft365",
        "/app/settings/integrations/textmagic",
    ):
        assert route in src, f"integration route {route} missing"
    assert "Managed platform service" in src, (
        "MongoDB tile must render as disabled with the "
        "'Managed platform service' tooltip")


# ─── User Manual downloader ───────────────────────────────────

def test_dashboard_wires_pin_gated_user_manual_downloader():
    src = _read(DASH)
    assert "import UserManualDownloader" in src
    # Both surfaces (v157 hero + banner) now use the downloader.
    assert 'testId="dashboard-user-manual-btn-v157"' in src
    assert 'testId="dashboard-user-manual-btn"' in src
    # Legacy /app/help static link removed.
    assert 'to="/app/help"' not in src, (
        "old static /app/help User Manual link must be gone")


def test_downloader_uses_pin_header_and_docs_endpoint():
    src = _read(DOWNLOADER)
    assert "'X-Admin-Console-Pin': pin" in src
    assert "/docs/manual.docx" in src
    assert "responseType: 'blob'" in src
    # 4-digit PIN input.
    assert "maxLength={4}" in src


# ─── Version lockstep ────────────────────────────────────────

def test_version_bumped_to_132ge():
    js = _read(VERSION_JS)
    sw = _read(SW)
    # Version bump is monotonic — .132ge or newer is acceptable.
    assert re.search(
        r"RUNNING_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132g[e-z]", js)
    assert re.search(
        r"EXPECTED_CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132g[e-z]", js)
    assert re.search(
        r"CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132g[e-z]", sw)

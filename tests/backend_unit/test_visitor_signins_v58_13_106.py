"""v58.13.106 — Public visitor sign-in flow tests.

Source-pin + module-import checks. Public flow HTTP contract also
exercised via curl in the ship report; those aren't in this pytest
because they need a live DB fixture + a valid `scan_token`.
"""
from __future__ import annotations
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"

VISITOR_PY = (BACKEND / "visitor_signins.py").read_text(encoding="utf-8")
SERVER_PY = (BACKEND / "server.py").read_text(encoding="utf-8")
PERMS_PY = (BACKEND / "permissions.py").read_text(encoding="utf-8")
APP_JS = (FRONTEND / "src" / "App.js").read_text(encoding="utf-8")
APPSHELL = (FRONTEND / "src" / "components" / "layout" / "AppShell.jsx").read_text(encoding="utf-8")
VISITOR_JSX = (FRONTEND / "src" / "pages" / "VisitorSignIn.jsx").read_text(encoding="utf-8")
ADMIN_JSX = (FRONTEND / "src" / "pages" / "AdminVisitors.jsx").read_text(encoding="utf-8")
VERSION_JS = (FRONTEND / "src" / "lib" / "version.js").read_text(encoding="utf-8")
SW_JS = (FRONTEND / "public" / "service-worker.js").read_text(encoding="utf-8")


# ── Backend module structure ────────────────────────────────────

def test_visitor_module_imports_cleanly():
    """Importing the module must not raise (catches typos / bad imports)."""
    import importlib, sys
    sys.path.insert(0, str(BACKEND))
    m = importlib.import_module("visitor_signins")
    assert hasattr(m, "public_router")
    assert hasattr(m, "public_flat")
    assert hasattr(m, "admin_router")
    # Route paths cover the brief's endpoint surface.
    all_paths = set()
    for r in list(m.public_router.routes) + list(m.public_flat.routes) + list(m.admin_router.routes):
        all_paths.add(getattr(r, "path", ""))
    assert "/public/site/{scan_token}/form" in all_paths
    assert "/public/visitor/site/{scan_token}/signin" in all_paths
    assert "/public/visitor/{visitor_id}/sign-out" in all_paths
    assert "/admin/visitors" in all_paths
    assert "/admin/visitors/{visitor_id}" in all_paths
    assert "/admin/visitors/{visitor_id}/force-signout" in all_paths


def test_public_signin_is_rate_limited():
    """Brief requires POST signin at 10/hour per IP."""
    assert re.search(r"@limiter\.limit\(\s*[\"']10/hour[\"']\s*\)", VISITOR_PY), (
        "public signin does not carry the 10/hour slowapi rate limit"
    )


def test_admin_endpoints_use_safe_wrapper():
    """CF 520 mitigation — every admin endpoint must be @safe_admin_endpoint."""
    admin_blocks = re.findall(
        r"@admin_router\.\w+\([^)]*\)\s*\n(@[^\n]+\n)*",
        VISITOR_PY,
    )
    assert admin_blocks, "no admin endpoints found"
    for block in admin_blocks:
        assert "safe_admin_endpoint" in block, (
            f"admin endpoint decorator block missing @safe_admin_endpoint: {block!r}"
        )


def test_signin_requires_induction_ack():
    """`induction_acknowledged` must be a hard `if not body.induction_acknowledged: raise` gate."""
    assert re.search(
        r"if\s+not\s+body\.induction_acknowledged\s*:\s*\n\s*raise\s+HTTPException",
        VISITOR_PY,
    ), "signin does not enforce induction_acknowledged"


def test_signout_requires_site_scan_token():
    """Public sign-out must require `token=…` so a random URL holder
    can't sign out arbitrary visitors."""
    m = re.search(
        r"async\s+def\s+public_visitor_signout\([^)]*\btoken:\s*str",
        VISITOR_PY,
    )
    assert m, "public_visitor_signout does not require the site scan token"


def test_archived_site_rejected():
    """`_site_by_token()` must reject archived sites with 410 Gone."""
    assert re.search(
        r'site\.get\("archived"\)[\s\S]{0,120}?raise\s+HTTPException\(\s*410',
        VISITOR_PY,
    ), "_site_by_token does not reject archived sites"


# ── server.py wire-in ──────────────────────────────────────────

def test_server_includes_visitor_routers():
    assert "from visitor_signins import" in SERVER_PY
    for r in ("visitor_public_router", "visitor_public_flat_router", "visitor_admin_router"):
        assert f"api.include_router({r})" in SERVER_PY, f"missing include_router({r})"


# ── permissions ─────────────────────────────────────────────────

def test_sites_visitors_in_permissions_schema():
    assert re.search(
        r'"sites_visitors":\s*\{[^}]*"label":\s*"Site visitors"',
        PERMS_PY,
    ), "sites_visitors is not in PERMISSIONS_SCHEMA"


def test_admin_role_gets_sites_visitors_by_default():
    assert re.search(
        r'ROLE_DEFAULTS\["admin"\]\["sites_visitors"\]\s*=\s*_grant\(\s*view=True,\s*edit=True',
        PERMS_PY,
    ), "admin ROLE_DEFAULTS does not grant sites_visitors view+edit"


# ── frontend wiring ────────────────────────────────────────────

def test_public_visitor_route_registered():
    assert re.search(
        r'<Route\s+path="/scan/site/:token/visitor"\s+element=\{<VisitorSignIn\s*/>\}',
        APP_JS,
    ), "public /scan/site/:token/visitor route not registered"


def test_admin_visitor_route_registered():
    assert re.search(
        r'<Route\s+path="admin/visitors"\s+element=\{<AdminVisitors\s*/>\}',
        APP_JS,
    ), "admin /app/admin/visitors route not registered"


def test_sidebar_entry_present():
    assert "'/app/admin/visitors'" in APPSHELL
    assert "'sites_visitors.view'" in APPSHELL, (
        "sidebar entry is not permission-gated on sites_visitors.view"
    )


def test_visitor_form_has_required_testids():
    for tid in (
        "visitor-form", "visitor-form-site-name",
        "visitor-name-input", "visitor-purpose-select",
        "visitor-induction-check", "visitor-submit-btn",
        "visitor-receipt", "visitor-signout-btn",
    ):
        assert f'data-testid="{tid}"' in VISITOR_JSX, f"missing testid {tid!r}"


def test_admin_page_has_required_testids():
    for tid in (
        "admin-visitors-page", "admin-visitors-table",
        "admin-visitors-refresh", "admin-visitors-active-only",
    ):
        assert f'data-testid="{tid}"' in ADMIN_JSX, f"missing testid {tid!r}"


# ── Version-sync pins ─────────────────────────────────────────

def _tail(text, name):
    m = re.search(rf"{name}\s*=\s*['\"]paneltec-v[\d.]+\.(\d+)['\"]", text)
    assert m, f"could not read tail of {name}"
    return int(m.group(1))


def test_running_version_gte_106():
    assert _tail(VERSION_JS, "RUNNING_VERSION") >= 106


def test_cache_version_gte_106():
    assert _tail(SW_JS, "CACHE_VERSION") >= 106

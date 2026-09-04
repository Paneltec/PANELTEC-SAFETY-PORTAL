"""v58.13.107 — Backend prep for the Mobile "Create Site with GPS"
feature.

Combines source-pin structural checks with runtime module-import
inspection (route path discovery via APIRouter introspection).

The full HTTP contract (auth, dedupe hit, list, close, idempotency,
non-creator 403) is exercised via curl in the ship report. Those
flows aren't reproduced in pytest because they need a live DB and a
seeded admin JWT — the source-pin surface below is enough to catch
regressions in CI while the shipped code sits behind the auth wall.

Pattern mirrors .100 / .103 / .105 / .106 / .106a source-pin tests.
"""
from __future__ import annotations
import importlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"

MOBILE_PY = (BACKEND / "mobile_sites.py").read_text(encoding="utf-8")
SERVER_PY = (BACKEND / "server.py").read_text(encoding="utf-8")
VERSION_JS = (FRONTEND / "src" / "lib" / "version.js").read_text(encoding="utf-8")
SW_JS = (FRONTEND / "public" / "service-worker.js").read_text(encoding="utf-8")
MOBILE_VERSION_TS = (ROOT / "mobile" / "src" / "lib" / "version.ts").read_text(encoding="utf-8")


# ── Module structure + route registration ──────────────────────────

def test_module_imports_and_registers_three_routes():
    sys.path.insert(0, str(BACKEND))
    m = importlib.import_module("mobile_sites")
    assert hasattr(m, "router"), "mobile_sites must export `router`"
    router = m.router
    paths = {getattr(r, "path", "") for r in router.routes}
    # Prefix on the router is `/mobile/sites`; path attributes carry the
    # sub-path segment.
    assert "/mobile/sites" in paths, f"POST /mobile/sites missing; saw {paths!r}"
    assert "/mobile/sites/mine" in paths, f"GET /mobile/sites/mine missing; saw {paths!r}"
    assert "/mobile/sites/{site_id}/close" in paths, (
        f"PATCH /mobile/sites/{{site_id}}/close missing; saw {paths!r}"
    )


def test_server_registers_mobile_sites_router():
    assert re.search(
        r"from\s+mobile_sites\s+import\s+router\s+as\s+mobile_sites_router",
        SERVER_PY,
    ), "server.py must import `router as mobile_sites_router`"
    assert "api.include_router(mobile_sites_router)" in SERVER_PY, (
        "server.py must `api.include_router(mobile_sites_router)`"
    )


# ── Compliance rails ───────────────────────────────────────────────

def test_list_and_close_are_safe_admin_wrapped():
    """`/mine` and `/{id}/close` must go through `@safe_admin_endpoint`
    so an unhandled crash returns clean JSON 500 instead of a CF 520."""
    assert "from admin_safe_wrapper import safe_admin_endpoint" in MOBILE_PY
    # Guard against future re-orderings — decorator must sit BELOW the
    # `@router.get("/mine")` and `@router.patch("/{site_id}/close")` lines.
    assert re.search(
        r'@router\.get\("/mine"\)\s*\n\s*@safe_admin_endpoint',
        MOBILE_PY,
    ), "@safe_admin_endpoint must decorate GET /mine (below @router.get)"
    assert re.search(
        r'@router\.patch\("/\{site_id\}/close"\)\s*\n\s*@safe_admin_endpoint',
        MOBILE_PY,
    ), "@safe_admin_endpoint must decorate PATCH /{site_id}/close (below @router.patch)"


def test_create_endpoint_is_auth_gated_but_not_safe_admin_wrapped():
    """POST /mobile/sites deliberately skips @safe_admin_endpoint so its
    422 (pydantic validation) and 200-with-created=False (dedupe hit)
    stay part of the mobile-app contract instead of getting collapsed
    into 500s."""
    # Auth dependency is present on the create handler.
    assert "async def mobile_create_site" in MOBILE_PY
    assert "Depends(get_current_user)" in MOBILE_PY, (
        "POST /mobile/sites must depend on get_current_user"
    )
    # Not wrapped in @safe_admin_endpoint immediately after @router.post.
    assert not re.search(
        r'@router\.post\(""\)\s*\n\s*@safe_admin_endpoint',
        MOBILE_PY,
    ), (
        "POST /mobile/sites must NOT be wrapped in @safe_admin_endpoint — "
        "its 200-with-created=False dedupe response is part of the "
        "mobile-app contract."
    )


def test_no_comms_side_effects_in_mobile_sites():
    """Belt-and-braces: this module must NOT reference any comms path
    (email outbox, TextMagic, M365, notifications). Anything that
    would need Comms Safe Mode was left out of this ship."""
    forbidden = [
        r"queue_email_doc",
        r"graph_send_mail",
        r"safe_send_sms",
        r"tm_send",
        r"outbound_emails",
        r"comms_outbox",
        r"notifications",
    ]
    for pat in forbidden:
        assert not re.search(pat, MOBILE_PY), (
            f"mobile_sites.py must not reference `{pat}` — no comms side-"
            "effects allowed in mobile Create-Site prep."
        )


# ── Behaviour pins ─────────────────────────────────────────────────

def test_dedupe_radius_is_50m_and_haversine_implemented():
    assert re.search(r"DEDUPE_RADIUS_M\s*=\s*50(?:\.0+)?", MOBILE_PY), (
        "DEDUPE_RADIUS_M must be exactly 50 metres per brief"
    )
    # Haversine implementation present.
    assert "def _haversine_m" in MOBILE_PY
    assert "atan2" in MOBILE_PY
    assert "6_371_000" in MOBILE_PY or "6371000" in MOBILE_PY, (
        "Earth radius should be in metres for a 50 m dedupe check"
    )


def test_haversine_math_matches_geodesy_reference():
    """Runtime sanity check — pin the haversine to a known Sydney
    reference distance. Opera House → Sydney Tower ≈ 1.6 km on the
    great circle. Tolerance ±100 m for the spherical-earth model."""
    sys.path.insert(0, str(BACKEND))
    m = importlib.import_module("mobile_sites")
    d = m._haversine_m(-33.8568, 151.2153, -33.8703, 151.2085)  # Opera → Tower
    assert 1500 <= d <= 1750, (
        f"Haversine reference check failed: expected ~1.6 km Opera→Tower, got {d:.1f} m"
    )
    # Zero distance for identical points.
    assert m._haversine_m(0, 0, 0, 0) == 0.0
    # 50 m dedupe boundary sanity — a 40 m north shift at Sydney latitude
    # should register as ≤ DEDUPE_RADIUS_M.
    d40 = m._haversine_m(-33.8568, 151.2153, -33.85644, 151.2153)  # ~40 m north
    assert d40 < m.DEDUPE_RADIUS_M, (
        f"40 m offset must be inside DEDUPE_RADIUS_M=50, got {d40:.1f}"
    )


def test_visitor_url_prefers_react_app_backend_url():
    """visitor_url returned by the POST /mobile/sites response should
    embed the absolute public origin so the mobile app can encode it
    directly into a QR without stitching a base URL client-side."""
    assert "REACT_APP_BACKEND_URL" in MOBILE_PY
    assert "/scan/site/" in MOBILE_PY
    assert "/visitor" in MOBILE_PY


def test_close_endpoint_is_idempotent_and_creator_gated():
    """Close-site must return `already: True` when the row already
    carries a `closed_at`, and reject non-creator non-admin callers
    with 403 (documented in module docstring)."""
    # Idempotent branch returns the same row + `already: True`.
    assert re.search(r'"already":\s*True', MOBILE_PY), (
        "close endpoint must return `already: True` on the idempotent "
        "re-close branch"
    )
    # 403 gate: only creator or admin.
    assert re.search(
        r'raise HTTPException\(403,\s*"Only the creator or an admin',
        MOBILE_PY,
    ), (
        "close endpoint must return 403 when the caller is neither the "
        "creator nor an admin"
    )


def test_mobile_created_sites_carry_source_marker():
    """Rows written by POST /mobile/sites must carry `source:
    "mobile_create"` so admin dashboards can filter them out of
    Simpro-source-of-truth queries if needed."""
    assert re.search(r'"source":\s*"mobile_create"', MOBILE_PY), (
        "New rows must be stamped `source: \"mobile_create\"`"
    )


# ── Version-sync forward-safe pins ─────────────────────────────────

def _ge_107(version: str) -> bool:
    m = re.search(r"58\.13\.(\d+)([a-z]*)", version)
    if not m:
        return False
    return int(m.group(1)) >= 107


def test_running_version_ge_107():
    m = re.search(r"RUNNING_VERSION\s*=\s*'([^']+)'", VERSION_JS)
    assert m, "RUNNING_VERSION not found"
    assert _ge_107(m.group(1)), f"RUNNING_VERSION {m.group(1)!r} must be >= .107"


def test_mobile_bundle_version_ge_107():
    m = re.search(r"MOBILE_BUNDLE_VERSION\s*=\s*'([^']+)'", MOBILE_VERSION_TS)
    assert m, "MOBILE_BUNDLE_VERSION not found"
    assert _ge_107(m.group(1)), f"MOBILE_BUNDLE_VERSION {m.group(1)!r} must be >= .107"


def test_service_worker_cache_version_ge_107():
    m = re.search(r"CACHE_VERSION\s*=\s*'([^']+)'", SW_JS)
    assert m, "CACHE_VERSION not found"
    assert _ge_107(m.group(1)), f"SW CACHE_VERSION {m.group(1)!r} must be >= .107"

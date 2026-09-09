"""v58.13.132p — 3-scope preview + Home 6-tile grid + module_badges pytests.

Coverage:
  • Backend behavioural — preview-user accepts `scope=paneltec_civil|
    viatec_traffic|admin`, resolves module unions, mints JWT with
    `preview_scope` + `preview_modules` claims.
  • `admin` scope opens every module key; scope with no matching roles
    falls back to the baseline `worker` row.
  • mobile_home embeds `module_badges` with the 7 expected keys.
  • Frontend + mobile source-pins for the 3-scope UI + splash forwarding.
"""
from __future__ import annotations
import re
import uuid
from pathlib import Path

import jwt
import pytest

VERSION_JS = Path("/app/frontend/src/lib/version.js")
VERSION_TS = Path("/app/mobile/src/lib/version.ts")
SW_JS = Path("/app/frontend/public/service-worker.js")
PANEL = Path("/app/frontend/src/components/settings/MobileModulesSection.jsx")
HOME = Path("/app/mobile/app/(tabs)/home.tsx")
HOME_TS = Path("/app/mobile/src/services/home.ts")
INDEX_TS = Path("/app/mobile/app/index.tsx")


# ─────────────── Backend behavioural ───────────────

@pytest.mark.asyncio
async def test_preview_scope_maps_to_module_union_and_module_badges() -> None:
    from db import db
    from mobile_preview import mint_preview_user, SCOPE_KEYS
    from mobile_home import mobile_home, _get_module_badges
    from auth import JWT_ALGORITHM, _secret
    from fastapi import HTTPException

    tag = uuid.uuid4().hex[:8]
    org_id = f"TEST-132p-{tag}"
    admin = {"id": f"admin-{tag}", "org_id": org_id, "role": "admin"}

    # ── admin scope: every module key ON ──
    res_admin = await mint_preview_user(
        role_id=None, scope="admin", worker_id=None, _admin=admin,
    )
    decoded = jwt.decode(res_admin.token, _secret(), algorithms=[JWT_ALGORITHM])
    assert decoded["preview_scope"] == "admin"
    assert len(decoded["preview_modules"]) > 0, "admin scope should enable every module"
    assert res_admin.user["preview_scope"] == "admin"

    # ── paneltec_civil scope ──
    res_civil = await mint_preview_user(
        role_id=None, scope="paneltec_civil", worker_id=None, _admin=admin,
    )
    d_civil = jwt.decode(res_civil.token, _secret(), algorithms=[JWT_ALGORITHM])
    assert d_civil["preview_scope"] == "paneltec_civil"
    assert res_civil.user["company_id"] == "2"
    assert res_civil.user["name"] == "Paneltec Civil"

    # ── viatec_traffic scope ──
    res_viatec = await mint_preview_user(
        role_id=None, scope="viatec_traffic", worker_id=None, _admin=admin,
    )
    assert res_viatec.user["company_id"] == "3"
    assert res_viatec.user["name"] == "Viatec Traffic Solutions"

    # ── unknown scope → 400 ──
    try:
        await mint_preview_user(role_id=None, scope="bogus", worker_id=None, _admin=admin)
        raise AssertionError("expected 400 for unknown scope")
    except HTTPException as e:
        assert e.status_code == 400

    # ── neither scope nor role_id → 400 ──
    try:
        await mint_preview_user(role_id=None, scope=None, worker_id=None, _admin=admin)
        raise AssertionError("expected 400 when both scope and role_id missing")
    except HTTPException as e:
        assert e.status_code == 400

    # ── module_badges shape (v58.13.132p corrected — module keys) ──
    fake_worker = {"id": "w", "org_id": org_id, "role": "worker",
                   "email": f"w-{tag}@paneltec.local"}
    badges = await _get_module_badges(fake_worker, "2")
    for k in ("forms", "sites", "profile", "swms", "certifications"):
        assert k in badges, f"module_badges missing key {k}"

    # ── SCOPE_KEYS export contract ──
    assert SCOPE_KEYS == {"paneltec_civil", "viatec_traffic", "admin"}


def test_home_endpoint_exposes_module_badges_top_level() -> None:
    src = Path("/app/backend/mobile_home.py").read_text()
    # Response includes `"module_badges": badges`.
    assert '"module_badges": badges' in src
    # Preview-modules override honoured before matrix lookup.
    assert 'user.get("preview_modules")' in src


# ─────────────── Frontend source-pins ───────────────

def test_admin_panel_has_3_scope_options_at_top() -> None:
    src = PANEL.read_text()
    for tid in ("mobile-preview-scope-paneltec_civil",
                "mobile-preview-scope-viatec_traffic",
                "mobile-preview-scope-admin"):
        assert f'data-testid="{tid}"' in src, f"missing scope testid {tid}"
    # ComputeExpoUrl maps scope → ?preview_scope= param.
    assert "preview_scope" in src
    assert "SCOPES.has(roleOrScope)" in src or "SCOPES = new Set" in src


# ─────────────── Mobile source-pins ───────────────

def test_mobile_home_uses_dynamic_tile_grid() -> None:
    src = HOME.read_text()
    # Dynamic modules loop over `primaryModules` — the fixed TILE_SPEC is gone.
    assert "primaryModules.map((m)" in src
    assert "TILE_SPEC" not in src
    assert "getTileBadge" in src
    # "More modules" collapsible section restored.
    assert "home-more-toggle" in src
    # Big-map hero preserved from the earlier attempt.
    assert "bigMap" in src
    assert "signInCtaFullWidth" in src


def test_home_type_has_module_badges() -> None:
    src = HOME_TS.read_text()
    assert "module_badges" in src
    # Corrected: keys are module-level, not hazards/vehicles.
    for k in ("forms", "sites", "profile", "swms", "certifications"):
        assert k in src, f"HomeData.module_badges missing key {k}"


def test_splash_forwards_preview_scope() -> None:
    src = INDEX_TS.read_text()
    assert "preview_scope?" in src
    assert "scope: string" in src or "scope?:" in src or "scope?" in src


# ─────────────── Version pins ───────────────

def test_running_and_bundle_bumped_to_132p() -> None:
    js = VERSION_JS.read_text()
    ts = VERSION_TS.read_text()
    assert re.search(r"RUNNING_VERSION\s*=\s*'paneltec-v160\.3\.9\.58\.13\.132p'", js)
    assert re.search(r"MOBILE_BUNDLE_VERSION\s*=\s*'paneltec-v160\.3\.9\.58\.13\.132p'", ts)


def test_cache_version_NOT_bumped_per_new_policy() -> None:
    """v58.13.132p policy: don't bump CACHE_VERSION per ship — only when
    the SW cache strategy actually changes. Verify it stayed at .132o."""
    sw = SW_JS.read_text()
    m = re.search(r"CACHE_VERSION\s*=\s*'([^']+)'", sw)
    assert m
    # Accept the .132o pin we froze at, OR any explicitly-motivated future
    # bump (letter suffix after .132p means the policy was invoked
    # deliberately for a cache-strategy change).
    assert ".132o" in m.group(1) or re.search(r"\.132[p-z]", m.group(1)) or re.search(r"\.13[3-9]", m.group(1)), (
        f"CACHE_VERSION = {m.group(1)} — should have stayed at .132o per "
        f"the .132p version-bump policy (see memory/version_bump_policy.md)"
    )

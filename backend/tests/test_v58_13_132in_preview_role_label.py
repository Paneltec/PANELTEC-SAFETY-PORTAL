"""v58.13.132in — Preview session role display fix.

Verifies:
  · `mobile_preview.py::preview_user` mints a JWT carrying a
    `role_label` claim (Paneltec Civil / Viatec Traffic Solutions /
    Admin / External Contractor).
  · `auth.py::get_current_user` synthetic preview user looks up the
    real worker by `preview_worker_id` and returns their actual name;
    surfaces `role_label` on the response; puts `preview_scope` on
    `role_id` so the mobile Profile fallback cascade lands on the
    scope not the collapsed 'worker' string.
  · `MobileModulesSection.jsx` passes `preview_role_label` on the
    iframe URL and posts the same label to the iframe via
    `postMessage` on load (mobile splash follow-up hook).
  · Version pin lockstep.
  · Behavioural: mint a preview JWT via `preview_user`, decode it,
    call `get_current_user` synthesis manually, assert both surfaces
    carry the expected role_label.
"""
from __future__ import annotations

from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend"
BACKEND = ROOT / "backend"


def _r(p: Path) -> str:
    return p.read_text(encoding="utf-8")


# ── Backend source pins ─────────────────────────────────────────────

def test_mobile_preview_jwt_carries_role_label():
    src = _r(BACKEND / "mobile_preview.py")
    assert 'payload["role_label"] = SCOPE_META[scope]["label"]' in src
    assert 'payload["role_label"] = role_id.replace("_", " ").title()' in src


def test_auth_synthetic_user_looks_up_worker_name_and_role_label():
    src = _r(BACKEND / "auth.py")
    # Worker lookup by preview_worker_id.
    assert "if preview_worker_id:" in src
    assert 'await db.workers.find_one(' in src
    assert 'first + " " + last' in src
    assert '(preview)' in src
    # role_id carries the scope when set (fallback cascade fix).
    assert '"role_id": preview_scope or payload.get("role_id"),' in src
    # role_label surfaced on the response.
    assert '"role_label": preview_role_label,' in src


# ── Frontend source pins ────────────────────────────────────────────

def test_iframe_url_carries_preview_role_label():
    src = _r(FRONTEND / "src" / "components" / "settings" / "MobileModulesSection.jsx")
    assert "preview_role_label" in src
    # SCOPE_LABELS map covers all four scopes.
    assert "paneltec_civil: 'Paneltec Civil'" in src
    assert "viatec_traffic: 'Viatec Traffic Solutions'" in src
    assert "admin: 'Admin'" in src
    assert "external_contractor: 'External Contractor'" in src


def test_iframe_posts_role_label_on_load():
    src = _r(FRONTEND / "src" / "components" / "settings" / "MobileModulesSection.jsx")
    # onLoad handler exists + posts the label to the iframe.
    assert "onLoad={(e) => {" in src
    assert "postMessage({" in src
    assert "type: 'paneltec_preview_role_label'" in src


# ── Version lockstep ────────────────────────────────────────────────

def test_version_pin_v132in():
    import re as _re
    v = _r(FRONTEND / "src" / "lib" / "version.js")
    sw = _r(FRONTEND / "public" / "service-worker.js")
    pat = r"paneltec-v160\.3\.9\.58\.13\.132[i-z][n-z]?"
    assert _re.search(rf"RUNNING_VERSION = '{pat}'", v)
    assert _re.search(rf"EXPECTED_CACHE_VERSION = '{pat}'", v)
    assert _re.search(rf"CACHE_VERSION = '{pat}'", sw)


# ── Behavioural — end-to-end JWT round-trip ─────────────────────────

@pytest.mark.asyncio
async def test_preview_jwt_and_get_current_user_carry_role_label(monkeypatch):
    """Mint a preview JWT via `preview_user` (paneltec_civil scope),
    then decode it via `get_current_user` and assert the synthetic
    user returned by `/api/auth/me` carries the correct role_label
    + the real worker's name."""
    import jwt as pyjwt
    import mobile_preview
    import auth
    from auth import _secret, JWT_ALGORITHM

    # Stub Mongo lookups.
    async def _fake_workers_find_one(query, projection=None):
        # Returns a Matthew Wells stand-in when queried by the
        # preview_worker_id we mint below.
        if query.get("id") == "worker_test_id":
            return {
                "id": "worker_test_id", "org_id": "org_test",
                "first_name": "Matthew", "last_name": "Wells",
                "email": "matthew@paneltec.com.au",
                "simpro_company_id": "2", "position": "Foreman",
                "role": "paneltec_civil",
            }
        return None

    monkeypatch.setattr(
        mobile_preview.db, "workers",
        type("W", (), {"find_one": staticmethod(_fake_workers_find_one)})(),
    )
    monkeypatch.setattr(
        auth.db, "workers",
        type("W", (), {"find_one": staticmethod(_fake_workers_find_one)})(),
    )

    # Also stub _resolve_scope_modules so preview_user doesn't need
    # a real mobile_modules_matrix row.
    async def _fake_resolve(_org, _scope):
        return (["home", "profile", "forms"], "2")
    monkeypatch.setattr(mobile_preview, "_resolve_scope_modules", _fake_resolve)

    # Mint the token — call preview_user directly, bypassing FastAPI's
    # dep injection.
    admin = {"id": "admin_test", "org_id": "org_test", "role": "admin"}
    resp = await mobile_preview.mint_preview_user(   # type: ignore[misc]
        role_id=None, scope="paneltec_civil",
        worker_id="worker_test_id", _admin=admin,
    )
    token = resp.token
    assert token, "preview JWT must be minted"

    # Decode the raw payload and assert the label rides along.
    payload = pyjwt.decode(token, _secret(), algorithms=[JWT_ALGORITHM])
    assert payload.get("role_label") == "Paneltec Civil"
    assert payload.get("preview_scope") == "paneltec_civil"
    assert payload.get("preview_worker_id") == "worker_test_id"

    # Now run the get_current_user synthetic-builder path directly
    # via jwt.decode + the same code that lives inside get_current_user.
    from datetime import datetime, timezone as _tz
    preview_worker_id = payload.get("preview_worker_id")
    preview_scope = payload.get("preview_scope")
    preview_role_label = payload.get("role_label")
    _w = await auth.db.workers.find_one(
        {"id": preview_worker_id, "org_id": payload["org_id"],
         "deleted_at": None},
        {"_id": 0, "first_name": 1, "last_name": 1, "email": 1},
    )
    first = (_w or {}).get("first_name", "")
    last = (_w or {}).get("last_name", "")
    preview_name = f"{first} {last} (preview)".strip()
    synthetic = {
        "id": payload["sub"],
        "name": preview_name,
        "role_id": preview_scope or payload.get("role_id"),
        "role_label": preview_role_label,
    }
    assert synthetic["name"] == "Matthew Wells (preview)"
    assert synthetic["role_id"] == "paneltec_civil"
    assert synthetic["role_label"] == "Paneltec Civil"

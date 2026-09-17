"""v58.13.132ho — SSRA vehicle picker resilience.

The `.132gx` ship handed the FE `VehicleNavixyField` a soft
`{status: navixy_disconnected}` envelope on hash-invalid so it
could fall back to manual-entry mode. Two gaps remained that
Stephen surfaced on SSRA forms:

1. Backend still raised HTTP 502 on the `except Exception` catch-all
   (Navixy 5xx / DNS blip / connection reset / decode error).
   FE surfaced that as a red-error dead-end — the worker had no
   manual-entry fallback until the SSRA was abandoned.
2. FE `catch` branch never flipped `mode` to manual OR set the
   soft-disconnected banner — again a dead-end.

`.132ho` closes both:
 * `forms.py::list_fleet_for_forms` now returns HTTP 200 with a new
   `status: "navixy_unavailable"` payload on the catch-all, mirroring
   the `.132gx` envelope shape.
 * `Forms.jsx::VehicleNavixyField.useEffect` treats both statuses
   (`navixy_disconnected` and `navixy_unavailable`) as the same
   "flip to manual mode + amber banner" class, and the `catch`
   branch degrades to the same soft-response instead of red-erroring.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest
import requests

from tests.conftest import ADMIN_EMAIL, ADMIN_PWD, API

pytestmark = pytest.mark.live_db_writes

APP_ROOT = Path(__file__).resolve().parents[2]
FORMS_PY = APP_ROOT / "backend" / "forms.py"
FORMS_JSX = APP_ROOT / "frontend" / "src" / "pages" / "Forms.jsx"
VJS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def _login() -> dict:
    r = requests.post(
        f"{API}/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PWD},
        timeout=30,
    )
    if r.status_code == 429:
        pytest.skip("rate-limited")
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


# ─────────────── Backend: soft-response catch-all ───────────────


def test_backend_catch_all_returns_soft_navixy_unavailable():
    src = _read(FORMS_PY)
    # Old 502-raise is gone from list_fleet_for_forms.
    assert 'raise HTTPException(502, f"Navixy fleet unavailable' not in src
    # New soft-response pin.
    assert '"status": "navixy_unavailable"' in src
    assert '"Fleet integration is temporarily unavailable"' in src or (
        "Fleet integration is temporarily unavailable" in src
    )


def test_backend_forms_fleet_still_soft_on_disconnect_live():
    """Guard against a regression that flips the 200-soft back to a
    hard error. The endpoint MUST still return 200 with a soft status
    when Navixy is disconnected."""
    h = _login()
    r = requests.get(f"{API}/forms/fleet/vehicles", headers=h, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    # Either connected (rare in test env), disconnected, or unavailable —
    # never a raise.
    assert body.get("status") in ("ok", "navixy_disconnected", "navixy_unavailable")
    assert isinstance(body.get("vehicles"), list)
    if body.get("status") != "ok":
        assert body.get("message"), "soft-response must carry an actionable message"


# ─────────────── Frontend: unified soft handling ───────────────


def test_frontend_effect_treats_both_statuses_as_soft():
    src = _read(FORMS_JSX)
    assert "'navixy_disconnected'" in src
    assert "'navixy_unavailable'" in src
    # Both statuses OR'd together as the soft-response class.
    pattern = re.compile(
        r"r\.data\?\.status === 'navixy_disconnected'\s*\n?\s*\|\|\s*"
        r"r\.data\?\.status === 'navixy_unavailable'"
    )
    assert pattern.search(src), "both statuses must be OR'd in soft-check"


def test_frontend_catch_branch_flips_to_manual_mode():
    src = _read(FORMS_JSX)
    # The old catch was a one-liner `.catch((e) => setError(apiError(e)))`.
    assert ".catch((e) => setError(apiError(e)))" not in src
    # New catch must switch to manual mode + set disconnectedMsg.
    # Anchor on the specific fallback banner text.
    assert (
        "Fleet integration is temporarily unreachable" in src
    ), "catch branch must show the amber-fallback banner"
    # Signature comment marker for provenance.
    assert "v58.13.132ho" in src


# ─────────────── Regression guard: SSRA still uses vehicle_navixy ─


def test_ssra_templates_carry_vehicle_navixy_field_live():
    """Live pin. Both SSRA templates must expose a `vehicle_navixy`
    field labelled 'Select Vehicle'. If a template migration
    accidentally regresses this to a plain `text` or `select`, the
    picker (and thus `.132ho`) can't help — this test catches it."""
    h = _login()
    r = requests.get(f"{API}/forms/templates?limit=500", headers=h, timeout=20)
    assert r.status_code == 200, r.text
    body = r.json()
    items = body if isinstance(body, list) else body.get("items", body.get("templates", []))
    ssras = [
        t for t in items
        if "ssra" in (t.get("name") or "").lower()
        or "construction & excavation" in (t.get("name") or "").lower()
    ]
    assert len(ssras) >= 2, (
        f"Expected at least 2 SSRA templates in Stephen's org, "
        f"found {len(ssras)}: {[t.get('name') for t in ssras]}"
    )
    for t in ssras:
        vehicle_navixy_fields = [
            f for f in t.get("fields", [])
            if f.get("type") == "vehicle_navixy"
        ]
        assert len(vehicle_navixy_fields) >= 1, (
            f"SSRA template {t.get('name')!r} lost its vehicle_navixy "
            f"field — the .132ho / .132gx fixes cannot help it any more."
        )


# ─────────────── Version lockstep ───────────────


def test_version_bumped_to_132ho():
    js, sw = _read(VJS), _read(SW)
    assert re.search(r"RUNNING_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132ho'", js)
    assert re.search(r"EXPECTED_CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132ho'", js)
    assert re.search(r"CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132ho'", sw)

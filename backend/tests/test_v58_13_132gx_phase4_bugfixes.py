"""v58.13.132gx — Phase 4 bug fixes.

Bug 1: Pre-start Select-Vehicle dropdown empty.
  Root cause — the stored Navixy `session_hash` expires. The old
  endpoint returned HTTP 400 "Hash invalid — refresh in Settings
  → Integrations → Navixy", which workers can't act on and which
  the FE surfaced as an unusable dropdown. Fix — auto-refresh
  the hash inline once using the stored credentials, retry, and
  on continued failure return a soft
  `{"vehicles": [], "status": "navixy_disconnected", "message":
  "..."}` with HTTP 200 so the FE can render a reconnect banner
  AND fall back to manual entry mode.

Bug 2: SSRAs incorrectly appearing in the Risk Assessments tab.
  Root cause — `build_router` mirror-union pulled every
  `form_submissions` row with `template_category_snapshot ==
  "risk_assessment"`, which includes SSRAs since the classifier
  routes some SSRA templates to that category. Fix — added a
  new `exclude_name_regex` kwarg to `build_router`. The RA
  router passes `\\bssra\\b|site\\s*specific\\s*risk` so
  submissions whose template name matches SSRA are dropped from
  both the mirror query AND the native list.
"""
from __future__ import annotations

import re
import uuid as _uuid
from pathlib import Path
from datetime import datetime, timezone

import pytest
import requests

from tests.conftest import ADMIN_EMAIL, ADMIN_PWD, API

pytestmark = pytest.mark.live_db_writes

APP_ROOT = Path(__file__).resolve().parents[2]
FORMS = APP_ROOT / "backend" / "forms.py"
CRUD = APP_ROOT / "backend" / "crud.py"
FORMS_JSX = APP_ROOT / "frontend" / "src" / "pages" / "Forms.jsx"
VERSION_JS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def _login() -> dict:
    r = requests.post(f"{API}/auth/login",
                        json={"email": ADMIN_EMAIL, "password": ADMIN_PWD},
                        timeout=30)
    if r.status_code == 429:
        pytest.skip("rate-limited")
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


# ─── Bug 1: Vehicle dropdown ──────────────────────────────────

def test_backend_forms_fleet_endpoint_has_auto_refresh_and_soft_response():
    src = _read(FORMS)
    # Pin the auto-refresh block + soft-response return shape.
    for pin in (
        "async def _auto_refresh_hash()",
        "await c.post(\n                    f\"{base}/v2/user/auth\"",
        '"navixy_disconnected"',
        '"Fleet integration needs reconnecting',
    ):
        assert pin in src, f"missing pin: {pin!r}"
    # Endpoint MUST still be at GET /forms/fleet/vehicles (URL
    # under the /forms prefix). The FE calls this exact path.
    assert '@router.get("/fleet/vehicles")' in src


def test_backend_forms_fleet_returns_200_soft_when_navixy_stale():
    """When Navixy hash is expired and auto-refresh can't recover,
    the endpoint MUST return HTTP 200 with the soft-disconnected
    payload — never HTTP 400. Blocking regression pin."""
    h = _login()
    r = requests.get(f"{API}/forms/fleet/vehicles", headers=h, timeout=30)
    # Two acceptable outcomes on live data:
    #   · 200 with vehicles list (Navixy healthy) — status="ok".
    #   · 200 with soft-disconnected payload — status="navixy_disconnected".
    # HTTP 400 or 404 is a regression.
    assert r.status_code == 200, (
        f"Vehicle endpoint returned {r.status_code}: {r.text[:200]}"
    )
    body = r.json()
    assert "vehicles" in body and isinstance(body["vehicles"], list)
    assert body.get("status") in ("ok", "navixy_disconnected")
    if body["status"] == "navixy_disconnected":
        assert body.get("message"), "soft-disconnect must carry a message"
        assert body["vehicles"] == []


def test_frontend_honours_soft_disconnect_payload():
    src = _read(FORMS_JSX)
    for pin in (
        "disconnectedMsg",
        'r.data?.status === \'navixy_disconnected\'',
        # Mode auto-flipped to `manual` on disconnect so the form
        # isn't blocked while an admin fixes the integration.
        "setMode('manual')",
        "vehicle-navixy-disconnected-",
    ):
        assert pin in src, f"missing FE pin: {pin!r}"


# ─── Bug 2: SSRA leaks ────────────────────────────────────────

def test_build_router_accepts_exclude_name_regex():
    src = _read(CRUD)
    assert "exclude_name_regex: Optional[str] = None" in src, (
        "build_router must accept exclude_name_regex kwarg"
    )
    # Applied to mirror category-snapshot query.
    assert re.search(
        r"if exclude_name_regex:\s*\n\s+mq\[\"template_name_snapshot\"\]\s*=\s*\{",
        src,
    )
    # AND applied to the native list query.
    assert "native_q = q" in src


def test_risk_assessments_router_passes_ssra_exclusion():
    src = _read(CRUD)
    m = re.search(
        r"risk_assessments_router\s*=\s*build_router\([\s\S]{0,300}"
        r"exclude_name_regex=_SSRA_EXCLUDE_REGEX",
        src,
    )
    assert m, "risk_assessments_router must pass exclude_name_regex"
    # Regex must catch both `SSRA` (word-boundary) and `Site
    # Specific Risk (Assessment)` patterns.
    assert "_SSRA_EXCLUDE_REGEX" in src
    assert r"\bssra\b" in src
    assert "site" in src.lower()


def test_ssra_named_submission_absent_from_risk_assessments_list():
    """Behavioural: seed a `form_submissions` row whose template
    name is 'Drain Cleaning SSRA' with category=risk_assessment,
    then hit GET /api/risk-assessments and assert the row is NOT
    surfaced. Cleans up afterwards."""
    import asyncio, os
    from motor.motor_asyncio import AsyncIOMotorClient

    h = _login()
    # Login again to pull org_id / user id.
    login = requests.post(f"{API}/auth/login",
                            json={"email": ADMIN_EMAIL, "password": ADMIN_PWD},
                            timeout=30).json()
    org_id = None
    # Prefer /auth/me if available.
    try:
        me = requests.get(f"{API}/auth/me", headers=h, timeout=15)
        if me.status_code == 200:
            org_id = me.json().get("org_id")
    except Exception:
        pass

    now = datetime.now(timezone.utc).isoformat()
    seeded_id = f"pytest-ssra-{_uuid.uuid4().hex[:10]}"

    async def _do():
        c = AsyncIOMotorClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
        db = c[os.environ.get("DB_NAME", "test_database")]
        # Find org_id if we couldn't via /auth/me.
        nonlocal_org = org_id
        if not nonlocal_org:
            u = await db.users.find_one({"email": ADMIN_EMAIL})
            nonlocal_org = u.get("org_id") if u else None
        assert nonlocal_org, "cannot resolve org_id"
        await db.form_submissions.insert_one({
            "id": seeded_id,
            "org_id": nonlocal_org,
            "deleted_at": None,
            "archived_at": None,
            "template_id": "pytest-tpl-132gx",
            "template_name_snapshot": "Drain Cleaning SSRA — 132gx test",
            "template_category_snapshot": "risk_assessment",
            "created_at": now,
            "submitted_at": now,
            "fields": [],
            "workspace_id": None,
        })
        return nonlocal_org

    try:
        asyncio.run(_do())

        # Fetch RA list.
        r = requests.get(f"{API}/risk-assessments", headers=h, timeout=30)
        assert r.status_code == 200, r.text
        rows = r.json()
        ids = [row.get("id") for row in rows]
        assert seeded_id not in ids, (
            f"SSRA-named submission leaked into Risk Assessments list "
            f"(seeded id {seeded_id})"
        )
    finally:
        async def _rm():
            c = AsyncIOMotorClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
            db = c[os.environ.get("DB_NAME", "test_database")]
            await db.form_submissions.delete_one({"id": seeded_id})
        asyncio.run(_rm())


def test_generic_risk_assessment_still_appears():
    """Regression guard: the SSRA-exclusion regex must NOT catch
    generic RA rows whose template name doesn't say SSRA."""
    import asyncio, os
    from motor.motor_asyncio import AsyncIOMotorClient

    h = _login()
    now = datetime.now(timezone.utc).isoformat()
    seeded_id = f"pytest-ra-{_uuid.uuid4().hex[:10]}"

    async def _seed():
        c = AsyncIOMotorClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
        db = c[os.environ.get("DB_NAME", "test_database")]
        u = await db.users.find_one({"email": ADMIN_EMAIL})
        oid = u.get("org_id")
        await db.form_submissions.insert_one({
            "id": seeded_id,
            "org_id": oid,
            "deleted_at": None,
            "archived_at": None,
            "template_id": "pytest-tpl-132gx-b",
            "template_name_snapshot": "Excavation Risk Assessment — 132gx test",
            "template_category_snapshot": "risk_assessment",
            "created_at": now,
            "submitted_at": now,
            "fields": [],
            "workspace_id": None,
        })

    try:
        asyncio.run(_seed())
        r = requests.get(f"{API}/risk-assessments", headers=h, timeout=30)
        assert r.status_code == 200, r.text
        rows = r.json()
        ids = [row.get("id") for row in rows]
        assert seeded_id in ids, (
            "Generic Risk Assessment must still appear in the RA list "
            "(regression guard against over-eager SSRA regex)"
        )
    finally:
        async def _rm():
            c = AsyncIOMotorClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
            db = c[os.environ.get("DB_NAME", "test_database")]
            await db.form_submissions.delete_one({"id": seeded_id})
        asyncio.run(_rm())


# ─── Version pins ─────────────────────────────────────────────

def test_version_bumped_to_132gx():
    js = _read(VERSION_JS)
    sw = _read(SW)
    assert re.search(r"RUNNING_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gx'", js)
    assert re.search(r"EXPECTED_CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gx'", js)
    assert re.search(r"CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gx'", sw)

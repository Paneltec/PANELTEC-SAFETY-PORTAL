"""v58.13.54 — CS Incidents feature retired.

Data preserved (`cs_incident_issues` collection untouched, 257 rows
on preview), but the user-facing UI is gone:
  · sidebar entry deleted,
  · route replaced with a 90-day redirect to `/app`,
  · page file `pages/CsIncidentsList.jsx` deleted (bespoke
    `CsIncidentDetailModal` deleted with it — modal was inline).

Backend `/api/cs-incidents/*` routes stay live for 90 days for any
integration / bookmarked API URL, then a follow-up ship can 410
both the frontend redirect and the backend routes.

This test file is the single guard that the retirement stays
retired.
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path


_FRONTEND_SRC = Path("/app/frontend/src")
_BACKEND = Path("/app/backend")


def _read(rel: str) -> str:
    return (_FRONTEND_SRC / rel).read_text(encoding="utf-8")


# ── 1. Frontend surface is gone ─────────────────────────────────────


def test_appshell_has_no_cs_incidents_nav_entry():
    src = _read("components/layout/AppShell.jsx")
    assert "nav-submissions-cs-incidents" not in src, (
        "AppShell.jsx still emits the retired CS Incidents nav "
        "testid — sidebar entry must be deleted."
    )
    # The sidebar `to` path must not be in the NAV items list.
    # (The `to: '/app/submissions/cs-incidents'` string only lived
    # inside the deleted nav item — nothing else in AppShell uses it.)
    assert "to: '/app/submissions/cs-incidents'" not in src, (
        "AppShell.jsx still routes to the retired CS Incidents page."
    )


def test_app_js_has_no_cs_incidents_list_route():
    src = (_FRONTEND_SRC / "App.js").read_text(encoding="utf-8")
    # The IMPORT line + any mount that renders <CsIncidentsList/>
    # must be gone. A comment referencing the retired name is fine
    # — that's the removal-audit trail.
    assert "import CsIncidentsList" not in src, (
        "App.js still imports the retired CsIncidentsList page"
    )
    assert "<CsIncidentsList" not in src, (
        "App.js still renders <CsIncidentsList/> somewhere"
    )
    assert 'submissions/cs-incidents" element={<CsIncidentsList' not in src


def test_cs_incidents_list_file_is_deleted():
    assert not (_FRONTEND_SRC / "pages" / "CsIncidentsList.jsx").exists(), (
        "pages/CsIncidentsList.jsx must be deleted in v58.13.54"
    )


# ── 2. Redirect is in place (90-day grace window) ───────────────────


def test_app_js_redirects_cs_incidents_url_to_root_app():
    src = (_FRONTEND_SRC / "App.js").read_text(encoding="utf-8")
    # The exact route line the ship spec asked for.
    assert (
        '<Route path="submissions/cs-incidents" '
        'element={<Navigate to="/app" replace />} />'
    ) in src, (
        "App.js must ship the 90-day redirect from "
        "`/app/submissions/cs-incidents` to `/app`"
    )
    # And the bare `submissions` bookmark must also land somewhere sane.
    assert (
        '<Route path="submissions" '
        'element={<Navigate to="/app" replace />} />'
    ) in src, (
        "App.js must also redirect the bare `/app/submissions` URL "
        "to `/app` (the retired page was its only child)"
    )
    # 90-day removal marker for a future flip-to-410 ship.
    assert "REMOVE AFTER 2026-11-24" in src, (
        "App.js must carry the explicit removal date so a future "
        "ship knows exactly when to flip the redirects to 410."
    )


# ── 3. Backend routes + data preserved ──────────────────────────────


def test_backend_cs_incident_routes_still_registered():
    """The user asked to KEEP the backend routes live for a 90-day
    grace window. This guard trips if a future ship deletes them
    prematurely."""
    server_src = (_BACKEND / "server.py").read_text(encoding="utf-8")
    cs_src = (_BACKEND / "cs_incident.py").read_text(encoding="utf-8")
    assert "cs_incident" in server_src, (
        "cs_incident router import/mount removed from server.py — "
        "user explicitly asked to keep it live for 90 days"
    )
    assert "cs_incident_issues" in cs_src, (
        "cs_incident.py collection reference changed — data lives "
        "in `cs_incident_issues`, do not rename during retirement"
    )
    # Also: pdf_renderer.py must still register the renderer per the
    # ship spec ("Do NOT touch pdf_renderer.py::render_cs_incident_pdf").
    pdf_src = (_BACKEND / "pdf_renderer.py").read_text(encoding="utf-8")
    assert "render_cs_incident_pdf" in pdf_src
    assert '"cs_incidents":' in pdf_src, (
        "pdf_renderer.py RESOURCE_TO_PATH lost `cs_incidents` entry"
    )


def test_cs_incident_issues_collection_data_preserved():
    """Sample the preview cluster. Fails LOUD if a future migration
    accidentally purges the CS Incidents data. Uses a soft skip if
    the DB is unreachable so this test doesn't block a CI run in a
    sandbox without Mongo access.
    """
    if str(_BACKEND) not in sys.path:
        sys.path.insert(0, str(_BACKEND))
    _env = _BACKEND / ".env"
    if _env.exists():
        for _line in _env.read_text(encoding="utf-8").splitlines():
            _line = _line.strip()
            if not _line or _line.startswith("#") or "=" not in _line:
                continue
            _k, _, _v = _line.partition("=")
            os.environ.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME", "test_database")
    if not mongo_url:
        import pytest
        pytest.skip("MONGO_URL not set — data-preservation guard skipped")

    async def _count():
        from motor.motor_asyncio import AsyncIOMotorClient
        c = AsyncIOMotorClient(mongo_url, serverSelectionTimeoutMS=5_000)
        return await c[db_name].cs_incident_issues.count_documents({})

    try:
        n = asyncio.run(_count())
    except Exception as e:  # noqa: BLE001
        import pytest
        pytest.skip(f"DB unreachable — {e}")
    assert n > 0, (
        f"`cs_incident_issues` collection is empty on the preview "
        f"cluster (got {n}). v58.13.54's core guarantee is data "
        f"preservation — a downstream migration must have dropped "
        f"or purged the records."
    )


# ── 4. Version-sync pin ─────────────────────────────────────────────


def test_version_sync_pins_v58_13_54_across_three_files():
    expected = "paneltec-v160.3.9.58.13.54"
    v_js = Path("/app/frontend/src/lib/version.js").read_text(encoding="utf-8")
    m_ts = Path("/app/mobile/src/lib/version.ts").read_text(encoding="utf-8")
    sw_js = Path("/app/frontend/public/service-worker.js").read_text(encoding="utf-8")
    assert f"RUNNING_VERSION = '{expected}'" in v_js
    assert f"MOBILE_BUNDLE_VERSION = '{expected}'" in m_ts
    assert f"CACHE_VERSION = '{expected}'" in sw_js

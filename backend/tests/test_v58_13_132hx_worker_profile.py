"""v58.13.132hx — Worker profile grouped tweaks.

Locks:
    · Backend: emergency_contact_relationship + photo_transform on
      WorkerPatch, clamp + serialise defaults.
    · Frontend: Workers.jsx retires the slider component, ships the
      wheel-zoom + drag photo tile, splits Emergency Contact into 3
      fields, and drops the inductions fast-select Section.
    · LicencesPanel matches the Certifications tab column shape.
    · Version-pin `.132hx` on version.js + service-worker.js.
"""
from __future__ import annotations

import re
import uuid
from pathlib import Path

import pytest
import requests

pytestmark = pytest.mark.live_db_writes

VJS = Path("/app/frontend/src/lib/version.js")
SW = Path("/app/frontend/public/service-worker.js")
WORKERS_JSX = Path("/app/frontend/src/pages/Workers.jsx")
LICENCES_JSX = Path("/app/frontend/src/components/workers/LicencesPanel.jsx")
WORKERS_PY = Path("/app/backend/workers.py")


def _api(_mongo) -> str:
    from tests.conftest import API as _api_url
    return _api_url


def _read(p: Path) -> str:
    return p.read_text()


# ── Backend contract ──────────────────────────────────────────────

def test_worker_patch_has_relationship_and_transform_fields():
    src = _read(WORKERS_PY)
    # Field declared on WorkerPatch
    assert re.search(
        r"emergency_contact_relationship:\s*Optional\[str\]\s*=\s*Field\(default=None,\s*max_length=60\)",
        src,
    )
    # New photo_transform field on WorkerPatch
    assert "photo_transform: Optional[dict] = None" in src
    # Serialise coerces photo_transform default
    assert 'out["photo_transform"]' in src
    # PATCH clamps photo_transform.{x,y,zoom}
    assert '"photo_transform" in payload' in src


def test_worker_in_accepts_relationship():
    src = _read(WORKERS_PY)
    # WorkerIn (create/replace) also carries the field
    m = re.search(
        r"class WorkerIn\(.*?\)\s*:\s*(.*?)class ",
        src,
        re.DOTALL,
    )
    assert m, "WorkerIn class missing"
    assert "emergency_contact_relationship" in m.group(1)


def test_worker_patch_roundtrip_relationship_and_transform(_mongo, ephemeral_admin, ephemeral_org_id):
    api = _api(_mongo)
    tok = ephemeral_admin["token"]
    org = ephemeral_org_id
    wid = f"pytest-hx-{uuid.uuid4().hex[:10]}"
    _mongo.workers.insert_one({
        "id": wid, "org_id": org, "first_name": "PT", "last_name": "HX",
        "email": None, "active": True, "deleted_at": None, "source": "manual",
    })
    try:
        # PATCH with new fields
        r = requests.patch(
            f"{api}/workers/{wid}",
            headers={"Authorization": f"Bearer {tok}"},
            json={
                "emergency_contact_name": "Jane Doe",
                "emergency_contact_relationship": "Spouse",
                "emergency_contact_phone": "+61400111222",
                "photo_transform": {"x": 12.5, "y": -30, "zoom": 1.7},
            },
            timeout=10,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["emergency_contact_name"] == "Jane Doe"
        assert body["emergency_contact_relationship"] == "Spouse"
        assert body["emergency_contact_phone"] == "+61400111222"
        pt = body["photo_transform"]
        assert pt["zoom"] == 1.7
        assert pt["x"] == 12.5
        assert pt["y"] == -30
        # Out-of-range clamps
        r2 = requests.patch(
            f"{api}/workers/{wid}",
            headers={"Authorization": f"Bearer {tok}"},
            json={"photo_transform": {"x": 9999, "y": -9999, "zoom": 25}},
            timeout=10,
        )
        assert r2.status_code == 200, r2.text
        pt2 = r2.json()["photo_transform"]
        assert pt2["zoom"] == 3.0
        assert pt2["x"] == 500.0
        assert pt2["y"] == -500.0
    finally:
        _mongo.workers.delete_one({"id": wid})


# ── Frontend source pins ──────────────────────────────────────────

def test_workers_jsx_has_wheel_zoom_and_drag():
    src = _read(WORKERS_JSX)
    # Slider component definition + rendering call gone
    assert "function SliderWithDiagnostic(" not in src
    assert "<SliderWithDiagnostic" not in src
    # Wheel handler in place
    assert "onWheel" in src
    # Pointer drag wired
    assert "onPointerDown" in src and "onPointerMove" in src
    # Shared transform helper
    assert "function getPhotoTransform(" in src
    # Reset control preserved
    assert "worker-edit-photo-transform-reset" in src


def test_workers_jsx_emergency_contact_split_and_relationship():
    src = _read(WORKERS_JSX)
    assert 'data-testid="worker-emergency-contact-relationship"' in src
    assert "emergency_contact_relationship" in src


def test_workers_jsx_removed_inductions_fast_select():
    src = _read(WORKERS_JSX)
    # Import gone
    assert "import WorkerInductionsCard" not in src
    # `Inductions` Section wrapper gone from the edit modal
    assert "title=\"Inductions\"" not in src
    assert "section-inductions" not in src


def test_workers_jsx_has_role_chip_filter():
    src = _read(WORKERS_JSX)
    assert 'data-testid="workers-role-filter"' in src
    # testid emitted as `workers-role-filter-${opt.k}` template literal
    assert '`workers-role-filter-${opt.k}`' in src
    for k in ("all", "paneltec", "viatec", "external"):
        assert f"k: '{k}'" in src or f'k: "{k}"' in src
    assert "const workerBucket = (w)" in src


def test_licences_panel_matches_certifications_layout():
    src = _read(LICENCES_JSX)
    # Column headers align with the CertificationsPanel table
    assert ">Name<" in src
    assert ">Issuer<" in src
    assert ">Issued<" in src
    assert ">Expiry<" in src
    assert ">Status<" in src
    assert ">File<" in src
    # Retains licence-family filter
    assert "LICENCE_SLUGS" in src
    # Summary pill testids in the header
    assert "licences-panel-total" in src


# ── Version sync ──────────────────────────────────────────────────

def test_version_pin_v132hx():
    js = _read(VJS)
    sw = _read(SW)
    assert "RUNNING_VERSION = 'paneltec-v160.3.9.58.13.132hx'" in js
    assert "EXPECTED_CACHE_VERSION = 'paneltec-v160.3.9.58.13.132hx'" in js
    assert "CACHE_VERSION = 'paneltec-v160.3.9.58.13.132hx'" in sw

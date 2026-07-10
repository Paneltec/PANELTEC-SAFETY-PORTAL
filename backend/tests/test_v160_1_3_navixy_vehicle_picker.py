"""
v160.1.3 — Regression tests for the Navixy vehicle picker field type
and the Vehicle Pre-Use Inspection template rework.

Guards against three known regressions:
  1. Someone removes `vehicle_navixy` from `ALLOWED_FIELD_TYPES` while
     tidying forms.py — the mobile picker would silently coerce the
     field to "text".
  2. The `/api/forms/fleet/vehicles` proxy stops returning a list —
     mobile pickers would render as empty dropdowns.
  3. The Vehicle Pre-Use Inspection template loses its brand-new
     `worker_picker` (Operator) or the `auto_date` swap regresses back
     to a plain manual `date` field.

Run with `pytest -xvs backend/tests/test_v160_1_3_navixy_vehicle_picker.py`
from `/app`. Uses the local supervisor-managed backend on `localhost:8001`.
"""
from __future__ import annotations

import os
import sys

import pytest
import requests

# Add /app/backend to sys.path so we can import `forms` when pytest is
# launched from /app.
_BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

from forms import ALLOWED_FIELD_TYPES  # noqa: E402


BASE = os.environ.get("PANELTEC_API", "http://localhost:8001")
WORKER_EMAIL = "worker_stephen@paneltec.com.au"
WORKER_PASSWORD = "WorkerTest123!"


def _login(email: str, password: str) -> str:
    r = requests.post(
        f"{BASE}/api/auth/login",
        json={"email": email, "password": password},
        timeout=10,
    )
    r.raise_for_status()
    body = r.json()
    token = body.get("access_token") or body.get("token")
    assert token, f"No token in login response: {body}"
    return token


@pytest.fixture(scope="module")
def worker_headers() -> dict:
    return {"Authorization": f"Bearer {_login(WORKER_EMAIL, WORKER_PASSWORD)}"}


# ─── ALLOWED_FIELD_TYPES ───────────────────────────────────────────────

def test_vehicle_navixy_is_registered_field_type():
    assert "vehicle_navixy" in ALLOWED_FIELD_TYPES, (
        "vehicle_navixy must remain in ALLOWED_FIELD_TYPES — "
        "the mobile NavixyVehiclePicker (v160.1.3) renders on this key"
    )


def test_worker_picker_and_auto_date_still_registered():
    # Both are used by the Vehicle Pre-Use Inspection template rework.
    assert "worker_picker" in ALLOWED_FIELD_TYPES
    assert "auto_date" in ALLOWED_FIELD_TYPES


# ─── /api/forms/fleet/vehicles proxy ───────────────────────────────────

def test_forms_fleet_vehicles_proxy_returns_list_shape(worker_headers):
    """The Navixy proxy must return a JSON body with a `vehicles` list.
    Worker-scoped auth is enough — the endpoint is deliberately open to
    any authenticated user so form pickers work for field crew."""
    r = requests.get(f"{BASE}/api/forms/fleet/vehicles", headers=worker_headers, timeout=20)
    # If Navixy upstream is down the endpoint returns 502 — that's OK
    # for this smoke test; we're only guarding the SHAPE when 2xx.
    if r.status_code != 200:
        pytest.skip(f"Navixy upstream unavailable in CI ({r.status_code})")
    body = r.json()
    assert isinstance(body, dict), body
    assert "vehicles" in body, body
    assert isinstance(body["vehicles"], list), body


# ─── Vehicle Pre-Use Inspection template shape ─────────────────────────

def test_vehicle_pre_use_inspection_template_has_v160_1_3_layout(worker_headers):
    """Locks the exact top-three field ordering the user asked for:
        1) auto_date            — 'Date'
        2) worker_picker        — 'Operator (Name)' + Paneltec/Viatec toggle
        3) vehicle_navixy       — 'Select Vehicle'
    Anything below index 2 is not asserted here (the checklist is
    intentionally left flexible for future template edits)."""
    r = requests.get(f"{BASE}/api/forms/templates", headers=worker_headers, timeout=10)
    r.raise_for_status()
    templates = r.json() if isinstance(r.json(), list) else r.json().get("templates", [])
    tpl = next(
        (t for t in templates if (t.get("name") or "").lower().startswith("vehicle pre")),
        None,
    )
    assert tpl is not None, "Vehicle Pre-Use Inspection template missing from /api/forms/templates"
    fields = tpl.get("fields") or []
    assert len(fields) >= 3, fields

    assert fields[0]["type"] == "auto_date", fields[0]
    assert fields[0]["label"].lower() == "date"

    assert fields[1]["type"] == "worker_picker", fields[1]
    cfg = fields[1].get("config") or {}
    assert cfg.get("inline_company_toggle") is True, cfg
    company_labels = [
        (o or {}).get("label") for o in (cfg.get("company_options") or [])
    ]
    assert "Paneltec Civil" in company_labels, company_labels
    assert "Viatec" in company_labels, company_labels

    assert fields[2]["type"] == "vehicle_navixy", fields[2]
    assert fields[2].get("required") is True

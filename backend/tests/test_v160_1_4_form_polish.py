"""
v160.1.4 — Vehicle Pre-Use Inspection template-polish regression tests.

Guards:
  1. Template first field is an editable `date` type (NOT `auto_date`).
  2. `Vehicle Type` (select) and `Odometer Reading` (number) are NOT
     required (asterisks removed per user request).
  3. All other v160.1.3 top-slot invariants still hold (worker_picker
     with Paneltec/Viatec toggle at slot 1, vehicle_navixy at slot 2).
"""
from __future__ import annotations

import os
import sys

import pytest
import requests

_BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)


BASE = os.environ.get("PANELTEC_API", "http://localhost:8001")
WORKER_EMAIL = "worker_stephen@paneltec.com.au"
WORKER_PASSWORD = "WorkerTest123!"


def _login() -> str:
    r = requests.post(
        f"{BASE}/api/auth/login",
        json={"email": WORKER_EMAIL, "password": WORKER_PASSWORD},
        timeout=10,
    )
    r.raise_for_status()
    return r.json().get("access_token") or r.json().get("token")


@pytest.fixture(scope="module")
def worker_headers() -> dict:
    return {"Authorization": f"Bearer {_login()}"}


def _fetch_template(worker_headers: dict) -> dict:
    r = requests.get(f"{BASE}/api/forms/templates", headers=worker_headers, timeout=10)
    r.raise_for_status()
    body = r.json()
    templates = body if isinstance(body, list) else body.get("templates", [])
    tpl = next(
        (t for t in templates if (t.get("name") or "").lower().startswith("vehicle pre")),
        None,
    )
    assert tpl is not None, "Vehicle Pre-Use Inspection template missing"
    return tpl


def test_first_field_is_editable_date_with_default_today(worker_headers):
    tpl = _fetch_template(worker_headers)
    fields = tpl.get("fields") or []
    assert fields, tpl
    date_field = fields[0]
    assert date_field["type"] == "date", date_field
    assert date_field["type"] != "auto_date", (
        "Date field must be editable (v160.1.4) — auto_date was replaced "
        "so operators can back-date or override today's date."
    )
    cfg = date_field.get("config") or {}
    assert cfg.get("default_today") is True, (
        f"date field must have config.default_today=True for prefill; got {cfg}"
    )


def test_vehicle_type_no_longer_required(worker_headers):
    tpl = _fetch_template(worker_headers)
    fields = tpl.get("fields") or []
    vehicle_type = next(
        (f for f in fields if (f.get("label") or "").lower().startswith("vehicle type")),
        None,
    )
    assert vehicle_type is not None, "Vehicle Type field missing"
    assert vehicle_type.get("required") is False, (
        f"Vehicle Type must NOT be required per v160.1.4; got required={vehicle_type.get('required')}"
    )


def test_odometer_reading_no_longer_required(worker_headers):
    tpl = _fetch_template(worker_headers)
    fields = tpl.get("fields") or []
    odo = next(
        (f for f in fields if "odometer" in (f.get("label") or "").lower()),
        None,
    )
    assert odo is not None, "Odometer Reading field missing"
    assert odo.get("required") is False, (
        f"Odometer Reading must NOT be required per v160.1.4; got required={odo.get('required')}"
    )


def test_worker_picker_and_vehicle_navixy_slots_still_correct(worker_headers):
    """v160.1.3 invariants must still hold after the v160.1.4 polish."""
    tpl = _fetch_template(worker_headers)
    fields = tpl.get("fields") or []
    assert fields[1]["type"] == "worker_picker", fields[1]
    cfg = fields[1].get("config") or {}
    assert cfg.get("inline_company_toggle") is True, cfg
    labels = [(o or {}).get("label") for o in (cfg.get("company_options") or [])]
    assert "Paneltec Civil" in labels and "Viatec" in labels, labels
    assert fields[2]["type"] == "vehicle_navixy", fields[2]
    assert fields[2].get("required") is True, fields[2]

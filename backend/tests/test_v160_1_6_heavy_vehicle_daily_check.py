"""
v160.1.6 — Heavy Vehicle Daily Check template-rework regression tests.

Locks the new "Standard Header" pattern (Date → Operator → Location →
Vehicle) applied to the Heavy Vehicle Daily Check template. Also guards
against the deleted standalone `asset_scan` field creeping back in — its
role is now covered by the Scan-QR primary CTA embedded in the
NavixyVehiclePicker (see mobile/src/components/NavixyVehiclePicker.tsx).
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


def _fetch_hvdc(worker_headers: dict) -> dict:
    r = requests.get(f"{BASE}/api/forms/templates", headers=worker_headers, timeout=10)
    r.raise_for_status()
    body = r.json()
    templates = body if isinstance(body, list) else body.get("templates", [])
    tpl = next(
        (t for t in templates if (t.get("name") or "").lower().startswith("heavy vehicle daily")),
        None,
    )
    assert tpl is not None, "Heavy Vehicle Daily Check template missing"
    return tpl


def test_hvdc_standard_header_slot_0_date(worker_headers):
    tpl = _fetch_hvdc(worker_headers)
    f = tpl["fields"][0]
    assert f["type"] == "date", f
    assert f["label"].lower() == "date"
    assert (f.get("config") or {}).get("default_today") is True, f


def test_hvdc_standard_header_slot_1_operator_worker_picker(worker_headers):
    tpl = _fetch_hvdc(worker_headers)
    f = tpl["fields"][1]
    assert f["type"] == "worker_picker", f
    assert "operator" in f["label"].lower()
    cfg = f.get("config") or {}
    assert cfg.get("inline_company_toggle") is True, cfg
    labels = [(o or {}).get("label") for o in (cfg.get("company_options") or [])]
    assert "Paneltec Civil" in labels and "Viatec" in labels, labels


def test_hvdc_standard_header_slot_2_location_gps(worker_headers):
    tpl = _fetch_hvdc(worker_headers)
    f = tpl["fields"][2]
    assert f["type"] == "gps", f
    assert f["label"].lower() == "location"
    assert (f.get("config") or {}).get("reverse_geocode") is True, f


def test_hvdc_standard_header_slot_3_vehicle_navixy(worker_headers):
    tpl = _fetch_hvdc(worker_headers)
    f = tpl["fields"][3]
    assert f["type"] == "vehicle_navixy", f
    assert "vehicle" in f["label"].lower()
    assert f.get("required") is True


def test_hvdc_no_standalone_asset_scan_field(worker_headers):
    """The standalone `asset_scan` field was deleted in v160.1.6 — its
    role now lives inside NavixyVehiclePicker's Scan-QR primary CTA."""
    tpl = _fetch_hvdc(worker_headers)
    asset_scans = [f for f in tpl["fields"] if f.get("type") == "asset_scan"]
    assert not asset_scans, (
        f"Heavy Vehicle Daily Check must not contain a standalone "
        f"asset_scan field (found: {[f['id'] for f in asset_scans]})"
    )


def test_hvdc_single_vehicle_navixy_field(worker_headers):
    """Only one vehicle_navixy field — no duplicates."""
    tpl = _fetch_hvdc(worker_headers)
    vehicles = [f for f in tpl["fields"] if f.get("type") == "vehicle_navixy"]
    assert len(vehicles) == 1, (
        f"Heavy Vehicle Daily Check must have exactly one vehicle_navixy "
        f"field (found {len(vehicles)}: {[f['id'] for f in vehicles]})"
    )


def test_no_template_requires_odometer(worker_headers):
    """Task 2 — Odometer is a data point, never required."""
    r = requests.get(f"{BASE}/api/forms/templates", headers=worker_headers, timeout=10)
    r.raise_for_status()
    body = r.json()
    templates = body if isinstance(body, list) else body.get("templates", [])
    offenders: list[str] = []
    for t in templates:
        for f in t.get("fields") or []:
            if "odometer" in (f.get("label") or "").lower() and f.get("required"):
                offenders.append(f"{t.get('name')} :: {f.get('label')}")
    assert not offenders, f"Odometer fields still required: {offenders}"

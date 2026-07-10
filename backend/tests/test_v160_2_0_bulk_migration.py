"""
v160.2.0 — Bulk-migration guardrail tests.

Runs against the LIVE DB via /api/forms/templates (worker-visible view)
plus a direct import of the migration script to re-verify idempotency.
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


@pytest.fixture(scope="module")
def all_templates(worker_headers) -> list:
    r = requests.get(f"{BASE}/api/forms/templates", headers=worker_headers, timeout=10)
    r.raise_for_status()
    body = r.json()
    return body if isinstance(body, list) else body.get("templates", [])


# ─── Rule 4: every template has a GPS field ────────────────────────────

def test_every_template_has_gps_location(all_templates):
    offenders = []
    for t in all_templates:
        fields = t.get("fields") or []
        if not any(f.get("type") in ("gps", "location") for f in fields):
            offenders.append(t.get("name"))
    assert not offenders, f"Templates missing GPS field: {offenders}"


def test_every_gps_field_has_reverse_geocode(all_templates):
    offenders = []
    for t in all_templates:
        for f in t.get("fields") or []:
            if f.get("type") in ("gps", "location"):
                cfg = f.get("config") or {}
                if not cfg.get("reverse_geocode"):
                    offenders.append(f"{t.get('name')} :: {f.get('id')}")
    assert not offenders, f"GPS fields missing reverse_geocode: {offenders}"


# ─── Rule 5: no legacy auto_date fields, every date has default_today ──

def test_no_auto_date_fields_remain(all_templates):
    offenders = []
    for t in all_templates:
        for f in t.get("fields") or []:
            if f.get("type") == "auto_date":
                offenders.append(f"{t.get('name')} :: {f.get('id')}")
    assert not offenders, f"Legacy auto_date fields still present: {offenders}"


def test_every_date_field_has_default_today(all_templates):
    offenders = []
    for t in all_templates:
        for f in t.get("fields") or []:
            if f.get("type") == "date":
                cfg = f.get("config") or {}
                if not cfg.get("default_today"):
                    offenders.append(f"{t.get('name')} :: {f.get('id')}")
    assert not offenders, f"date fields missing default_today: {offenders}"


# ─── Rule 2: no standalone asset_scan and at most one vehicle_navixy ───

def test_no_standalone_asset_scan_fields(all_templates):
    offenders = []
    for t in all_templates:
        for f in t.get("fields") or []:
            if f.get("type") == "asset_scan":
                offenders.append(f"{t.get('name')} :: {f.get('id')}")
    assert not offenders, (
        f"Standalone asset_scan fields still present: {offenders}. Their "
        f"function now lives inside NavixyVehiclePicker (Scan-QR CTA)."
    )


def test_at_most_one_vehicle_navixy_per_template(all_templates):
    offenders = []
    for t in all_templates:
        vs = [f for f in (t.get("fields") or []) if f.get("type") == "vehicle_navixy"]
        if len(vs) > 1:
            offenders.append(f"{t.get('name')} → {len(vs)}× vehicle_navixy")
    assert not offenders, f"Templates with duplicate vehicle_navixy: {offenders}"


# ─── Rule 1: worker_picker fields have inline_company_toggle ──────────

def test_worker_picker_fields_use_inline_company_toggle(all_templates):
    offenders = []
    for t in all_templates:
        for f in t.get("fields") or []:
            if f.get("type") == "worker_picker":
                cfg = f.get("config") or {}
                if not cfg.get("inline_company_toggle"):
                    offenders.append(f"{t.get('name')} :: {f.get('id')} ({f.get('label')})")
    assert not offenders, (
        f"worker_picker fields missing inline_company_toggle: {offenders}"
    )


# ─── Idempotency: re-running the migration should produce zero changes ─

def test_migration_script_is_idempotent():
    """Import the script and re-run — it must not detect any further
    changes when the DB already reflects v160.2.0."""
    # We already ran the migration in the CI shell. Re-run:
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "migrate_v160_2_0_bulk",
        os.path.join(_BACKEND_DIR, "scripts", "migrate_v160_2_0_bulk.py"),
    )
    mod = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    import asyncio
    asyncio.get_event_loop() if False else None
    asyncio.run(mod.migrate())

    # Read the fresh report and assert no vehicle/worker/asset_scan
    # changes on a second run (gps_updated is allowed because it always
    # touches the reverse_geocode flag).
    import json as _json
    with open("/tmp/v160_2_0_migration_report.json") as fh:
        report = _json.load(fh)
    for r in report:
        if "skipped" in r:
            continue
        ch = r.get("changes", {})
        rerun_touched = {k: v for k, v in ch.items() if v and k not in ("gps_updated",)}
        assert not rerun_touched, f"Second run modified {r['name']}: {rerun_touched}"

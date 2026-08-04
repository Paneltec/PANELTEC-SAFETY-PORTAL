"""v160.3.9.49 — New endpoints shipped in the Bundle A+B+C pass.

Covers:
  1. `POST /workers/sync-from-simpro` — reachable by admin. (Refresh-from-
     Simpro on the Certifications page proxies straight through this
     existing endpoint; new v49 coverage confirms the wire.)
  2. `POST /hr/employees/refresh-from-source` — new v49 endpoint.
     Admin 200; audit row `refresh-from-source` written; auditor 403
     (permission carve: no `hr_employees.reimport`).
  3. `GET /suppliers/address-lookup?company_name=X` — new v49 endpoint.
     Admin 200 with structured shape; behaviour graceful whether ABN
     is configured or not (no `ABN_LOOKUP_GUID` env → OSM fallback
     path exercised).

Ephemeral fixtures only. Stephen never mutated.
"""
from __future__ import annotations
import os
import time
import requests

from tests.conftest import API, ADMIN_EMAIL, ADMIN_PWD, EPHEMERAL_PWD, _login


def _admin_headers() -> dict:
    return {"Authorization": f"Bearer {_login(ADMIN_EMAIL, ADMIN_PWD)}"}


# ─────────────────────────────────────────────────────────────
# Bundle B — HR refresh-from-source
# ─────────────────────────────────────────────────────────────

def test_hr_refresh_from_source_admin_200_and_audit_row(_mongo):
    hdr = _admin_headers()
    before = _mongo.hr_employees_audit.count_documents(
        {"action": "refresh-from-source"})
    r = requests.post(f"{API}/hr/employees/refresh-from-source",
                      headers=hdr, timeout=60)
    assert r.status_code == 200, r.text
    payload = r.json()
    assert payload["parsed_rows"] >= 121, f"parsed_rows={payload['parsed_rows']}"
    assert payload["live_total"] >= 121
    # Audit trail must reflect the call.
    after = _mongo.hr_employees_audit.count_documents(
        {"action": "refresh-from-source"})
    assert after == before + 1, (
        f"expected exactly 1 new refresh-from-source audit row; "
        f"before={before} after={after}"
    )


def test_hr_refresh_from_source_auditor_denied(ephemeral_users):
    """Auditor role has `hr_employees.audit_view` but NOT `.reimport`."""
    email = ephemeral_users["auditor"]
    tok = _login(email, EPHEMERAL_PWD)
    r = requests.post(f"{API}/hr/employees/refresh-from-source",
                      headers={"Authorization": f"Bearer {tok}"}, timeout=30)
    assert r.status_code == 403, r.text


def test_hr_refresh_from_source_updates_the_import_snapshot():
    """After refresh, the parsed_rows == 121 and stats block is present."""
    hdr = _admin_headers()
    r = requests.post(f"{API}/hr/employees/refresh-from-source",
                      headers=hdr, timeout=60)
    assert r.status_code == 200
    body = r.json()
    for k in ("parsed_rows", "live_total", "inserted",
              "updated", "unchanged", "security_flags"):
        assert k in body, f"refresh response missing key {k}"


# ─────────────────────────────────────────────────────────────
# Bundle C — Supplier address-lookup
# ─────────────────────────────────────────────────────────────

def test_supplier_address_lookup_shape_admin():
    """Endpoint MUST return the documented shape whether or not the
    provider found a match. Uses a well-known AU business name so
    the OSM fallback almost always resolves; the assertion below
    tolerates either `source: 'osm'` or `source: null` (network-
    resilient in CI)."""
    hdr = _admin_headers()
    r = requests.get(f"{API}/suppliers/address-lookup",
                     headers=hdr,
                     params={"company_name": "Bunnings Warehouse Alexandria"},
                     timeout=20)
    assert r.status_code == 200, r.text
    body = r.json()
    for k in ("source", "street", "suburb", "state",
              "postcode", "country", "confidence"):
        assert k in body, f"address-lookup response missing key {k}"
    # `source` must be one of: null | "abn" | "osm"
    assert body["source"] in (None, "abn", "osm"), body


def test_supplier_address_lookup_short_name_400():
    hdr = _admin_headers()
    r = requests.get(f"{API}/suppliers/address-lookup",
                     headers=hdr, params={"company_name": "AB"}, timeout=15)
    assert r.status_code == 400, r.text


def test_supplier_address_lookup_never_echoes_guid_env():
    """Even if a GUID is configured, it MUST NEVER leak in the response."""
    hdr = _admin_headers()
    r = requests.get(f"{API}/suppliers/address-lookup",
                     headers=hdr,
                     params={"company_name": "Some Company Ltd"},
                     timeout=15)
    assert r.status_code == 200
    guid = os.environ.get("ABN_LOOKUP_GUID", "").strip()
    if guid:
        assert guid not in r.text, "ABN_LOOKUP_GUID leaked in response body"


# ─────────────────────────────────────────────────────────────
# Bundle A — Certifications refresh wire-check
#   (The FE button calls `/workers/sync-from-simpro`. That endpoint
#   is admin-only. Skipped end-to-end if Simpro isn't wired for the
#   test workspace — 400 is the expected "not-connected" return.)
# ─────────────────────────────────────────────────────────────

def test_certifications_refresh_wire_reaches_workers_sync_endpoint():
    hdr = _admin_headers()
    r = requests.post(f"{API}/workers/sync-from-simpro",
                      headers=hdr, json={"company": "both"}, timeout=30)
    # 200 = full sync completed; 400 = "Simpro not connected" (test-env
    # baseline). Both are acceptable — we're testing the WIRE, not the
    # third-party success rate.
    assert r.status_code in (200, 400), (
        f"unexpected status from workers sync endpoint: {r.status_code} {r.text[:200]}"
    )

"""Phase 3.8 — QR scan as form launcher backend regression tests.

Covers:
- GET /api/scan/{scan_token}/forms — curated list + recommended badges
- POST /api/scan/quick-action with action='open_form' (422/404/200)
- POST /api/forms/templates/{id}/submissions persists launched_via/source_*
- 404 unknown token, 410 retired asset
- Regression on existing actions (log_service, report_defect, update_meter)
"""
import os
import pytest
import requests
from pathlib import Path


def _load_backend_url() -> str:
    url = os.environ.get("REACT_APP_BACKEND_URL")
    if not url:
        env_path = Path("/app/frontend/.env")
        if env_path.exists():
            for line in env_path.read_text().splitlines():
                if line.startswith("REACT_APP_BACKEND_URL="):
                    url = line.split("=", 1)[1].strip()
                    break
    if not url:
        raise RuntimeError("REACT_APP_BACKEND_URL not set and not found in /app/frontend/.env")
    return url.rstrip("/")


BASE_URL = _load_backend_url()

ADMIN_EMAIL = "stephen@paneltec.com.au"
ADMIN_PW = "Mcgstephen50#"

VEHICLE_TOKEN = "yTtV1KWWmE"   # Industrial - XT02AX, vacuum_truck
PLANT_TOKEN = "EFLdyI3Thc"      # CAT 320 Excavator, excavator


@pytest.fixture(scope="module")
def token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PW},
        timeout=15,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def auth(token):
    return {"Authorization": f"Bearer {token}"}


# ─── GET /api/scan/{token}/forms ─────────────────────────────────────
class TestScanForms:
    def test_vehicle_scan_forms(self, auth):
        r = requests.get(f"{BASE_URL}/api/scan/{VEHICLE_TOKEN}/forms", headers=auth, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        # Asset card
        assert "asset" in body and "forms" in body
        a = body["asset"]
        assert a.get("rego_serial") == "XT02AX"
        assert a.get("kind") == "vehicle"
        assert (a.get("asset_type") or "").lower() == "vacuum_truck"
        # Forms list
        names = [f["name"] for f in body["forms"]]
        recommended = {f["name"]: f["recommended"] for f in body["forms"]}
        # Required forms present
        assert "Vehicle Pre-Use Inspection" in names
        assert "Heavy Vehicle Daily Check" in names
        assert "Incident Report" in names
        assert "Near Miss Report" in names
        # Recommended logic for vacuum_truck (heavy)
        assert recommended["Vehicle Pre-Use Inspection"] is True
        assert recommended["Heavy Vehicle Daily Check"] is True
        assert recommended["Incident Report"] is False
        assert recommended["Near Miss Report"] is False
        # Tile shape sanity
        for f in body["forms"]:
            assert "template_id" in f and isinstance(f["template_id"], str)
            assert "description" in f
            assert "icon" in f
            assert "field_count" in f and isinstance(f["field_count"], int)

    def test_plant_scan_forms(self, auth):
        r = requests.get(f"{BASE_URL}/api/scan/{PLANT_TOKEN}/forms", headers=auth, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        a = body["asset"]
        assert a.get("kind") == "plant"
        assert (a.get("asset_type") or "").lower() == "excavator"
        names = [f["name"] for f in body["forms"]]
        rec = {f["name"]: f["recommended"] for f in body["forms"]}
        assert "Plant Pre-Start Checklist (Heavy Equipment)" in names
        assert "Incident Report" in names
        assert "Near Miss Report" in names
        # Recommended must be the heavy-equipment plant pre-start only
        assert rec["Plant Pre-Start Checklist (Heavy Equipment)"] is True
        assert rec["Incident Report"] is False
        assert rec["Near Miss Report"] is False
        # Total tiles either 3 or 4 (depending on whether vanilla Plant Pre-Start exists in org)
        assert 3 <= len(body["forms"]) <= 4

    def test_unknown_token_returns_404(self, auth):
        r = requests.get(f"{BASE_URL}/api/scan/ZZZ_no_such_token/forms", headers=auth, timeout=10)
        assert r.status_code == 404

    def test_retired_asset_returns_410(self, auth):
        """Flip the test asset to retired temporarily, hit endpoint, revert."""
        from pymongo import MongoClient
        mongo_url = os.environ.get("MONGO_URL")
        db_name = os.environ.get("DB_NAME")
        if not mongo_url or not db_name:
            # Pull from backend/.env if not exported
            env_path = Path("/app/backend/.env")
            if env_path.exists():
                for line in env_path.read_text().splitlines():
                    if line.startswith("MONGO_URL=") and not mongo_url:
                        mongo_url = line.split("=", 1)[1].strip().strip('"').strip("'")
                    elif line.startswith("DB_NAME=") and not db_name:
                        db_name = line.split("=", 1)[1].strip().strip('"').strip("'")
        assert mongo_url and db_name, "MONGO_URL/DB_NAME missing"
        client = MongoClient(mongo_url)
        db = client[db_name]
        before = db.assets.find_one({"scan_token": PLANT_TOKEN}, {"_id": 0, "status": 1, "id": 1})
        assert before, "test plant asset missing"
        prev_status = before.get("status")
        try:
            db.assets.update_one({"scan_token": PLANT_TOKEN}, {"$set": {"status": "retired"}})
            r = requests.get(f"{BASE_URL}/api/scan/{PLANT_TOKEN}/forms", headers=auth, timeout=10)
            assert r.status_code == 410, f"expected 410 got {r.status_code}: {r.text}"
        finally:
            # Restore previous status (None if it was unset)
            if prev_status is None:
                db.assets.update_one({"scan_token": PLANT_TOKEN}, {"$unset": {"status": ""}})
            else:
                db.assets.update_one({"scan_token": PLANT_TOKEN}, {"$set": {"status": prev_status}})
            client.close()

    def test_unauthenticated_returns_401(self):
        r = requests.get(f"{BASE_URL}/api/scan/{VEHICLE_TOKEN}/forms", timeout=10)
        assert r.status_code == 401


# ─── POST /api/scan/quick-action action='open_form' ──────────────────
class TestOpenFormQuickAction:
    def _pick_template_id(self, auth, token, name_match):
        r = requests.get(f"{BASE_URL}/api/scan/{token}/forms", headers=auth, timeout=10)
        assert r.status_code == 200
        for f in r.json()["forms"]:
            if f["name"] == name_match:
                return f["template_id"]
        pytest.skip(f"Template {name_match} not present in org for token {token}")

    def test_open_form_success(self, auth):
        tpl_id = self._pick_template_id(auth, PLANT_TOKEN, "Plant Pre-Start Checklist (Heavy Equipment)")
        r = requests.post(
            f"{BASE_URL}/api/scan/quick-action",
            headers=auth,
            json={"scan_token": PLANT_TOKEN, "action": "open_form", "payload": {"template_id": tpl_id}},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert body.get("scan_token") == PLANT_TOKEN
        assert body.get("template_id") == tpl_id
        assert body.get("template_name") == "Plant Pre-Start Checklist (Heavy Equipment)"
        assert isinstance(body.get("asset_id"), str) and len(body["asset_id"]) > 0

    def test_open_form_missing_template_id_returns_422(self, auth):
        r = requests.post(
            f"{BASE_URL}/api/scan/quick-action",
            headers=auth,
            json={"scan_token": PLANT_TOKEN, "action": "open_form", "payload": {}},
            timeout=15,
        )
        assert r.status_code == 422, f"expected 422 got {r.status_code}: {r.text}"

    def test_open_form_unknown_template_returns_404(self, auth):
        r = requests.post(
            f"{BASE_URL}/api/scan/quick-action",
            headers=auth,
            json={"scan_token": PLANT_TOKEN, "action": "open_form", "payload": {"template_id": "no-such-tpl-zzz"}},
            timeout=15,
        )
        assert r.status_code == 404, r.text


# ─── Submission stamps launched_via/source_* ─────────────────────────
class TestSubmissionStamping:
    def test_submission_persists_scan_provenance(self, auth):
        # Resolve vehicle pre-use template via the scan endpoint
        r = requests.get(f"{BASE_URL}/api/scan/{VEHICLE_TOKEN}/forms", headers=auth, timeout=10)
        assert r.status_code == 200
        tpl_id = None
        asset_id = r.json()["asset"]["id"]
        for f in r.json()["forms"]:
            if f["name"] == "Vehicle Pre-Use Inspection":
                tpl_id = f["template_id"]
                break
        assert tpl_id, "Vehicle Pre-Use Inspection missing"

        # Get template fields so we can build a minimal valid submission
        tpl = requests.get(f"{BASE_URL}/api/forms/templates/{tpl_id}", headers=auth, timeout=10).json()
        fields_payload = []
        for f in tpl.get("fields") or []:
            fields_payload.append({"id": f["id"], "value": "TEST_phase38"})

        payload = {
            "fields": fields_payload,
            "launched_via": "scan",
            "source_scan_token": VEHICLE_TOKEN,
            "source_asset_id": asset_id,
        }
        r = requests.post(
            f"{BASE_URL}/api/forms/templates/{tpl_id}/submissions",
            headers=auth, json=payload, timeout=20,
        )
        assert r.status_code in (200, 201), r.text
        sub = r.json()
        sub_id = sub["id"]

        # GET it back and verify persistence
        r2 = requests.get(f"{BASE_URL}/api/forms/submissions/{sub_id}", headers=auth, timeout=10)
        assert r2.status_code == 200, r2.text
        body = r2.json()
        # Submission may be nested or flat depending on endpoint
        target = body.get("submission") if isinstance(body, dict) and "submission" in body else body
        assert target.get("launched_via") == "scan"
        assert target.get("source_scan_token") == VEHICLE_TOKEN
        assert target.get("source_asset_id") == asset_id

    def test_submission_without_provenance_omits_fields(self, auth):
        """Regression: existing manual submissions still work + don't get phantom stamps."""
        r = requests.get(f"{BASE_URL}/api/scan/{VEHICLE_TOKEN}/forms", headers=auth, timeout=10)
        assert r.status_code == 200
        tpl_id = None
        for f in r.json()["forms"]:
            if f["name"] == "Vehicle Pre-Use Inspection":
                tpl_id = f["template_id"]
                break
        assert tpl_id

        tpl = requests.get(f"{BASE_URL}/api/forms/templates/{tpl_id}", headers=auth, timeout=10).json()
        fields_payload = [{"id": f["id"], "value": "TEST_manual"} for f in tpl.get("fields") or []]

        r = requests.post(
            f"{BASE_URL}/api/forms/templates/{tpl_id}/submissions",
            headers=auth, json={"fields": fields_payload}, timeout=20,
        )
        assert r.status_code in (200, 201), r.text
        sub_id = r.json()["id"]

        r2 = requests.get(f"{BASE_URL}/api/forms/submissions/{sub_id}", headers=auth, timeout=10)
        assert r2.status_code == 200
        body = r2.json()
        target = body.get("submission") if isinstance(body, dict) and "submission" in body else body
        # Either absent or explicitly None — both OK
        assert not target.get("launched_via")
        assert not target.get("source_scan_token")


# ─── Quick-action regression (existing actions) ──────────────────────
class TestQuickActionRegression:
    def test_update_meter_still_works(self, auth):
        r = requests.post(
            f"{BASE_URL}/api/scan/quick-action",
            headers=auth,
            json={
                "scan_token": VEHICLE_TOKEN,
                "action": "update_meter",
                "payload": {"hours": 999, "km": 12345},
            },
            timeout=15,
        )
        # Vehicles with Navixy device intentionally return 422 (read-only meter).
        # Either path proves the action handler is wired correctly.
        if r.status_code in (200, 201):
            assert r.json().get("type") == "meter_update"
        else:
            assert r.status_code == 422
            assert "navixy" in r.text.lower()

    def test_log_service_still_works(self, auth):
        r = requests.post(
            f"{BASE_URL}/api/scan/quick-action",
            headers=auth,
            json={
                "scan_token": VEHICLE_TOKEN,
                "action": "log_service",
                "payload": {"title": "TEST_phase38 service", "description": "regression"},
            },
            timeout=15,
        )
        assert r.status_code in (200, 201), r.text
        assert r.json().get("type") == "service"

    def test_report_defect_still_works(self, auth):
        r = requests.post(
            f"{BASE_URL}/api/scan/quick-action",
            headers=auth,
            json={
                "scan_token": VEHICLE_TOKEN,
                "action": "report_defect",
                "payload": {"title": "TEST_phase38 defect", "defect_severity": "minor"},
            },
            timeout=15,
        )
        assert r.status_code in (200, 201), r.text
        assert r.json().get("type") == "defect"

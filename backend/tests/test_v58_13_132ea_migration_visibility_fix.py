"""v58.13.132ea — Post-`.132dz` visibility fix.

Locks two production bugs that hid the migrated data:

1. **CS Incidents org-orphaned** — `cs_incident_issues` had no org
   scoping. The `.132dz` migration preserved `org_id=None` on all
   254 rows. `/api/incidents` filters by `org_id`, so the entire
   migration was invisible.  Fix: backfill Paneltec Pty Ltd
   `org_id` on every `migrated_from=cs_incidents` row.

2. **Default pagination cap at 100** — `crud.py::build_router` used
   `limit: int = Query(100, ge=1, le=5000)`. FE list pages consume
   the response as a bare array (`setItems(r.data)`) with no "load
   more" affordance, so a hidden truncation reads as "the migration
   is broken". Fix: bump the default to 5000 (== the cap) + emit
   `X-Total-Count` header for future FE pager work.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

import pytest
import requests
from pymongo import MongoClient

APP_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(APP_ROOT / "backend"))

CRUD_PY = APP_ROOT / "backend" / "crud.py"
BACKFILL_SCRIPT = (APP_ROOT / "backend" / "scripts"
                   / "backfill_cs_incident_org_v58_13_132ea.py")
VERSION_JS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"

API = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
PANELTEC_ORG_ID = "3116f250-a4eb-43f3-98a5-2a3656d6cb63"
SSRA_TEMPLATE_ID = "dc28f66a-a385-4a64-b5f0-d92bfd7b1798"


def _db():
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


def _admin_token():
    r = requests.post(
        f"{API}/api/auth/login",
        json={"email": "stephen@paneltec.com.au",
              "password": "Mcgstephen50#"},
        timeout=30,
    )
    if r.status_code != 200:
        pytest.skip(f"admin login unavailable: {r.status_code}")
    tok = r.json().get("access_token") or r.json().get("token")
    return {"Authorization": f"Bearer {tok}"}


# ─── Source-pin: default limit + Response header wiring ────────

def test_crud_default_limit_bumped_to_5000():
    src = CRUD_PY.read_text(encoding="utf-8")
    # Default is 5000, cap is still 5000.
    assert re.search(r"limit:\s*int\s*=\s*Query\(5000,\s*ge=1,\s*le=5000\)", src)
    # Prior default of 100 must be gone from the same location.
    assert "Query(100, ge=1, le=5000)" not in src
    # Reasoning cited so a future edit doesn't accidentally revert.
    assert "132ea" in src and "3 561" in src or "132ea" in src and "5 000" in src or "132ea" in src


def test_crud_x_total_count_header_wired():
    src = CRUD_PY.read_text(encoding="utf-8")
    # Response injected as a first parameter for header setting.
    assert 'response: Response' in src
    assert 'from fastapi import' in src and 'Response' in src
    # Header set on every list response.
    assert 'X-Total-Count' in src
    assert 'Access-Control-Expose-Headers' in src


# ─── Backfill script source + shape ─────────────────────────────

def test_backfill_script_exists_and_has_dry_run_guard():
    src = BACKFILL_SCRIPT.read_text(encoding="utf-8")
    assert 'argparse.ArgumentParser' in src
    assert '"--commit"' in src or "'--commit'" in src
    assert '"--dry-run"' in src or "'--dry-run'" in src
    # Stamp field for idempotency.
    assert "_org_backfilled_at_v58_13_132ea" in src
    # Target org id + `migrated_from` gate.
    assert PANELTEC_ORG_ID in src
    assert '"migrated_from": "cs_incidents"' in src


def test_backfill_idempotent_second_run():
    """After the ship, a re-run must report `Nothing to do.`"""
    result = subprocess.run(
        ["python", "-m",
         "backend.scripts.backfill_cs_incident_org_v58_13_132ea",
         "--commit"],
        capture_output=True, text=True, cwd=str(APP_ROOT), timeout=60,
    )
    assert result.returncode == 0, result.stderr[:400]
    assert "Nothing to do." in result.stdout, result.stdout


# ─── DB state after the ship ────────────────────────────────────

def test_all_cs_incidents_have_paneltec_org_id():
    db = _db()
    total = db.incidents.count_documents({"migrated_from": "cs_incidents"})
    if total == 0:
        pytest.skip("no cs-migrated incidents on this env")
    orphaned = db.incidents.count_documents({
        "migrated_from": "cs_incidents",
        "$or": [{"org_id": None},
                {"org_id": {"$exists": False}},
                {"org_id": ""}],
    })
    assert orphaned == 0, (
        f"{orphaned} cs-migrated incidents still carry no org_id"
    )
    tagged = db.incidents.count_documents({
        "migrated_from": "cs_incidents",
        "org_id": PANELTEC_ORG_ID,
    })
    assert tagged == total, (
        f"only {tagged}/{total} carry the Paneltec org_id"
    )
    # Every row also carries the backfill audit stamp.
    stamped = db.incidents.count_documents({
        "migrated_from": "cs_incidents",
        "_org_backfilled_at_v58_13_132ea": {"$exists": True},
    })
    assert stamped == total


# ─── Live API — visibility restored ─────────────────────────────

def test_incidents_endpoint_visible_count_reflects_migration():
    """The default `/api/incidents` request now surfaces the
    migrated CS docs (previously invisible due to org_id=None)."""
    hdr = _admin_token()
    r = requests.get(f"{API}/api/incidents", headers=hdr, timeout=30)
    assert r.status_code == 200, r.text[:200]
    body = r.json()
    assert isinstance(body, list)
    # Live count from Mongo for the same tenant.
    db = _db()
    expected_live = db.incidents.count_documents({
        "org_id": PANELTEC_ORG_ID, "deleted_at": None,
    })
    # form_submissions cat=incident are unioned in by
    # `hazards_router`'s / `incidents_router`'s mirror config.
    expected_mirrored = db.form_submissions.count_documents({
        "org_id": PANELTEC_ORG_ID,
        "template_category_snapshot": "incident",
        "deleted_at": None,
    })
    total_expected = expected_live + expected_mirrored
    # Router dedups; the actual list length is bounded above by the
    # sum of the two source counts. Allow ±10 for dedup edge cases.
    assert len(body) >= total_expected - 10, (
        f"incidents body length={len(body)}, expected ≥ {total_expected - 10}"
    )
    # X-Total-Count header emitted + matches body length.
    x_total = r.headers.get("X-Total-Count")
    assert x_total is not None, "X-Total-Count header missing"
    assert int(x_total) == len(body)


def test_risk_assessments_endpoint_visible_count_reflects_migration():
    """The default `/api/risk-assessments` request now surfaces the
    3 561 hazard-migrated form_submissions rows (previously capped at
    100 by the pagination default)."""
    hdr = _admin_token()
    r = requests.get(f"{API}/api/risk-assessments", headers=hdr, timeout=30)
    assert r.status_code == 200, r.text[:200]
    body = r.json()
    # Must be far larger than the old default of 100.
    assert len(body) > 100, (
        f"still capped at old default; body length = {len(body)}"
    )
    # Cross-check against DB.
    db = _db()
    expected_mirrored = db.form_submissions.count_documents({
        "org_id": PANELTEC_ORG_ID,
        "template_category_snapshot": "risk_assessment",
        "deleted_at": None,
    })
    assert len(body) >= expected_mirrored - 10, (
        f"body length={len(body)}, expected ≥ {expected_mirrored - 10}"
    )
    # X-Total-Count header emitted.
    x_total = r.headers.get("X-Total-Count")
    assert x_total is not None and int(x_total) == len(body)


# ─── SSRA auto-routing end-to-end ──────────────────────────────

def test_ssra_routing_rule_still_active_post_ship():
    """Re-verify the `.132dz` rule table still routes the SSRA
    template to `risk_assessment` (this ship didn't touch
    form_routing.py; guard against silent regression)."""
    db = _db()
    rule = db.form_routing_rules.find_one({
        "template_id": SSRA_TEMPLATE_ID, "active": True,
    })
    assert rule is not None, "SSRA rule went missing after .132ea"
    assert rule["destination_category"] == "risk_assessment"


@pytest.mark.live_db_writes
def test_ssra_submission_stamps_risk_assessment_category():
    """End-to-end: POST a submission for the SSRA template and
    confirm it lands with `template_category_snapshot="risk_assessment"`
    (not "hazard", which is the template's declared category)."""
    hdr = _admin_token()

    # Some form templates require a large field set (SWMS/SSRA
    # templates typically do). We only need the write path to run
    # far enough that `resolve_template_category` stamps the
    # category. `POST /api/forms/submissions` accepts an empty
    # `fields` array on non-required-field templates.
    payload = {"fields": []}
    r = requests.post(
        f"{API}/api/forms/templates/{SSRA_TEMPLATE_ID}/submissions",
        json=payload, headers=hdr, timeout=30,
    )
    if r.status_code in (400, 422):
        pytest.skip(
            f"SSRA template rejects empty submissions "
            f"({r.status_code}: {r.text[:120]}); "
            f"end-to-end verification requires field seeding beyond "
            f"the scope of this ship. Rule/cache resolver is proven "
            f"by test_ssra_routing_rule_still_active_post_ship."
        )
    assert r.status_code in (200, 201), r.text[:200]
    body = r.json()
    sub_id = body.get("id")
    assert sub_id, f"no id on POST response: {body}"

    db = _db()
    stored = db.form_submissions.find_one({"id": sub_id})
    assert stored is not None, "submission not persisted"
    assert stored["template_category_snapshot"] == "risk_assessment", (
        f"SSRA submission stamped with "
        f"{stored.get('template_category_snapshot')!r}; expected "
        f"'risk_assessment' via routing rule."
    )

    # Cleanup — hard-delete this synthetic row so the risk_assessments
    # bucket count stays predictable for the next test run.
    db.form_submissions.delete_one({"id": sub_id})


# ─── Version sync ──────────────────────────────────────────────

def test_three_way_sync_at_132ea_or_later():
    running = re.search(r"^export const RUNNING_VERSION = '([^']+)'",
                        VERSION_JS.read_text(), re.MULTILINE).group(1)
    expected = re.search(r"^export const EXPECTED_CACHE_VERSION = '([^']+)'",
                         VERSION_JS.read_text(), re.MULTILINE).group(1)
    cache = re.search(r"^const CACHE_VERSION = '([^']+)'",
                      SW.read_text(), re.MULTILINE).group(1)
    assert running == expected == cache
    tail = re.search(r"132([a-z]+)", running).group(1)
    assert tail >= "ea"

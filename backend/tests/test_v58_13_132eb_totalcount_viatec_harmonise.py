"""v58.13.132eb — Total-count chip + Viatec SSRA routing + CS-field
harmonisation.

Locks a three-part ship:

1. **FE total-count chip** — 4 list pages (Incidents, Hazards, Risk
   Assessments, Inspections) now read the `X-Total-Count` header
   emitted by `crud.py::list_items` since `.132ea` and render a
   subtle "N showing · M total" pill via the reusable
   `TotalCountChip` component.

2. **Viatec SSRA routing rule** (and every other SSRA variant) — 12
   routing rules seeded in `form_routing_rules`, one per SSRA
   template row in `form_templates` (6 Construction & Excavation +
   6 Viatec Traffic Solutions). Investigation revealed the previous
   `.132dz` rule only covered 1 of 12 template variants; a re-import
   of the source PDF would have missed the routing.

3. **CS-migrated field harmonisation** — the 254
   `migrated_from=cs_incidents` docs now carry native `IncidentIn`
   fields (`title`, `occurred_at`, `location`, `category`,
   `follow_up_status`, `immediate_actions`, `person_involved`,
   `evidence_photos`, `follow_up_actions`). CS originals preserved
   as `_cs_*` audit copies. FE surfaces a `CS-migrated` badge on the
   `CaptureCard` via `capture-cs-migrated-<id>` testid.
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

# ── File paths ────────────────────────────────────────────────
CHIP_JSX   = APP_ROOT / "frontend" / "src" / "components" / "TotalCountChip.jsx"
INCIDENTS  = APP_ROOT / "frontend" / "src" / "pages" / "Incidents.jsx"
HAZARDS    = APP_ROOT / "frontend" / "src" / "pages" / "Hazards.jsx"
RISK_JSX   = APP_ROOT / "frontend" / "src" / "pages" / "RiskAssessments.jsx"
INSPECT    = APP_ROOT / "frontend" / "src" / "pages" / "Inspections.jsx"
CAP_CARD   = APP_ROOT / "frontend" / "src" / "components" / "CaptureCard.jsx"
SEED_PY    = APP_ROOT / "backend" / "scripts" / "seed_ssra_routing_rules_v58_13_132eb.py"
HARM_PY    = APP_ROOT / "backend" / "scripts" / "harmonise_cs_incident_fields_v58_13_132eb.py"
VERSION_JS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW         = APP_ROOT / "frontend" / "public" / "service-worker.js"

API = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
PANELTEC_ORG_ID = "3116f250-a4eb-43f3-98a5-2a3656d6cb63"


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


# ─── Item 1: FE total-count chip ────────────────────────────────

def test_total_count_chip_component_exists():
    src = CHIP_JSX.read_text(encoding="utf-8")
    # Exports default + reads `X-Total-Count`-derived `total` prop.
    assert "export default function TotalCountChip" in src
    assert "total" in src and "showing" in src
    # Two visual states: full-visibility (emerald) + truncated (amber).
    assert "bg-emerald-50" in src
    assert "bg-amber-50" in src
    # Human-readable copy for both count-known and count-unknown cases.
    assert "showing ·" in src
    assert "total" in src
    # Renders a data-testid the tests can locate on the page.
    assert "data-testid={testid}" in src


def _chip_wired_on(page_src_path: Path, testid: str) -> None:
    src = page_src_path.read_text(encoding="utf-8")
    assert "import TotalCountChip" in src, (
        f"{page_src_path.name}: TotalCountChip not imported"
    )
    # Header read wire-up on the axios response.
    assert "x-total-count" in src, (
        f"{page_src_path.name}: `x-total-count` header not read"
    )
    # Chip renders with the page-specific testid.
    assert f'testid="{testid}"' in src, (
        f"{page_src_path.name}: testid={testid!r} not rendered"
    )


def test_chip_wired_on_incidents_page():
    _chip_wired_on(INCIDENTS, "incidents-total-count-chip")


def test_chip_wired_on_hazards_page():
    _chip_wired_on(HAZARDS, "hazards-total-count-chip")


def test_chip_wired_on_risk_assessments_page():
    _chip_wired_on(RISK_JSX, "risk-assessments-total-count-chip")


def test_chip_wired_on_inspections_page():
    _chip_wired_on(INSPECT, "inspections-total-count-chip")


def test_x_total_count_header_still_emitted_post_ship():
    """v58.13.132ea header is still emitted after `.132eb` — guards
    against a silent regression in `crud.py`."""
    hdr = _admin_token()
    r = requests.get(f"{API}/api/incidents", headers=hdr, timeout=30)
    assert r.status_code == 200
    x_total = r.headers.get("X-Total-Count")
    assert x_total is not None and int(x_total) == len(r.json())


# ─── Item 2: SSRA routing rule seed ─────────────────────────────

def test_seed_script_exists_and_dry_run_guarded():
    src = SEED_PY.read_text(encoding="utf-8")
    assert "argparse.ArgumentParser" in src
    assert '"--commit"' in src or "'--commit'" in src
    # Regex matches every SSRA variant regardless of business unit.
    assert '"SSRA"' in src
    # Every seeded row inserts `active: True` + `destination_category`
    # `risk_assessment`.
    assert '"active": True' in src
    assert '"risk_assessment"' in src


def test_all_ssra_templates_have_active_routing_rule():
    db = _db()
    templates = list(db.form_templates.find({
        "name": {"$regex": "SSRA", "$options": "i"},
        "$or": [{"deleted_at": None},
                {"deleted_at": {"$exists": False}}],
    }, {"_id": 0, "id": 1, "name": 1}))
    assert len(templates) >= 12, (
        f"expected ≥12 SSRA templates; got {len(templates)}"
    )
    missing = []
    wrong_category = []
    for t in templates:
        rule = db.form_routing_rules.find_one({
            "template_id": t["id"], "active": True,
        })
        if rule is None:
            missing.append((t["id"], t["name"]))
        elif rule.get("destination_category") != "risk_assessment":
            wrong_category.append((t["id"], t["name"],
                                    rule.get("destination_category")))
    assert not missing, (
        f"{len(missing)} SSRA templates have no active routing rule: "
        f"{missing[:3]}{' …' if len(missing) > 3 else ''}"
    )
    assert not wrong_category, (
        f"{len(wrong_category)} SSRA rules route somewhere other than "
        f"risk_assessment: {wrong_category[:3]}"
    )


def test_viatec_ssra_rule_present():
    """Explicit lock on the .132eb ask: Viatec Traffic Solutions SSRA
    templates route to Risk Assessments."""
    db = _db()
    viatec = list(db.form_templates.find({
        "name": {"$regex": "Viatec.*SSRA", "$options": "i"},
        "$or": [{"deleted_at": None},
                {"deleted_at": {"$exists": False}}],
    }, {"_id": 0, "id": 1}))
    assert len(viatec) >= 1
    for t in viatec:
        rule = db.form_routing_rules.find_one({
            "template_id": t["id"], "active": True,
        })
        assert rule is not None, (
            f"Viatec SSRA template {t['id']} has no active rule"
        )
        assert rule["destination_category"] == "risk_assessment"


def test_ssra_seed_idempotent():
    """Re-invoking the seed script reports zero new writes."""
    result = subprocess.run(
        ["python", "-m",
         "backend.scripts.seed_ssra_routing_rules_v58_13_132eb",
         "--commit"],
        capture_output=True, text=True, cwd=str(APP_ROOT), timeout=60,
    )
    assert result.returncode == 0
    assert "seeded new:      0" in result.stdout


# ─── Item 3: CS-field harmonisation ─────────────────────────────

def test_harmonise_script_exists_and_dry_run_guarded():
    src = HARM_PY.read_text(encoding="utf-8")
    assert "argparse.ArgumentParser" in src
    assert "_harmonised_at_v58_13_132eb" in src
    # Full mapping table encoded.
    for cs_key in ("location_2", "date_of_issue", "incident_categories",
                   "status", "immediate_action_2", "immediate_action_3",
                   "employee_reporting", "issue_number", "issue_type"):
        assert cs_key in src, f"{cs_key} not referenced in harmonise script"
    # `_cs_*` audit prefix used.
    assert "_cs_" in src


def test_all_cs_incidents_carry_harmonised_stamp():
    db = _db()
    total = db.incidents.count_documents({"migrated_from": "cs_incidents"})
    if total == 0:
        pytest.skip("no cs-migrated incidents on this env")
    stamped = db.incidents.count_documents({
        "migrated_from": "cs_incidents",
        "_harmonised_at_v58_13_132eb": {"$exists": True},
    })
    assert stamped == total


def test_all_cs_incidents_have_native_incident_fields():
    """After harmonisation every doc has the fields the native
    IncidentIn schema + list/detail views expect."""
    db = _db()
    required = ["title", "occurred_at", "category", "follow_up_status",
                "evidence_photos", "follow_up_actions"]
    q = {"migrated_from": "cs_incidents",
         "_harmonised_at_v58_13_132eb": {"$exists": True}}
    total = db.incidents.count_documents(q)
    if total == 0:
        pytest.skip("no harmonised cs-migrated incidents")
    missing_reports = {}
    for field in required:
        missing = db.incidents.count_documents({**q, field: {"$exists": False}})
        if missing:
            missing_reports[field] = missing
    assert not missing_reports, (
        f"native fields missing on some rows: {missing_reports}"
    )


def test_cs_origin_fields_preserved_as_underscore_prefix():
    """Every doc that had a CS `issue_number` / `business_unit` etc.
    now has `_cs_issue_number` / `_cs_business_unit` preserved."""
    db = _db()
    total = db.incidents.count_documents({"migrated_from": "cs_incidents"})
    if total == 0:
        pytest.skip("no cs-migrated incidents on this env")
    # Pick a sample and prove _cs_* keys exist.
    doc = db.incidents.find_one({"migrated_from": "cs_incidents",
                                  "_cs_issue_number": {"$exists": True}})
    assert doc is not None, "no doc has _cs_issue_number preserved"
    for k in ("_cs_business_unit", "_cs_issue_type", "_cs_status",
              "_cs_incident_categories", "_cs_date_of_issue"):
        assert k in doc, f"expected {k} on harmonised doc"


def test_harmonise_idempotent():
    """Re-invoking the harmonise script reports zero new writes."""
    result = subprocess.run(
        ["python", "-m",
         "backend.scripts.harmonise_cs_incident_fields_v58_13_132eb",
         "--commit"],
        capture_output=True, text=True, cwd=str(APP_ROOT), timeout=60,
    )
    assert result.returncode == 0
    assert "Nothing to do." in result.stdout


def test_capture_card_renders_cs_migrated_badge():
    src = CAP_CARD.read_text(encoding="utf-8")
    assert "r.migrated_from === 'cs_incidents'" in src
    assert 'capture-cs-migrated-' in src
    assert "CS-migrated" in src


def test_incidents_endpoint_surfaces_harmonised_fields():
    """Live-HTTP check: pull the Incidents list and confirm every
    CS-migrated row carries the native fields the FE expects."""
    hdr = _admin_token()
    r = requests.get(f"{API}/api/incidents", headers=hdr, timeout=30)
    assert r.status_code == 200
    body = r.json()
    cs_rows = [i for i in body if i.get("migrated_from") == "cs_incidents"]
    if not cs_rows:
        pytest.skip("no cs-migrated rows visible to this user")
    for row in cs_rows:
        assert row.get("title"), (
            f"cs-migrated row {row.get('id')} has no title"
        )
        assert row.get("category") in (
            "near_miss", "first_aid", "medical", "ltc", "env", "property"
        ), f"cs-migrated row has non-native category: {row.get('category')}"
        assert row.get("follow_up_status") in ("open", "in_progress", "closed")


# ─── Version sync ──────────────────────────────────────────────

def test_three_way_sync_at_132eb_or_later():
    running = re.search(r"^export const RUNNING_VERSION = '([^']+)'",
                        VERSION_JS.read_text(), re.MULTILINE).group(1)
    expected = re.search(r"^export const EXPECTED_CACHE_VERSION = '([^']+)'",
                         VERSION_JS.read_text(), re.MULTILINE).group(1)
    cache = re.search(r"^const CACHE_VERSION = '([^']+)'",
                      SW.read_text(), re.MULTILINE).group(1)
    assert running == expected == cache
    tail = re.search(r"132([a-z]+)", running).group(1)
    assert tail >= "eb"

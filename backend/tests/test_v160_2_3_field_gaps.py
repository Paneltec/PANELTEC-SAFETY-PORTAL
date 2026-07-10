"""v160.2.3 — Field-gap migration regression tests.

Uses the live backend (via `requests`) matching the existing project
convention. Assumes the v160.2.3 migration script has already run at
least once against the live DB.
"""
from __future__ import annotations
import os
import pytest
import requests

BASE = os.environ.get("PANELTEC_API", "http://localhost:8001")
ADMIN_EMAIL, ADMIN_PW = "stephen@paneltec.com.au", "Mcgstephen50#"


def _login(email: str, pw: str) -> str:
    r = requests.post(f"{BASE}/api/auth/login",
                      json={"email": email, "password": pw}, timeout=10)
    r.raise_for_status()
    body = r.json()
    return body.get("access_token") or body.get("token")


@pytest.fixture(scope="module")
def headers() -> dict:
    return {"Authorization": f"Bearer {_login(ADMIN_EMAIL, ADMIN_PW)}"}


@pytest.fixture(scope="module")
def by_name() -> dict:
    """Direct-DB fetch of all templates. Migration is a DB-level concern
    and some legacy templates live in orphan org rows that aren't
    reachable via `/api/forms/templates` for any given caller."""
    from pymongo import MongoClient
    from dotenv import load_dotenv
    load_dotenv()
    client = MongoClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    rows = list(db.form_templates.find({}))
    return {t["name"]: t for t in rows}


# ─── Task registry sanity ─────────────────────────────────────────────

def test_time_field_type_registered():
    """The `time` field type MUST be in ALLOWED_FIELD_TYPES so it round-
    trips through the template save endpoint without being coerced to
    text."""
    import sys
    sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
    from forms import ALLOWED_FIELD_TYPES  # noqa: E402
    assert "time" in ALLOWED_FIELD_TYPES
    assert "company_selector" in ALLOWED_FIELD_TYPES


# ─── Task 1: missing worker_picker added ───────────────────────────────

@pytest.mark.parametrize("name,multi", [
    ("Equipment Pre-Use Checklist", False),
    ("Incident Report",             False),
    ("Incident Report Form",        False),
    ("Near Miss Report",            False),
    ("Toolbox Talk",                True),
])
def test_worker_picker_added(by_name, name, multi):
    t = by_name.get(name)
    assert t is not None, f"template missing: {name}"
    wps = [f for f in t["fields"] if f["type"] == "worker_picker"]
    assert len(wps) >= 1, f"{name} still missing worker_picker"
    # The newly-added worker_picker must have the inline_company_toggle
    # config and (for multi cases) the multi flag.
    if multi:
        assert any(
            (f.get("config") or {}).get("multi") is True for f in wps
        ), f"{name} needs at least one multi worker_picker"
    for wp in wps:
        cfg = wp.get("config") or {}
        assert cfg.get("inline_company_toggle") is True, wp


# ─── Task 2: missing vehicle_navixy added ─────────────────────────────

def test_excavation_permit_has_vehicle(by_name):
    t = by_name.get("Excavation / Trench Permit")
    assert t is not None
    assert any(f["type"] == "vehicle_navixy" for f in t["fields"])


# ─── Task 3: company_selector added ───────────────────────────────────

@pytest.mark.parametrize("name", [
    "Hot Work Permit",
    "Confined Space Entry Permit",
    "Excavation / Trench Permit",
    "Working at Heights Permit",
    "JSEA — Job Safety & Environmental Analysis",
    "SWMS Sign-On",
    "Incident Report",
    "Incident Report Form",
    "Near Miss Report",
    "Equipment Pre-Use Checklist",
])
def test_company_selector_added(by_name, name):
    t = by_name.get(name)
    assert t is not None, f"template missing: {name}"
    cs = [f for f in t["fields"] if f["type"] == "company_selector"]
    assert len(cs) >= 1, f"{name} has no company_selector"
    assert cs[0]["required"] is True


# ─── Task 4: time fields added / converted ────────────────────────────

@pytest.mark.parametrize("name,in_lbl,out_lbl", [
    ("Toolbox Talk",                    "Start Time",     "End Time"),
    ("Toolbox Talk Attendance",         "Start Time",     "End Time"),
    ("Site Sign-In / Visitor Register", "Time In",        "Time Out"),
    ("Site Induction Checklist",        "Start Time",     "End Time"),
    ("Excavation / Trench Permit",      "Permit Time In", "Permit Time Out"),
    ("Working at Heights Permit",       "Permit Time In", "Permit Time Out"),
])
def test_time_in_out_added(by_name, name, in_lbl, out_lbl):
    t = by_name.get(name)
    assert t is not None, f"template missing: {name}"
    labels = {f["label"]: f for f in t["fields"]}
    assert in_lbl  in labels, f"{name} missing '{in_lbl}'"
    assert out_lbl in labels, f"{name} missing '{out_lbl}'"
    assert labels[in_lbl]["type"] == "time"
    assert labels[out_lbl]["type"] == "time"


@pytest.mark.parametrize("name,label", [
    ("Hot Work Permit",             "Permit Valid From"),
    ("Hot Work Permit",             "Permit Valid To"),
    ("Confined Space Entry Permit", "Permit Valid From"),
    ("Confined Space Entry Permit", "Permit Valid To"),
])
def test_text_to_time_converted(by_name, name, label):
    t = by_name.get(name)
    assert t is not None, f"template missing: {name}"
    matches = [f for f in t["fields"] if f["label"] == label]
    assert matches, f"{name} missing '{label}'"
    assert matches[0]["type"] == "time", (
        f"{name} / {label} still on {matches[0]['type']}, expected 'time'"
    )


# ─── Snapshot sanity ──────────────────────────────────────────────────

def test_backup_collection_populated_v160_2_2():
    """The migration script creates `form_templates_backup_v160_2_2`
    on first run. Verify it has rows so we can restore if needed."""
    from pymongo import MongoClient
    import os
    from dotenv import load_dotenv
    load_dotenv()
    client = MongoClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    assert "form_templates_backup_v160_2_2" in db.list_collection_names(), (
        "run scripts/migrate_v160_2_3_field_gaps.py first"
    )
    count = db["form_templates_backup_v160_2_2"].count_documents({})
    assert count > 0

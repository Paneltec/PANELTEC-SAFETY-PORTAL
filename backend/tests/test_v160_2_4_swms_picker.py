"""v160.2.4 — swms_picker field-type regression tests.

Verifies:
  · `swms_picker` is in ALLOWED_FIELD_TYPES (round-trips template saves).
  · Each target permit / JSEA / heavy-equipment template has a
    `swms_picker` field at the expected position (after the header /
    company / time block).
  · `multi` and `required` flags match the brief.
  · Snapshot collection `form_templates_backup_v160_2_3` exists.
  · Workers can list SWMS via the picker's underlying `GET /api/swms`
    endpoint. If a worker's role has no swms.view permission they get
    an empty list (expected), never a 500.
"""
from __future__ import annotations
import os
import pytest
import requests

BASE = os.environ.get("PANELTEC_API", "http://localhost:8001")
ADMIN_EMAIL, ADMIN_PW = "stephen@paneltec.com.au", "Mcgstephen50#"
WORKER_EMAIL, WORKER_PW = "worker_stephen@paneltec.com.au", "WorkerTest123!"


def _login(email: str, pw: str) -> str:
    r = requests.post(f"{BASE}/api/auth/login",
                      json={"email": email, "password": pw}, timeout=10)
    r.raise_for_status()
    body = r.json()
    return body.get("access_token") or body.get("token")


@pytest.fixture(scope="module")
def admin_headers() -> dict:
    return {"Authorization": f"Bearer {_login(ADMIN_EMAIL, ADMIN_PW)}"}


@pytest.fixture(scope="module")
def worker_headers() -> dict:
    return {"Authorization": f"Bearer {_login(WORKER_EMAIL, WORKER_PW)}"}


@pytest.fixture(scope="module")
def by_name() -> dict:
    from pymongo import MongoClient
    from dotenv import load_dotenv
    load_dotenv()
    client = MongoClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    return {t["name"]: t for t in db.form_templates.find({})}


TARGETS = [
    ("Hot Work Permit",                                       True,  True),
    ("Confined Space Entry Permit",                            True,  True),
    ("Excavation / Trench Permit",                             True,  True),
    ("Working at Heights Permit",                              True,  True),
    ("Crane Lift / Rigging Plan",                              True,  True),
    ("JSEA — Job Safety & Environmental Analysis",             True,  False),
    ("Construction Heavy Equipment Pre-Operation Checklist",   False, False),
]


def test_swms_picker_type_registered():
    import sys
    sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
    from forms import ALLOWED_FIELD_TYPES  # noqa: E402
    assert "swms_picker" in ALLOWED_FIELD_TYPES


@pytest.mark.parametrize("name,multi,required", TARGETS)
def test_swms_picker_added_to_template(by_name, name, multi, required):
    t = by_name.get(name)
    assert t is not None, f"template missing: {name}"
    picks = [f for f in t["fields"] if f["type"] == "swms_picker"]
    assert len(picks) == 1, f"{name} has {len(picks)} swms_picker fields"
    p = picks[0]
    assert p["label"] == "Applicable SWMS", p
    cfg = p.get("config") or {}
    assert bool(cfg.get("multi")) is multi, (
        f"{name}: multi expected {multi}, got {cfg.get('multi')}"
    )
    assert bool(p.get("required")) is required, (
        f"{name}: required expected {required}, got {p.get('required')}"
    )


def test_swms_picker_position_after_header(by_name):
    """The field must sit AFTER the Standard Header + Company + Time
    block on every target template."""
    header_types = {"date", "worker_picker", "gps", "vehicle_navixy",
                    "company_selector", "time"}
    for name, _, _ in TARGETS:
        t = by_name[name]
        idx_swms = next((i for i, f in enumerate(t["fields"])
                         if f["type"] == "swms_picker"), -1)
        assert idx_swms >= 0, name
        idx_header_last = max(
            (i for i, f in enumerate(t["fields"]) if f["type"] in header_types),
            default=-1,
        )
        assert idx_swms > idx_header_last, (
            f"{name}: swms_picker at {idx_swms} not after last header at {idx_header_last}"
        )


def test_backup_collection_populated_v160_2_3():
    from pymongo import MongoClient
    from dotenv import load_dotenv
    load_dotenv()
    client = MongoClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    assert "form_templates_backup_v160_2_3" in db.list_collection_names(), (
        "run scripts/migrate_v160_2_4_swms_picker.py first"
    )
    assert db["form_templates_backup_v160_2_3"].count_documents({}) > 0


def test_admin_can_list_swms(admin_headers):
    """Admin caller must be able to hit the picker's underlying endpoint
    without a 403 or 500 — this is the pattern the mobile SwmsPicker uses."""
    r = requests.get(f"{BASE}/api/swms", headers=admin_headers, timeout=10)
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body, list)


def test_worker_swms_list_never_errors(worker_headers):
    """Worker caller may receive 403 or 200 depending on the per-role
    permission preset (existing behaviour, not enforced here). What
    matters is that the picker never blows up on a worker with a
    restricted role — either 200 with a possibly-empty list, or a
    clean 403 that the mobile component surfaces as an empty state."""
    r = requests.get(f"{BASE}/api/swms", headers=worker_headers, timeout=10)
    assert r.status_code in (200, 403), (
        f"unexpected {r.status_code} from worker swms list: {r.text}"
    )
    if r.status_code == 200:
        assert isinstance(r.json(), list)

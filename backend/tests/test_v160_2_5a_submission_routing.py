"""v160.2.5a — Submission-routing regression tests.

Verifies phone-filled form submissions land in the correct web-admin
Capture sub-tab via the `mirror_categories` union added to `crud.py`.

Routing map (per the brief):
    pre_start | plant_pre_start → /api/pre-starts
    incident                     → /api/incidents
    near_miss                    → /api/hazards
    inspection                   → /api/inspections
    (site_diary)                 → /api/site-diary   (empty in prod)
    toolbox | general            → NOT mirrored (Forms tab reads its
                                                 own /api/forms/templates
                                                 per-template view)
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
def db():
    from pymongo import MongoClient
    from dotenv import load_dotenv
    load_dotenv()
    client = MongoClient(os.environ["MONGO_URL"])
    return client[os.environ["DB_NAME"]]


def _first_template(db, category: str, org_id: str) -> str:
    """Pick any template in `category` for the caller's org."""
    t = db.form_templates.find_one({
        "category": category, "org_id": org_id, "deleted_at": None,
    })
    return t["id"] if t else None


def _submit(headers: dict, template_id: str) -> str:
    """Create a submission the way the mobile app does."""
    r = requests.post(
        f"{BASE}/api/forms/templates/{template_id}/submissions",
        headers=headers, json={"fields": []}, timeout=10,
    )
    r.raise_for_status()
    return r.json()["id"]


def _list_ids(headers: dict, tab: str) -> set[str]:
    r = requests.get(f"{BASE}/api/{tab}?limit=500", headers=headers, timeout=10)
    r.raise_for_status()
    return {row["id"] for row in r.json() if row.get("source") == "form_submission"}


# ─── Routing proof ────────────────────────────────────────────────────

def _org_id(headers: dict) -> str:
    r = requests.get(f"{BASE}/api/auth/me", headers=headers, timeout=10)
    r.raise_for_status()
    return r.json()["org_id"]


@pytest.mark.parametrize("category,expected_tab,other_tabs", [
    ("pre_start", "pre-starts", ["hazards", "incidents", "inspections", "site-diary"]),
    ("incident",  "incidents",  ["hazards", "pre-starts", "inspections", "site-diary"]),
    ("inspection", "inspections", ["hazards", "pre-starts", "incidents", "site-diary"]),
])
def test_category_routes_to_correct_tab(db, headers, category, expected_tab, other_tabs):
    tpl = _first_template(db, category, _org_id(headers))
    if not tpl:
        pytest.skip(f"no template for category={category} in this org")
    sid = _submit(headers, tpl)

    assert sid in _list_ids(headers, expected_tab), (
        f"submission {sid} category={category} did NOT show up in /{expected_tab}"
    )
    for other in other_tabs:
        assert sid not in _list_ids(headers, other), (
            f"submission {sid} category={category} leaked into /{other}"
        )


def test_toolbox_does_not_leak_to_capture_tabs(db, headers):
    """The `toolbox` category is a Forms catch-all — it MUST NOT surface
    in any Capture sub-tab."""
    tpl = _first_template(db, "toolbox", _org_id(headers))
    if not tpl:
        pytest.skip("no toolbox template in this org")
    sid = _submit(headers, tpl)
    for tab in ["pre-starts", "hazards", "incidents", "inspections", "site-diary"]:
        assert sid not in _list_ids(headers, tab), (
            f"toolbox submission {sid} leaked into /{tab}"
        )


def test_mirrored_rows_carry_source_marker(headers):
    """Every mirrored row MUST carry `source: 'form_submission'` so the
    web-admin UI can distinguish legacy vs. phone-filled entries."""
    r = requests.get(f"{BASE}/api/pre-starts?limit=500", headers=headers, timeout=10)
    r.raise_for_status()
    mirrored = [row for row in r.json() if row.get("source") == "form_submission"]
    assert mirrored, "expected at least one mirrored pre-start row"
    for row in mirrored:
        assert row.get("template_category_snapshot") in {"pre_start", "plant_pre_start"}
        assert "created_at" in row and row["created_at"], row
        assert "status" in row


def test_status_filter_disables_mirror(headers):
    """When a caller narrows with `status=`, the mirror is skipped —
    legacy rows only. This is intentional: heterogeneous status
    schemas can't be safely projected."""
    r = requests.get(f"{BASE}/api/pre-starts?status=open", headers=headers, timeout=10)
    r.raise_for_status()
    for row in r.json():
        assert row.get("source") != "form_submission", (
            "status filter must not surface mirrored rows"
        )


def test_no_cross_tab_duplication(headers):
    """No mirrored row shows up in more than one Capture tab."""
    tabs = ["pre-starts", "hazards", "incidents", "inspections", "site-diary"]
    id_sets = {t: _list_ids(headers, t) for t in tabs}
    seen: dict[str, str] = {}
    for tab, ids in id_sets.items():
        for _id in ids:
            assert _id not in seen, (
                f"submission {_id} appears in both /{seen[_id]} and /{tab}"
            )
            seen[_id] = tab

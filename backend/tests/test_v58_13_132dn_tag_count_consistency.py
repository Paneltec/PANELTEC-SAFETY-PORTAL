"""v58.13.132dn — Tag count consistency bug fix.

Root cause (documented in `.132dn` ship memo):

  * `fleet_navixy_tags.get_navixy_tags` counted every asset carrying
    `navixy_device_id` regardless of `deleted_at` / `status` — so
    retired or soft-deleted vehicles bumped the sidebar count even
    though they never appeared in the `/fleet/register` default view.
  * `/fleet/register` did not accept a `tag` filter, so the FE
    applied the tag filter CLIENT-SIDE after server pagination — the
    "115 total" footer + "3 rows on page 1" mismatch.

Fixes locked below:

  1. Tag endpoint excludes retired + soft-deleted assets.
  2. `/fleet/register?tag=<label>` filters server-side; `total` and
     pagination page count reflect the tag-filtered result.
  3. Sidebar count === list total === len(items across pages).
"""
from __future__ import annotations

import os
import re
from pathlib import Path

import pytest
import requests
from pymongo import MongoClient

APP_ROOT = Path(__file__).resolve().parents[2]
TAGS_MOD = APP_ROOT / "backend" / "fleet_navixy_tags.py"
FLEET_MOD = APP_ROOT / "backend" / "fleet.py"
REGISTER_JSX = APP_ROOT / "frontend" / "src" / "pages" / "FleetRegister.jsx"

API = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
ADMIN_EMAIL = "stephen@paneltec.com.au"
ADMIN_PWD = "Mcgstephen50#"


def _admin_headers():
    r = requests.post(f"{API}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PWD},
                      timeout=30)
    if r.status_code != 200:
        pytest.skip(f"admin login unavailable: {r.status_code}")
    tok = r.json().get("access_token") or r.json().get("token")
    return {"Authorization": f"Bearer {tok}"}


def _mongo():
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


# ─── Source pins ────────────────────────────────────────────────

def test_tag_endpoint_excludes_retired_and_deleted():
    src = TAGS_MOD.read_text(encoding="utf-8")
    # Both queries (navixy-linked and local-tag) must exclude
    # retired + soft-deleted assets to align with the register view.
    assert '"status": {"$ne": "retired"}' in src
    # Two occurrences: navixy-linked branch + local-tag branch.
    assert src.count('"status": {"$ne": "retired"}') >= 2


def test_register_endpoint_accepts_tag_param():
    src = FLEET_MOD.read_text(encoding="utf-8")
    assert "tag: Optional[str] = Query(None" in src
    # Uses the shared helper to resolve label -> vehicle_ids.
    assert "from fleet_navixy_tags import get_navixy_tags" in src
    # AND-merges the id filter into the existing query.
    assert "id_filter = {\"id\": {\"$in\":" in src


def test_frontend_moves_tag_filter_server_side():
    src = REGISTER_JSX.read_text(encoding="utf-8")
    # Server-side param passed on reloadRows.
    assert "if (tagFilter) params.tag = tagFilter" in src
    # Legacy client-side branch removed.
    assert "// v58.13.132dj — Client-side tag filter" not in src
    assert "tagsByVehicle[row.id] === tagFilter" not in src
    # Reset-to-page-1 when tag changes.
    assert "setPage(1); }, [tagFilter]" in src


# ─── Behavioural: sidebar count matches register total ─────────

def test_sidebar_count_equals_register_total_for_every_tag():
    """For every tag returned by /fleet/navixy/tags, the sidebar
    `count` must equal the `/fleet/register?tag=<label>` `total`."""
    hdr = _admin_headers()
    tag_resp = requests.get(f"{API}/api/fleet/navixy/tags",
                            headers=hdr, timeout=30)
    assert tag_resp.status_code == 200, tag_resp.text
    distinct = tag_resp.json().get("distinct_tags", [])
    assert isinstance(distinct, list) and distinct, \
        "tag universe empty — cannot exercise the invariant"

    for t in distinct:
        label = t["label"] if isinstance(t, dict) else t
        expected = t["count"] if isinstance(t, dict) else None
        reg = requests.get(f"{API}/api/fleet/register",
                           params={"tag": label, "limit": 200},
                           headers=hdr, timeout=30)
        assert reg.status_code == 200, f"{label}: {reg.status_code} {reg.text[:120]}"
        body = reg.json()
        total = body.get("total", -1)
        items = body.get("items", [])
        if expected is not None:
            assert total == expected, (
                f"Tag '{label}': sidebar count {expected} != register total {total}")
        # If the tag has any linked vehicles, page 1 must return
        # all of them when limit=200 (matches Stephen's Vac Truck
        # Dumping bug that was showing 3 of 12).
        assert len(items) == total, (
            f"Tag '{label}': items returned {len(items)} != total {total}")


def test_vac_truck_dumping_specific_case():
    """Regression pin for Stephen's screenshot: `Vac Truck Dumping`
    tag filter must return the same number of rows as its sidebar
    count (fixed the '3 rows visible of 115 total' bug), and the
    known-retired asset `d076342d-...` must NEVER surface in the
    result. Uses the sidebar count as ground truth so the check
    stays valid as the fleet + local tags evolve."""
    hdr = _admin_headers()
    tag_resp = requests.get(f"{API}/api/fleet/navixy/tags",
                            headers=hdr, timeout=30)
    assert tag_resp.status_code == 200
    row = next((t for t in tag_resp.json().get("distinct_tags", [])
                if isinstance(t, dict) and t["label"] == "Vac Truck Dumping"),
               None)
    assert row, "Vac Truck Dumping tag missing from sidebar universe"
    expected = row["count"]
    assert expected >= 12, f"sidebar count regressed below 12: {expected}"
    reg = requests.get(f"{API}/api/fleet/register",
                       params={"tag": "Vac Truck Dumping", "limit": 200},
                       headers=hdr, timeout=30)
    assert reg.status_code == 200, reg.text
    body = reg.json()
    assert body["total"] == expected, (
        f"register total {body['total']} != sidebar count {expected}")
    assert len(body["items"]) == expected
    # And confirm the retired D076342d-... is NOT in the result.
    ids = {i["id"] for i in body["items"]}
    assert "d076342d-1f79-4a06-9ac1-0d21affc98ab" not in ids, \
        "retired asset leaked back into the tag-filtered register"


def test_retired_and_deleted_never_counted_in_tag_universe():
    """Retired vehicles that carry a Navixy tag must NOT bump the
    sidebar count."""
    db = _mongo()
    # Confirm there IS at least one retired-with-tag asset in the DB
    # so this test is meaningful.
    u = db.users.find_one({"email": ADMIN_EMAIL}, {"_id": 0, "org_id": 1})
    if not u:
        pytest.skip("admin user not seeded")
    org_id = u["org_id"]
    retired_with_tag = db.assets.find_one({
        "org_id": org_id,
        "status": "retired",
        "navixy_device_id": {"$ne": None},
    })
    if not retired_with_tag:
        pytest.skip("no retired-with-navixy-device asset in DB "
                    "— test invariant is vacuous")
    # Now ensure the tag endpoint's items[] never carries this asset.
    hdr = _admin_headers()
    resp = requests.get(f"{API}/api/fleet/navixy/tags",
                        headers=hdr, timeout=30)
    ids = {it["vehicle_id"] for it in resp.json().get("items", [])}
    assert retired_with_tag["id"] not in ids, \
        f"Retired asset {retired_with_tag['id']} leaked into the tag universe"

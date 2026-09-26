"""v58.13.132n7 — batch "Issue Job" endpoints.

Tests the four new endpoints in `backend/daily_jobs_batch.py`:
  · POST /daily-jobs/bulk-create
  · GET  /daily-jobs/today
  · GET  /daily-jobs/admin/trucks
  · GET  /daily-jobs/admin/sites
  · GET  /daily-jobs/admin/workers  (alias of the sibling module)

Coverage:
  · Batch create with 3 target users → 3 docs share one job_batch_id.
  · Snapshot fields (task, supervisor_name, supervisor_phone,
    truck_name, customer, issued_at) land on every child doc.
  · Site-id path — auto-populates snapshot from db.sites.
  · Site-freeform path — no site_id required, address optional.
  · Missing site_id AND site_freeform → 400.
  · Duplicate (worker, date) without override → conflicts bucket.
  · Duplicate WITH override → previous row supersedes.
  · Non-existent worker_id → not_found bucket, other siblings still land.
  · GET /daily-jobs/today lists ALL rows for the org for the date.
  · Non-admin (role='worker') → 403 across all endpoints.

Uses live-DB conftest (`_mongo`, `ephemeral_admin`, `ephemeral_org_id`)
per the `.132ab` pattern.
"""
from __future__ import annotations
import os
import time
import uuid
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import bcrypt
import pytest
import requests

pytestmark = pytest.mark.live_db_writes

BASE = "http://localhost:8001"
SYDNEY_TZ = ZoneInfo("Australia/Sydney")


def _hash(pwd: str) -> str:
    return bcrypt.hashpw(pwd.encode("utf-8"), bcrypt.gensalt(rounds=4)).decode("utf-8")


def _login_with_backoff(email: str, pwd: str) -> str:
    for attempt in range(3):
        r = requests.post(f"{BASE}/api/auth/login",
                          json={"email": email, "password": pwd}, timeout=15)
        if r.status_code == 200:
            return r.json()["access_token"]
        if r.status_code == 429:
            wait = int((r.json() or {}).get("retry_after_seconds") or 60)
            time.sleep(min(wait + 2, 75))
            continue
        pytest.fail(f"login failed for {email}: {r.status_code} {r.text[:200]}")
    pytest.fail(f"login rate-limited after 3 attempts for {email}")


def _sydney_today_iso() -> str:
    return datetime.now(SYDNEY_TZ).strftime("%Y-%m-%d")


@pytest.mark.live_db_writes
def test_bulk_create_batch_and_conflict_flow(
    _mongo, ephemeral_admin, ephemeral_org_id,
):
    """End-to-end bulk-create + list flow.

    Uses ephemeral users as workers so we don't disturb any real
    seeded data. Cleanup runs in `finally`."""
    admin_token = ephemeral_admin["token"]
    admin_org = ephemeral_org_id

    # ── Seed 3 target users (matches the picker's user-source path). ──
    prefix = f"t132n7-{uuid.uuid4().hex[:6]}"
    user_ids = []
    users_to_insert = []
    for i in range(3):
        uid = str(uuid.uuid4())
        user_ids.append(uid)
        users_to_insert.append({
            "id": uid, "org_id": admin_org,
            "email": f"{prefix}-w{i}@t.io",
            "first_name": f"TEST{prefix}", "last_name": f"W{i}",
            "name": f"TEST{prefix} W{i}",
            "role": "worker", "role_id": "paneltec_civil",
            "status": "active", "activation_status": "active",
            "mobile": f"04001320{i:02d}",
            "created_at": "2026-08-01T00:00:00+00:00",
            "created_by": "pytest",
            "token_version": 0, "workspace_ids": [],
        })
    _mongo.users.insert_many(users_to_insert)

    # ── Seed a truck (assets kind=vehicle). ──
    truck_id = str(uuid.uuid4())
    _mongo.assets.insert_one({
        "id": truck_id, "org_id": admin_org,
        "name": f"TEST-{prefix} Ranger",
        "kind": "vehicle", "asset_type": "ute",
        "rego": f"T{prefix[:5].upper()}",
        # Unique scan_token required by a unique index on the collection.
        "scan_token": f"scan-{prefix}-{uuid.uuid4().hex[:8]}",
        "deleted_at": None,
        "created_at": "2026-08-01T00:00:00+00:00",
    })

    # ── Seed a site. ──
    site_id = str(uuid.uuid4())
    _mongo.sites.insert_one({
        "id": site_id, "org_id": admin_org,
        "name": f"TEST-{prefix} Depot",
        "address_full": "1 Test Road", "suburb": "Testville", "state": "TAS",
        "latitude": -42.0, "longitude": 147.0,
        # Sites likely also carry a unique scan_token — set one to be safe.
        "scan_token": f"site-scan-{prefix}-{uuid.uuid4().hex[:8]}",
        "deleted_at": None,
        "created_at": "2026-08-01T00:00:00+00:00",
    })

    # Ephemeral non-admin worker user for 403 checks.
    worker_uid = str(uuid.uuid4())
    worker_email = f"__132n7_workerpwd_{prefix}@paneltec.internal"
    worker_pwd = f"Wpwd132n7_{prefix}!X"
    _mongo.users.insert_one({
        "id": worker_uid, "org_id": admin_org, "email": worker_email,
        "name": f"Pytest 132n7 worker {prefix}",
        "role": "worker", "role_id": "worker",
        "status": "active", "activation_status": "active",
        "password_hash": _hash(worker_pwd),
        "created_at": "2026-08-01T00:00:00+00:00", "created_by": "pytest",
        "token_version": 0, "workspace_ids": [],
    })
    worker_token = _login_with_backoff(worker_email, worker_pwd)

    H = {"Authorization": f"Bearer {admin_token}"}
    HW = {"Authorization": f"Bearer {worker_token}"}
    the_date = _sydney_today_iso()
    created_ids = []

    try:
        # ── 1. Trucks picker returns our seeded row. ──
        r = requests.get(f"{BASE}/api/daily-jobs/admin/trucks",
                         params={"q": prefix, "limit": 10}, headers=H, timeout=10)
        assert r.status_code == 200, r.text
        rows = r.json()["rows"]
        assert any(x["id"] == truck_id for x in rows), \
            f"trucks picker missed seeded row: {rows}"

        # ── 2. Sites picker returns our seeded row. ──
        r = requests.get(f"{BASE}/api/daily-jobs/admin/sites",
                         params={"q": prefix, "limit": 10}, headers=H, timeout=10)
        assert r.status_code == 200
        assert any(x["id"] == site_id for x in r.json()["rows"])

        # ── 3. Workers picker returns our seeded users. ──
        r = requests.get(f"{BASE}/api/daily-jobs/admin/workers",
                         params={"q": prefix, "limit": 200}, headers=H, timeout=10)
        assert r.status_code == 200
        picked_ids = {x["id"] for x in r.json()["rows"]}
        assert set(user_ids).issubset(picked_ids), \
            f"workers picker missed: expected {user_ids} in {picked_ids}"

        # ── 4. Bulk-create 3 workers, one batch. ──
        # FE composes address from site.address_full + suburb + state and
        # sends the composed string; backend snapshots it verbatim.
        # v58.13.132n7a — supervisor removed from the payload entirely.
        payload = {
            "date": the_date,
            "truck_id": truck_id,
            "site_id": site_id,
            "address": "1 Test Road, Testville, TAS",
            "customer": f"TEST-{prefix} Customer",
            "task": "Trench excavation and pipe laying",
            "notes": "Extra hi-vis. Traffic control from 07:00.",
            "worker_ids": user_ids,
        }
        r = requests.post(f"{BASE}/api/daily-jobs/bulk-create",
                          json=payload, headers=H, timeout=15)
        assert r.status_code == 201, r.text
        result = r.json()
        assert len(result["created"]) == 3, result
        assert len(result["conflicts"]) == 0
        assert len(result["not_found"]) == 0
        job_batch_id = result["job_batch_id"]
        created_ids.extend([x["assignment_id"] for x in result["created"]])
        # v58.13.132n7a — every child in a non-trial batch reports
        # is_trial_mirror=False in the created bucket.
        assert all(c.get("is_trial_mirror") is False for c in result["created"]), result

        # ── 5. Snapshot fields on every child doc. ──
        docs = list(_mongo.daily_job_assignments.find(
            {"job_batch_id": job_batch_id}, {"_id": 0},
        ))
        assert len(docs) == 3
        # v58.13.132n7a — staff_names is the alphabetically-sorted crew.
        expected_staff = sorted([f"TEST{prefix} W{i}" for i in range(3)])
        for d in docs:
            assert d["job_batch_id"] == job_batch_id
            assert d["truck_id"] == truck_id
            assert d["truck_name"].startswith(f"TEST-{prefix}"), d.get("truck_name")
            # v58.13.132n7a — truck_reg auto-snapshotted from db.assets.rego.
            assert d["truck_reg"] == f"T{prefix[:5].upper()}", d.get("truck_reg")
            assert d["site_id"] == site_id
            assert d["site_address"] == "1 Test Road, Testville, TAS", d.get("site_address")
            assert d["customer"] == f"TEST-{prefix} Customer"
            # v58.13.132n7a — supervisor keys must NOT be on the doc.
            assert "supervisor_id" not in d, d
            assert "supervisor_name" not in d, d
            assert "supervisor_phone" not in d, d
            assert d["task"] == "Trench excavation and pipe laying"
            assert d["notes"] == "Extra hi-vis. Traffic control from 07:00."
            assert d["issued_at"], d.get("issued_at")
            assert d["assigned_at"] == d["issued_at"]   # aliased
            assert d["status"] == "pending"
            assert d["meta"]["source"] == "issue_job_form"
            # v58.13.132n7a — SMS "Staff on this job" parity.
            assert d["staff_names"] == expected_staff, d.get("staff_names")
            assert d["is_trial_mirror"] is False

        # ── 6. Duplicate without override → conflicts. ──
        r = requests.post(f"{BASE}/api/daily-jobs/bulk-create",
                          json={"date": the_date, "site_id": site_id,
                                "worker_ids": user_ids[:1]},
                          headers=H, timeout=10)
        assert r.status_code == 201
        result2 = r.json()
        assert len(result2["created"]) == 0
        assert len(result2["conflicts"]) == 1
        assert result2["conflicts"][0]["worker_id"] == user_ids[0]

        # ── 7. Duplicate WITH override → previous superseded. ──
        r = requests.post(f"{BASE}/api/daily-jobs/bulk-create",
                          json={"date": the_date, "site_id": site_id,
                                "worker_ids": user_ids[:1],
                                "customer": "Overridden",
                                "override": True},
                          headers=H, timeout=10)
        assert r.status_code == 201
        result3 = r.json()
        assert len(result3["created"]) == 1
        assert len(result3["replaced"]) == 1
        assert result3["replaced"][0]["worker_id"] == user_ids[0]
        created_ids.append(result3["created"][0]["assignment_id"])
        # The new doc has the fresh customer; original is gone.
        assert _mongo.daily_job_assignments.count_documents({
            "worker_id": user_ids[0], "org_id": admin_org, "date": the_date,
        }) == 1
        latest = _mongo.daily_job_assignments.find_one(
            {"worker_id": user_ids[0], "org_id": admin_org, "date": the_date},
            {"_id": 0, "customer": 1},
        )
        assert latest["customer"] == "Overridden"

        # ── 8. Non-existent worker id lands in not_found + siblings still land. ──
        bogus = str(uuid.uuid4())
        r = requests.post(f"{BASE}/api/daily-jobs/bulk-create",
                          json={"date": the_date, "site_freeform": "Mystery Site",
                                "worker_ids": [bogus, user_ids[1]],
                                "override": True},
                          headers=H, timeout=10)
        assert r.status_code == 201
        result4 = r.json()
        assert result4["not_found"] == [bogus]
        # user_ids[1] already had an assignment from step 4 — override=true → replaces.
        assert any(c["worker_id"] == user_ids[1] for c in result4["created"])
        for c in result4["created"]:
            created_ids.append(c["assignment_id"])

        # ── 9. Missing both site_id and site_freeform → 400. ──
        r = requests.post(f"{BASE}/api/daily-jobs/bulk-create",
                          json={"date": the_date, "worker_ids": user_ids[:1]},
                          headers=H, timeout=10)
        assert r.status_code == 400
        assert "site_id" in r.json().get("detail", "").lower() or \
               "site_freeform" in r.json().get("detail", "").lower()

        # ── 10. GET /daily-jobs/today lists our seeded rows. ──
        r = requests.get(f"{BASE}/api/daily-jobs/today",
                         params={"date": the_date, "limit": 200},
                         headers=H, timeout=10)
        assert r.status_code == 200
        listed = r.json()
        assert listed["date"] == the_date
        our_rows = [x for x in listed["rows"] if x.get("worker_id") in set(user_ids)]
        assert len(our_rows) >= 3, \
            f"expected >=3 today-rows for our workers, got {len(our_rows)}"

        # ── 11. Non-admin caller: 403 across all four endpoints. ──
        for path in [
            "/api/daily-jobs/admin/trucks",
            "/api/daily-jobs/admin/sites",
            "/api/daily-jobs/admin/workers",
            "/api/daily-jobs/today",
        ]:
            r = requests.get(f"{BASE}{path}", headers=HW, timeout=10)
            assert r.status_code == 403, f"{path} should require admin, got {r.status_code}"
        r = requests.post(f"{BASE}/api/daily-jobs/bulk-create",
                          json={"site_freeform": "x", "worker_ids": [user_ids[0]]},
                          headers=HW, timeout=10)
        assert r.status_code == 403

        # ── 12. v58.13.132n7a — legacy supervisor_id in payload silently ignored. ──
        # Backend's BulkCreateIn drops unknown fields via Pydantic
        # `extra="ignore"`. Sending supervisor_id must NOT 400 (backwards-
        # compat) and MUST NOT land on the doc.
        r = requests.post(f"{BASE}/api/daily-jobs/bulk-create",
                          json={"date": the_date, "site_freeform": "Legacy-sup Site",
                                "supervisor_id": user_ids[0],
                                "supervisor_name": "Ignored", "supervisor_phone": "0400",
                                "worker_ids": user_ids[2:3], "override": True},
                          headers=H, timeout=10)
        assert r.status_code == 201, r.text
        legacy = r.json()
        assert len(legacy["created"]) == 1
        created_ids.append(legacy["created"][0]["assignment_id"])
        legacy_doc = _mongo.daily_job_assignments.find_one(
            {"id": legacy["created"][0]["assignment_id"]}, {"_id": 0},
        )
        assert "supervisor_id" not in legacy_doc, legacy_doc
        assert "supervisor_name" not in legacy_doc, legacy_doc
        assert "supervisor_phone" not in legacy_doc, legacy_doc

        # ── 13. v58.13.132n7a — trial_run=true creates admin mirror. ──
        # The batch has 1 real worker + the admin's mirror. Real
        # worker's is_trial_mirror=False; admin's is_trial_mirror=True.
        # `staff_names` on both docs lists only the REAL crew (admin
        # excluded — they're the officer, not the crew).
        r = requests.post(f"{BASE}/api/daily-jobs/bulk-create",
                          json={"date": the_date, "site_freeform": "Trial Site",
                                "worker_ids": user_ids[1:2], "override": True,
                                "trial_run": True},
                          headers=H, timeout=10)
        assert r.status_code == 201, r.text
        trial_res = r.json()
        assert len(trial_res["created"]) == 2, trial_res
        trial_mirrors = [c for c in trial_res["created"] if c.get("is_trial_mirror")]
        real_crew    = [c for c in trial_res["created"] if not c.get("is_trial_mirror")]
        assert len(trial_mirrors) == 1
        assert len(real_crew) == 1
        assert trial_mirrors[0]["worker_id"] == ephemeral_admin["id"]
        for c in trial_res["created"]:
            created_ids.append(c["assignment_id"])
        # staff_names on BOTH docs = real crew only (1 name).
        for aid in [c["assignment_id"] for c in trial_res["created"]]:
            doc = _mongo.daily_job_assignments.find_one({"id": aid}, {"_id": 0})
            assert doc["staff_names"] == [f"TEST{prefix} W1"], doc.get("staff_names")

    finally:
        # Cleanup — assignments, seeded users, truck, site.
        # v58.13.132n7a — also strip the admin trial-mirror rows we
        # inserted in step 13.
        _mongo.daily_job_assignments.delete_many(
            {"worker_id": {"$in": user_ids + [ephemeral_admin["id"]]}}
        )
        if created_ids:
            _mongo.daily_job_assignments.delete_many({"id": {"$in": created_ids}})
        _mongo.users.delete_many({"id": {"$in": user_ids + [worker_uid]}})
        _mongo.assets.delete_one({"id": truck_id})
        _mongo.sites.delete_one({"id": site_id})

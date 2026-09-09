"""v58.13.132ab — admin daily-job endpoints + duplicate guard.

Uses `_mongo` + `ephemeral_admin` conftest fixtures (module scoped)
and seeds ONE ephemeral worker user directly to avoid the shared
`tokens` fixture triggering the login rate limiter with all 6
NON_ADMIN_ROLES accounts. Hits the running supervisor-managed
backend on localhost:8001 via requests.
"""
from __future__ import annotations
import os
import time
import uuid
from datetime import datetime, timezone

import bcrypt
import pytest
import requests

pytestmark = pytest.mark.live_db_writes

BASE = "http://localhost:8001"


def _hash(pwd: str) -> str:
    return bcrypt.hashpw(pwd.encode("utf-8"), bcrypt.gensalt(rounds=4)).decode("utf-8")


def _login_with_backoff(email: str, pwd: str) -> str:
    for attempt in range(3):
        r = requests.post(f"{BASE}/api/auth/login",
                          json={"email": email, "password": pwd}, timeout=15)
        if r.status_code == 200:
            j = r.json()
            return j.get("access_token") or j.get("token")
        if r.status_code == 429:
            wait = int((r.json() or {}).get("retry_after_seconds") or 60)
            time.sleep(min(wait + 2, 75))
            continue
        pytest.fail(f"login failed for {email}: {r.status_code} {r.text[:200]}")
    pytest.fail(f"login rate-limited after 3 attempts for {email}")


@pytest.mark.live_db_writes
def test_admin_endpoints_and_duplicate_guard(_mongo, ephemeral_admin, ephemeral_org_id):
    admin_token = ephemeral_admin["token"]
    admin_org = ephemeral_org_id

    # Seed ONE ephemeral worker user for the 403 check.
    worker_uid = str(uuid.uuid4())
    worker_email = f"__132ab_worker_{worker_uid[:8]}@paneltec.internal"
    worker_pwd = f"Worker132ab_{worker_uid[:8]}!X"
    _mongo.users.insert_one({
        "id": worker_uid, "org_id": admin_org, "email": worker_email,
        "name": f"Pytest 132ab worker {worker_uid[:8]}",
        "role": "worker", "role_id": "worker",
        "status": "active", "activation_status": "active",
        "password_hash": _hash(worker_pwd),
        "created_at": "2026-08-01T00:00:00+00:00", "created_by": "pytest",
        "token_version": 0, "workspace_ids": [],
    })
    worker_token = _login_with_backoff(worker_email, worker_pwd)

    prefix = f"t132ab-{uuid.uuid4().hex[:6]}"
    w1 = {
        "id": str(uuid.uuid4()), "org_id": admin_org,
        "first_name": f"TEST{prefix}", "last_name": "Alpha",
        "mobile": "0400132001", "phone": "0400132001",
        "active_role": "worker", "role": "worker",
        "last_seen_at": None, "deleted_at": None,
        "email": f"alpha{prefix}@t.io",
    }
    w2 = {
        "id": str(uuid.uuid4()), "org_id": admin_org,
        "first_name": f"TEST{prefix}", "last_name": "Bravo",
        "mobile": "0400132002", "phone": "0400132002",
        "active_role": "supervisor", "role": "supervisor",
        "last_seen_at": None, "deleted_at": None,
        "email": f"bravo{prefix}@t.io",
    }
    _mongo.workers.insert_many([w1, w2])

    try:
        H = {"Authorization": f"Bearer {admin_token}"}

        r = requests.get(f"{BASE}/api/mobile/daily-jobs/admin/workers",
                         params={"q": prefix, "limit": 200}, headers=H, timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["total"] == 2, data
        names = {row["name"] for row in data["rows"]}
        assert names == {f"TEST{prefix} Alpha", f"TEST{prefix} Bravo"}

        r = requests.get(f"{BASE}/api/mobile/daily-jobs/admin/workers",
                         params={"q": prefix}, headers=H, timeout=10)
        assert r.json()["total"] == 2

        payload = {"worker_id": w1["id"], "site_id": "site-x", "site_name": "First"}
        r = requests.post(f"{BASE}/api/mobile/daily-jobs",
                          json=payload, headers=H, timeout=10)
        assert r.status_code == 201, r.text
        assert r.json()["site_name"] == "First"

        r = requests.post(f"{BASE}/api/mobile/daily-jobs",
                          json=payload, headers=H, timeout=10)
        assert r.status_code == 409, r.text
        assert "override" in r.json().get("detail", "").lower()

        r = requests.post(f"{BASE}/api/mobile/daily-jobs",
                          json={"worker_id": w1["id"], "site_id": "site-y",
                                "site_name": "Second", "override": True},
                          headers=H, timeout=10)
        assert r.status_code == 201, r.text
        assert r.json()["site_name"] == "Second"

        the_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        assert _mongo.daily_job_assignments.count_documents(
            {"org_id": admin_org, "worker_id": w1["id"], "date": the_date}
        ) == 1

        r = requests.post(f"{BASE}/api/mobile/daily-jobs",
                          json={"worker_id": w2["id"], "site_id": "site-z",
                                "site_name": "Bravo Site"},
                          headers=H, timeout=10)
        assert r.status_code == 201

        r = requests.get(f"{BASE}/api/mobile/daily-jobs/admin/assignments",
                         headers=H, timeout=10)
        assert r.status_code == 200
        listed = r.json()
        rows_for_test = [x for x in listed["rows"]
                         if x.get("worker_id") in {w1["id"], w2["id"]}]
        assert len(rows_for_test) == 2

        r = requests.get(f"{BASE}/api/mobile/daily-jobs/admin/sites",
                         params={"limit": 5}, headers=H, timeout=10)
        assert r.status_code == 200
        assert "rows" in r.json()

        r = requests.get(f"{BASE}/api/mobile/weather", headers=H, timeout=15)
        assert r.status_code == 200
        assert "station_name" in r.json()

        HW = {"Authorization": f"Bearer {worker_token}"}
        r = requests.get(f"{BASE}/api/mobile/daily-jobs/admin/workers",
                         headers=HW, timeout=10)
        assert r.status_code == 403
        r = requests.get(f"{BASE}/api/mobile/daily-jobs/admin/assignments",
                         headers=HW, timeout=10)
        assert r.status_code == 403
        r = requests.get(f"{BASE}/api/mobile/daily-jobs/admin/sites",
                         headers=HW, timeout=10)
        assert r.status_code == 403
    finally:
        _mongo.workers.delete_many({"id": {"$in": [w1["id"], w2["id"]]}})
        _mongo.daily_job_assignments.delete_many(
            {"worker_id": {"$in": [w1["id"], w2["id"]]}}
        )
        _mongo.pending_sms_dispatches.delete_many(
            {"worker_id": {"$in": [w1["id"], w2["id"]]}}
        )
        _mongo.users.delete_one({"id": worker_uid})

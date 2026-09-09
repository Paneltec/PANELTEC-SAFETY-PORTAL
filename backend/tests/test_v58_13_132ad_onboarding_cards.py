"""v58.13.132ad — Onboarding cards PDF endpoint.

Covers:
  · single-worker mode returns a PDF (200, correct headers).
  · bulk `worker_ids=` returns a PDF spanning multiple cards.
  · `all=true` returns a PDF for every active non-archived worker.
  · token idempotency — a second call for the same worker within
    the TTL reuses the existing unused token.
  · bulk-skip semantics — worker without `simpro_employee_id`
    doesn't crash the run; `X-Paneltec-Skipped` reflects the count.
  · admin-only gate — worker role → 403.
  · user_audit row is written with action=onboarding_cards_generated.

Uses the shared conftest fixtures (`_mongo`, `ephemeral_admin`,
`ephemeral_org_id`) and hits the running supervisor-managed backend
on localhost:8001 — Motor loop-binding forces the same
network-request pattern used by `.132ab` tests.
"""
from __future__ import annotations
import time
import uuid

import bcrypt
import pytest
import requests

pytestmark = pytest.mark.live_db_writes

BASE = "http://localhost:8001"
MIN_PDF_BYTES = 500  # single card floor; A4 pages are ~8KB+.


def _hash(pwd: str) -> str:
    return bcrypt.hashpw(pwd.encode("utf-8"), bcrypt.gensalt(rounds=4)).decode("utf-8")


def _login_with_backoff(email: str, pwd: str) -> str:
    for _ in range(3):
        r = requests.post(f"{BASE}/api/auth/login",
                          json={"email": email, "password": pwd}, timeout=15)
        if r.status_code == 200:
            return r.json().get("access_token") or r.json().get("token")
        if r.status_code == 429:
            time.sleep(65)
            continue
        pytest.fail(f"login failed for {email}: {r.status_code}")
    pytest.fail(f"rate-limited for {email}")


@pytest.mark.live_db_writes
def test_onboarding_cards_end_to_end(_mongo, ephemeral_admin, ephemeral_org_id):
    admin_token = ephemeral_admin["token"]
    admin_org = ephemeral_org_id

    # ── Seed worker users for the admin's real org ──
    prefix = f"t132ad-{uuid.uuid4().hex[:6]}"
    w1 = {
        "id": str(uuid.uuid4()), "org_id": admin_org,
        "first_name": f"TEST{prefix}", "last_name": "Alpha",
        "simpro_employee_id": f"sid-{prefix}-1",
        "company_id": "2", "company": "Paneltec",
        "active": True, "deleted_at": None,
        "email": f"alpha{prefix}@t.io",
        "mobile": "0400132201",
    }
    w2 = {
        "id": str(uuid.uuid4()), "org_id": admin_org,
        "first_name": f"TEST{prefix}", "last_name": "Bravo",
        "simpro_employee_id": f"sid-{prefix}-2",
        "company_id": "2", "company": "Paneltec",
        "active": True, "deleted_at": None,
        "email": f"bravo{prefix}@t.io",
        "mobile": "0400132202",
    }
    # A worker without simpro_employee_id — should be skipped in bulk.
    w3 = {
        "id": str(uuid.uuid4()), "org_id": admin_org,
        "first_name": f"TEST{prefix}", "last_name": "Charlie",
        "simpro_employee_id": None,
        "active": True, "deleted_at": None,
        "email": f"charlie{prefix}@t.io",
    }
    _mongo.workers.insert_many([w1, w2, w3])

    # ── Seed a non-admin user for 403 check ──
    worker_uid = str(uuid.uuid4())
    worker_email = f"__132ad_worker_{worker_uid[:8]}@paneltec.internal"
    worker_pwd = f"WorkerAD_{worker_uid[:8]}!X"
    _mongo.users.insert_one({
        "id": worker_uid, "org_id": admin_org, "email": worker_email,
        "name": f"Pytest 132ad worker {worker_uid[:8]}",
        "role": "worker", "role_id": "worker",
        "status": "active", "activation_status": "active",
        "password_hash": _hash(worker_pwd),
        "created_at": "2026-08-01T00:00:00+00:00", "created_by": "pytest",
        "token_version": 0, "workspace_ids": [],
    })
    worker_token = _login_with_backoff(worker_email, worker_pwd)

    try:
        H = {"Authorization": f"Bearer {admin_token}"}

        # 1. single-worker mode
        r = requests.get(f"{BASE}/api/mobile/onboarding/cards.pdf",
                         params={"worker_id": w1["id"]}, headers=H, timeout=15)
        assert r.status_code == 200, r.text[:300]
        assert r.headers["content-type"] == "application/pdf"
        assert r.headers.get("x-paneltec-generated") == "1"
        assert r.headers.get("x-paneltec-skipped") == "0"
        assert len(r.content) >= MIN_PDF_BYTES
        assert r.content[:4] == b"%PDF"

        # 2. token idempotency — second call reuses the same token.
        first_token_count = _mongo.mobile_onboarding_tokens.count_documents(
            {"simpro_employee_id": w1["simpro_employee_id"], "used": False}
        )
        r = requests.get(f"{BASE}/api/mobile/onboarding/cards.pdf",
                         params={"worker_id": w1["id"]}, headers=H, timeout=15)
        assert r.status_code == 200
        second_token_count = _mongo.mobile_onboarding_tokens.count_documents(
            {"simpro_employee_id": w1["simpro_employee_id"], "used": False}
        )
        assert second_token_count == first_token_count, "token should be reused, not re-issued"

        # 3. bulk selection — 2 workers with simpro id + 1 without.
        r = requests.get(
            f"{BASE}/api/mobile/onboarding/cards.pdf",
            params={"worker_ids": ",".join([w1["id"], w2["id"], w3["id"]])},
            headers=H, timeout=15,
        )
        assert r.status_code == 200, r.text[:300]
        assert r.headers.get("x-paneltec-generated") == "2"
        assert r.headers.get("x-paneltec-skipped") == "1"
        assert len(r.content) >= 2 * MIN_PDF_BYTES

        # 4. all=true mode — includes at least our two test workers.
        r = requests.get(f"{BASE}/api/mobile/onboarding/cards.pdf",
                         params={"all": "true"}, headers=H, timeout=30)
        assert r.status_code == 200
        assert int(r.headers.get("x-paneltec-generated", "0")) >= 2

        # 5. bad request — no mode chosen.
        r = requests.get(f"{BASE}/api/mobile/onboarding/cards.pdf",
                         headers=H, timeout=10)
        assert r.status_code == 400

        # 6. worker not found → 404.
        r = requests.get(f"{BASE}/api/mobile/onboarding/cards.pdf",
                         params={"worker_id": "does-not-exist"}, headers=H, timeout=10)
        assert r.status_code == 404

        # 7. audit row written.
        audit_count = _mongo.user_audit.count_documents(
            {"action": "onboarding_cards_generated", "org_id": admin_org}
        )
        assert audit_count >= 4  # single + reuse + bulk + all

        # 8. worker role → 403.
        HW = {"Authorization": f"Bearer {worker_token}"}
        r = requests.get(f"{BASE}/api/mobile/onboarding/cards.pdf",
                         params={"worker_id": w1["id"]}, headers=HW, timeout=10)
        assert r.status_code == 403
    finally:
        _mongo.workers.delete_many({"id": {"$in": [w1["id"], w2["id"], w3["id"]]}})
        _mongo.mobile_onboarding_tokens.delete_many(
            {"simpro_employee_id": {"$in": [
                w1["simpro_employee_id"], w2["simpro_employee_id"],
            ]}}
        )
        _mongo.users.delete_one({"id": worker_uid})

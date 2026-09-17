"""v58.13.132hs — Auto-provision workers → users.

Behaviour under test:

  1. Single-worker provision (happy path): admin POSTs
     `/workers/{id}/provision-user` → creates a `users` row in
     `status=invited`, role=viewer, worker_id set, throwaway password
     hash, `worker.user_link_status = invited_pending_send`, and
     `worker.user_id` populated. NO invite email queued.
  2. Missing-email guard: worker without email → status=`no_email`,
     no user row created.
  3. Email-conflict guard: worker whose email is already owned by a
     different user in the same org → status=`email_conflict`, no
     user created, `worker.user_conflict_user_id` populated.
  4. Idempotent: re-running provision on an already-linked worker
     returns `linked` and does not create a second user row.
  5. Manual link on conflict: admin POSTs `/workers/{id}/link-user`
     with the existing user's id → worker.user_id is set,
     `user.worker_id` is set, status flips to `linked`.
  6. Backfill: `/workers/backfill-user-provision` scans every worker
     in the org and returns aggregate counts.
  7. Bridge on send: hitting `/users/{id}/invite` records
     `last_invite_sent` on the user and flips the linked worker's
     `user_link_status` to `invite_sent`.
  8. Bulk send-pending: `/users/bulk-send-pending-invites` sends to
     every eligible `status=invited` user and reports counts, skips
     users that were emailed recently.
  9. `POST /users` (deprecated) still returns 410 — this ship must
     not accidentally un-deprecate it.
"""
from __future__ import annotations

import time
import uuid
from typing import Dict

import pytest
import requests

pytestmark = pytest.mark.live_db_writes

API = None  # populated in the fixture


# ── Fixture helpers ──────────────────────────────────────────────────

def _api(_mongo) -> str:
    from tests.conftest import API as _api_url
    return _api_url


def _seed_worker(_mongo, org_id: str, email: str = None,
                  first: str = "Casey", last: str = "Testworker",
                  extra: dict = None) -> dict:
    wid = f"pytest-w-{uuid.uuid4().hex[:8]}"
    doc = {
        "id":          wid,
        "org_id":      org_id,
        "first_name":  first,
        "last_name":   last,
        "email":       (email or "").lower() or None,
        "phone":       "0400000000",
        "mobile":      "0400000000",
        "position":    "Tester",
        "active":      True,
        "deleted_at":  None,
        "created_at":  "2026-09-15T00:00:00+00:00",
        "updated_at":  "2026-09-15T00:00:00+00:00",
        "created_by":  "pytest",
    }
    if extra:
        doc.update(extra)
    _mongo.workers.insert_one(dict(doc))
    return doc


def _seed_user(_mongo, org_id: str, email: str, worker_id: str = None) -> dict:
    uid = f"pytest-u-{uuid.uuid4().hex[:8]}"
    doc = {
        "id":            uid,
        "org_id":        org_id,
        "email":         email.lower(),
        "name":          "Existing Someone",
        "role":          "worker",
        "status":        "active",
        "password_hash": "$2b$04$0000000000000000000000000000000000000000000000000000",
        "token_version": 0,
        "created_at":    "2026-09-15T00:00:00+00:00",
    }
    if worker_id:
        doc["worker_id"] = worker_id
    _mongo.users.insert_one(dict(doc))
    return doc


def _cleanup(_mongo, worker_ids, user_ids):
    for wid in worker_ids:
        _mongo.workers.delete_one({"id": wid})
    for uid in user_ids:
        _mongo.users.delete_one({"id": uid})


# ── Tests ────────────────────────────────────────────────────────────

def test_provision_single_happy_path(_mongo, ephemeral_admin, ephemeral_org_id):
    api = _api(_mongo)
    tok = ephemeral_admin["token"]
    email = f"pytest.provision.{uuid.uuid4().hex[:6]}@paneltec.internal"
    worker = _seed_worker(_mongo, ephemeral_org_id, email=email)
    try:
        r = requests.post(
            f"{api}/workers/{worker['id']}/provision-user",
            headers={"Authorization": f"Bearer {tok}"}, timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "invited_pending_send"
        assert body["user_id"]
        assert body["email"] == email

        u = _mongo.users.find_one({"id": body["user_id"]}, {"_id": 0})
        assert u
        # v58.13.132hv — Provisioner default role now derives from
        # simpro_company_id (viewer was removed in .132s cleanup).
        # Test worker has no simpro_company_id, so default falls
        # through to `external_contractor`.
        assert u["role"] == "external_contractor"
        assert u["status"] == "invited"
        assert u["worker_id"] == worker["id"]
        assert u["email"] == email
        assert u["org_id"] == ephemeral_org_id
        assert u["password_hash"]

        w = _mongo.workers.find_one({"id": worker["id"]}, {"_id": 0})
        assert w["user_link_status"] == "invited_pending_send"
        assert w["user_id"] == body["user_id"]

        # No email should have been queued.
        queued = _mongo.email_outbox.count_documents(
            {"related_record_id": body["user_id"]}) if "email_outbox" in _mongo.list_collection_names() else 0
        assert queued == 0, "provisioning must NOT queue email"

        _cleanup(_mongo, [worker["id"]], [body["user_id"]])
    except Exception:
        _cleanup(_mongo, [worker["id"]], [])
        raise


def test_provision_missing_email_flags_no_email(_mongo, ephemeral_admin, ephemeral_org_id):
    api = _api(_mongo)
    tok = ephemeral_admin["token"]
    worker = _seed_worker(_mongo, ephemeral_org_id, email=None)
    try:
        r = requests.post(
            f"{api}/workers/{worker['id']}/provision-user",
            headers={"Authorization": f"Bearer {tok}"}, timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "no_email"
        assert body["user_id"] is None
        w = _mongo.workers.find_one({"id": worker["id"]}, {"_id": 0})
        assert w["user_link_status"] == "no_email"
    finally:
        _cleanup(_mongo, [worker["id"]], [])


def test_provision_email_match_auto_links_when_user_free(_mongo, ephemeral_admin, ephemeral_org_id):
    """v58.13.132hu — Refined policy. When a user already exists
    with the worker's email AND that user has no `worker_id`, the
    provisioner auto-links both sides (was `email_conflict` in
    .132hs). Only truly ambiguous cases (user already linked to a
    different worker) trigger the conflict flag."""
    api = _api(_mongo)
    tok = ephemeral_admin["token"]
    shared_email = f"pytest.autolink.{uuid.uuid4().hex[:6]}@paneltec.internal"
    existing = _seed_user(_mongo, ephemeral_org_id, shared_email)
    worker = _seed_worker(_mongo, ephemeral_org_id, email=shared_email)
    try:
        r = requests.post(
            f"{api}/workers/{worker['id']}/provision-user",
            headers={"Authorization": f"Bearer {tok}"}, timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "linked", f"expected auto-link, got {body}"
        assert body["user_id"] == existing["id"]
        # Only ONE user with that email in the org.
        n = _mongo.users.count_documents(
            {"org_id": ephemeral_org_id, "email": shared_email})
        assert n == 1
        # Both sides of the link written.
        w = _mongo.workers.find_one({"id": worker["id"]}, {"_id": 0})
        assert w["user_link_status"] == "linked"
        assert w["user_id"] == existing["id"]
        u = _mongo.users.find_one({"id": existing["id"]}, {"_id": 0})
        assert u["worker_id"] == worker["id"]
    finally:
        _cleanup(_mongo, [worker["id"]], [existing["id"]])


def test_provision_email_match_flags_conflict_when_user_bound_to_other_worker(
    _mongo, ephemeral_admin, ephemeral_org_id,
):
    """v58.13.132hu — The genuine conflict case: user with the same
    email is already tied to a DIFFERENT worker. That's ambiguous
    and requires admin intervention."""
    api = _api(_mongo)
    tok = ephemeral_admin["token"]
    shared_email = f"pytest.conflict.{uuid.uuid4().hex[:6]}@paneltec.internal"
    other_worker = _seed_worker(_mongo, ephemeral_org_id,
                                 email=shared_email, first="Other", last="Person")
    existing = _seed_user(_mongo, ephemeral_org_id, shared_email,
                          worker_id=other_worker["id"])
    worker = _seed_worker(_mongo, ephemeral_org_id, email=shared_email)
    try:
        r = requests.post(
            f"{api}/workers/{worker['id']}/provision-user",
            headers={"Authorization": f"Bearer {tok}"}, timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "email_conflict", \
            f"expected email_conflict, got {body}"
        assert body["user_id"] == existing["id"]
        # Only ONE user with that email in the org.
        n = _mongo.users.count_documents(
            {"org_id": ephemeral_org_id, "email": shared_email})
        assert n == 1
        w = _mongo.workers.find_one({"id": worker["id"]}, {"_id": 0})
        assert w["user_link_status"] == "email_conflict"
        assert w["user_conflict_user_id"] == existing["id"]
        assert not w.get("user_id")
        # And the other worker's link is untouched.
        u = _mongo.users.find_one({"id": existing["id"]}, {"_id": 0})
        assert u["worker_id"] == other_worker["id"]
    finally:
        _cleanup(_mongo,
                  [worker["id"], other_worker["id"]],
                  [existing["id"]])


def test_provision_is_idempotent_when_already_linked(_mongo, ephemeral_admin, ephemeral_org_id):
    api = _api(_mongo)
    tok = ephemeral_admin["token"]
    email = f"pytest.idempotent.{uuid.uuid4().hex[:6]}@paneltec.internal"
    worker = _seed_worker(_mongo, ephemeral_org_id, email=email)
    try:
        r1 = requests.post(f"{api}/workers/{worker['id']}/provision-user",
                           headers={"Authorization": f"Bearer {tok}"}, timeout=30)
        assert r1.status_code == 200
        first_uid = r1.json()["user_id"]

        r2 = requests.post(f"{api}/workers/{worker['id']}/provision-user",
                           headers={"Authorization": f"Bearer {tok}"}, timeout=30)
        assert r2.status_code == 200
        body = r2.json()
        assert body["status"] == "linked"
        assert body["user_id"] == first_uid

        # Still only one user row.
        n = _mongo.users.count_documents(
            {"org_id": ephemeral_org_id, "email": email})
        assert n == 1

        _cleanup(_mongo, [worker["id"]], [first_uid])
    except Exception:
        _cleanup(_mongo, [worker["id"]], [])
        raise


def test_link_user_resolves_email_conflict(_mongo, ephemeral_admin, ephemeral_org_id):
    api = _api(_mongo)
    tok = ephemeral_admin["token"]
    shared_email = f"pytest.link.{uuid.uuid4().hex[:6]}@paneltec.internal"
    existing = _seed_user(_mongo, ephemeral_org_id, shared_email)
    worker = _seed_worker(_mongo, ephemeral_org_id, email=shared_email)
    try:
        # Trigger the conflict flag first.
        requests.post(f"{api}/workers/{worker['id']}/provision-user",
                      headers={"Authorization": f"Bearer {tok}"}, timeout=30)

        r = requests.post(
            f"{api}/workers/{worker['id']}/link-user",
            json={"user_id": existing["id"]},
            headers={"Authorization": f"Bearer {tok}"}, timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"]
        assert body["status"] == "linked"

        w = _mongo.workers.find_one({"id": worker["id"]}, {"_id": 0})
        assert w["user_link_status"] == "linked"
        assert w["user_id"] == existing["id"]
        u = _mongo.users.find_one({"id": existing["id"]}, {"_id": 0})
        assert u["worker_id"] == worker["id"]
    finally:
        _cleanup(_mongo, [worker["id"]], [existing["id"]])


def test_backfill_produces_aggregate_counts(_mongo, ephemeral_admin, ephemeral_org_id):
    api = _api(_mongo)
    tok = ephemeral_admin["token"]
    happy_email = f"pytest.bf.happy.{uuid.uuid4().hex[:6]}@paneltec.internal"
    conflict_email = f"pytest.bf.conflict.{uuid.uuid4().hex[:6]}@paneltec.internal"
    # v58.13.132hu — For the conflict bucket the existing user must
    # be bound to a DIFFERENT worker (a same-email user with no
    # `worker_id` now auto-links instead of flagging as conflict).
    other_worker = _seed_worker(_mongo, ephemeral_org_id, email=conflict_email,
                                 first="Other", last="Owner")
    existing = _seed_user(_mongo, ephemeral_org_id, conflict_email,
                           worker_id=other_worker["id"])
    w_happy = _seed_worker(_mongo, ephemeral_org_id, email=happy_email)
    w_conflict = _seed_worker(_mongo, ephemeral_org_id, email=conflict_email)
    w_noemail = _seed_worker(_mongo, ephemeral_org_id, email=None)
    created_uids: list[str] = []
    try:
        r = requests.post(
            f"{api}/workers/backfill-user-provision",
            headers={"Authorization": f"Bearer {tok}"}, timeout=60,
        )
        assert r.status_code == 200, r.text
        counts = r.json()
        assert counts["scanned"] >= 4
        assert counts["invited_pending_send"] >= 1
        assert counts["email_conflict"] >= 1
        assert counts["no_email"] >= 1

        happy = _mongo.workers.find_one({"id": w_happy["id"]}, {"_id": 0})
        assert happy["user_link_status"] == "invited_pending_send"
        created_uids.append(happy["user_id"])

        conflict = _mongo.workers.find_one({"id": w_conflict["id"]}, {"_id": 0})
        assert conflict["user_link_status"] == "email_conflict"

        no_email = _mongo.workers.find_one({"id": w_noemail["id"]}, {"_id": 0})
        assert no_email["user_link_status"] == "no_email"

        # Re-run must be idempotent (no doubled users).
        r2 = requests.post(
            f"{api}/workers/backfill-user-provision",
            headers={"Authorization": f"Bearer {tok}"}, timeout=60,
        )
        assert r2.status_code == 200
        n = _mongo.users.count_documents(
            {"org_id": ephemeral_org_id, "email": happy_email})
        assert n == 1
    finally:
        _cleanup(_mongo,
                  [w_happy["id"], w_conflict["id"], w_noemail["id"], other_worker["id"]],
                  created_uids + [existing["id"]])


def test_deprecated_post_users_still_returns_410(_mongo, ephemeral_admin):
    api = _api(_mongo)
    tok = ephemeral_admin["token"]
    r = requests.post(
        f"{api}/users",
        json={"email": "x@example.com", "name": "x", "role": "viewer",
              "workspace_ids": []},
        headers={"Authorization": f"Bearer {tok}"}, timeout=30,
    )
    assert r.status_code == 410, r.text


def test_bulk_send_pending_invites_targets_only_invited_users(
    _mongo, ephemeral_admin, ephemeral_org_id,
):
    api = _api(_mongo)
    tok = ephemeral_admin["token"]
    happy_email = f"pytest.bulk.{uuid.uuid4().hex[:6]}@paneltec.internal"
    worker = _seed_worker(_mongo, ephemeral_org_id, email=happy_email)
    # Provision the invited user first.
    r = requests.post(f"{api}/workers/{worker['id']}/provision-user",
                       headers={"Authorization": f"Bearer {tok}"}, timeout=30)
    assert r.status_code == 200
    uid = r.json()["user_id"]
    try:
        # Bulk send (target only this user via allow-list).
        r2 = requests.post(
            f"{api}/users/bulk-send-pending-invites",
            json={"user_ids": [uid], "resend_after_days": 0},
            headers={"Authorization": f"Bearer {tok}"}, timeout=60,
        )
        assert r2.status_code == 200, r2.text
        body = r2.json()
        assert body["scanned"] == 1
        assert body["sent"] == 1
        assert body["skipped_recent"] == 0

        # User must now carry last_invite_sent.
        u = _mongo.users.find_one({"id": uid}, {"_id": 0})
        assert u.get("last_invite_sent")

        # Worker's user_link_status must have flipped to invite_sent.
        w = _mongo.workers.find_one({"id": worker["id"]}, {"_id": 0})
        assert w["user_link_status"] == "invite_sent"

        # Second call with resend_after_days=0 must skip (already sent).
        r3 = requests.post(
            f"{api}/users/bulk-send-pending-invites",
            json={"user_ids": [uid], "resend_after_days": 0},
            headers={"Authorization": f"Bearer {tok}"}, timeout=60,
        )
        assert r3.status_code == 200
        body3 = r3.json()
        assert body3["sent"] == 0
        assert body3["skipped_recent"] == 1
    finally:
        # Also purge the queued email so we don't leak into email_outbox.
        _mongo.email_outbox.delete_many({"related_record_id": uid})
        _cleanup(_mongo, [worker["id"]], [uid])


def test_version_pin_v132hs():
    """v58.13.132hs — Forward-safe pin. Any ship at .132hs or later
    is acceptable so subsequent ships don't retroactively break this
    ship's version-lockstep guard."""
    version_js = open("/app/frontend/src/lib/version.js").read()
    import re as _re
    assert _re.search(r"paneltec-v160\.3\.9\.58\.13\.132h[s-z]", version_js), \
        "RUNNING_VERSION not bumped to .132hs or later"
    sw_js = open("/app/frontend/public/service-worker.js").read()
    assert _re.search(r"paneltec-v160\.3\.9\.58\.13\.132h[s-z]", sw_js), \
        "CACHE_VERSION not bumped to .132hs or later"

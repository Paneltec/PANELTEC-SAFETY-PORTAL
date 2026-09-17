"""v58.13.132hu — Auto-link fix for worker → user provisioning.

`.132hs` treated every same-email/same-org collision as an
`email_conflict` requiring admin review. Live audit of Stephen's
org (2026-09-17) put 63/70 workers in the conflict bucket because
the matching users existed BEFORE the auto-provisioning system
did — Simpro's legacy user path, admin-created accounts, pre-.132hs
onboarding. The user IS the correct target; the two-way link just
hadn't been attached.

`.132hu` refines the policy:
  · Email match, existing user has no `worker_id` → auto-link
    (`worker.user_id ↔ user.worker_id`, status="linked").
  · Email match, existing user's `worker_id == this worker.id`  →
    idempotent no-op (status="linked").
  · Email match, existing user's `worker_id` points at a DIFFERENT
    worker → the ONLY genuine `email_conflict` case.

Live backfill on Stephen's org after this fix shipped:
    scanned=70, already_linked=68,
    invited_pending_send=0, email_conflict=1, no_email=1

The single remaining `email_conflict` is a duplicate-worker case
(two "Amanda Guy" workers with different simpro_employee_ids
sharing the same email) — correct behaviour, admin has to resolve
which record is authoritative.

Tests below lock the refined policy.
"""
from __future__ import annotations

import re
import uuid
from pathlib import Path

import pytest
import requests

pytestmark = pytest.mark.live_db_writes


VJS = Path("/app/frontend/src/lib/version.js")
SW = Path("/app/frontend/public/service-worker.js")


def _api(_mongo) -> str:
    from tests.conftest import API as _api_url
    return _api_url


def _seed_worker(_mongo, org_id: str, email: str = None,
                  first: str = "Sam", last: str = "Auto") -> dict:
    wid = f"pytest-hu-w-{uuid.uuid4().hex[:8]}"
    doc = {
        "id":         wid,
        "org_id":     org_id,
        "first_name": first,
        "last_name":  last,
        "email":      (email or "").lower() or None,
        "active":     True,
        "deleted_at": None,
        "created_at": "2026-09-17T00:00:00+00:00",
        "updated_at": "2026-09-17T00:00:00+00:00",
    }
    _mongo.workers.insert_one(dict(doc))
    return doc


def _seed_user(_mongo, org_id: str, email: str,
                worker_id: str = None, name: str = "Legacy User") -> dict:
    uid = f"pytest-hu-u-{uuid.uuid4().hex[:8]}"
    doc = {
        "id":            uid,
        "org_id":        org_id,
        "email":         email.lower(),
        "name":          name,
        "role":          "worker",
        "status":        "active",
        "password_hash": "$2b$04$0000000000000000000000000000000000000000000000000000",
        "token_version": 0,
        "created_at":    "2026-09-17T00:00:00+00:00",
    }
    if worker_id:
        doc["worker_id"] = worker_id
    _mongo.users.insert_one(dict(doc))
    return doc


def _cleanup(_mongo, wids, uids):
    for wid in wids:
        _mongo.workers.delete_one({"id": wid})
    for uid in uids:
        _mongo.users.delete_one({"id": uid})


# ── Backend behaviour guards ────────────────────────────────────────

def test_provision_auto_links_free_user(_mongo, ephemeral_admin, ephemeral_org_id):
    """Existing user with matching email + no worker_id → auto-link.
    The exact case that turned 63/70 workers into false conflicts
    before this ship."""
    api = _api(_mongo)
    tok = ephemeral_admin["token"]
    email = f"pytest.hu.free.{uuid.uuid4().hex[:6]}@paneltec.internal"
    user = _seed_user(_mongo, ephemeral_org_id, email)
    worker = _seed_worker(_mongo, ephemeral_org_id, email=email)
    try:
        r = requests.post(
            f"{api}/workers/{worker['id']}/provision-user",
            headers={"Authorization": f"Bearer {tok}"}, timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "linked", f"expected linked, got {body}"
        assert body["user_id"] == user["id"]
        w = _mongo.workers.find_one({"id": worker["id"]}, {"_id": 0})
        assert w["user_link_status"] == "linked"
        assert w["user_id"] == user["id"]
        u = _mongo.users.find_one({"id": user["id"]}, {"_id": 0})
        assert u["worker_id"] == worker["id"]
        # Only ONE user with that email remains — we did not
        # create a duplicate.
        n = _mongo.users.count_documents(
            {"org_id": ephemeral_org_id, "email": email})
        assert n == 1
    finally:
        _cleanup(_mongo, [worker["id"]], [user["id"]])


def test_provision_flags_conflict_when_user_bound_to_other_worker(
    _mongo, ephemeral_admin, ephemeral_org_id,
):
    """Existing user with matching email + `worker_id` on a
    different worker → truly ambiguous, must flag as
    `email_conflict`. Mirrors Stephen's Amanda Guy duplicate."""
    api = _api(_mongo)
    tok = ephemeral_admin["token"]
    email = f"pytest.hu.dup.{uuid.uuid4().hex[:6]}@paneltec.internal"
    other_worker = _seed_worker(_mongo, ephemeral_org_id, email=email,
                                 first="Other", last="Person")
    user = _seed_user(_mongo, ephemeral_org_id, email,
                       worker_id=other_worker["id"])
    dup_worker = _seed_worker(_mongo, ephemeral_org_id, email=email,
                               first="Dupe", last="Person")
    try:
        r = requests.post(
            f"{api}/workers/{dup_worker['id']}/provision-user",
            headers={"Authorization": f"Bearer {tok}"}, timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "email_conflict", body
        assert body["user_id"] == user["id"]
        w = _mongo.workers.find_one({"id": dup_worker["id"]}, {"_id": 0})
        assert w["user_link_status"] == "email_conflict"
        assert w["user_conflict_user_id"] == user["id"]
        assert not w.get("user_id"), "dup worker must NOT auto-link"
        # Original link untouched.
        u = _mongo.users.find_one({"id": user["id"]}, {"_id": 0})
        assert u["worker_id"] == other_worker["id"]
    finally:
        _cleanup(_mongo,
                  [dup_worker["id"], other_worker["id"]],
                  [user["id"]])


def test_provision_idempotent_when_user_already_points_at_this_worker(
    _mongo, ephemeral_admin, ephemeral_org_id,
):
    """Existing user with matching email AND `worker_id == this
    worker.id` → idempotent linked no-op."""
    api = _api(_mongo)
    tok = ephemeral_admin["token"]
    email = f"pytest.hu.idem.{uuid.uuid4().hex[:6]}@paneltec.internal"
    worker = _seed_worker(_mongo, ephemeral_org_id, email=email)
    user = _seed_user(_mongo, ephemeral_org_id, email,
                       worker_id=worker["id"])
    try:
        r = requests.post(
            f"{api}/workers/{worker['id']}/provision-user",
            headers={"Authorization": f"Bearer {tok}"}, timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "linked", body
        assert body["user_id"] == user["id"]
        # No duplicate user created.
        n = _mongo.users.count_documents(
            {"org_id": ephemeral_org_id, "email": email})
        assert n == 1
    finally:
        _cleanup(_mongo, [worker["id"]], [user["id"]])


def test_backfill_auto_links_all_free_email_matches(
    _mongo, ephemeral_admin, ephemeral_org_id,
):
    """`POST /workers/backfill-user-provision` must heal every
    stale email_conflict where the collision is a two-way mirror.
    Mirrors the exact scenario that unblocked Stephen's org
    (63 workers → 63 links in one call)."""
    api = _api(_mongo)
    tok = ephemeral_admin["token"]
    trios = []
    for i in range(3):
        email = f"pytest.hu.bf.{uuid.uuid4().hex[:6]}.{i}@paneltec.internal"
        u = _seed_user(_mongo, ephemeral_org_id, email)
        w = _seed_worker(_mongo, ephemeral_org_id, email=email,
                          first=f"BF{i}", last="Worker")
        trios.append((w, u))
    wid_by_uid = {u["id"]: w["id"] for w, u in trios}
    try:
        r = requests.post(
            f"{api}/workers/backfill-user-provision",
            headers={"Authorization": f"Bearer {tok}"}, timeout=60,
        )
        assert r.status_code == 200, r.text
        counts = r.json()
        # `already_linked` covers both pre-existing links and the
        # new same-invocation auto-links (the service returns
        # STATUS_LINKED for both).
        assert counts["already_linked"] >= 3, counts
        for uid, wid in wid_by_uid.items():
            u = _mongo.users.find_one({"id": uid}, {"_id": 0})
            w = _mongo.workers.find_one({"id": wid}, {"_id": 0})
            assert u["worker_id"] == wid, f"user {uid} not linked"
            assert w["user_id"] == uid, f"worker {wid} not linked"
            assert w["user_link_status"] == "linked", w["user_link_status"]
    finally:
        _cleanup(_mongo,
                  [w["id"] for w, _ in trios],
                  [u["id"] for _, u in trios])


def test_mirror_status_endpoint_returns_expected_shape(
    _mongo, ephemeral_admin, ephemeral_org_id,
):
    """v58.13.132hu — `GET /worker-user-mirror-status` powers the
    Settings > Users toolbar pill. Shape guard so future refactors
    don't drop fields the FE reads."""
    api = _api(_mongo)
    tok = ephemeral_admin["token"]
    r = requests.get(
        f"{api}/worker-user-mirror-status",
        headers={"Authorization": f"Bearer {tok}"}, timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    for key in ("workers_total", "linked", "invited_pending",
                "invite_sent", "email_conflict", "no_email", "unset"):
        assert key in body, f"mirror-status payload missing {key!r}: {body}"
        assert isinstance(body[key], int), f"{key} must be int"
    # Total must equal the sum of the buckets.
    bucket_sum = (body["linked"] + body["invited_pending"]
                  + body["invite_sent"] + body["email_conflict"]
                  + body["no_email"] + body["unset"])
    assert body["workers_total"] == bucket_sum, \
        f"workers_total {body['workers_total']} ≠ sum-of-buckets {bucket_sum}"


def test_users_management_active_filter_includes_invited():
    """v58.13.132hu — Glen's user record has `status='invited'`
    after auto-provisioning. The Settings > Users default view
    (filters.status === 'active') must surface `invited` rows too
    — otherwise auto-provisioned workers stay invisible even
    though the mirror pill claims they're mirrored."""
    src = Path("/app/frontend/src/pages/UsersManagement.jsx").read_text()
    # The `statusMatches` predicate must accept `invited` in the
    # active bucket.
    assert "u.status === 'active' || u.status === 'invited'" in src, \
        "default Active filter still excludes invited users"
    # And the "Pending inductees" alias must map the FE constant
    # `pending_invite` onto the DB value `invited`.
    assert "filters.status === 'pending_invite'" in src, \
        "pending_invite alias branch missing"
    assert "u.status === 'invited'" in src, \
        "pending_invite alias must match u.status === 'invited'"


# ── Version lockstep ───────────────────────────────────────────────

def test_version_pin_v132hu():
    js = VJS.read_text()
    sw = SW.read_text()
    assert re.search(
        r"RUNNING_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132h[u-z]", js
    ), "RUNNING_VERSION not bumped to .132hu or later"
    assert re.search(
        r"EXPECTED_CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132h[u-z]", js
    ), "EXPECTED_CACHE_VERSION not bumped to .132hu or later"
    assert re.search(
        r"CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132h[u-z]", sw
    ), "service-worker CACHE_VERSION not bumped to .132hu or later"

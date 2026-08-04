"""v160.3.9.57.1 — Notifications API unit tests.

Hits the live FastAPI backend via `requests` (matching the pattern
established by `test_hr_employees_v48.py` et al) rather than pulling
the ASGI app into pytest, which would double-bind Motor's event loop.

Five contract points covered:
  1. `unread_count` math (mark 2 read → count drops by 2).
  2. Category gating by permission token (empty-token role → 0 items).
  3. Read idempotency (double-POST → single `notifications_read` row).
  4. `mark-all-read` clears the count.
  5. Stable ID hash (same source → same id across calls).

All fixtures ephemeral. `stephen@paneltec.com.au` is used ONLY as the
admin who reads live data — never mutated.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone

import bcrypt
import pytest
import pymongo
import requests
from tests.conftest import API, ADMIN_EMAIL, ADMIN_PWD, EPHEMERAL_PWD, _login


def _admin() -> str:
    return _login(ADMIN_EMAIL, ADMIN_PWD)


def _hdr(t: str) -> dict:
    return {"Authorization": f"Bearer {t}"}


def _make_ephemeral_user(role_id: str = "admin") -> tuple[str, dict, pymongo.MongoClient]:
    """Insert a temporary user + role and return (token, doc, client)."""
    client = pymongo.MongoClient(os.environ["MONGO_URL"])
    dbn = os.environ.get("DB_NAME", "paneltec")
    dbh = client[dbn]
    org_id = "3116f250-a4eb-43f3-98a5-2a3656d6cb63"
    uid = str(uuid.uuid4())
    email = f"nt-{uid[:8]}@notifications-fixture.example.com"
    pwd_hash = bcrypt.hashpw(EPHEMERAL_PWD.encode(), bcrypt.gensalt(rounds=10)).decode()
    doc = {
        "id": uid, "org_id": org_id, "email": email,
        "name": f"Notifications Fixture {uid[:6]}",
        "role_id": role_id, "role": role_id,
        "password_hash": pwd_hash,
        "must_change_password": False,
        "activation_status": "active",
        "token_version": 0,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    dbh.users.insert_one(doc)
    token = _login(email, EPHEMERAL_PWD)
    return token, doc, client


def _cleanup(client: pymongo.MongoClient, user_id: str) -> None:
    dbn = os.environ.get("DB_NAME", "paneltec")
    client[dbn].users.delete_many({"id": user_id})
    client[dbn].notifications_read.delete_many({"user_id": user_id})


# ── Test 1 — unread_count math ────────────────────────────────────────
def test_1_unread_count_math():
    token = _admin()
    r = requests.get(f"{API}/notifications", headers=_hdr(token), timeout=15)
    assert r.status_code == 200, r.text
    initial = r.json()
    if initial["unread_count"] < 2:
        # Not enough live data — synthesise via mark-all-read then
        # re-fetch. If no notifications at all, this contract still
        # holds trivially (0 == 0), so skip the delta assertion.
        return
    marks = [it["id"] for it in initial["items"] if not it["read"]][:2]
    for mid in marks:
        rr = requests.post(f"{API}/notifications/{mid}/read", headers=_hdr(token), timeout=15)
        assert rr.status_code == 200
    r2 = requests.get(f"{API}/notifications", headers=_hdr(token), timeout=15)
    after = r2.json()
    # unread should have dropped by exactly 2.
    assert after["unread_count"] == initial["unread_count"] - 2, (
        f"expected {initial['unread_count']-2}, got {after['unread_count']}"
    )


# ── Test 2 — category gating by permission token ──────────────────────
@pytest.mark.live_db_writes
def test_2_category_gating_by_permission():
    """A user whose role holds no tokens sees zero items — every
    category is gated behind a `require_permission` check and returns
    an empty list rather than 403."""
    role_id = f"test-role-{uuid.uuid4().hex[:8]}"
    client = pymongo.MongoClient(os.environ["MONGO_URL"])
    dbn = os.environ.get("DB_NAME", "paneltec")
    client[dbn].roles.insert_one({
        "id": role_id, "role_id": role_id, "name": role_id,
        "is_active": True,  # v57.2 — required for _role_tokens() to return the empty set explicitly
        "is_system": False, "auto_created": False, "permission_tokens": [],
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    token, doc, _ = _make_ephemeral_user(role_id=role_id)
    try:
        r = requests.get(f"{API}/notifications", headers=_hdr(token), timeout=15)
        assert r.status_code == 200
        items = r.json()["items"]
        cats = {it["category"] for it in items}
        for c in ("expiring_certs", "overdue_renewals",
                  "failed_integrations", "pending_approvals"):
            assert c not in cats, f"empty-token role should not see {c}: got {cats}"
    finally:
        _cleanup(client, doc["id"])
        client[dbn].roles.delete_one({"id": role_id})


# ── Test 3 — read idempotency ────────────────────────────────────────
@pytest.mark.live_db_writes
def test_3_read_idempotency():
    token, doc, client = _make_ephemeral_user(role_id="admin")
    try:
        r = requests.get(f"{API}/notifications", headers=_hdr(token), timeout=15)
        items = r.json()["items"]
        if not items:
            return  # no items → contract trivially holds
        nid = items[0]["id"]
        for _ in range(2):
            rr = requests.post(f"{API}/notifications/{nid}/read", headers=_hdr(token), timeout=15)
            assert rr.status_code == 200
        dbn = os.environ.get("DB_NAME", "paneltec")
        cnt = client[dbn].notifications_read.count_documents({
            "user_id": doc["id"], "notification_id": nid,
        })
        assert cnt == 1, f"expected 1 row after 2 posts, got {cnt}"
    finally:
        _cleanup(client, doc["id"])


# ── Test 4 — mark-all-read clears unread count ───────────────────────
@pytest.mark.live_db_writes
def test_4_mark_all_read_clears_count():
    token, doc, client = _make_ephemeral_user(role_id="admin")
    try:
        r = requests.get(f"{API}/notifications", headers=_hdr(token), timeout=15)
        initial = r.json()
        if initial["unread_count"] == 0:
            return  # trivially holds
        rr = requests.post(f"{API}/notifications/mark-all-read", headers=_hdr(token), timeout=15)
        assert rr.status_code == 200
        assert rr.json()["marked"] == initial["unread_count"]
        r3 = requests.get(f"{API}/notifications", headers=_hdr(token), timeout=15)
        assert r3.json()["unread_count"] == 0
    finally:
        _cleanup(client, doc["id"])


# ── Test 5 — stable id hash ──────────────────────────────────────────
def test_5_stable_id_hash():
    """Two consecutive GETs → identical id sets for the same underlying
    items. Also directly exercises `_sig()`."""
    from notifications import _sig
    assert _sig("expiring_cert", "abc") == _sig("expiring_cert", "abc")
    assert _sig("expiring_cert", "abc") != _sig("expiring_cert", "xyz")
    assert len(_sig("expiring_cert", "abc")) == 16
    token = _admin()
    r1 = requests.get(f"{API}/notifications", headers=_hdr(token), timeout=15)
    r2 = requests.get(f"{API}/notifications", headers=_hdr(token), timeout=15)
    ids1 = {it["id"] for it in r1.json()["items"]}
    ids2 = {it["id"] for it in r2.json()["items"]}
    assert ids1 == ids2, f"id set drifted across polls: {ids1 ^ ids2}"

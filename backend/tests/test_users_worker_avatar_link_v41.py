"""v160.3.9.41 — Auto-linked worker avatars on `GET /api/users`.

Coverage:
  1. User with matching worker email + photo_url → `photo_url` present on the
     enriched response.
  2. User with matching worker email but NO `photo_url` on worker →
     enriched `photo_url` is absent / None.
  3. User with no matching worker → `photo_url` absent / None.
  4. Case-insensitive email match — worker `Alice@Example.com`, user
     `ALICE@example.COM` → link found.
  5. Cross-org isolation — user in org A, matching-email worker in org B →
     NO link (photo_url stays None).

Enrichment lives at `backend/users.py:187-231`. Ephemeral fixtures only.
Stephen's row is not modified. All probe rows use `__v41_probe_*` markers
and are cleaned up in `finally`.
"""
from __future__ import annotations

import uuid
import pytest
import requests

from .conftest import API


def _admin_token():
    r = requests.post(
        f"{API}/auth/login",
        json={"email": "stephen@paneltec.com.au",
              "password": "Mcgstephen50#"},
        timeout=10,
    )
    if r.status_code != 200:
        pytest.skip(f"admin login unavailable: HTTP {r.status_code}")
    return r.json().get("access_token") or r.json().get("token")


def _stephen_org_id(tok):
    r = requests.get(f"{API}/auth/me",
                     headers={"Authorization": f"Bearer {tok}"}, timeout=10)
    return r.json().get("org_id")


def _list_users(tok):
    # Include test-fixture users in the response so ephemeral probe
    # accounts (which land in the `@example.com` bucket in
    # `_TEST_ACCOUNT_OR`) are visible for assertions.
    r = requests.get(f"{API}/users?hide_test=false",
                     headers={"Authorization": f"Bearer {tok}"}, timeout=15)
    assert r.status_code == 200, f"users list failed: HTTP={r.status_code}"
    return r.json() if isinstance(r.json(), list) else r.json().get("items", [])


def _mint_probe_user(_mongo, org_id: str, email: str,
                     simpro_employee_id: str | None = None):
    uid = str(uuid.uuid4())
    _mongo.users.insert_one({
        "id": uid,
        "email": email,
        "name": f"__v41_probe_{uid[:6]}",
        "org_id": org_id,
        "role": "general_user",
        "role_id": "general_user",
        "status": "active",
        "created_at": "2026-08-03T00:00:00+00:00",
        "token_version": 1,
        **({"simpro_employee_id": simpro_employee_id} if simpro_employee_id else {}),
    })
    return uid


def _mint_probe_worker(_mongo, org_id: str, email: str,
                       photo_url: str | None,
                       simpro_employee_id: str | None = None):
    wid = str(uuid.uuid4())
    doc = {
        "id": wid,
        "org_id": org_id,
        "first_name": "V41",
        "last_name": "Probe",
        "email": email,
        "created_at": "2026-08-03T00:00:00+00:00",
    }
    if photo_url:
        doc["photo_url"] = photo_url
    if simpro_employee_id:
        doc["simpro_employee_id"] = simpro_employee_id
    _mongo.workers.insert_one(doc)
    return wid


def _find(users, uid):
    return next((u for u in users if u.get("id") == uid), None)


# ── Case 1 — matching email + photo → enriched
def test_case1_matching_email_with_photo_enriches(_mongo):
    tok = _admin_token()
    org_id = _stephen_org_id(tok)
    tag = uuid.uuid4().hex[:8]
    email = f"__v41_link_{tag}@example.com"
    photo = f"/api/files/document_library/__v41_probe_{tag}/probe.png"

    uid = _mint_probe_user(_mongo, org_id, email)
    wid = _mint_probe_worker(_mongo, org_id, email, photo_url=photo)
    try:
        users = _list_users(tok)
        row = _find(users, uid)
        assert row is not None, "probe user missing from /users response"
        assert row.get("photo_url") == photo, (
            f"expected photo_url={photo!r}, got {row.get('photo_url')!r}")
    finally:
        _mongo.users.delete_one({"id": uid})
        _mongo.workers.delete_one({"id": wid})


# ── Case 2 — matching email but no photo → no enrichment
def test_case2_matching_email_no_photo_leaves_null(_mongo):
    tok = _admin_token()
    org_id = _stephen_org_id(tok)
    tag = uuid.uuid4().hex[:8]
    email = f"__v41_nophoto_{tag}@example.com"
    uid = _mint_probe_user(_mongo, org_id, email)
    wid = _mint_probe_worker(_mongo, org_id, email, photo_url=None)
    try:
        users = _list_users(tok)
        row = _find(users, uid)
        assert row is not None
        assert not row.get("photo_url"), (
            f"user should have no photo_url, got {row.get('photo_url')!r}")
    finally:
        _mongo.users.delete_one({"id": uid})
        _mongo.workers.delete_one({"id": wid})


# ── Case 3 — no matching worker → no enrichment
def test_case3_no_matching_worker_leaves_null(_mongo):
    tok = _admin_token()
    org_id = _stephen_org_id(tok)
    tag = uuid.uuid4().hex[:8]
    email = f"__v41_nomatch_{tag}@example.com"
    uid = _mint_probe_user(_mongo, org_id, email)
    try:
        users = _list_users(tok)
        row = _find(users, uid)
        assert row is not None
        assert not row.get("photo_url"), (
            f"user with no matching worker must have photo_url=None, "
            f"got {row.get('photo_url')!r}")
    finally:
        _mongo.users.delete_one({"id": uid})


# ── Case 4 — case-insensitive email match
def test_case4_case_insensitive_email_match(_mongo):
    tok = _admin_token()
    org_id = _stephen_org_id(tok)
    tag = uuid.uuid4().hex[:8]
    user_email = f"__v41_MIXEDcase_{tag}@Example.COM"
    worker_email = user_email.lower()
    photo = f"/api/files/document_library/__v41_probe_case_{tag}/probe.png"

    uid = _mint_probe_user(_mongo, org_id, user_email)
    wid = _mint_probe_worker(_mongo, org_id, worker_email, photo_url=photo)
    try:
        users = _list_users(tok)
        row = _find(users, uid)
        assert row is not None
        assert row.get("photo_url") == photo, (
            f"case-insensitive match failed: user={user_email!r} "
            f"worker={worker_email!r} got={row.get('photo_url')!r}")
    finally:
        _mongo.users.delete_one({"id": uid})
        _mongo.workers.delete_one({"id": wid})


# ── Case 5 — cross-org isolation
def test_case5_cross_org_worker_does_not_link(_mongo):
    tok = _admin_token()
    org_id = _stephen_org_id(tok)
    other_org_id = f"__v41_other_org_{uuid.uuid4().hex[:8]}"
    tag = uuid.uuid4().hex[:8]
    email = f"__v41_crossorg_{tag}@example.com"
    photo = f"/api/files/document_library/__v41_probe_xo_{tag}/probe.png"

    uid = _mint_probe_user(_mongo, org_id, email)
    # Worker in OTHER org with matching email + photo
    wid = _mint_probe_worker(_mongo, other_org_id, email, photo_url=photo)
    try:
        users = _list_users(tok)
        row = _find(users, uid)
        assert row is not None
        assert not row.get("photo_url"), (
            f"cross-org photo LEAKED: got {row.get('photo_url')!r} "
            f"(worker org={other_org_id}, user org={org_id})")
    finally:
        _mongo.users.delete_one({"id": uid})
        _mongo.workers.delete_one({"id": wid})

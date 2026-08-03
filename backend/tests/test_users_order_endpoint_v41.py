"""v160.3.9.41 — Section-order endpoint contract (behind the drag handle).

The drag handle is a pure FE change; the persistence contract is
UNCHANGED — this suite guards against regressions on the underlying
`PUT /api/user-prefs/section-order/users` endpoint.

Coverage:
  1. Reorder persists to the same field/collection the previous
     up/down arrows wrote to (per-viewer `user_prefs` document keyed by
     `{user_id, resource="users", kind="section_order"}`).
  2. Gate: endpoint requires an authenticated user (Depends
     get_current_user). Anon requests → 401.
  3. Two callers get two independent orders (per-viewer semantic
     preserved — no cross-user contamination).

Ephemeral fixtures only. Stephen's row is not touched — an ephemeral
probe user is minted for each case.
"""
from __future__ import annotations

import uuid
import pytest
import requests

from .conftest import API


def _login(email, pwd):
    r = requests.post(f"{API}/auth/login",
                      json={"email": email, "password": pwd}, timeout=10)
    return r.json().get("access_token") or r.json().get("token") if r.status_code == 200 else None


def _mint_probe_user(_mongo, org_id: str, email: str, pwd: str):
    """Mint an ephemeral admin-role user so we can login as them and
    hit the endpoint without touching Stephen."""
    import bcrypt
    uid = str(uuid.uuid4())
    ph = bcrypt.hashpw(pwd.encode(), bcrypt.gensalt(rounds=12)).decode()
    _mongo.users.insert_one({
        "id": uid,
        "email": email,
        "name": f"__v41_probe_{uid[:6]}",
        "org_id": org_id,
        "role": "admin",
        "role_id": "admin",
        "status": "active",
        "password_hash": ph,
        "created_at": "2026-08-03T00:00:00+00:00",
        "token_version": 1,
    })
    return uid


def _admin_org_id():
    r = requests.post(
        f"{API}/auth/login",
        json={"email": "stephen@paneltec.com.au",
              "password": "Mcgstephen50#"},
        timeout=10,
    )
    if r.status_code != 200:
        pytest.skip(f"admin lookup unavailable")
    tok = r.json().get("access_token") or r.json().get("token")
    r2 = requests.get(f"{API}/auth/me",
                      headers={"Authorization": f"Bearer {tok}"}, timeout=10)
    return r2.json().get("org_id")


# ── Case 1 — reorder persists to the same field the arrows wrote to
def test_case1_put_persists_to_section_order_field(_mongo):
    org_id = _admin_org_id()
    email = f"__v41_probe_{uuid.uuid4().hex[:8]}@example.com"
    pwd = "V41ProbePw!" + uuid.uuid4().hex[:6]
    uid = _mint_probe_user(_mongo, org_id, email, pwd)
    try:
        tok = _login(email, pwd)
        assert tok, "probe login failed"

        order = ["admin", "hseq_lead", "general_user"]
        r = requests.put(
            f"{API}/user-prefs/section-order/users",
            json={"section_order": order},
            headers={"Authorization": f"Bearer {tok}"}, timeout=10,
        )
        assert r.status_code == 200, f"PUT failed: HTTP={r.status_code} {r.text[:200]}"

        doc = _mongo.user_prefs.find_one(
            {"user_id": uid, "resource": "users", "kind": "section_order"},
            {"_id": 0},
        )
        assert doc is not None, "user_prefs doc missing"
        assert doc.get("section_order") == order, (
            f"persistence mismatch: {doc.get('section_order')!r}")

        # GET returns it
        r2 = requests.get(
            f"{API}/user-prefs/section-order/users",
            headers={"Authorization": f"Bearer {tok}"}, timeout=10,
        )
        assert r2.status_code == 200
        assert r2.json().get("section_order") == order
    finally:
        _mongo.users.delete_one({"id": uid})
        _mongo.user_prefs.delete_many({"user_id": uid})


# ── Case 2 — gate: anon → 401
def test_case2_anon_put_returns_401():
    r = requests.put(
        f"{API}/user-prefs/section-order/users",
        json={"section_order": ["admin"]},
        timeout=10,
    )
    assert r.status_code == 401, (
        f"anon PUT should be 401, got HTTP={r.status_code} {r.text[:200]}")


# ── Case 3 — per-viewer isolation (two users, two orders)
def test_case3_per_viewer_isolation(_mongo):
    org_id = _admin_org_id()

    # User A (lowercase — auth.login lowercases before lookup)
    email_a = f"__v41_probea_{uuid.uuid4().hex[:8]}@example.com"
    pwd_a = "V41ProbePwA!" + uuid.uuid4().hex[:6]
    uid_a = _mint_probe_user(_mongo, org_id, email_a, pwd_a)

    # User B (lowercase)
    email_b = f"__v41_probeb_{uuid.uuid4().hex[:8]}@example.com"
    pwd_b = "V41ProbePwB!" + uuid.uuid4().hex[:6]
    uid_b = _mint_probe_user(_mongo, org_id, email_b, pwd_b)

    order_a = ["admin", "hseq_lead", "general_user"]
    order_b = ["general_user", "admin", "hseq_lead"]

    try:
        tok_a = _login(email_a, pwd_a)
        tok_b = _login(email_b, pwd_b)
        assert tok_a and tok_b

        r_a = requests.put(f"{API}/user-prefs/section-order/users",
                           json={"section_order": order_a},
                           headers={"Authorization": f"Bearer {tok_a}"}, timeout=10)
        r_b = requests.put(f"{API}/user-prefs/section-order/users",
                           json={"section_order": order_b},
                           headers={"Authorization": f"Bearer {tok_b}"}, timeout=10)
        assert r_a.status_code == 200 and r_b.status_code == 200

        # A reads back A's order — MUST NOT see B's
        r_ga = requests.get(f"{API}/user-prefs/section-order/users",
                            headers={"Authorization": f"Bearer {tok_a}"}, timeout=10)
        r_gb = requests.get(f"{API}/user-prefs/section-order/users",
                            headers={"Authorization": f"Bearer {tok_b}"}, timeout=10)
        assert r_ga.json().get("section_order") == order_a
        assert r_gb.json().get("section_order") == order_b
    finally:
        _mongo.users.delete_many({"id": {"$in": [uid_a, uid_b]}})
        _mongo.user_prefs.delete_many({"user_id": {"$in": [uid_a, uid_b]}})

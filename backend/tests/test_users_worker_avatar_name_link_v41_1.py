"""v160.3.9.41.1 — Name-based fallback for the worker-avatar auto-link.

Extends the v41 email/sid enrichment (`backend/users.py:187-231`) with a
name fallback for orgs whose users have role-based email addresses but
workers have personal-name emails.

Coverage:
  A. User with matching worker NAME (email doesn't match) → `photo_url`
     returned.
  B. User name matches worker with REVERSED name order — user "John
     Smith", worker `first_name=SMITH last_name=JOHN` → link succeeds.
  C. User name matches 2 workers (both have identical normalised
     first+last) → NO link; the ambiguity is logged.
  D. User has BOTH a matching email AND a matching name pointing to
     DIFFERENT workers → email wins (deterministic; email is the
     higher-precedence path).
  E. Cross-org name match → NO link (org isolation preserved).

Ephemeral fixtures only. Stephen's row is not modified.
"""
from __future__ import annotations

import uuid
import pytest
import requests

from .conftest import API


def _admin_token():
    r = requests.post(f"{API}/auth/login",
                      json={"email": "stephen@paneltec.com.au",
                            "password": "Mcgstephen50#"}, timeout=10)
    if r.status_code != 200:
        pytest.skip(f"admin login unavailable")
    return r.json().get("access_token") or r.json().get("token")


def _stephen_org_id(tok):
    r = requests.get(f"{API}/auth/me",
                     headers={"Authorization": f"Bearer {tok}"}, timeout=10)
    return r.json().get("org_id")


def _list_users(tok):
    r = requests.get(f"{API}/users?hide_test=false",
                     headers={"Authorization": f"Bearer {tok}"}, timeout=15)
    assert r.status_code == 200
    return r.json() if isinstance(r.json(), list) else r.json().get("items", [])


def _mint_user(_mongo, org_id, email, name):
    uid = str(uuid.uuid4())
    _mongo.users.insert_one({
        "id": uid, "email": email, "name": name, "org_id": org_id,
        "role": "general_user", "role_id": "general_user", "status": "active",
        "created_at": "2026-08-03T00:00:00+00:00", "token_version": 1,
    })
    return uid


def _mint_worker(_mongo, org_id, email, first, last, photo):
    wid = str(uuid.uuid4())
    doc = {
        "id": wid, "org_id": org_id, "email": email,
        "first_name": first, "last_name": last,
        "created_at": "2026-08-03T00:00:00+00:00",
    }
    if photo:
        doc["photo_url"] = photo
    _mongo.workers.insert_one(doc)
    return wid


def _find(users, uid):
    return next((u for u in users if u.get("id") == uid), None)


# ── Case A — name match, email mismatch
def test_caseA_name_match_email_mismatch_links(_mongo):
    tok = _admin_token()
    org = _stephen_org_id(tok)
    tag = uuid.uuid4().hex[:6]
    uid = _mint_user(_mongo, org,
                     f"__v411_role_{tag}@example.com",
                     f"Jordan Nameprobe {tag}")
    photo = f"/api/files/document_library/__v411_A_{tag}/jordan.png"
    wid = _mint_worker(_mongo, org,
                       f"__v411_personal_{tag}@example.com",
                       f"JORDAN", f"NAMEPROBE {tag}", photo)
    try:
        users = _list_users(tok)
        row = _find(users, uid)
        assert row is not None
        assert row.get("photo_url") == photo, (
            f"name match should link: got {row.get('photo_url')!r}")
    finally:
        _mongo.users.delete_one({"id": uid})
        _mongo.workers.delete_one({"id": wid})


# ── Case B — reversed name order (LAST FIRST vs First Last)
def test_caseB_reversed_name_order_links(_mongo):
    tok = _admin_token()
    org = _stephen_org_id(tok)
    tag = uuid.uuid4().hex[:6]
    # User has "John Reversedprobe" — Simpro worker stored as LASTNAME FIRSTNAME.
    uid = _mint_user(_mongo, org,
                     f"__v411_rev_{tag}@example.com",
                     f"John Reversedprobe {tag}")
    photo = f"/api/files/document_library/__v411_B_{tag}/john.png"
    # Worker: first=REVERSEDPROBE, last=JOHN → reversed order key matches
    wid = _mint_worker(_mongo, org,
                       f"__v411_rev_worker_{tag}@example.com",
                       f"REVERSEDPROBE {tag}", "JOHN", photo)
    try:
        users = _list_users(tok)
        row = _find(users, uid)
        assert row is not None
        assert row.get("photo_url") == photo, (
            f"reversed name order should still link: {row.get('photo_url')!r}")
    finally:
        _mongo.users.delete_one({"id": uid})
        _mongo.workers.delete_one({"id": wid})


# ── Case C — ambiguous (2 workers with identical name) → no link
def test_caseC_ambiguous_name_no_link(_mongo):
    tok = _admin_token()
    org = _stephen_org_id(tok)
    tag = uuid.uuid4().hex[:6]
    uid = _mint_user(_mongo, org,
                     f"__v411_amb_{tag}@example.com",
                     f"Chris Duplicateprobe{tag}")
    p1 = f"/api/files/document_library/__v411_C1_{tag}/one.png"
    p2 = f"/api/files/document_library/__v411_C2_{tag}/two.png"
    w1 = _mint_worker(_mongo, org, f"__v411_c1_{tag}@example.com",
                      "CHRIS", f"DUPLICATEPROBE{tag}", p1)
    w2 = _mint_worker(_mongo, org, f"__v411_c2_{tag}@example.com",
                      "CHRIS", f"DUPLICATEPROBE{tag}", p2)
    try:
        users = _list_users(tok)
        row = _find(users, uid)
        assert row is not None
        assert not row.get("photo_url"), (
            f"ambiguous name (2 workers) must NOT link — got "
            f"{row.get('photo_url')!r}")
    finally:
        _mongo.users.delete_one({"id": uid})
        _mongo.workers.delete_one({"id": w1})
        _mongo.workers.delete_one({"id": w2})


# ── Case D — email + name point to different workers → email wins
def test_caseD_email_wins_over_name(_mongo):
    tok = _admin_token()
    org = _stephen_org_id(tok)
    tag = uuid.uuid4().hex[:6]
    shared_email = f"__v411_shared_{tag}@example.com"
    # Worker E — matched by email, DIFFERENT name
    photo_email = f"/api/files/document_library/__v411_D_email_{tag}/e.png"
    w_email = _mint_worker(_mongo, org, shared_email,
                           "TOTALLY", "DIFFERENT NAME", photo_email)
    # Worker N — matched by name, DIFFERENT email
    photo_name = f"/api/files/document_library/__v411_D_name_{tag}/n.png"
    w_name = _mint_worker(_mongo, org,
                          f"__v411_name_worker_{tag}@example.com",
                          "ROBIN", f"EDGECASE{tag}", photo_name)
    # User: email = worker E's email; name = worker N's name
    uid = _mint_user(_mongo, org, shared_email,
                     f"Robin Edgecase{tag}")
    try:
        users = _list_users(tok)
        row = _find(users, uid)
        assert row is not None
        assert row.get("photo_url") == photo_email, (
            f"email match must win over name match — got "
            f"{row.get('photo_url')!r}")
    finally:
        _mongo.users.delete_one({"id": uid})
        _mongo.workers.delete_one({"id": w_email})
        _mongo.workers.delete_one({"id": w_name})


# ── Case E — cross-org name match → no link
def test_caseE_cross_org_name_no_link(_mongo):
    tok = _admin_token()
    org = _stephen_org_id(tok)
    other_org = f"__v411_other_org_{uuid.uuid4().hex[:8]}"
    tag = uuid.uuid4().hex[:6]
    uid = _mint_user(_mongo, org,
                     f"__v411_xo_{tag}@example.com",
                     f"Alex Crossorg{tag}")
    photo = f"/api/files/document_library/__v411_E_{tag}/x.png"
    wid = _mint_worker(_mongo, other_org,
                       f"__v411_xoworker_{tag}@example.com",
                       "ALEX", f"CROSSORG{tag}", photo)
    try:
        users = _list_users(tok)
        row = _find(users, uid)
        assert row is not None
        assert not row.get("photo_url"), (
            f"cross-org name match LEAKED photo: {row.get('photo_url')!r}")
    finally:
        _mongo.users.delete_one({"id": uid})
        _mongo.workers.delete_one({"id": wid})

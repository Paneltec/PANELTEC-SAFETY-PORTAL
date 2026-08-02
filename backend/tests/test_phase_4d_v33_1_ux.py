"""v160.3.9.33.1 — Photo enrichment + section-order + slug-hide tests.

Rides on top of Phase 4d. Uses ephemeral fixtures per the conftest guard.
"""
import uuid
import requests

from .conftest import API, _login


def _hdr(t):
    return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


# ─────────────────────────────────────────────────────────────
# 1. Photo enrichment
# ─────────────────────────────────────────────────────────────

def test_users_list_surfaces_photo_url_when_worker_has_one(ephemeral_admin, _mongo):
    """A worker doc in the same org with `photo_url` set MUST surface
    that photo on the matched user row (by simpro_employee_id first)."""
    tok = ephemeral_admin["token"]
    org_id = ephemeral_admin.get("org_id") or _mongo.users.find_one(
        {"id": ephemeral_admin["id"]}, {"_id": 0, "org_id": 1})["org_id"]

    # Seed a user + a matching worker with a photo.
    uid = str(uuid.uuid4())
    sid = f"EPH-photo-{uid[:6]}"
    email = f"__phase4d_photo_test_{uid[:8]}@paneltec.internal"
    photo_url = f"/api/workers/testworker-{uid[:8]}/photo/test-token"
    _mongo.users.insert_one({
        "id": uid, "org_id": org_id, "email": email,
        "name": f"PhotoTest {uid[:6]}", "role": "general_user",
        "role_id": "general_user", "status": "active",
        "activation_status": "active",
        "simpro_employee_id": sid, "simpro_position": "Traffic Controller",
        "created_at": "2026-08-01T00:00:00+00:00",
        "created_by": "pytest", "token_version": 0, "workspace_ids": [],
    })
    wid = f"testworker-{uid[:8]}"
    _mongo.workers.insert_one({
        "id": wid, "org_id": org_id, "email": email,
        "simpro_employee_id": sid, "photo_url": photo_url,
        "created_at": "2026-08-01T00:00:00+00:00",
    })

    try:
        rows = requests.get(f"{API}/users?hide_test=false",
                            headers=_hdr(tok), timeout=10).json()
        target = [r for r in rows if r["id"] == uid][0]
        assert target["photo_url"] == photo_url, (
            f"Expected photo enrichment; got photo_url={target.get('photo_url')}"
        )
    finally:
        _mongo.users.delete_one({"id": uid})
        _mongo.workers.delete_one({"id": wid})


def test_users_list_does_not_leak_cross_org_photo(ephemeral_admin, _mongo):
    """A worker doc in a DIFFERENT org with matching sid/email MUST NOT
    surface its photo. Same-org guard is non-negotiable."""
    tok = ephemeral_admin["token"]
    org_id = _mongo.users.find_one(
        {"id": ephemeral_admin["id"]}, {"_id": 0, "org_id": 1})["org_id"]
    other_org = str(uuid.uuid4())

    uid = str(uuid.uuid4())
    sid = f"EPH-crossorg-{uid[:6]}"
    email = f"__phase4d_crossorg_{uid[:8]}@paneltec.internal"
    _mongo.users.insert_one({
        "id": uid, "org_id": org_id, "email": email,
        "name": "CrossOrg Test", "role": "general_user",
        "role_id": "general_user", "status": "active",
        "activation_status": "active",
        "simpro_employee_id": sid,
        "created_at": "2026-08-01T00:00:00+00:00",
        "created_by": "pytest", "token_version": 0, "workspace_ids": [],
    })
    wid = f"testworker-crossorg-{uid[:8]}"
    _mongo.workers.insert_one({
        "id": wid, "org_id": other_org, "email": email,   # !!! different org
        "simpro_employee_id": sid,
        "photo_url": "/api/workers/should-not-leak/photo/x",
        "created_at": "2026-08-01T00:00:00+00:00",
    })

    try:
        rows = requests.get(f"{API}/users?hide_test=false",
                            headers=_hdr(tok), timeout=10).json()
        target = [r for r in rows if r["id"] == uid][0]
        assert target.get("photo_url") in (None, ""), (
            f"CROSS-ORG PHOTO LEAK: got photo_url={target.get('photo_url')}"
        )
    finally:
        _mongo.users.delete_one({"id": uid})
        _mongo.workers.delete_one({"id": wid})


# ─────────────────────────────────────────────────────────────
# 2. Section-order roundtrip
# ─────────────────────────────────────────────────────────────

def test_section_order_put_get_delete_roundtrip(ephemeral_admin):
    tok = ephemeral_admin["token"]
    order = ["admin", "custom_plumber", "general_user"]
    r_put = requests.put(f"{API}/user-prefs/section-order/users",
                         headers=_hdr(tok), json={"section_order": order},
                         timeout=10)
    assert r_put.status_code == 200
    assert r_put.json()["section_order"] == order

    r_get = requests.get(f"{API}/user-prefs/section-order/users",
                         headers=_hdr(tok), timeout=10)
    assert r_get.status_code == 200
    assert r_get.json()["section_order"] == order

    r_del = requests.delete(f"{API}/user-prefs/section-order/users",
                            headers=_hdr(tok), timeout=10)
    assert r_del.status_code == 200
    assert r_del.json()["reset"] is True

    r_get2 = requests.get(f"{API}/user-prefs/section-order/users",
                          headers=_hdr(tok), timeout=10)
    assert r_get2.json()["section_order"] == []


def test_section_order_scoped_per_user(ephemeral_admin, tokens):
    """User A's section-order MUST NOT leak into user B's response."""
    tok_a = ephemeral_admin["token"]
    tok_b = tokens.get("general_user") or tokens.get("hseq_manager") \
        or list(tokens.values())[0]
    requests.put(f"{API}/user-prefs/section-order/users",
                 headers=_hdr(tok_a),
                 json={"section_order": ["admin", "custom_plumber"]},
                 timeout=10)
    r_b = requests.get(f"{API}/user-prefs/section-order/users",
                       headers=_hdr(tok_b), timeout=10)
    assert r_b.status_code == 200
    assert r_b.json()["section_order"] == []


def test_section_order_unknown_resource_400(ephemeral_admin):
    tok = ephemeral_admin["token"]
    r = requests.put(f"{API}/user-prefs/section-order/not_a_resource",
                     headers=_hdr(tok), json={"section_order": []},
                     timeout=10)
    assert r.status_code == 400

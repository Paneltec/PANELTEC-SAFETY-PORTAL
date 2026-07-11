"""v160.3.0 — Qualification-gated forms regression tests.

Contracts under test
--------------------
1. `slug_for_name` maps common cert-name spellings (spacing,
   punctuation, trailing noise words) to the canonical slug.
2. `cert_status` returns `valid` / `expiring_soon` / `expired` /
   `no_expiry` for the right expiry windows.
3. `POST /api/forms/templates` with a `required_certifications` list
   persists ONLY slugs we recognise (unknown slugs silently dropped).
4. `PATCH /api/forms/templates/{id}` can add + clear the gate.
5. `GET /api/forms/cert-kinds` returns the canonical vocabulary.
6. `GET /api/forms/templates/{id}/access-check`:
   - `mode=no_gate` when list is empty.
   - `mode=admin_bypass` for admin caller with `ok=true` even if
     the admin has none of the certs personally.
   - `mode=gated` for worker caller — `ok=true` only when every
     required slug resolves to a satisfying cert on their record.
   - Expired cert = `ok=false, status=expired`.
   - Missing cert = `ok=false, status=missing`.
   - Second-cert-of-same-slug tiebreaker: latest expiry wins.
7. The migration is idempotent — a second run modifies 0 rows.
"""
from __future__ import annotations

import asyncio
import os
from datetime import date, datetime, timedelta, timezone

import pytest
import requests

BASE = os.environ.get("PANELTEC_API", "http://localhost:8001")
ADMIN_EMAIL = "stephen@paneltec.com.au"
ADMIN_PW = "Mcgstephen50#"
WORKER_EMAIL = os.environ.get("WORKER_EMAIL", "worker_stephen@paneltec.com.au")
WORKER_PW = os.environ.get("WORKER_PW", "WorkerTest123!")


# ─────────────────────────── Helpers ──────────────────────────────────

def _login(email: str, pw: str) -> str:
    r = requests.post(
        f"{BASE}/api/auth/login",
        json={"email": email, "password": pw},
        timeout=10,
    )
    r.raise_for_status()
    body = r.json()
    return body.get("access_token") or body.get("token")


def _db():
    from pymongo import MongoClient
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


def _new_id() -> str:
    import uuid
    return str(uuid.uuid4())


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ─────────────────────────── Slug matcher ─────────────────────────────

def test_slug_for_name_covers_known_spellings():
    from cert_kinds import slug_for_name
    cases = {
        "White Card":                 "white_card",
        "White_Card_Induction":       "white_card",
        "General Construction Induction": "white_card",
        "First Aid":                  "first_aid",
        "First_Aid_Cert":             "first_aid",
        "First aid certificate":      "first_aid",
        "CPR":                        "cpr",
        "Traffic Control":            "traffic_control",
        "Confined Space Card":        "confined_space",
        "Confined Space":             "confined_space",
        "HR License":                 "hr_licence",
        "MR License":                 "mr_licence",
        "TasWater Induction":         "taswater_induction",
        "Tas Rail":                   "tasrail_induction",
        "Airport":                    "airport_induction",
        "Working at Heights":         "working_at_heights",
    }
    for raw, expected in cases.items():
        assert slug_for_name(raw) == expected, f"{raw!r} → {slug_for_name(raw)!r}, expected {expected!r}"


def test_slug_for_name_returns_none_on_ambiguous_or_unknown():
    from cert_kinds import slug_for_name
    # Truly unknown certs should not match anything.
    for raw in ["", None, "AJR Construct", "MV/ NMC", "DCC", "Some Bespoke Cert"]:
        assert slug_for_name(raw) is None, f"{raw!r} should not map"


# ─────────────────────────── Status resolution ────────────────────────

def test_cert_status_covers_all_paths():
    from cert_kinds import cert_status
    today = date(2026, 7, 11)
    assert cert_status(None, today) == "no_expiry"
    assert cert_status("", today) == "no_expiry"
    assert cert_status("2026-07-11", today) == "expired"  # today = expiry → expired
    assert cert_status("2026-07-10", today) == "expired"
    assert cert_status("2026-08-01", today) == "expiring_soon"  # 21 days
    assert cert_status("2026-08-10", today) == "expiring_soon"  # exactly 30 days
    assert cert_status("2026-08-11", today) == "valid"  # 31 days — outside window
    assert cert_status("2027-01-01", today) == "valid"


# ─────────────────────────── Template writes ──────────────────────────

@pytest.fixture(scope="module")
def admin_token() -> str:
    return _login(ADMIN_EMAIL, ADMIN_PW)


def _create_template(admin_token: str, required: list[str]) -> str:
    r = requests.post(
        f"{BASE}/api/forms/templates",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "name": f"v160.3.0 gated {_new_id()[:8]}",
            "category": "general",
            "fields": [{"id": "n", "label": "Note", "type": "text"}],
            "required_certifications": required,
        },
        timeout=10,
    )
    r.raise_for_status()
    return r.json()["id"]


def test_create_template_persists_only_known_slugs(admin_token):
    tid = _create_template(admin_token, ["white_card", "made_up_slug", "first_aid"])
    try:
        row = _db().form_templates.find_one({"id": tid}, {"_id": 0, "required_certifications": 1})
        assert row["required_certifications"] == ["white_card", "first_aid"]
    finally:
        _db().form_templates.delete_one({"id": tid})


def test_patch_can_clear_and_reset_the_gate(admin_token):
    tid = _create_template(admin_token, ["white_card"])
    try:
        h = {"Authorization": f"Bearer {admin_token}"}
        r = requests.patch(f"{BASE}/api/forms/templates/{tid}",
                           headers=h, json={"required_certifications": []}, timeout=10)
        assert r.status_code == 200
        assert r.json()["required_certifications"] == []
        r = requests.patch(f"{BASE}/api/forms/templates/{tid}",
                           headers=h, json={"required_certifications": ["cpr", "cpr", "unknown"]}, timeout=10)
        assert r.status_code == 200
        # Duplicates deduped, unknowns dropped, order preserved.
        assert r.json()["required_certifications"] == ["cpr"]
    finally:
        _db().form_templates.delete_one({"id": tid})


# ─────────────────────────── Catalog endpoint ─────────────────────────

def test_cert_kinds_endpoint_lists_canonical_slugs(admin_token):
    r = requests.get(f"{BASE}/api/forms/cert-kinds",
                     headers={"Authorization": f"Bearer {admin_token}"}, timeout=10)
    assert r.status_code == 200
    payload = r.json()
    slugs = [k["slug"] for k in payload]
    assert "white_card" in slugs
    assert "first_aid" in slugs
    assert len(slugs) == len(set(slugs)), "no dupes"
    for k in payload:
        assert isinstance(k["label"], str) and k["label"], "every slug has a label"


# ─────────────────────────── Access check ─────────────────────────────

def test_access_check_no_gate_returns_ok(admin_token):
    tid = _create_template(admin_token, [])
    try:
        h = {"Authorization": f"Bearer {admin_token}"}
        r = requests.get(f"{BASE}/api/forms/templates/{tid}/access-check",
                         headers=h, timeout=10)
        assert r.status_code == 200
        b = r.json()
        assert b["ok"] is True
        assert b["mode"] == "no_gate"
        assert b["required"] == []
    finally:
        _db().form_templates.delete_one({"id": tid})


def test_access_check_admin_bypass(admin_token):
    # Ask for something the admin does NOT personally hold to prove bypass works.
    tid = _create_template(admin_token, ["dogging", "basic_rigging"])
    try:
        h = {"Authorization": f"Bearer {admin_token}"}
        r = requests.get(f"{BASE}/api/forms/templates/{tid}/access-check",
                         headers=h, timeout=10)
        b = r.json()
        assert b["ok"] is True, f"admin must bypass: {b}"
        assert b["mode"] == "admin_bypass"
        # Required detail still enumerated for the preview panel.
        assert {r["slug"] for r in b["required"]} == {"dogging", "basic_rigging"}
    finally:
        _db().form_templates.delete_one({"id": tid})


def _seed_worker_with_cert(admin_org_id: str, worker_email: str,
                           cert_name: str, expiry: str | None):
    """Attach one cert row to the worker record linked to the auth user.

    v160.3.0 — Uses the same lookup path the `/access-check` endpoint
    uses (`user_id` link OR email match). Auto-creates a stub worker
    row when the auth user has no linked worker profile so the tests
    are self-sufficient on a lightly-seeded org. The stub is cleaned
    up alongside the cert row via the fixture teardown.
    """
    u = _db().users.find_one({"email": worker_email}, {"_id": 0})
    if not u:
        pytest.skip(f"auth user missing for {worker_email}")
    query = {
        "org_id": admin_org_id, "deleted_at": None,
        "$or": [{"user_id": u["id"]}, {"email": worker_email}],
    }
    w = _db().workers.find_one(query, {"_id": 0})
    created_worker_id = None
    if not w:
        # Stub — matches the auth user by both email and user_id, active.
        wid = _new_id()
        _db().workers.insert_one({
            "id": wid, "org_id": admin_org_id,
            "user_id": u["id"], "email": worker_email,
            "first_name": "Test", "last_name": "Worker",
            "active": True,
            "created_at": _now_iso(), "updated_at": _now_iso(),
            "deleted_at": None,
        })
        created_worker_id = wid
        w = _db().workers.find_one({"id": wid}, {"_id": 0})
    cid = _new_id()
    _db().worker_certifications.insert_one({
        "id": cid, "org_id": admin_org_id, "worker_id": w["id"],
        "name": cert_name, "expiry_date": expiry,
        "created_at": _now_iso(), "updated_at": _now_iso(), "deleted_at": None,
    })
    # Return a compound handle so cleanup can drop the stub worker too.
    return {"cert_id": cid, "stub_worker_id": created_worker_id}


def _cleanup_seed(handle: dict):
    _db().worker_certifications.delete_one({"id": handle["cert_id"]})
    if handle.get("stub_worker_id"):
        _db().workers.delete_one({"id": handle["stub_worker_id"]})


def test_access_check_worker_ok_when_valid_certs_present(admin_token):
    admin = _db().users.find_one({"email": ADMIN_EMAIL}, {"_id": 0})
    tid = _create_template(admin_token, ["white_card", "first_aid"])
    future = (date.today() + timedelta(days=365)).isoformat()
    h1 = _seed_worker_with_cert(admin["org_id"], WORKER_EMAIL, "White Card", future)
    h2 = _seed_worker_with_cert(admin["org_id"], WORKER_EMAIL, "First Aid", future)
    try:
        worker_token = _login(WORKER_EMAIL, WORKER_PW)
        r = requests.get(f"{BASE}/api/forms/templates/{tid}/access-check",
                         headers={"Authorization": f"Bearer {worker_token}"}, timeout=10)
        b = r.json()
        assert b["ok"] is True, b
        assert b["mode"] == "gated"
        statuses = {row["slug"]: row["status"] for row in b["required"]}
        assert statuses["white_card"] in {"valid", "expiring_soon", "no_expiry"}
        assert statuses["first_aid"] in {"valid", "expiring_soon", "no_expiry"}
    finally:
        _db().form_templates.delete_one({"id": tid})
        _cleanup_seed(h1)
        _cleanup_seed(h2)


def test_access_check_worker_blocked_when_expired_or_missing(admin_token):
    admin = _db().users.find_one({"email": ADMIN_EMAIL}, {"_id": 0})
    tid = _create_template(admin_token, ["white_card", "confined_space"])
    past = (date.today() - timedelta(days=5)).isoformat()
    h1 = _seed_worker_with_cert(admin["org_id"], WORKER_EMAIL, "White Card", past)
    try:
        worker_token = _login(WORKER_EMAIL, WORKER_PW)
        r = requests.get(f"{BASE}/api/forms/templates/{tid}/access-check",
                         headers={"Authorization": f"Bearer {worker_token}"}, timeout=10)
        b = r.json()
        assert b["ok"] is False, b
        detail = {row["slug"]: row for row in b["required"]}
        assert detail["white_card"]["status"] == "expired"
        assert detail["confined_space"]["status"] == "missing"
    finally:
        _db().form_templates.delete_one({"id": tid})
        _cleanup_seed(h1)


def test_access_check_latest_expiry_wins_when_two_of_same_slug(admin_token):
    """v160.3.0 mirrors the v160.2.6-cleanup dedupe tiebreaker: latest
    `expiry_date` wins. Belt-and-braces so a stale-but-live older row
    doesn't block a worker whose renewal was captured under the same
    (or a near-duplicate) name."""
    admin = _db().users.find_one({"email": ADMIN_EMAIL}, {"_id": 0})
    tid = _create_template(admin_token, ["first_aid"])
    past = (date.today() - timedelta(days=30)).isoformat()
    future = (date.today() + timedelta(days=200)).isoformat()
    h_old = _seed_worker_with_cert(admin["org_id"], WORKER_EMAIL, "First Aid", past)
    h_new = _seed_worker_with_cert(admin["org_id"], WORKER_EMAIL, "First_Aid_Cert", future)
    try:
        worker_token = _login(WORKER_EMAIL, WORKER_PW)
        r = requests.get(f"{BASE}/api/forms/templates/{tid}/access-check",
                         headers={"Authorization": f"Bearer {worker_token}"}, timeout=10)
        b = r.json()
        assert b["ok"] is True, f"newest expiry must win: {b}"
        detail = {row["slug"]: row for row in b["required"]}
        assert detail["first_aid"]["status"] in {"valid", "expiring_soon"}
        assert detail["first_aid"]["expiry_date"] == future
    finally:
        _db().form_templates.delete_one({"id": tid})
        _cleanup_seed(h_old)
        _cleanup_seed(h_new)


# ─────────────────────────── Migration ─────────────────────────────────

def test_migration_is_idempotent():
    from scripts.migrate_v160_3_0_cert_gate import main
    # First run may modify legacy rows; second run must be a no-op.
    asyncio.run(main())
    second = asyncio.run(main())
    assert second["templates_shape_migrated"] == 0

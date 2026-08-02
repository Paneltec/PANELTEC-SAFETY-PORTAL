"""v160.3.9.24-backend — Standing admin-guard regression test.

Ensures every mutation endpoint on the seven Risk Assessments reference
modules refuses non-admin authenticated users with HTTP 403.

Modules covered:
    master_risks, list_forms, incident_root_causes, cs_incident,
    list_roles, completed_training, companies

Non-admin roles verified:
    - hseq_lead, worker, supervisor, manager, auditor

Approach: seed-and-teardown pattern. The module-scope fixture inserts
five ephemeral users (`__admin_guard_test__+role@paneltec.internal`)
directly into Mongo with bcrypt password hashes, then removes them at
teardown. This avoids depending on the demo-seed accounts (which the
operator has set to `status: disabled` on this instance) and doesn't
mutate any real user state.

Admin control: uses the real seeded admin `stephen@paneltec.com.au`
(active) so the positive-control test runs against a normal live token.
"""
from __future__ import annotations

import os
import uuid

import bcrypt
import pytest
import requests
from pymongo import MongoClient


# ── env plumbing ──────────────────────────────────────────────────────
def _load_frontend_env() -> None:
    if os.environ.get("REACT_APP_BACKEND_URL"):
        return
    env_path = "/app/frontend/.env"
    if not os.path.exists(env_path):
        return
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line.startswith("REACT_APP_BACKEND_URL="):
                os.environ["REACT_APP_BACKEND_URL"] = (
                    line.split("=", 1)[1].strip().strip('"'))
                return


def _load_backend_env() -> None:
    env_path = "/app/backend/.env"
    if not os.path.exists(env_path):
        return
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line and not os.environ.get(line.split("=", 1)[0]):
                k, v = line.split("=", 1)
                os.environ[k] = v.strip().strip('"')


_load_frontend_env()
_load_backend_env()
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "stephen@paneltec.com.au"
ADMIN_PWD = "Mcgstephen50#"
EPHEMERAL_PWD = "PytestGuard-2026!"
EPHEMERAL_EMAIL_PREFIX = "__admin_guard_test__"

# v160.3.9.29 (Blocker-E close-out) — hseq_lead is widened for
# reference_library WRITE (per Phase 3c decision #5), but still denied
# DELETE. The full role list drives fixture creation; individual tests
# filter it via `NON_ADMIN_EDIT_ROLES` (below) for edit-scope actions.
NON_ADMIN_ROLES = ["hseq_lead", "worker", "supervisor", "manager", "auditor"]
# hseq_lead excluded — has reference_library.edit=True.
NON_ADMIN_EDIT_ROLES = ["worker", "supervisor", "manager", "auditor"]


# One entry per module we're checking. `post_body` is a minimal payload
# — the request may still fail downstream on admin (400/409) but the
# auth gate must reject non-admin with 403 before that.
MODULES: list[dict] = [
    {"prefix": "/master-risks",         "post_body": {"risk_id":       f"pytest-{uuid.uuid4().hex[:8]}"}},
    {"prefix": "/list-forms",           "post_body": {"list_form_id":  f"pytest-{uuid.uuid4().hex[:8]}"}},
    {"prefix": "/incident-root-causes", "post_body": {"question_id":   f"pytest-{uuid.uuid4().hex[:8]}"}},
    {"prefix": "/cs-incident",          "post_body": {"issue_number":  f"pytest-{uuid.uuid4().hex[:8]}"}},
    {"prefix": "/list-roles",           "post_body": {"role_id":       f"pytest-{uuid.uuid4().hex[:8]}"}},
    {"prefix": "/completed-training",   "post_body": {"training_name": "pytest",
                                                       "worker_name":   "pytest",
                                                       "date_completed": "2026-01-01"}},
    {"prefix": "/companies",            "post_body": {"company_id":    f"pytest-{uuid.uuid4().hex[:8]}"}},
]


# ── helpers ───────────────────────────────────────────────────────────
def _hash(pwd: str) -> str:
    return bcrypt.hashpw(pwd.encode("utf-8"),
                          bcrypt.gensalt(rounds=4)).decode("utf-8")


def _login(email: str, pwd: str) -> str:
    r = requests.post(f"{API}/auth/login",
                      json={"email": email, "password": pwd}, timeout=30)
    assert r.status_code == 200, (
        f"login failed for {email}: {r.status_code} {r.text[:200]}")
    payload = r.json()
    tok = payload.get("access_token") or payload.get("token")
    assert tok, f"no token in login response for {email}: {payload}"
    return tok


# ── ephemeral user setup / teardown ───────────────────────────────────
@pytest.fixture(scope="module")
def _mongo():
    client = MongoClient(os.environ["MONGO_URL"])
    yield client[os.environ["DB_NAME"]]
    client.close()


@pytest.fixture(scope="module")
def ephemeral_users(_mongo):
    """Insert one user per non-admin role, yield the role → email map,
    then remove them at teardown. Runs against real backend DB."""
    # Pick any active org so the seeded users belong somewhere real.
    seed_user = _mongo.users.find_one({"email": ADMIN_EMAIL}, {"_id": 0, "org_id": 1})
    assert seed_user, f"admin seed user {ADMIN_EMAIL} missing"
    org_id = seed_user["org_id"]

    accounts: dict[str, str] = {}
    for role in NON_ADMIN_ROLES:
        email = f"{EPHEMERAL_EMAIL_PREFIX}{role}@paneltec.internal"
        accounts[role] = email
        doc = {
            "id": str(uuid.uuid4()),
            "org_id": org_id,
            "email": email,
            "name": f"Pytest {role}",
            "full_name": f"Pytest {role}",
            "role": role,
            "status": "active",
            "password_hash": _hash(EPHEMERAL_PWD),
            "created_at": "2026-08-01T00:00:00+00:00",
            "created_by": "pytest",
            "token_version": 0,
        }
        _mongo.users.replace_one({"email": email}, doc, upsert=True)

    yield accounts

    # Teardown — delete every ephemeral user we created.
    for role, email in accounts.items():
        _mongo.users.delete_one({"email": email})


@pytest.fixture(scope="module")
def tokens(ephemeral_users) -> dict[str, str]:
    """Return a role → bearer token map."""
    out: dict[str, str] = {"admin": _login(ADMIN_EMAIL, ADMIN_PWD)}
    for role, email in ephemeral_users.items():
        out[role] = _login(email, EPHEMERAL_PWD)
    return out


# ── admin-guard tests ─────────────────────────────────────────────────
@pytest.mark.parametrize("role", NON_ADMIN_EDIT_ROLES)
@pytest.mark.parametrize("module", MODULES, ids=[m["prefix"] for m in MODULES])
def test_non_admin_post_forbidden(module, role, tokens):
    token = tokens[role]
    r = requests.post(f"{API}{module['prefix']}/",
                      headers={"Authorization": f"Bearer {token}"},
                      json=module["post_body"], timeout=30)
    assert r.status_code == 403, (
        f"{role} POST {module['prefix']}/ → HTTP {r.status_code} "
        f"(expected 403). Body: {r.text[:200]}")


@pytest.mark.parametrize("role", NON_ADMIN_EDIT_ROLES)
@pytest.mark.parametrize("module", MODULES, ids=[m["prefix"] for m in MODULES])
def test_non_admin_patch_forbidden(module, role, tokens):
    token = tokens[role]
    r = requests.patch(f"{API}{module['prefix']}/nope-{uuid.uuid4().hex[:8]}",
                       headers={"Authorization": f"Bearer {token}"},
                       json={"note": "pytest-should-be-blocked"}, timeout=30)
    assert r.status_code == 403, (
        f"{role} PATCH {module['prefix']}/... → HTTP {r.status_code} "
        f"(expected 403). Body: {r.text[:200]}")


@pytest.mark.parametrize("role", NON_ADMIN_ROLES)
@pytest.mark.parametrize("module", MODULES, ids=[m["prefix"] for m in MODULES])
def test_non_admin_delete_forbidden(module, role, tokens):
    token = tokens[role]
    r = requests.delete(f"{API}{module['prefix']}/nope-{uuid.uuid4().hex[:8]}",
                        headers={"Authorization": f"Bearer {token}"}, timeout=30)
    assert r.status_code == 403, (
        f"{role} DELETE {module['prefix']}/... → HTTP {r.status_code} "
        f"(expected 403). Body: {r.text[:200]}")


@pytest.mark.parametrize("role", NON_ADMIN_EDIT_ROLES)
@pytest.mark.parametrize("module", MODULES, ids=[m["prefix"] for m in MODULES])
def test_non_admin_reimport_forbidden(module, role, tokens):
    token = tokens[role]
    r = requests.post(f"{API}{module['prefix']}/reimport",
                      headers={"Authorization": f"Bearer {token}"},
                      data={"marker": "pytest"}, timeout=30)
    assert r.status_code == 403, (
        f"{role} POST {module['prefix']}/reimport → HTTP {r.status_code} "
        f"(expected 403). Body: {r.text[:200]}")


# ── positive control (admin still passes the auth gate) ───────────────
@pytest.mark.parametrize("module", MODULES, ids=[m["prefix"] for m in MODULES])
def test_admin_can_pass_auth_gate(module, tokens):
    """Auth gate must accept admin — downstream may still 400/409 on the
    thin payload, but 403 would indicate the guard tightening broke."""
    token = tokens["admin"]
    r = requests.post(f"{API}{module['prefix']}/",
                      headers={"Authorization": f"Bearer {token}"},
                      json=module["post_body"], timeout=30)
    assert r.status_code != 403, (
        f"admin POST {module['prefix']}/ blocked with 403 — auth "
        f"tightening over-shot. Body: {r.text[:200]}")
    # Best-effort cleanup: soft-delete anything admin just created.
    if 200 <= r.status_code < 300:
        try:
            uid = r.json().get("id")
            if uid:
                requests.delete(
                    f"{API}{module['prefix']}/{uid}",
                    headers={"Authorization": f"Bearer {token}"},
                    timeout=15)
        except Exception:
            pass

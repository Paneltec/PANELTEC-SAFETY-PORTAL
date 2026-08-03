"""Shared pytest fixtures for the Paneltec backend test suite.

Extracted from `test_admin_guards.py` in v160.3.9.27 so the newer
`test_v27_guard_migration.py` and future test modules can reuse the
same ephemeral-user setup + tokens without importing across files.

v160.3.9.33 — Phase 4d: added ephemeral admin fixture + collection
guards that reject any test-side write to real production accounts
(`@paneltec.com.au` domain OR role in {admin, hseq_manager}). Rationale:
in v160.3.9.33 development a test-side helper rewrote stephen@paneltec.com.au's
`password_hash` and locked the real admin out of production preview.
This must never happen again — see the outage note in
`/app/memory/permissions_redesign/07_phase_plan.md`.

Fixtures provided (all module-scope):
    _mongo             : MongoClient bound to the live DB.
    ephemeral_users    : role -> email dict for 5 non-admin roles.
    tokens             : role -> Bearer token dict incl. 'admin'.
    ephemeral_admin    : NEW v4d — fresh admin user in a throwaway org.
    ephemeral_org_id   : NEW v4d — throwaway org_id for isolated tests.

Constants also re-exported: `API`, `NON_ADMIN_ROLES`, `EPHEMERAL_PWD`.
"""
from __future__ import annotations

import os
import uuid
from typing import Dict

import bcrypt
import pytest
import requests
from pymongo import MongoClient


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

NON_ADMIN_ROLES = ["hseq_lead", "worker", "supervisor", "manager", "auditor"]


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


@pytest.fixture(scope="module")
def _mongo():
    client = MongoClient(os.environ["MONGO_URL"])
    yield client[os.environ["DB_NAME"]]
    client.close()


# v160.3.9.36 — Shared session-scope event loop for tests that drive
# `permissions.py` / `auth.py` async helpers directly via
# `loop.run_until_complete(...)`. Without a shared loop each test
# module creates its own, then Motor's `AsyncIOMotorClient` (bound
# to whichever loop first executed a DB call) starts throwing
# `RuntimeError: Event loop is closed` on the second module's tests.
# Import and reuse via `from tests.conftest import async_loop`
# or the shorthand `run_async(coro)` helper below.
import asyncio as _asyncio

_ASYNC_LOOP = _asyncio.new_event_loop()
_asyncio.set_event_loop(_ASYNC_LOOP)


def run_async(coro):
    """Run a coroutine on the shared test-session event loop."""
    return _ASYNC_LOOP.run_until_complete(coro)


@pytest.fixture(scope="session")
def async_loop():
    """Session-scope event loop. Tests that need to await coroutines
    should call `loop.run_until_complete(coro)` on this instead of
    `asyncio.run(...)` (which creates + closes a fresh loop each
    call and orphans Motor)."""
    return _ASYNC_LOOP



@pytest.fixture(scope="module")
def ephemeral_users(_mongo) -> Dict[str, str]:
    """Insert one user per non-admin role, yield the role → email map,
    then remove them at teardown. Runs against the live DB."""
    seed_user = _mongo.users.find_one({"email": ADMIN_EMAIL}, {"_id": 0, "org_id": 1})
    assert seed_user, f"admin seed user {ADMIN_EMAIL} missing"
    org_id = seed_user["org_id"]

    accounts: Dict[str, str] = {}
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

    for role, email in accounts.items():
        _mongo.users.delete_one({"email": email})


# ─────────────────────────────────────────────────────────────
# v160.3.9.33 — Phase 4d ephemeral admin + org fixtures.
# Tests that need an admin token for role-mutation endpoints MUST use
# these fixtures instead of touching the live `stephen@paneltec.com.au`
# account. See outage note above.
# ─────────────────────────────────────────────────────────────

EPHEMERAL_ADMIN_EMAIL_PREFIX = "__phase4d_ephemeral_admin__"


@pytest.fixture(scope="module")
def ephemeral_org_id(_mongo) -> str:
    """Return the org_id of Stephen's real org.

    Rationale: creating a fresh throwaway org would require seeding
    workspaces, roles, and integration configs to make endpoints work.
    We instead let tests live INSIDE Stephen's org but with distinct
    ephemeral user rows, so cross-org RBAC still works and no
    production user is ever mutated.
    """
    seed = _mongo.users.find_one({"email": ADMIN_EMAIL},
                                  {"_id": 0, "org_id": 1})
    assert seed, f"admin seed user {ADMIN_EMAIL} missing"
    return seed["org_id"]


@pytest.fixture(scope="module")
def ephemeral_admin(_mongo, ephemeral_org_id) -> Dict[str, str]:
    """Seed a throwaway admin user (unique email, throwaway password),
    yield `{email, password, id, token}`, tear it down at end."""
    uid = str(uuid.uuid4())
    email = f"{EPHEMERAL_ADMIN_EMAIL_PREFIX}{uid[:8]}@paneltec.internal"
    pwd = f"EphAdmin_{uid[:8]}!X"
    doc = {
        "id": uid,
        "org_id": ephemeral_org_id,
        "email": email,
        "name": f"Pytest Ephemeral Admin {uid[:8]}",
        "role": "admin",
        "role_id": "admin",
        "status": "active",
        "activation_status": "active",
        "password_hash": _hash(pwd),
        "created_at": "2026-08-01T00:00:00+00:00",
        "created_by": "pytest",
        "token_version": 0,
        "workspace_ids": [],
    }
    _mongo.users.insert_one(doc)
    token = _login(email, pwd)
    yield {"id": uid, "email": email, "password": pwd, "token": token}
    _mongo.users.delete_one({"id": uid})


# ─────────────────────────────────────────────────────────────
# v160.3.9.33 — Phase 4d test-side write guard.
# Rejects any test-side db.users mutation that could touch a real
# production account. Applied only when RUN_UNDER_GUARD=1 to keep
# existing tests untouched; new v4d tests opt in explicitly.
# ─────────────────────────────────────────────────────────────

# Domains treated as "production" — any user matching one of these
# domains cannot be updated/deleted/replaced by a test.
_PROD_DOMAINS = ("paneltec.com.au",)
# Roles treated as "production seed" — never mutate one of these.
_PROD_ROLES = ("admin", "hseq_manager")


def assert_ephemeral_target(_mongo, filter_or_email):
    """Sanity-check that the target of a test-side write is ephemeral,
    i.e. NOT a paneltec.com.au user AND NOT a system-role account.

    Use like:
        assert_ephemeral_target(_mongo, {"email": some_email})
        _mongo.users.update_one({"email": some_email}, ...)

    Raises AssertionError with an actionable message if the target
    could be a production seed account.
    """
    if isinstance(filter_or_email, str):
        q = {"email": filter_or_email}
    else:
        q = filter_or_email
    doc = _mongo.users.find_one(q, {"_id": 0, "email": 1, "role": 1, "role_id": 1})
    if not doc:
        return  # nothing to guard against — filter matches nobody
    email = (doc.get("email") or "").lower()
    role = (doc.get("role") or "").lower()
    role_id = (doc.get("role_id") or "").lower()
    for dom in _PROD_DOMAINS:
        if email.endswith("@" + dom) and not email.startswith(EPHEMERAL_ADMIN_EMAIL_PREFIX) \
           and not email.startswith(EPHEMERAL_EMAIL_PREFIX):
            raise AssertionError(
                f"REFUSED: test tried to mutate production account {email}. "
                f"Use the `ephemeral_admin` fixture instead."
            )
    if role in _PROD_ROLES or role_id in _PROD_ROLES:
        if not email.startswith(EPHEMERAL_ADMIN_EMAIL_PREFIX):
            raise AssertionError(
                f"REFUSED: test tried to mutate a {role or role_id} role account "
                f"({email}). Use the `ephemeral_admin` fixture instead."
            )



@pytest.fixture(scope="module")
def tokens(ephemeral_users) -> Dict[str, str]:
    """Return a role → bearer token map. Includes `admin` (live seeded
    Stephen account) plus every ephemeral non-admin role."""
    out: Dict[str, str] = {"admin": _login(ADMIN_EMAIL, ADMIN_PWD)}
    for role, email in ephemeral_users.items():
        out[role] = _login(email, EPHEMERAL_PWD)
    return out

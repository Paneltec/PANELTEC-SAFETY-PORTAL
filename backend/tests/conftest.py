"""Shared pytest fixtures for the Paneltec backend test suite.

Extracted from `test_admin_guards.py` in v160.3.9.27 so the newer
`test_v27_guard_migration.py` and future test modules can reuse the
same ephemeral-user setup + tokens without importing across files.

Fixtures provided (all module-scope):
    _mongo           : MongoClient bound to the live DB.
    ephemeral_users  : role -> email dict for 5 non-admin roles.
    tokens           : role -> Bearer token dict incl. 'admin'.

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


@pytest.fixture(scope="module")
def tokens(ephemeral_users) -> Dict[str, str]:
    """Return a role → bearer token map. Includes `admin` (live seeded
    Stephen account) plus every ephemeral non-admin role."""
    out: Dict[str, str] = {"admin": _login(ADMIN_EMAIL, ADMIN_PWD)}
    for role, email in ephemeral_users.items():
        out[role] = _login(email, EPHEMERAL_PWD)
    return out

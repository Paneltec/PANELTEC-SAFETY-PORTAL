"""v160.2.7 — Worker view-only permissions regression tests.

Contracts under test
--------------------
1. The migration is idempotent — a fresh run must clear 0 denies.
2. `ROLE_DEFAULTS["worker"]` still carries `view=True` on every
   resource backing an enabled worker mobile module.
3. Live curl proof: a worker JWT can call the module-enabled list
   endpoints (`/api/pre-starts`, `/api/hazards`, `/api/incidents`,
   `/api/inspections`, `/api/me/worker-profile`, `/api/forms/templates`)
   and receive a 200 (own-scope filtered).
"""
from __future__ import annotations

import asyncio
import os

import requests

BASE = os.environ.get("PANELTEC_API", "http://localhost:8001")
WORKER_EMAIL = os.environ.get("WORKER_EMAIL", "worker_stephen@paneltec.com.au")
WORKER_PW = os.environ.get("WORKER_PW", "WorkerTest123!")


def _login(email: str, pw: str) -> str:
    r = requests.post(
        f"{BASE}/api/auth/login",
        json={"email": email, "password": pw},
        timeout=10,
    )
    r.raise_for_status()
    body = r.json()
    return body.get("access_token") or body.get("token")


def test_migration_idempotent():
    from scripts.migrate_v160_2_7_worker_perms import main
    summary = asyncio.run(main())
    assert summary["denies_cleared_count"] == 0, (
        f"Denies still being cleared on subsequent runs: {summary['denies_cleared']}"
    )


def test_worker_role_defaults_carry_view():
    from permissions import ROLE_DEFAULTS
    from scripts.migrate_v160_2_7_worker_perms import WORKER_VIEW_RESOURCES
    for res in WORKER_VIEW_RESOURCES:
        assert ROLE_DEFAULTS["worker"][res]["view"] is True, (
            f"Worker preset lost view=True on {res}"
        )


def test_worker_curl_view_endpoints_return_200():
    token = _login(WORKER_EMAIL, WORKER_PW)
    headers = {"Authorization": f"Bearer {token}"}
    endpoints = [
        "/api/pre-starts",
        "/api/hazards",
        "/api/incidents",
        "/api/inspections",
        "/api/site-diary",
        "/api/swms",
        "/api/me/worker-profile",
        "/api/forms/templates",
    ]
    failed: list[tuple[str, int]] = []
    for ep in endpoints:
        r = requests.get(f"{BASE}{ep}", headers=headers, timeout=10)
        if r.status_code != 200:
            failed.append((ep, r.status_code))
    assert not failed, f"Worker view-only endpoints failed: {failed}"

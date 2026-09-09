"""v58.13.132bk — Guardrails for the "Forms per role" tab tightening.

Coverage:
  1. Zero legacy tokens remain in `orgs.role_form_allowlist` across
     the whole DB.
  2. The GET endpoint accepts each of the 4 core roles and returns
     the expected shape.
  3. The endpoint rejects legacy tokens (`worker`, `supervisor`, …)
     with HTTP 400.
  4. PUT against `admin` and `owner` is rejected with HTTP 400
     (inert tier — no allowlist storage).
  5. Backfill script is idempotent.
"""
from __future__ import annotations
import os
import re
import pytest
import httpx
from pathlib import Path
from pymongo import MongoClient
from dotenv import load_dotenv

pytestmark = pytest.mark.live_db_writes

CORE_ROLES = ["admin", "paneltec_civil", "viatec_traffic", "external_contractor"]
LEGACY_TOKENS = ["worker", "supervisor", "foreman", "contractor", "hseq"]


@pytest.fixture(scope="module")
def env():
    load_dotenv("/app/backend/.env")
    api_url = None
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            api_url = line.split("=", 1)[1].strip().strip('"')
            break
    return {
        "api_url": api_url,
        "mongo_url": os.environ["MONGO_URL"],
        "db_name": os.environ["DB_NAME"],
    }


@pytest.fixture(scope="module")
def db_sync(env):
    return MongoClient(env["mongo_url"])[env["db_name"]]


@pytest.fixture(scope="module")
def token(env):
    """Rate-limit-aware admin login. The preview environment applies
    a login rate limiter that trips when several test modules login
    back-to-back; retry with backoff so cross-module runs
    (`pytest tests/test_v58_13_132b*.py`) don't false-fail on 429s."""
    import time
    last_err = None
    for attempt in range(6):
        try:
            r = httpx.post(
                f"{env['api_url']}/api/auth/login",
                json={"email": "stephen@paneltec.com.au",
                      "password": "Mcgstephen50#"},
                timeout=10,
            )
            if r.status_code == 429:
                # Sleep with exponential backoff before retrying.
                time.sleep(2 * (attempt + 1))
                last_err = r.text
                continue
            r.raise_for_status()
            return r.json()["access_token"]
        except httpx.HTTPStatusError as e:  # noqa: PERF203
            last_err = str(e)
            if e.response.status_code == 429:
                time.sleep(2 * (attempt + 1))
                continue
            raise
    raise RuntimeError(f"login failed after retries: {last_err}")


def test_no_legacy_tokens_in_role_form_allowlist(db_sync):
    """After the `.132bk` backfill, `orgs.role_form_allowlist` must
    only carry keys in the 4 core roles (or be empty)."""
    offenders = []
    for org in db_sync.orgs.find({}, {"_id": 0, "id": 1, "name": 1,
                                      "role_form_allowlist": 1}):
        rfa = org.get("role_form_allowlist") or {}
        for key in rfa:
            if key in LEGACY_TOKENS:
                offenders.append(f"{org.get('name')} → legacy key {key!r}")
            if key not in CORE_ROLES and key not in ("owner",):
                offenders.append(f"{org.get('name')} → unknown key {key!r}")
    assert not offenders, "\n  " + "\n  ".join(offenders)


@pytest.mark.parametrize("role_id", ["paneltec_civil", "viatec_traffic",
                                     "external_contractor", "admin"])
def test_get_role_forms_accepts_each_core_role(env, token, role_id):
    r = httpx.get(
        f"{env['api_url']}/api/org/role-presets/{role_id}/forms",
        headers={"Authorization": f"Bearer {token}"}, timeout=10,
    )
    assert r.status_code == 200, (role_id, r.status_code, r.text)
    body = r.json()
    assert body.get("role") == role_id
    assert isinstance(body.get("categories"), list)
    assert len(body["categories"]) == 7  # 7 canonical categories


@pytest.mark.parametrize("role_id", LEGACY_TOKENS)
def test_get_role_forms_rejects_legacy_tokens(env, token, role_id):
    r = httpx.get(
        f"{env['api_url']}/api/org/role-presets/{role_id}/forms",
        headers={"Authorization": f"Bearer {token}"}, timeout=10,
    )
    assert r.status_code == 400, (role_id, r.status_code, r.text)


def test_put_role_forms_rejects_admin_and_owner(env, token):
    for tier in ["admin", "owner"]:
        r = httpx.put(
            f"{env['api_url']}/api/org/role-presets/{tier}/forms",
            headers={"Authorization": f"Bearer {token}"},
            json={"allowed_form_ids": []}, timeout=10,
        )
        assert r.status_code == 400, (tier, r.status_code, r.text)
        assert "cannot store" in r.text.lower() or "see every form" in r.text.lower()


def test_backfill_is_idempotent():
    import subprocess, sys
    p = subprocess.run(
        [sys.executable,
         "/app/backend/scripts/backfill_forms_per_role_v58_13_132bk.py"],
        capture_output=True, text=True, timeout=30,
    )
    assert p.returncode == 0, p.stderr
    assert "orgs needing rewrite: 0" in p.stdout, p.stdout


def test_paneltec_civil_inherits_worker_forms(db_sync):
    """The `.132bk` backfill unioned the legacy `worker` allowlist
    onto `paneltec_civil`. Assert the paneltec_civil key exists
    with a non-zero list on the Paneltec Pty Ltd org."""
    org = db_sync.orgs.find_one(
        {"id": "3116f250-a4eb-43f3-98a5-2a3656d6cb63"},
        {"_id": 0, "role_form_allowlist": 1,
         "_forms_per_role_backfilled_version": 1},
    )
    rfa = (org or {}).get("role_form_allowlist") or {}
    assert "paneltec_civil" in rfa, f"paneltec_civil key missing: keys={list(rfa)}"
    assert len(rfa["paneltec_civil"]) > 0, "paneltec_civil allowlist should have inherited worker's 35 forms"
    assert "worker" not in rfa
    assert "admin" not in rfa
    assert (org or {}).get("_forms_per_role_backfilled_version") == "v58.13.132bk"


def test_version_bumped_to_132bk():
    version_js = Path("/app/frontend/src/lib/version.js").read_text()
    sw_js = Path("/app/frontend/public/service-worker.js").read_text()
    m = re.search(r"paneltec-v160\.3\.9\.58\.13\.132([a-z]{1,3})", version_js)
    assert m and m.group(1) >= "bk", (
        f"RUNNING_VERSION letter regressed: {m and m.group(1)}"
    )
    m2 = re.search(r"paneltec-v160\.3\.9\.58\.13\.132([a-z]{1,3})", sw_js)
    assert m2 and m2.group(1) >= "bk"

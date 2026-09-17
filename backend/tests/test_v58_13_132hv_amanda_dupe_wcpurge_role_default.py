"""v58.13.132hv — Three items bundled: Amanda dupe archive,
`worker_companies` full purge, and the `.132hs` role-default fix.

Live actions taken on Stephen's org (2026-09-17):

  1. Amanda Guy dupe archived
     · KEPT   `4d0fa50a-1447-4788-9698-367d1b166b73` (simpro=50)
              — 13 certs, `Office Manager` position, linked user.
     · ARCHIVED `f7e200f8-4c9e-4762-bde4-7c5479cdefa3` (simpro=1086)
                — 0 certs, empty position, unresolved conflict.
     Historical worker_certifications, hr_documents, and SWMS
     signoffs were NOT touched (cascade explicitly avoided —
     `.132hm`'s recursive cascade only fires on doc-library
     folder delete, not worker archive).
     Result: mirror-status conflict bucket went 1 → 0.

  2. worker_companies feature fully purged
     · `db.worker_companies` collection dropped.
     · `workers.worker_company_id` + `worker_company_name` fields
       `$unset` on all 70 remaining workers.
     · Router unmounted, `_serialise` override removed, model
       fields dropped, startup backfill hook deleted.
     · `worker_companies.py` module deleted; `.132hq` pytest
       deleted (replaced by the purge-verification tests below).

  3. Role catalogue fix
     · `.132hs` provisioner defaulted new users to `role="viewer"`
       — a slug the .132s cleanup hard-removed. The FE role
       dropdown filters unknown role_ids into a placeholder
       ("Select role"), which Stephen reported as "empty".
     · Provisioner now derives from `worker.simpro_company_id`:
         "2" → paneltec_civil, "3" → viatec_traffic,
         else → external_contractor.
     · Retro-fixed the two auto-provisioned users on invalid roles
       (Glen → paneltec_civil, MELINDA LINFORD invited → paneltec_civil).

Tests below lock all three fixes.
"""
from __future__ import annotations

import re
import uuid
from pathlib import Path

import pytest
import requests

pytestmark = pytest.mark.live_db_writes


VJS = Path("/app/frontend/src/lib/version.js")
SW = Path("/app/frontend/public/service-worker.js")
WORKERS_PY = Path("/app/backend/workers.py")
SERVER_PY = Path("/app/backend/server.py")


def _api(_mongo) -> str:
    from tests.conftest import API as _api_url
    return _api_url


def _read(p: Path) -> str:
    return p.read_text()


# ── worker_companies purge guards ───────────────────────────────────

def test_worker_companies_router_unmounted(_mongo, ephemeral_admin):
    """`/worker-companies/*` must 404 — router deleted in .132hv."""
    api = _api(_mongo)
    tok = ephemeral_admin["token"]
    r = requests.get(f"{api}/worker-companies",
                     headers={"Authorization": f"Bearer {tok}"}, timeout=10)
    assert r.status_code == 404, \
        f"expected 404 (route deleted), got {r.status_code}: {r.text[:200]}"


def test_worker_companies_module_deleted():
    assert not Path("/app/backend/worker_companies.py").exists(), \
        "worker_companies.py should be deleted"
    assert not Path("/app/backend/tests/test_v58_13_132hq_worker_companies.py").exists(), \
        "test_v58_13_132hq_worker_companies.py should be deleted"


def test_server_no_longer_mounts_worker_companies():
    src = _read(SERVER_PY)
    for banned in (
        "from worker_companies import router as worker_companies_router",
        "api.include_router(worker_companies_router)",
        "from worker_companies import backfill_worker_company_ids_on_startup",
    ):
        assert banned not in src, \
            f"server.py still references purged code: {banned!r}"


def test_workers_py_no_longer_carries_worker_company_fields():
    src = _read(WORKERS_PY)
    # The Pydantic Create + Update models must NOT declare these
    # fields any more. The comment memo trail is allowed.
    for banned in (
        "worker_company_id: Optional[str]",
        "worker_company_name: Optional[str]",
        'out["company_label"] = doc["worker_company_name"]',
    ):
        assert banned not in src, \
            f"workers.py still carries purged field: {banned!r}"


# ── Amanda dupe archive audit trail ─────────────────────────────────

def test_amanda_dupe_archive_audit_entry_written(_mongo):
    """The archive step wrote a `worker.duplicate_archived` audit
    log entry keyed on the dupe worker id."""
    dupe_id = "f7e200f8-4c9e-4762-bde4-7c5479cdefa3"
    entry = _mongo.audit_logs.find_one(
        {"action": "worker.duplicate_archived", "worker_id": dupe_id},
        {"_id": 0},
    )
    assert entry, "audit log entry for Amanda dupe archive is missing"
    assert entry.get("kept_worker_id") == "4d0fa50a-1447-4788-9698-367d1b166b73"
    assert "auto-provision conflict resolution" in (entry.get("reason") or "")

    # And the dupe worker record is now soft-deleted.
    w = _mongo.workers.find_one({"id": dupe_id}, {"_id": 0})
    assert w, "dupe worker record should still exist (soft-delete only)"
    assert w.get("deleted_at"), "dupe should be soft-deleted"
    assert w.get("active") is False


# ── Role-default fix ────────────────────────────────────────────────

def test_provisioner_default_role_derives_from_simpro_company_id(
    _mongo, ephemeral_admin, ephemeral_org_id,
):
    """v58.13.132hv — Auto-provisioner no longer writes `role="viewer"`
    (a slug the .132s cleanup removed). Instead:
      · simpro_company_id="2" → `paneltec_civil`
      · simpro_company_id="3" → `viatec_traffic`
      · otherwise             → `external_contractor`
    """
    api = _api(_mongo)
    tok = ephemeral_admin["token"]
    cases = [("2", "paneltec_civil"),
             ("3", "viatec_traffic"),
             (None, "external_contractor")]
    for cid, expected_role in cases:
        wid = f"pytest-hv-{uuid.uuid4().hex[:8]}"
        email = f"pytest.hv.{uuid.uuid4().hex[:6]}@paneltec.internal"
        doc = {
            "id": wid, "org_id": ephemeral_org_id,
            "first_name": "Sam", "last_name": "Provisionee",
            "email": email, "active": True, "deleted_at": None,
            "created_at": "2026-09-17T00:00:00+00:00",
            "updated_at": "2026-09-17T00:00:00+00:00",
        }
        if cid is not None:
            doc["simpro_company_id"] = cid
        _mongo.workers.insert_one(dict(doc))
        try:
            r = requests.post(
                f"{api}/workers/{wid}/provision-user",
                headers={"Authorization": f"Bearer {tok}"}, timeout=30,
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["status"] == "invited_pending_send", body
            u = _mongo.users.find_one({"id": body["user_id"]}, {"_id": 0})
            assert u["role"] == expected_role, \
                f"cid={cid!r} expected {expected_role!r}, got {u['role']!r}"
        finally:
            _mongo.workers.delete_one({"id": wid})
            _mongo.users.delete_one({"email": email})


def test_provisioner_no_longer_writes_viewer_role():
    """Source-level guard — the `.132hs` `role: "viewer"` line is
    gone from `worker_user_provisioning.py`."""
    src = Path("/app/backend/worker_user_provisioning.py").read_text()
    # Allow the substring inside a comment / memo (context) but not
    # as an active dict literal setting role="viewer".
    lines = [
        ln for ln in src.splitlines()
        if '"role":' in ln and '"viewer"' in ln and "#" not in ln.split('"role"')[0]
    ]
    assert not lines, f"provisioner still writes role='viewer': {lines}"


# ── Version lockstep ───────────────────────────────────────────────

def test_version_pin_v132hv():
    js = _read(VJS)
    sw = _read(SW)
    assert re.search(
        r"RUNNING_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132h[v-z]", js
    ), "RUNNING_VERSION not bumped to .132hv or later"
    assert re.search(
        r"EXPECTED_CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132h[v-z]", js
    ), "EXPECTED_CACHE_VERSION not bumped to .132hv or later"
    assert re.search(
        r"CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132h[v-z]", sw
    ), "service-worker CACHE_VERSION not bumped to .132hv or later"

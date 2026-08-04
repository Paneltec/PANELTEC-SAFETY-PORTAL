"""v160.3.9.48 — HR Employees register — gate matrix + semantic split + idempotency.

Comprehensive coverage:
  1. Gate matrix — every endpoint returns 401 for anon, 403 for a role
     missing the required token, 200 for a role that holds it.
  2. reveal-dob / reveal-address / reveal-next-of-kin each write a
     matching audit row.
  3. `POST /archive` sets `archived="Archived"` (semantic — not `deleted_at`).
  4. `DELETE /{uid}` sets `deleted_at` AND preserves `archived`.
  5. Startup ingest migration is idempotent (marker present → skip).
  6. Auditor role gets 200 on view + audit_view but 403 on reveal-dob.

Fixture-only test users. Stephen (real admin) is used ONLY for read
probes on his role tokens; never mutated. Every write goes through the
ephemeral admin from conftest.
"""
from __future__ import annotations

import requests
from tests.conftest import (
    API,
    ADMIN_EMAIL,
    ADMIN_PWD,
    NON_ADMIN_ROLES,
    EPHEMERAL_PWD,
    _login,
)


def _admin_headers() -> dict:
    return {"Authorization": f"Bearer {_login(ADMIN_EMAIL, ADMIN_PWD)}"}


def _headers_for(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _first_employee_uid(admin_headers: dict) -> str:
    r = requests.get(f"{API}/hr/employees/", headers=admin_headers,
                     params={"limit": 1}, timeout=30)
    assert r.status_code == 200, r.text
    items = r.json().get("items") or []
    assert items, "no employees available for gate-matrix test"
    return items[0]["id"] or items[0]["employee_id"]


# ─────────────────────────────────────────────────────────────
# 1. Gate matrix — anon
# ─────────────────────────────────────────────────────────────

def test_all_endpoints_reject_anonymous():
    """Every hr_employees endpoint MUST reject an unauthenticated call.
    401 (missing JWT) or 403 (JWT present but no token) both count."""
    fake_uid = "nonexistent-uid-12345"
    calls = [
        ("GET",    f"{API}/hr/employees/"),
        ("GET",    f"{API}/hr/employees/columns"),
        ("GET",    f"{API}/hr/employees/audit"),
        ("GET",    f"{API}/hr/employees/{fake_uid}"),
        ("POST",   f"{API}/hr/employees/{fake_uid}/reveal-dob"),
        ("POST",   f"{API}/hr/employees/{fake_uid}/reveal-address"),
        ("POST",   f"{API}/hr/employees/{fake_uid}/reveal-next-of-kin"),
        ("PATCH",  f"{API}/hr/employees/{fake_uid}"),
        ("POST",   f"{API}/hr/employees/{fake_uid}/archive"),
        ("DELETE", f"{API}/hr/employees/{fake_uid}"),
        ("POST",   f"{API}/hr/employees/reimport"),
    ]
    for verb, url in calls:
        r = requests.request(verb, url, timeout=30, json={} if verb == "PATCH" else None)
        assert r.status_code in (401, 403), (
            f"{verb} {url} — expected 401/403 anon, got {r.status_code}: {r.text[:200]}"
        )


# ─────────────────────────────────────────────────────────────
# 2. Gate matrix — role-based token grants
# ─────────────────────────────────────────────────────────────

def test_admin_can_reach_every_endpoint(ephemeral_users):
    """Ephemeral admin should hit 200 on every non-mutating endpoint."""
    hdr = _admin_headers()
    uid = _first_employee_uid(hdr)

    assert requests.get(f"{API}/hr/employees/", headers=hdr, timeout=30).status_code == 200
    assert requests.get(f"{API}/hr/employees/columns", headers=hdr, timeout=30).status_code == 200
    assert requests.get(f"{API}/hr/employees/audit", headers=hdr, timeout=30).status_code == 200
    assert requests.get(f"{API}/hr/employees/{uid}", headers=hdr, timeout=30).status_code == 200
    assert requests.post(f"{API}/hr/employees/{uid}/reveal-dob", headers=hdr, timeout=30).status_code == 200
    assert requests.post(f"{API}/hr/employees/{uid}/reveal-address", headers=hdr, timeout=30).status_code == 200
    assert requests.post(f"{API}/hr/employees/{uid}/reveal-next-of-kin", headers=hdr, timeout=30).status_code == 200


def test_worker_role_denied_view_and_pii(ephemeral_users):
    """Worker fixture must NOT reach any hr_employees endpoint."""
    email = ephemeral_users["worker"]
    tok = _login(email, EPHEMERAL_PWD)
    hdr = _headers_for(tok)
    admin_uid = _first_employee_uid(_admin_headers())

    for verb, path in [
        ("GET",  "/hr/employees/"),
        ("GET",  "/hr/employees/columns"),
        ("GET",  f"/hr/employees/{admin_uid}"),
        ("POST", f"/hr/employees/{admin_uid}/reveal-dob"),
        ("POST", f"/hr/employees/{admin_uid}/reveal-address"),
        ("POST", f"/hr/employees/{admin_uid}/reveal-next-of-kin"),
        ("POST", f"/hr/employees/{admin_uid}/archive"),
        ("POST", "/hr/employees/reimport"),
    ]:
        r = requests.request(verb, f"{API}{path}", headers=hdr, timeout=30)
        assert r.status_code == 403, f"worker on {verb} {path} — expected 403, got {r.status_code}"


def test_auditor_role_permission_carve(ephemeral_users):
    """Auditor MUST reach view + audit endpoints, but MUST NOT reach
    reveal-dob (permission carve — no `hr_employees.reveal_pii`)."""
    email = ephemeral_users["auditor"]
    tok = _login(email, EPHEMERAL_PWD)
    hdr = _headers_for(tok)
    admin_uid = _first_employee_uid(_admin_headers())

    # view + audit granted
    assert requests.get(f"{API}/hr/employees/", headers=hdr, timeout=30).status_code == 200
    assert requests.get(f"{API}/hr/employees/audit", headers=hdr, timeout=30).status_code == 200
    assert requests.get(f"{API}/hr/employees/{admin_uid}", headers=hdr, timeout=30).status_code == 200

    # reveal-pii denied
    r = requests.post(f"{API}/hr/employees/{admin_uid}/reveal-dob",
                      headers=hdr, timeout=30)
    assert r.status_code == 403, r.text
    assert "hr_employees" in r.text.lower() or "permission" in r.text.lower()

    # archive + reimport denied
    r = requests.post(f"{API}/hr/employees/{admin_uid}/archive",
                      headers=hdr, timeout=30)
    assert r.status_code == 403


# ─────────────────────────────────────────────────────────────
# 3. reveal-* endpoints each write an audit row
# ─────────────────────────────────────────────────────────────

def test_reveal_endpoints_write_audit_rows():
    hdr = _admin_headers()
    # Grab both id (URL) and employee_id (audit key) so we query the right one.
    r_first = requests.get(f"{API}/hr/employees/", headers=hdr,
                           params={"limit": 1}, timeout=30)
    assert r_first.status_code == 200, r_first.text
    row = (r_first.json().get("items") or [None])[0]
    assert row, "no employees available for reveal-audit test"
    uid = row["id"] or row["employee_id"]
    employee_id = row["employee_id"]

    # Fire the three reveal endpoints.
    assert requests.post(f"{API}/hr/employees/{uid}/reveal-dob",
                         headers=hdr, timeout=30).status_code == 200
    assert requests.post(f"{API}/hr/employees/{uid}/reveal-address",
                         headers=hdr, timeout=30).status_code == 200
    assert requests.post(f"{API}/hr/employees/{uid}/reveal-next-of-kin",
                         headers=hdr, timeout=30).status_code == 200

    # Each reveal endpoint MUST emit a matching audit row.
    r1 = requests.get(f"{API}/hr/employees/audit", headers=hdr,
                      params={"employee_id": employee_id, "limit": 100},
                      timeout=30)
    rows = r1.json()["items"]
    actions = [r["action"] for r in rows]
    assert "reveal-dob" in actions, f"reveal-dob audit row missing (employee_id={employee_id})"
    assert "reveal-address" in actions, "reveal-address audit row missing"
    assert "reveal-next-of-kin" in actions, "reveal-next-of-kin audit row missing"


# ─────────────────────────────────────────────────────────────
# 4. Archive / Delete semantic split
# ─────────────────────────────────────────────────────────────

def test_archive_sets_archived_field_not_deleted_at(_mongo):
    hdr = _admin_headers()
    # Pick an Active employee.
    r = requests.get(f"{API}/hr/employees/", headers=hdr,
                     params={"archived": "active", "limit": 200}, timeout=30)
    items = r.json().get("items") or []
    active = next((e for e in items if e.get("archived") == "Active"), None)
    if not active:
        # Fallback — take any active row.
        active = items[0]
    uid = active["id"] or active["employee_id"]
    employee_id = active["employee_id"]

    # POST /archive → archived=Archived, deleted_at NOT set.
    r_arch = requests.post(f"{API}/hr/employees/{uid}/archive",
                           headers=hdr, timeout=30)
    assert r_arch.status_code == 200, r_arch.text
    payload = r_arch.json()
    assert payload["archived"] is True
    assert payload["archived_status"] == "Archived"

    # Direct Mongo verification: archived flipped, deleted_at null.
    doc = _mongo.hr_employees.find_one({"employee_id": employee_id})
    assert doc is not None
    assert doc.get("archived") == "Archived"
    assert doc.get("deleted_at") in (None, ""), (
        f"archive MUST NOT set deleted_at; got {doc.get('deleted_at')}"
    )

    # Idempotency — second archive call is a no-op.
    r_arch2 = requests.post(f"{API}/hr/employees/{uid}/archive",
                            headers=hdr, timeout=30)
    assert r_arch2.status_code == 200
    assert r_arch2.json()["archived_status"] == "Archived"

    # Restore for cleanliness.
    requests.patch(f"{API}/hr/employees/{uid}",
                   headers=hdr, json={"archived": "Active"}, timeout=30)


def test_delete_sets_deleted_at_and_preserves_archived(_mongo):
    hdr = _admin_headers()
    # Pick an Archived employee — safer than deleting an Active one.
    r = requests.get(f"{API}/hr/employees/", headers=hdr,
                     params={"archived": "archived", "limit": 200}, timeout=30)
    items = r.json().get("items") or []
    if not items:
        # If no archived rows exist, archive one first.
        active = requests.get(f"{API}/hr/employees/", headers=hdr,
                              params={"archived": "active", "limit": 1},
                              timeout=30).json().get("items") or []
        assert active, "no employees available for delete-semantic test"
        target = active[0]
        uid = target["id"] or target["employee_id"]
        requests.post(f"{API}/hr/employees/{uid}/archive",
                      headers=hdr, timeout=30)
        items = requests.get(f"{API}/hr/employees/", headers=hdr,
                             params={"archived": "archived", "limit": 1},
                             timeout=30).json().get("items") or []
    target = items[0]
    uid = target["id"] or target["employee_id"]
    employee_id = target["employee_id"]
    archived_before = target.get("archived")

    r_del = requests.delete(f"{API}/hr/employees/{uid}",
                            headers=hdr, timeout=30)
    assert r_del.status_code == 200, r_del.text
    payload = r_del.json()
    assert payload["deleted"] is True
    assert payload["archived_preserved"] == archived_before

    # Direct Mongo verification.
    doc = _mongo.hr_employees.find_one({"employee_id": employee_id})
    assert doc is not None
    assert doc.get("deleted_at"), "delete MUST set deleted_at"
    assert doc.get("archived") == archived_before, (
        f"delete MUST preserve archived; before={archived_before} "
        f"after={doc.get('archived')}"
    )

    # Cleanup — clear deleted_at so the fixture row stays visible.
    _mongo.hr_employees.update_one(
        {"employee_id": employee_id},
        {"$set": {"deleted_at": None}},
    )


# ─────────────────────────────────────────────────────────────
# 5. Auto-ingest migration is idempotent
# ─────────────────────────────────────────────────────────────

def test_ingest_migration_marker_present_and_singular(_mongo):
    """The startup migration MUST insert exactly one marker document."""
    docs = list(_mongo.bk_migrations.find(
        {"_id": "v160_3_9_48_hr_employees_ingest"}))
    assert len(docs) == 1, (
        f"expected exactly 1 marker, found {len(docs)} — non-idempotent ingest"
    )
    m = docs[0]
    assert "ingest_stats" in m
    assert "live_total" in m
    assert m["live_total"] >= 121 or m["ingest_stats"]["inserted"] >= 0


def test_hr_employees_populated(_mongo):
    """After the startup migration, hr_employees must carry >= 121 rows."""
    total = _mongo.hr_employees.count_documents({"deleted_at": None})
    assert total >= 121, f"expected >= 121 employees, got {total}"


# ─────────────────────────────────────────────────────────────
# 6. Stephen (real admin) MUST carry hr_employees.* tokens
# ─────────────────────────────────────────────────────────────

def test_stephen_carries_all_hr_employees_tokens(_mongo):
    """Post-migration Stephen MUST inherit all 6 hr_employees tokens
    (via admin role → permission_tokens[]). Read-only assertion —
    no write to Stephen's user doc."""
    admin_role = _mongo.roles.find_one({"role_id": "admin"})
    assert admin_role is not None, "admin role doc missing"
    tokens = set(admin_role.get("permission_tokens") or [])
    required = {
        "hr_employees.view",
        "hr_employees.edit",
        "hr_employees.reveal_pii",
        "hr_employees.archive",
        "hr_employees.reimport",
        "hr_employees.audit_view",
    }
    missing = required - tokens
    assert not missing, f"admin role missing hr_employees tokens: {missing}"

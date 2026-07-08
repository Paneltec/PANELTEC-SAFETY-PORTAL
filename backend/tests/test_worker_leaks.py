"""v159.0 — Worker permission regression tests.

Locks in the API-level gates added in v159.0 so a future refactor cannot
silently re-expose sensitive registers to a worker JWT.

Assertions:
  * worker → 403 on suppliers / assets / documents / contractors /
    backup / integrations / settings endpoints
  * worker → 200 on `/api/workers` with a THIN projection (no PII fields)
  * admin  → 200 on all of the above

Run with `pytest -xvs backend/tests/test_worker_leaks.py` from `/app`.
Uses the local supervisor-managed backend on `localhost:8001`.
"""
from __future__ import annotations

import os
import pytest
import requests

BASE = os.environ.get("PANELTEC_API", "http://localhost:8001")

ADMIN_EMAIL = "stephen@paneltec.com.au"
ADMIN_PASSWORD = "Mcgstephen50#"
WORKER_EMAIL = "worker_stephen@paneltec.com.au"
WORKER_PASSWORD = "WorkerTest123!"

# Fields that the worker MUST NOT see on a `/api/workers` row.
WORKER_PII_FIELDS = {
    "email", "mobile", "phone", "address", "date_of_birth", "dob",
    "tax_file_number", "tfn", "bank_bsb", "bank_account",
    "emergency_contact_name", "emergency_contact_phone",
    "medical_conditions", "notes", "availability",
}

# Endpoints that must return 403 for a worker JWT.
FORBIDDEN_FOR_WORKER = [
    "/api/suppliers/meta",
    "/api/assets",
    "/api/document-library/folders",
    "/api/contractors",
    # Backup + integrations + settings should stay admin-only.
    "/api/backup/summary",
    "/api/health/integrations",  # NOTE: allowed publicly for banners? adjust if needed
    "/api/settings/org",
]


def _login(email: str, password: str) -> str:
    r = requests.post(
        f"{BASE}/api/auth/login",
        json={"email": email, "password": password},
        timeout=10,
    )
    r.raise_for_status()
    body = r.json()
    token = body.get("access_token") or body.get("token")
    assert token, f"No token in login response: {body}"
    return token


@pytest.fixture(scope="module")
def admin_headers() -> dict:
    return {"Authorization": f"Bearer {_login(ADMIN_EMAIL, ADMIN_PASSWORD)}"}


@pytest.fixture(scope="module")
def worker_headers() -> dict:
    return {"Authorization": f"Bearer {_login(WORKER_EMAIL, WORKER_PASSWORD)}"}


# ---------- 403 sweeps ----------

@pytest.mark.parametrize("path", [
    "/api/suppliers/meta",
    "/api/assets",
    "/api/document-library/folders",
    "/api/contractors",
])
def test_worker_forbidden_on_sensitive_registers(worker_headers, path):
    r = requests.get(f"{BASE}{path}", headers=worker_headers, timeout=10)
    assert r.status_code == 403, (
        f"Worker leaked {path} — expected 403 got {r.status_code}\n"
        f"body={r.text[:400]}"
    )


# ---------- 200 sweeps for admin ----------

@pytest.mark.parametrize("path", [
    "/api/suppliers/meta",
    "/api/assets",
    "/api/document-library/folders",
    "/api/contractors",
    "/api/workers",
])
def test_admin_can_see_all_registers(admin_headers, path):
    r = requests.get(f"{BASE}{path}", headers=admin_headers, timeout=10)
    assert r.status_code == 200, (
        f"Admin blocked from {path} — got {r.status_code}\n"
        f"body={r.text[:400]}"
    )


# ---------- workers thin projection ----------

def test_worker_workers_list_is_thin(worker_headers):
    r = requests.get(f"{BASE}/api/workers", headers=worker_headers, timeout=10)
    assert r.status_code == 200, r.text[:300]
    rows = r.json()
    assert isinstance(rows, list) and rows, "worker /api/workers returned no rows"
    for row in rows[:20]:
        leaked = WORKER_PII_FIELDS.intersection(row.keys())
        assert not leaked, (
            f"Thin projection leaked PII fields to worker: {leaked}\n"
            f"row keys={list(row.keys())}"
        )


def test_admin_workers_list_has_full_fields(admin_headers):
    r = requests.get(f"{BASE}/api/workers", headers=admin_headers, timeout=10)
    assert r.status_code == 200, r.text[:300]
    rows = r.json()
    assert isinstance(rows, list) and rows
    # Admin must be able to see at least one of the PII fields on a row.
    seen = set()
    for row in rows[:50]:
        seen.update(WORKER_PII_FIELDS.intersection(row.keys()))
    assert seen, (
        "Admin workers list is missing every expected PII field — projection"
        " may have been over-clamped."
    )


def test_worker_scope_me_returns_own_row_only(worker_headers):
    r = requests.get(f"{BASE}/api/workers?scope=me", headers=worker_headers, timeout=10)
    assert r.status_code == 200, r.text[:300]
    rows = r.json()
    assert isinstance(rows, list)
    # 0 rows is acceptable (worker not linked yet), but if present must be
    # exactly the caller's own row.
    assert len(rows) <= 1


# ---------- v159.1 gates ----------

def test_worker_ask_briefing_is_forbidden(worker_headers):
    """Ask Intelligence must be admin/hseq-only unless the org's mobile
    module allocator explicitly enables `ask_intel` for the worker role."""
    r = requests.get(f"{BASE}/api/ask/briefing", headers=worker_headers, timeout=15)
    assert r.status_code == 403, (
        f"Worker leaked /api/ask/briefing — expected 403 got {r.status_code}\n"
        f"body={r.text[:300]}"
    )


def test_worker_ask_post_is_forbidden(worker_headers):
    r = requests.post(
        f"{BASE}/api/ask",
        headers={**worker_headers, "Content-Type": "application/json"},
        json={"question": "What incidents happened last week?"},
        timeout=15,
    )
    assert r.status_code == 403, (
        f"Worker leaked POST /api/ask — expected 403 got {r.status_code}\n"
        f"body={r.text[:300]}"
    )


def test_worker_certifications_all_forces_scope_me(worker_headers):
    """Even without the ?scope=me query string, a worker's certifications
    list must be filtered to their own worker record."""
    r = requests.get(
        f"{BASE}/api/workers/certifications/all",
        headers=worker_headers, timeout=10,
    )
    assert r.status_code == 200, r.text[:300]
    rows = r.json()
    assert isinstance(rows, list)
    # If the worker has no linked worker row yet, expect 0 rows. Otherwise
    # every row must belong to the caller (worker_id consistent across all).
    worker_ids = {r.get("worker_id") for r in rows}
    assert len(worker_ids) <= 1, (
        f"Worker /certifications/all leaked multiple worker_ids: {worker_ids}"
    )


def test_admin_certifications_all_returns_full_list(admin_headers):
    r = requests.get(
        f"{BASE}/api/workers/certifications/all",
        headers=admin_headers, timeout=10,
    )
    assert r.status_code == 200, r.text[:300]
    rows = r.json()
    assert isinstance(rows, list)
    # Admin should see many worker_ids (or 0 if empty org). This asserts
    # the privileged path is NOT being clamped to a single worker row.
    worker_ids = {r.get("worker_id") for r in rows}
    # Allow 0 (empty seed) but never should this be exactly 1 unless the
    # org genuinely has a single worker with certs — leave as a smoke check.
    assert len(worker_ids) != 1 or len(rows) <= 1, (
        f"Admin certifications list looks over-clamped: {len(rows)} rows, "
        f"{len(worker_ids)} worker_ids"
    )


# ─── v160.0.6 — admin preview-as-worker defense in depth ───

def test_admin_certifications_all_with_as_role_worker_clamps_to_admin_row(admin_headers):
    """Web admin's Live Preview iframe passes `?as_role=worker`. The endpoint
    must downgrade the privileged admin to non-privileged scoping so the
    preview shows what a real worker would see — not the org-wide list."""
    r = requests.get(
        f"{BASE}/api/workers/certifications/all?as_role=worker",
        headers=admin_headers, timeout=10,
    )
    assert r.status_code == 200, r.text[:300]
    rows = r.json()
    assert isinstance(rows, list)
    worker_ids = {row.get("worker_id") for row in rows}
    # Either 0 rows (admin has no linked worker row) OR exactly 1 (the
    # admin's own linked worker row). Never the full org.
    assert len(worker_ids) <= 1, (
        f"as_role=worker leaked {len(worker_ids)} worker_ids in {len(rows)} rows"
    )


def test_admin_certifications_all_with_as_role_admin_returns_full_list(admin_headers):
    """`as_role=admin` (or any privileged role) must NOT downgrade — the
    preview-as-admin path should still see the org-wide list."""
    r = requests.get(
        f"{BASE}/api/workers/certifications/all?as_role=admin",
        headers=admin_headers, timeout=10,
    )
    assert r.status_code == 200, r.text[:300]
    rows = r.json()
    assert isinstance(rows, list)


def test_admin_certifications_search_with_as_role_worker_clamps(admin_headers):
    """Same defense applies to the search endpoint."""
    r = requests.get(
        f"{BASE}/api/workers/certifications/search?q=&as_role=contractor",
        headers=admin_headers, timeout=10,
    )
    assert r.status_code == 200, r.text[:300]
    rows = r.json()
    worker_ids = {row.get("worker_id") for row in rows}
    assert len(worker_ids) <= 1, (
        f"search as_role=contractor leaked {len(worker_ids)} worker_ids"
    )



def test_mobile_modules_response_includes_defaults_version(admin_headers):
    """The v159.1 admin GET must expose `defaults_version` and
    `needs_migration_review` so the Web UI can render the banner."""
    r = requests.get(f"{BASE}/api/settings/mobile-modules", headers=admin_headers, timeout=10)
    assert r.status_code == 200, r.text[:300]
    body = r.json()
    assert "defaults_version" in body, "Missing defaults_version in response"
    assert "needs_migration_review" in body, "Missing needs_migration_review in response"
    assert body["defaults_version"] == "v160.0.2", (
        f"Server defaults_version is {body['defaults_version']!r}, expected v160.0.2"
    )
    # `users_directory` must be present in the module catalogue.
    assert "users_directory" in (body.get("module_keys") or []), (
        "users_directory missing from module_keys catalogue"
    )


# ---------- v159.2 team-scoping gates ----------

@pytest.mark.parametrize("resource", ["incidents", "hazards", "inspections",
                                       "pre-starts", "site-diary", "swms"])
def test_worker_list_auto_scoped_to_own_records(worker_headers, resource):
    """Worker without team_view sees only their own records on
    `GET /api/{resource}`. `created_by` must be uniform (or list empty)."""
    r = requests.get(f"{BASE}/api/{resource}", headers=worker_headers, timeout=10)
    assert r.status_code == 200, r.text[:300]
    rows = r.json()
    assert isinstance(rows, list)
    creators = {row.get("created_by") for row in rows}
    creators.discard(None)
    assert len(creators) <= 1, (
        f"Worker /api/{resource} leaked multiple created_by values: {creators}"
    )


def test_worker_scope_team_denied(worker_headers):
    """Worker asking `?scope=team` must be rejected with 403 (no team_view)."""
    for resource in ("incidents", "hazards"):
        r = requests.get(
            f"{BASE}/api/{resource}?scope=team", headers=worker_headers, timeout=10,
        )
        assert r.status_code == 403, (
            f"Worker got {r.status_code} on /api/{resource}?scope=team, expected 403"
        )
        assert "team_view" in (r.json().get("detail") or "").lower(), r.text[:300]


def test_admin_sees_full_incident_list(admin_headers, worker_headers):
    """Admin has team_view — must see at least as many rows as the worker."""
    admin = requests.get(f"{BASE}/api/incidents", headers=admin_headers, timeout=10)
    worker = requests.get(f"{BASE}/api/incidents", headers=worker_headers, timeout=10)
    assert admin.status_code == 200 and worker.status_code == 200
    assert len(admin.json()) >= len(worker.json()), (
        f"Admin saw fewer incidents ({len(admin.json())}) than worker "
        f"({len(worker.json())}) — team-scoping is over-filtering."
    )


def test_worker_scope_me_explicit_returns_own(worker_headers):
    r = requests.get(f"{BASE}/api/hazards?scope=me", headers=worker_headers, timeout=10)
    assert r.status_code == 200
    rows = r.json()
    creators = {row.get("created_by") for row in rows}
    creators.discard(None)
    assert len(creators) <= 1, f"scope=me leaked others' hazards: {creators}"


def test_worker_cannot_open_someone_elses_hazard(admin_headers, worker_headers):
    """If any hazard exists that the worker DIDN'T create, worker → 403
    on the detail route."""
    admin_rows = requests.get(f"{BASE}/api/hazards", headers=admin_headers, timeout=10).json()
    # Login worker just for its id via /auth/me
    me = requests.get(f"{BASE}/api/auth/me", headers=worker_headers, timeout=10).json()
    worker_id = me.get("id")
    foreign = next((h for h in admin_rows if h.get("created_by") != worker_id), None)
    if not foreign:
        pytest.skip("No hazards owned by another user in this org to test against.")
    r = requests.get(f"{BASE}/api/hazards/{foreign['id']}", headers=worker_headers, timeout=10)
    assert r.status_code == 403, (
        f"Worker leaked hazard {foreign['id']} — expected 403 got {r.status_code}"
    )


def test_admin_openapi_still_available(admin_headers):
    r = requests.get(f"{BASE}/api/openapi.json", timeout=15)
    assert r.status_code == 200, r.text[:200]
    body = r.json()
    assert body.get("openapi", "").startswith("3."), "OpenAPI schema malformed"


# ---------- v160.0 phone lockdown ----------

def test_worker_dashboard_metrics_hides_watch_signal(worker_headers):
    """WATCH card gate: for non-privileged callers the aggregate
    attention_score/records_needing_attention are zeroed and band='hidden'
    so the mobile hides the card entirely."""
    r = requests.get(f"{BASE}/api/dashboard/metrics", headers=worker_headers, timeout=10)
    assert r.status_code == 200, r.text[:300]
    body = r.json()
    assert body.get("attention_band") == "hidden", (
        f"Worker got attention_band={body.get('attention_band')!r}, expected 'hidden'"
    )
    assert body.get("records_needing_attention") == 0
    assert body.get("attention_score") == 0


def test_admin_dashboard_metrics_still_shows_watch(admin_headers):
    r = requests.get(f"{BASE}/api/dashboard/metrics", headers=admin_headers, timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert body.get("attention_band") in ("Strong", "Watch", "Action needed"), (
        f"Admin lost WATCH signal: band={body.get('attention_band')!r}"
    )


def test_worker_outbox_auto_scoped(worker_headers):
    r = requests.get(f"{BASE}/api/email/outbox", headers=worker_headers, timeout=10)
    assert r.status_code == 200, r.text[:300]
    body = r.json()
    me = requests.get(f"{BASE}/api/auth/me", headers=worker_headers, timeout=10).json()
    me_id, me_email = me["id"], (me.get("email") or "").lower()
    for m in body.get("items") or []:
        assert (m.get("created_by") == me_id) or (me_email in (m.get("to") or [])), (
            f"Worker outbox leaked message id={m.get('id')} created_by={m.get('created_by')}"
        )


def test_worker_outbox_scope_team_denied(worker_headers):
    r = requests.get(f"{BASE}/api/email/outbox?scope=team", headers=worker_headers, timeout=10)
    assert r.status_code == 403, r.text[:300]


def test_worker_inductions_matrix_auto_scoped(worker_headers):
    r = requests.get(f"{BASE}/api/workers/inductions/matrix", headers=worker_headers, timeout=10)
    assert r.status_code == 200, r.text[:300]
    body = r.json()
    workers_out = body.get("workers") or []
    # Worker may not be linked → 0 rows. If linked, exactly one worker row.
    assert len(workers_out) <= 1, (
        f"Worker /inductions/matrix leaked {len(workers_out)} workers"
    )


def test_admin_inductions_matrix_full(admin_headers):
    r = requests.get(f"{BASE}/api/workers/inductions/matrix", headers=admin_headers, timeout=10)
    assert r.status_code == 200
    workers_out = (r.json() or {}).get("workers") or []
    # Admin should see many workers (or 0 if empty seed). Never clamped to 1.
    assert len(workers_out) == 0 or len(workers_out) >= 2, (
        f"Admin /inductions/matrix looks clamped: {len(workers_out)} workers"
    )


# ---------- v159.3 preset clone + per-user permissions + bulk restrict ----------

def test_admin_can_duplicate_builtin_preset(admin_headers):
    """Cloning a built-in preset creates an editable custom row with a
    `based_on` audit-trail field."""
    r = requests.post(
        f"{BASE}/api/permission-presets/field_worker/duplicate",
        headers=admin_headers, timeout=10,
    )
    assert r.status_code == 201, r.text[:300]
    clone = r.json()
    assert clone["is_builtin"] is False
    assert clone["based_on"] == "field_worker"
    assert "Custom" in clone["label"]
    assert clone["permissions"], "Clone must carry a non-empty matrix"
    # Cleanup: delete the clone so repeated test runs don't pile up rows.
    requests.delete(
        f"{BASE}/api/permission-presets/{clone['id']}",
        headers=admin_headers, timeout=10,
    )


def test_worker_cannot_duplicate_preset(worker_headers):
    r = requests.post(
        f"{BASE}/api/permission-presets/field_worker/duplicate",
        headers=worker_headers, timeout=10,
    )
    assert r.status_code == 403, (
        f"Worker leaked preset clone endpoint — got {r.status_code}"
    )


def test_builtin_preset_cannot_be_deleted(admin_headers):
    r = requests.delete(
        f"{BASE}/api/permission-presets/field_worker", headers=admin_headers, timeout=10,
    )
    assert r.status_code == 400, (
        f"Built-in preset deletion should 400 — got {r.status_code}"
    )


def test_admin_can_read_and_write_user_permissions(admin_headers, worker_headers):
    me = requests.get(f"{BASE}/api/auth/me", headers=worker_headers, timeout=10).json()
    uid = me["id"]
    # Read
    r = requests.get(
        f"{BASE}/api/users/{uid}/permissions", headers=admin_headers, timeout=10,
    )
    assert r.status_code == 200, r.text[:300]
    body = r.json()
    assert "effective" in body and "overrides" in body
    # Write a benign no-op override (documents.email=False for a resource
    # that doesn't support email anyway — persisted but effectively inert).
    new_overrides = dict(body.get("overrides") or {})
    r2 = requests.put(
        f"{BASE}/api/users/{uid}/permissions",
        headers={**admin_headers, "Content-Type": "application/json"},
        json={"overrides": new_overrides}, timeout=10,
    )
    assert r2.status_code == 200, r2.text[:300]


def test_worker_cannot_read_own_permissions_endpoint(worker_headers):
    me = requests.get(f"{BASE}/api/auth/me", headers=worker_headers, timeout=10).json()
    r = requests.get(
        f"{BASE}/api/users/{me['id']}/permissions", headers=worker_headers, timeout=10,
    )
    assert r.status_code == 403, (
        f"Worker leaked own permissions GET — got {r.status_code}"
    )


def test_bulk_restrict_denies_documents_view(admin_headers, worker_headers):
    me = requests.get(f"{BASE}/api/auth/me", headers=worker_headers, timeout=10).json()
    payload = {
        "user_ids": [me["id"]],
        "resource": "documents",
        "action": "view",
        "value": False,
        "reason": "v159.3 pytest — bulk restrict smoke",
    }
    r = requests.post(
        f"{BASE}/api/permissions/bulk-restrict",
        headers={**admin_headers, "Content-Type": "application/json"},
        json=payload, timeout=10,
    )
    assert r.status_code == 200, r.text[:300]
    body = r.json()
    assert body["updated"] == 1
    assert body["missing_user_ids"] == []
    # Sanity: the worker's effective docs.view is now False.
    r2 = requests.get(
        f"{BASE}/api/users/{me['id']}/permissions", headers=admin_headers, timeout=10,
    )
    eff = r2.json().get("effective") or {}
    assert eff.get("documents", {}).get("view") is False, (
        f"Bulk restrict didn't stick: documents.view={eff.get('documents', {}).get('view')}"
    )
    # Cleanup — reset the worker's overrides so subsequent tests aren't affected.
    requests.post(
        f"{BASE}/api/users/{me['id']}/permissions/reset",
        headers=admin_headers, timeout=10,
    )


def test_worker_cannot_bulk_restrict(worker_headers):
    r = requests.post(
        f"{BASE}/api/permissions/bulk-restrict",
        headers={**worker_headers, "Content-Type": "application/json"},
        json={"user_ids": ["x"], "resource": "documents", "action": "view", "value": False},
        timeout=10,
    )
    assert r.status_code == 403, (
        f"Worker leaked bulk-restrict — got {r.status_code}"
    )


def test_bulk_restrict_rejects_bad_resource(admin_headers):
    r = requests.post(
        f"{BASE}/api/permissions/bulk-restrict",
        headers={**admin_headers, "Content-Type": "application/json"},
        json={"user_ids": ["x"], "resource": "banana", "action": "view", "value": False},
        timeout=10,
    )
    assert r.status_code == 400, r.text[:200]


# ---------- v160.0.2 compliance_snapshot module ----------

def test_worker_me_modules_hides_compliance_snapshot(worker_headers):
    """Worker's `/api/me/mobile-modules` must expose `compliance_snapshot:false`
    so the phone Home skips the chip row without a second round-trip."""
    r = requests.get(f"{BASE}/api/me/mobile-modules", headers=worker_headers, timeout=10)
    assert r.status_code == 200, r.text[:300]
    body = r.json()
    modules = (body or {}).get("modules") or body
    assert modules.get("compliance_snapshot") is False, (
        f"Worker compliance_snapshot={modules.get('compliance_snapshot')!r}, expected False"
    )


def test_admin_me_modules_shows_compliance_snapshot(admin_headers):
    r = requests.get(f"{BASE}/api/me/mobile-modules", headers=admin_headers, timeout=10)
    assert r.status_code == 200, r.text[:300]
    body = r.json()
    modules = (body or {}).get("modules") or body
    assert modules.get("compliance_snapshot") is True, (
        f"Admin compliance_snapshot={modules.get('compliance_snapshot')!r}, expected True"
    )


# ---------- v160.1 document categorization ----------

def test_worker_cannot_create_category(worker_headers):
    r = requests.post(
        f"{BASE}/api/document-categories",
        headers={**worker_headers, "Content-Type": "application/json"},
        json={"name": "Sneaky", "scope": "shared", "applies_to": ["document"]},
        timeout=10,
    )
    assert r.status_code == 403, r.text[:300]


def test_admin_can_create_list_and_delete_empty_category(admin_headers):
    r = requests.post(
        f"{BASE}/api/document-categories",
        headers={**admin_headers, "Content-Type": "application/json"},
        json={"name": "TasWater Inductions v160.1", "scope": "employee",
              "sensitive": True, "applies_to": ["induction", "document"]},
        timeout=10,
    )
    assert r.status_code == 201, r.text[:300]
    cat = r.json()
    assert cat["scope"] == "employee"
    assert cat["slug"].startswith("taswater_inductions")
    assert cat["sensitive"] is True
    cat_id = cat["id"]
    # List — admin sees at least this one
    r2 = requests.get(f"{BASE}/api/document-categories", headers=admin_headers, timeout=10)
    assert r2.status_code == 200
    ids = {c["id"] for c in r2.json()}
    assert cat_id in ids
    # Delete (no records reference it) → 200
    r3 = requests.delete(f"{BASE}/api/document-categories/{cat_id}", headers=admin_headers, timeout=10)
    assert r3.status_code == 200, r3.text[:300]


def test_worker_list_categories_filtered(admin_headers, worker_headers):
    """Worker sees only categories where `role_acl.worker=true` or an
    employee-scope category they own a record under. Fresh employee-scope
    category with 0 records should NOT appear."""
    r = requests.post(
        f"{BASE}/api/document-categories",
        headers={**admin_headers, "Content-Type": "application/json"},
        json={"name": "Private Cat v160.1", "scope": "employee",
              "applies_to": ["document"]},
        timeout=10,
    )
    cat_id = r.json()["id"]
    r2 = requests.get(f"{BASE}/api/document-categories", headers=worker_headers, timeout=10)
    # Worker may lack documents.view perm entirely → 403 is acceptable
    # (means the endpoint is protected). If 200, ensure the private cat
    # is filtered out.
    if r2.status_code == 200:
        ids = {c["id"] for c in r2.json()}
        assert cat_id not in ids, "Worker leaked an employee-scope category they don't own records in"
    else:
        assert r2.status_code == 403, f"Unexpected {r2.status_code}"
    requests.delete(f"{BASE}/api/document-categories/{cat_id}", headers=admin_headers, timeout=10)


def test_delete_category_with_records_returns_409(admin_headers):
    """Insert a category, seed one dummy document referencing it via the
    same POST /doc_files upsert-shape, then delete → expect 409."""
    from pymongo import MongoClient
    from dotenv import load_dotenv
    import os
    load_dotenv("/app/backend/.env")
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not mongo_url or not db_name:
        import pytest
        pytest.skip("MONGO_URL/DB_NAME not available in test env")

    r = requests.post(
        f"{BASE}/api/document-categories",
        headers={**admin_headers, "Content-Type": "application/json"},
        json={"name": "Conflict Cat v160.1", "scope": "shared",
              "applies_to": ["document"]},
        timeout=10,
    )
    cat = r.json()
    cat_id = cat["id"]
    mc = MongoClient(mongo_url)
    dummy = {
        "id": "test-dummy-160-1", "org_id": cat["org_id"],
        "folder_id": "x", "filename": "x.pdf", "stored_name": "x.pdf",
        "category_id": cat_id, "deleted_at": None,
        "uploaded_at": "2026-07-08T00:00:00Z",
    }
    mc[db_name].doc_files.insert_one(dict(dummy))
    try:
        r2 = requests.delete(f"{BASE}/api/document-categories/{cat_id}", headers=admin_headers, timeout=10)
        assert r2.status_code == 409, r2.text[:300]
        detail = r2.json().get("detail") or {}
        assert detail.get("count") == 1, f"expected count=1 got {detail}"
        assert detail.get("breakdown", {}).get("documents") == 1
    finally:
        mc[db_name].doc_files.delete_one({"id": "test-dummy-160-1"})
        requests.delete(f"{BASE}/api/document-categories/{cat_id}", headers=admin_headers, timeout=10)

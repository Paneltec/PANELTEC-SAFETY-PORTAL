"""v160.3.4 — Auto-taxonomy + Unmatched Documents triage regression tests.

Task D (live commit) is HELD — all ZIP-upload tests use dry_run=1.
"""
import os
import io
import zipfile
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://whs-compliance.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "stephen@paneltec.com.au"
ADMIN_PW = "Mcgstephen50#"
WORKER_ID = "904c93f5-c714-432d-a24e-d4e40b749294"
UNMATCHED_DOC_ID = "27924694-3c71-4afd-a0cf-f7a2053e6cdb"
PROBE_SLUG = "__probe_v1604_auto"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PW},
                      timeout=30)
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


# ─── Auth & version ────────────────────────────────────────────
def test_auth_me(admin_headers):
    r = requests.get(f"{BASE_URL}/api/auth/me", headers=admin_headers, timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert body["email"] == ADMIN_EMAIL
    assert body["role"] == "admin"


# ─── cert-kinds catalogue ──────────────────────────────────────
def test_cert_kinds_returns_full_catalogue(admin_headers):
    r = requests.get(f"{BASE_URL}/api/integrations/simpro/workers/cert-kinds",
                     headers=admin_headers, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    rows = data.get("cert_kinds") if isinstance(data, dict) else data
    assert isinstance(rows, list)
    slugs = {r_.get("slug") for r_ in rows}
    assert len(rows) >= 142, f"Expected >=142 cert_kinds, got {len(rows)}"
    for expected in ("white-card", "first-aid", "traffic-control"):
        assert expected in slugs, f"Missing slug {expected}"


def test_cert_kinds_worker_forbidden():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": "worker_stephen@paneltec.com.au", "password": "WorkerTest123!"},
                      timeout=15)
    if r.status_code != 200:
        pytest.skip(f"worker seed not available ({r.status_code})")
    tok = r.json()["access_token"]
    r2 = requests.get(f"{BASE_URL}/api/integrations/simpro/workers/cert-kinds",
                      headers={"Authorization": f"Bearer {tok}"}, timeout=15)
    assert r2.status_code == 403


# ─── accept-suggestions idempotency ────────────────────────────
def test_accept_suggestions_idempotent(admin_headers):
    payload = {"suggestions": [{"slug": PROBE_SLUG, "label": "Probe",
                                "simpro_variants": ["X.pdf"]}]}
    r1 = requests.post(f"{BASE_URL}/api/integrations/simpro/workers/accept-suggestions",
                       json=payload, headers=admin_headers, timeout=30)
    assert r1.status_code == 200, r1.text
    b1 = r1.json()
    assert PROBE_SLUG in b1["created"]
    assert b1["merged"] == []
    assert b1["total"] == 1

    # Verify catalogue insertion
    ck = requests.get(f"{BASE_URL}/api/integrations/simpro/workers/cert-kinds",
                     headers=admin_headers, timeout=30).json()
    rows = ck.get("cert_kinds") if isinstance(ck, dict) else ck
    assert any(r_.get("slug") == PROBE_SLUG for r_ in rows)

    # Second identical call — should merge
    r2 = requests.post(f"{BASE_URL}/api/integrations/simpro/workers/accept-suggestions",
                       json=payload, headers=admin_headers, timeout=30)
    assert r2.status_code == 200, r2.text
    b2 = r2.json()
    assert b2["created"] == []
    assert PROBE_SLUG in b2["merged"]
    assert b2["total"] == 1


def test_zzz_cleanup_probe(admin_headers):
    """Cleanup the probe row directly via mongo."""
    import asyncio
    from motor.motor_asyncio import AsyncIOMotorClient
    async def _clean():
        cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = cli[os.environ["DB_NAME"]]
        await db.cert_kinds.delete_one({"slug": PROBE_SLUG})
        await db.simpro_licence_mapping.delete_one({"cert_kind_slug": PROBE_SLUG})
        cli.close()
    asyncio.get_event_loop().run_until_complete(_clean())


# ─── Unmatched documents triage lifecycle ──────────────────────
def test_unmatched_docs_lifecycle(admin_headers):
    # 1. list
    r = requests.get(f"{BASE_URL}/api/workers/{WORKER_ID}/unmatched-documents",
                     headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    docs = r.json()["documents"]
    ids = [d["id"] for d in docs]
    assert UNMATCHED_DOC_ID in ids, f"Expected doc {UNMATCHED_DOC_ID} in {ids}"

    # 2. stream file
    r2 = requests.get(
        f"{BASE_URL}/api/workers/{WORKER_ID}/unmatched-documents/{UNMATCHED_DOC_ID}/file",
        headers=admin_headers, timeout=30, stream=True)
    assert r2.status_code == 200
    assert r2.headers.get("content-type", "").startswith("application/pdf")
    r2.close()

    # 3. delete (soft)
    r3 = requests.delete(
        f"{BASE_URL}/api/workers/{WORKER_ID}/unmatched-documents/{UNMATCHED_DOC_ID}",
        headers=admin_headers, timeout=15)
    assert r3.status_code == 200
    assert r3.json().get("deleted") is True

    # 4. subsequent list should not contain it
    r4 = requests.get(f"{BASE_URL}/api/workers/{WORKER_ID}/unmatched-documents",
                      headers=admin_headers, timeout=15)
    ids_after = [d["id"] for d in r4.json()["documents"]]
    assert UNMATCHED_DOC_ID not in ids_after


def test_zzz_restore_unmatched_doc():
    """Restore the doc so future runs remain reproducible."""
    import asyncio
    from motor.motor_asyncio import AsyncIOMotorClient
    async def _restore():
        cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = cli[os.environ["DB_NAME"]]
        await db.worker_unmatched_documents.update_one(
            {"id": UNMATCHED_DOC_ID},
            {"$set": {"deleted_at": None, "deleted_by": None, "reviewed": False}})
        cli.close()
    asyncio.get_event_loop().run_until_complete(_restore())


# ─── reclassify + move-to-hr validation (non-destructive) ──────
def test_reclassify_400_on_unknown_slug(admin_headers):
    # First restore the doc so it exists for this test
    import asyncio
    from motor.motor_asyncio import AsyncIOMotorClient
    async def _restore():
        cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = cli[os.environ["DB_NAME"]]
        await db.worker_unmatched_documents.update_one(
            {"id": UNMATCHED_DOC_ID},
            {"$set": {"deleted_at": None, "deleted_by": None, "reviewed": False}})
        cli.close()
    asyncio.get_event_loop().run_until_complete(_restore())

    r = requests.post(
        f"{BASE_URL}/api/workers/{WORKER_ID}/unmatched-documents/{UNMATCHED_DOC_ID}/reclassify",
        json={"cert_kind_slug": "nonexistent-slug-xyz"},
        headers=admin_headers, timeout=15)
    assert r.status_code == 400, r.text


def test_reclassify_404_on_unknown_doc(admin_headers):
    r = requests.post(
        f"{BASE_URL}/api/workers/{WORKER_ID}/unmatched-documents/nonexistent-doc-id/reclassify",
        json={"cert_kind_slug": "white-card"},
        headers=admin_headers, timeout=15)
    assert r.status_code == 404


def test_move_to_hr_404_on_unknown_doc(admin_headers):
    r = requests.post(
        f"{BASE_URL}/api/workers/{WORKER_ID}/unmatched-documents/nonexistent-doc-id/move-to-hr",
        headers=admin_headers, timeout=15)
    assert r.status_code == 404


# ─── Dry-run planning surfaces unmatched_groups ────────────────
def test_dry_run_surfaces_unmatched_groups(admin_headers):
    zip_path = "/tmp/simpro_test/z4.zip"
    if not os.path.exists(zip_path):
        pytest.skip("z4.zip not available")
    with open(zip_path, "rb") as f:
        files = {"file": ("z4.zip", f, "application/zip")}
        r = requests.post(
            f"{BASE_URL}/api/workers/{WORKER_ID}/simpro-zip-import?dry_run=1",
            files=files, headers=admin_headers, timeout=90)
    assert r.status_code == 200, f"{r.status_code} {r.text[:400]}"
    body = r.json()
    for k in ("files", "counts"):
        assert k in body, f"missing {k}"
    # unmatched_groups may be empty if this zip has none; check shape when present
    ug = body.get("unmatched_groups", [])
    assert isinstance(ug, list)
    for g in ug:
        for k in ("suggested_slug", "suggested_label", "confidence",
                  "existing_slug_hit", "count", "sample_filenames",
                  "auto_accept_default"):
            assert k in g, f"unmatched_group missing field {k}: {g}"
        # Verify auto_accept rule: no existing hit AND (count>=3 OR conf>=0.85)
        expected = (g["existing_slug_hit"] is None
                    and (g["count"] >= 3 or g["confidence"] >= 0.85))
        assert g["auto_accept_default"] == expected


# ─── Regression: existing endpoints still work ─────────────────
def test_last_sync(admin_headers):
    r = requests.get(f"{BASE_URL}/api/integrations/simpro/workers/last-sync",
                     headers=admin_headers, timeout=15)
    assert r.status_code == 200


def test_workers_list(admin_headers):
    r = requests.get(f"{BASE_URL}/api/workers", headers=admin_headers, timeout=30)
    assert r.status_code == 200
    body = r.json()
    workers = body if isinstance(body, list) else body.get("workers", [])
    assert isinstance(workers, list)
    assert len(workers) > 0


def test_hr_documents(admin_headers):
    r = requests.get(f"{BASE_URL}/api/workers/{WORKER_ID}/hr-documents",
                     headers=admin_headers, timeout=15)
    assert r.status_code == 200

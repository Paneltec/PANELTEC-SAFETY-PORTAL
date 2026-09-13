"""v58.13.132dv — Bulk archive cleanup + inline delete in Email popup.

Locks:
  1. New `POST /api/org/insurance/{policy_type}/history/clear-all` endpoint.
  2. Bulk endpoint is admin-only (403 for others) + idempotent.
  3. Migration script has the expected shape (default org_id,
     DELETED_BY tag, KINDS tuple, idempotent skip on `deleted_at`).
  4. FE Email popup renders inline trash icon + Clear-all-archived
     button + confirm dialogs for both, and filters soft-deleted
     rows out of the archived list.
  5. Three-way version pin at .132dv.
"""
from __future__ import annotations

import io
import os
import re
from pathlib import Path

import pytest
import requests
from bson import ObjectId
from pymongo import MongoClient

APP_ROOT = Path(__file__).resolve().parents[2]
ORG_MOD = APP_ROOT / "backend" / "org_settings.py"
ORG_JSX = APP_ROOT / "frontend" / "src" / "pages" / "OrgSettings.jsx"
MIGRATION = APP_ROOT / "backend" / "scripts" / "cleanup_test_archives_v58_13_132dv.py"
VERSION_JS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"

API = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
ADMIN_EMAIL = "stephen@paneltec.com.au"
ADMIN_PWD = "Mcgstephen50#"


def _admin_headers():
    r = requests.post(f"{API}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PWD},
                      timeout=30)
    if r.status_code != 200:
        pytest.skip(f"admin login unavailable: {r.status_code}")
    tok = r.json().get("access_token") or r.json().get("token")
    return {"Authorization": f"Bearer {tok}"}


def _db():
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


# ─── Source pins ────────────────────────────────────────────────

def test_backend_clear_all_endpoint_present():
    src = ORG_MOD.read_text(encoding="utf-8")
    assert "132dv" in src
    assert '@router.post("/insurance/{policy_type}/history/clear-all")' in src
    # Admin gate + idempotent skip of already-deleted rows.
    assert '_is_admin(user)' in src
    assert 'not p.get("deleted_at")' in src


def test_migration_script_shape():
    src = MIGRATION.read_text(encoding="utf-8")
    assert "132dv" in src
    # Default org is Stephen's tenant so re-running without --org-id
    # doesn't accidentally target a fresh install.
    assert 'DEFAULT_ORG_ID = "3116f250-a4eb-43f3-98a5-2a3656d6cb63"' in src
    # Audit tag used on every soft-deleted row.
    assert 'DELETED_BY = "migration:v58.13.132dv"' in src
    # All four kinds covered.
    for kind in ("public_liability", "workers_comp",
                 "general_cover", "professional_indemnity"):
        assert f'"{kind}"' in src
    # Idempotent skip.
    assert 'row.get("deleted_at")' in src
    # `--dry-run` flag exists so operators can preview.
    assert '--dry-run' in src


def test_frontend_email_popup_has_inline_delete():
    src = ORG_JSX.read_text(encoding="utf-8")
    assert "132dv" in src
    # Per-row trash button.
    assert "insurance-email-arch-delete-" in src
    # Per-row delete confirm dialog.
    assert 'data-testid="insurance-email-arch-delete-confirm"' in src
    assert 'data-testid="insurance-email-arch-delete-cancel"' in src
    assert 'data-testid="insurance-email-arch-delete-ok"' in src
    # Clear-all-archived button per kind + its confirm.
    assert "insurance-email-clear-archived-" in src
    assert 'data-testid="insurance-email-clear-archived-confirm"' in src
    assert 'data-testid="insurance-email-clear-archived-ok"' in src
    # Soft-deleted rows are filtered out of the archived list —
    # both prior-`deleted_at` and this-session `hiddenCerts`.
    assert "!a.deleted_at" in src
    assert "hiddenCerts" in src


def test_three_way_version_sync_at_132dv():
    running = re.search(r"^export const RUNNING_VERSION = '([^']+)'",
                        VERSION_JS.read_text(), re.MULTILINE).group(1)
    expected = re.search(r"^export const EXPECTED_CACHE_VERSION = '([^']+)'",
                         VERSION_JS.read_text(), re.MULTILINE).group(1)
    cache = re.search(r"^const CACHE_VERSION = '([^']+)'",
                      SW.read_text(), re.MULTILINE).group(1)
    assert running == expected == cache
    tail = re.search(r"132([a-z]+)", running).group(1)
    assert tail >= "dv"


# ─── Behavioural ────────────────────────────────────────────────

def test_clear_all_soft_deletes_and_gridfs_preserved():
    """Seed 2 archived certs on a policy type, call clear-all, verify
    (a) cleared count matches, (b) history endpoint returns empty by
    default, (c) `?include_deleted=true` still returns them with
    deleted_at populated, (d) GridFS blobs untouched.
    Uses `general_cover` since Stephen's org currently has 0 live
    archives there after the .132dv migration."""
    hdr = _admin_headers()
    # Seed two archived certs.
    kind = "general_cover"
    for i in range(2):
        pdf = f"%PDF-1.4\n%dv-clear-{i}\n%%EOF\n".encode()
        r = requests.post(
            f"{API}/api/org/insurance/{kind}/upload",
            files={"file": (f"clear-{i}.pdf", io.BytesIO(pdf),
                             "application/pdf")},
            headers=hdr, timeout=30)
        assert r.status_code == 200, r.text

    hist_before = requests.get(
        f"{API}/api/org/insurance/{kind}/history",
        headers=hdr, timeout=30).json()
    n_before = hist_before.get("total") or 0
    assert n_before >= 1, "expected at least 1 live archive after upload"

    # Capture ids so we can prove GridFS preservation.
    live_ids = [r["certificate_id"] for r in hist_before["items"]
                if not r.get("deleted_at")]

    cr = requests.post(
        f"{API}/api/org/insurance/{kind}/history/clear-all",
        headers=hdr, timeout=30)
    assert cr.status_code == 200, cr.text
    body = cr.json()
    assert body.get("ok") is True
    assert body.get("cleared") >= 1

    # Default view is now empty.
    hist_after = requests.get(
        f"{API}/api/org/insurance/{kind}/history",
        headers=hdr, timeout=30).json()
    assert hist_after.get("total") == 0

    # include_deleted=true surfaces them again with deleted_at.
    hist_all = requests.get(
        f"{API}/api/org/insurance/{kind}/history",
        params={"include_deleted": "true"},
        headers=hdr, timeout=30).json()
    ids_all = {r["certificate_id"] for r in hist_all["items"]}
    for lid in live_ids:
        assert lid in ids_all
        row = next(r for r in hist_all["items"]
                   if r["certificate_id"] == lid)
        assert row.get("deleted_at")

    # GridFS blob preserved.
    db = _db()
    for lid in live_ids:
        assert db.fs.files.find_one({"_id": ObjectId(lid)}) is not None

    # Idempotent re-run: cleared count is 0.
    cr2 = requests.post(
        f"{API}/api/org/insurance/{kind}/history/clear-all",
        headers=hdr, timeout=30)
    assert cr2.status_code == 200
    assert cr2.json().get("cleared") == 0


def test_clear_all_admin_only():
    """Unauth'd request must be rejected."""
    r = requests.post(
        f"{API}/api/org/insurance/public_liability/history/clear-all",
        timeout=15)
    assert r.status_code in (401, 403)


def test_migration_soft_deleted_stephen_org():
    """After running the .132dv migration, Stephen's org has 0 live
    archived certs across all 4 policy types. Behavioural lock on
    the applied state — proves the migration actually ran + persisted
    the deleted_at flag."""
    hdr = _admin_headers()
    for kind in ("public_liability", "workers_comp",
                 "general_cover", "professional_indemnity"):
        r = requests.get(
            f"{API}/api/org/insurance/{kind}/history",
            headers=hdr, timeout=30).json()
        assert r.get("total") == 0, \
            f"{kind}: expected 0 live archives after migration, got {r.get('total')}"
        # But include_deleted returns the rows with the migration tag.
        r_all = requests.get(
            f"{API}/api/org/insurance/{kind}/history",
            params={"include_deleted": "true"},
            headers=hdr, timeout=30).json()
        for row in r_all.get("items", []):
            if row.get("deleted_at"):
                # Tag is either "migration:v58.13.132dv" (migration)
                # or a user_id (admin-triggered soft-delete). Accept
                # both — presence of `deleted_at` is what matters.
                assert row.get("deleted_by") is not None

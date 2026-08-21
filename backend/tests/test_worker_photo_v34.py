"""v160.3.9.34 — Worker photo upload / delete tests.

Ephemeral-worker fixture pattern so no production worker is ever mutated.
"""
# v58.13.21 — Module-scoped `live_db_writes` opt-in.
# v58.13.22 — Conftest guard hardened to respect this module-level
# marker in BOTH setup and teardown paths of module-scoped fixtures
# (ephemeral_admin, eph_worker), so the in-file session-scoped
# workaround from v58.13.21 is no longer needed. The `pytestmark`
# below is all that's required.
import io
import uuid
import requests

import pytest

pytestmark = pytest.mark.live_db_writes


from .conftest import API, _login


def _hdr(t):
    return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


def _jpeg_bytes(color="steelblue", size=(400, 300)):
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", size, color=color).save(buf, format="JPEG")
    return buf.getvalue()


# (pytest imported at module top for the `live_db_writes` marker.)


@pytest.fixture
def eph_worker(_mongo, ephemeral_admin):
    """Seed one ephemeral worker in Stephen's org and delete on teardown."""
    org_id = _mongo.users.find_one(
        {"id": ephemeral_admin["id"]}, {"_id": 0, "org_id": 1})["org_id"]
    wid = str(uuid.uuid4())
    doc = {
        "id": wid, "org_id": org_id,
        "first_name": "Photo", "last_name": f"Test {wid[:6]}",
        "email": f"__phase4d_photo_worker_{wid[:8]}@paneltec.internal",
        "created_at": "2026-08-01T00:00:00+00:00",
        "created_by": "pytest",
        "deleted_at": None,
    }
    _mongo.workers.insert_one(doc)
    yield doc
    _mongo.workers.delete_one({"id": wid})


# ─── 1. valid JPEG upload ─────────────────────────────────────────────

def test_upload_valid_jpeg_returns_200_and_updates_worker(
    ephemeral_admin, eph_worker
):
    tok = ephemeral_admin["token"]
    r = requests.post(
        f"{API}/workers/{eph_worker['id']}/photo",
        headers={"Authorization": f"Bearer {tok}"},
        files={"file": ("headshot.jpg", _jpeg_bytes(), "image/jpeg")},
        timeout=20,
    )
    assert r.status_code == 200, r.text[:300]
    body = r.json()
    assert body["photo_url"].startswith(f"/api/workers/{eph_worker['id']}/photo/")
    assert body["photo_gridfs_id"]
    # v58.13.22 — Cleanup the uploaded GridFS blob so the module
    # session leaves bk_fs.files at baseline.
    requests.delete(f"{API}/workers/{eph_worker['id']}/photo",
                    headers=_hdr(tok), timeout=10)


# ─── 2. Wrong MIME → 415 ──────────────────────────────────────────────

def test_upload_text_file_returns_415(ephemeral_admin, eph_worker):
    tok = ephemeral_admin["token"]
    r = requests.post(
        f"{API}/workers/{eph_worker['id']}/photo",
        headers={"Authorization": f"Bearer {tok}"},
        files={"file": ("notimg.txt", b"not an image", "text/plain")},
        timeout=10,
    )
    assert r.status_code == 415


# ─── 3. Oversized upload → 413 ────────────────────────────────────────

def test_upload_oversized_returns_413(ephemeral_admin, eph_worker):
    tok = ephemeral_admin["token"]
    payload = b"\xff\xd8\xff\xe0" + b"\x00" * (11 * 1024 * 1024)   # 11MB, JPEG magic
    r = requests.post(
        f"{API}/workers/{eph_worker['id']}/photo",
        headers={"Authorization": f"Bearer {tok}"},
        files={"file": ("huge.jpg", payload, "image/jpeg")},
        timeout=20,
    )
    assert r.status_code == 413


# ─── 4. Delete → 200 + fields cleared ────────────────────────────────

def test_delete_photo_clears_fields(ephemeral_admin, eph_worker):
    tok = ephemeral_admin["token"]
    # First upload one so there's something to delete.
    up = requests.post(
        f"{API}/workers/{eph_worker['id']}/photo",
        headers={"Authorization": f"Bearer {tok}"},
        files={"file": ("h.jpg", _jpeg_bytes(), "image/jpeg")},
        timeout=15,
    )
    assert up.status_code == 200
    r = requests.delete(f"{API}/workers/{eph_worker['id']}/photo",
                        headers=_hdr(tok), timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert body["photo_url"] in (None, "")
    assert body["photo_gridfs_id"] in (None, "")


# ─── 5. Non-admin → 403 ──────────────────────────────────────────────

def test_upload_as_worker_role_forbidden(eph_worker):
    try:
        wtok = _login("worker-fixture@paneltec.com.au", "WorkerFixture123!")
    except AssertionError:
        pytest.skip("worker fixture unavailable"); return
    r = requests.post(
        f"{API}/workers/{eph_worker['id']}/photo",
        headers={"Authorization": f"Bearer {wtok}"},
        files={"file": ("h.jpg", _jpeg_bytes(), "image/jpeg")},
        timeout=10,
    )
    assert r.status_code == 403


# ─── 6. Cross-org worker → 404 ───────────────────────────────────────

def test_upload_for_nonexistent_worker_returns_404(ephemeral_admin):
    tok = ephemeral_admin["token"]
    r = requests.post(
        f"{API}/workers/nonexistent-worker-{uuid.uuid4()}/photo",
        headers={"Authorization": f"Bearer {tok}"},
        files={"file": ("h.jpg", _jpeg_bytes(), "image/jpeg")},
        timeout=10,
    )
    assert r.status_code == 404


# ─── 7. Zero-orphan invariant on replace ─────────────────────────────

def test_replace_photo_deletes_old_gridfs_blob(
    _mongo, ephemeral_admin, eph_worker
):
    """After replacing a photo, GridFS must contain exactly ONE blob for
    this worker (the new one). The old blob MUST be deleted."""
    tok = ephemeral_admin["token"]
    # First upload.
    r1 = requests.post(f"{API}/workers/{eph_worker['id']}/photo",
                       headers={"Authorization": f"Bearer {tok}"},
                       files={"file": ("a.jpg", _jpeg_bytes(color="red"), "image/jpeg")},
                       timeout=15)
    assert r1.status_code == 200
    gid1 = r1.json()["photo_gridfs_id"]
    # Second upload replaces.
    r2 = requests.post(f"{API}/workers/{eph_worker['id']}/photo",
                       headers={"Authorization": f"Bearer {tok}"},
                       files={"file": ("b.jpg", _jpeg_bytes(color="green"), "image/jpeg")},
                       timeout=15)
    assert r2.status_code == 200
    gid2 = r2.json()["photo_gridfs_id"]
    assert gid1 != gid2, "second upload should produce a new blob id"
    # Assert old blob is gone.
    from bson import ObjectId
    # v58.13.22 — workers.py stores photos in the `bk_fs` GridFS
    # bucket (co-tenanted with backup snapshots since the v58.13-era
    # bucket consolidation). The test previously queried the default
    # `fs.files` bucket and always returned None for both assertions
    # → falsely passed the "old gone" check while silently missing
    # the "new present" check. Now correctly targeting `bk_fs.files`.
    fs_files = _mongo["bk_fs.files"]
    assert fs_files.find_one({"_id": ObjectId(gid1)}) is None, (
        "OLD GridFS blob still present after replace — orphan leak"
    )
    assert fs_files.find_one({"_id": ObjectId(gid2)}) is not None
    # Cleanup — delete second blob.
    requests.delete(f"{API}/workers/{eph_worker['id']}/photo",
                    headers=_hdr(tok), timeout=10)


# ─── 8. Users list photo-join sees the newly uploaded photo ──────────

def test_users_list_reflects_worker_photo_after_upload(
    _mongo, ephemeral_admin, eph_worker
):
    """Upload a photo on a worker linked to a user by simpro_employee_id.
    GET /users must return that photo_url on the linked user."""
    tok = ephemeral_admin["token"]
    org_id = _mongo.users.find_one(
        {"id": ephemeral_admin["id"]}, {"_id": 0, "org_id": 1})["org_id"]
    # Link the ephemeral worker to a fresh ephemeral user by simpro_employee_id.
    sid = f"EPH-photojoin-{uuid.uuid4().hex[:6]}"
    _mongo.workers.update_one({"id": eph_worker["id"]},
                                {"$set": {"simpro_employee_id": sid}})
    uid = str(uuid.uuid4())
    email = f"__photojoin_{uid[:8]}@paneltec.internal"
    _mongo.users.insert_one({
        "id": uid, "org_id": org_id, "email": email,
        "name": "PhotoJoin Test", "role": "general_user",
        "role_id": "general_user", "status": "active",
        "activation_status": "active",
        "simpro_employee_id": sid,
        "created_at": "2026-08-01T00:00:00+00:00",
        "created_by": "pytest", "token_version": 0, "workspace_ids": [],
    })
    try:
        up = requests.post(
            f"{API}/workers/{eph_worker['id']}/photo",
            headers={"Authorization": f"Bearer {tok}"},
            files={"file": ("h.jpg", _jpeg_bytes(), "image/jpeg")},
            timeout=15,
        )
        assert up.status_code == 200
        worker_photo_url = up.json()["photo_url"]
        # Now GET /users and confirm the join surfaces it.
        rows = requests.get(f"{API}/users?hide_test=false",
                            headers=_hdr(tok), timeout=10).json()
        target = [r for r in rows if r["id"] == uid][0]
        assert target["photo_url"] == worker_photo_url, (
            f"users-list photo-join failed: expected {worker_photo_url}, "
            f"got {target.get('photo_url')}"
        )
        # v58.13.22 — Cleanup the uploaded GridFS blob so the module
        # session leaves bk_fs.files at baseline.
        requests.delete(f"{API}/workers/{eph_worker['id']}/photo",
                        headers=_hdr(tok), timeout=10)
    finally:
        _mongo.users.delete_one({"id": uid})


# ─── 9. Login regression ─────────────────────────────────────────────

def test_login_regression_admin_still_authenticates():
    from .conftest import ADMIN_EMAIL, ADMIN_PWD
    r = requests.post(f"{API}/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PWD},
                      timeout=10)
    assert r.status_code == 200, f"REGRESSION HTTP={r.status_code} {r.text[:200]}"

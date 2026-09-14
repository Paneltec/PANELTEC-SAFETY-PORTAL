"""v58.13.132gh — Object-storage migration wave 3.

Migrates SWMS scans, worker cert / induction uploads, and the
hazard-vision endpoint from ephemeral pod disk to the shared
`uploads_storage` GridFS bucket. Reads prefer GridFS, fall back to
disk for pre-migration files. Serve-side readers on
`backend/dashboard.py` are swapped from the sync `_serve` to the
GridFS-first `_serve_async`.

Source pins + a behavioural round-trip against the worker-cert
upload path (the only endpoint whose curl round-trip stays cheap
without a real SWMS scan / hazard image).
"""
from __future__ import annotations

import re
import uuid
from pathlib import Path

import pytest
import requests

from tests.conftest import ADMIN_EMAIL, ADMIN_PWD, API

pytestmark = pytest.mark.live_db_writes

APP_ROOT = Path(__file__).resolve().parents[2]
BE = APP_ROOT / "backend"
FRONTEND = APP_ROOT / "frontend"

WC = BE / "worker_certifications.py"
WI = BE / "workers_inductions.py"
SWMS = BE / "swms_phase45.py"
AI = BE / "ai.py"
DASH = BE / "dashboard.py"
MIGRATE = APP_ROOT / "scripts" / "migrate_ephemeral_to_gridfs.py"
VERSION_JS = FRONTEND / "src" / "lib" / "version.js"
SW = FRONTEND / "public" / "service-worker.js"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def _login() -> dict:
    r = requests.post(
        f"{API}/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PWD},
        timeout=30,
    )
    if r.status_code == 429:
        pytest.skip("rate-limited")
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


# ─── Source pins ───────────────────────────────────────────────


def test_worker_certifications_both_upload_sites_use_gridfs():
    src = _read(WC)
    # Neither the old create-cert upload nor the new attach-cert upload
    # may still write to pod disk.
    assert 'target.open("wb")' not in src, (
        "worker_certifications must have no local-disk writes left")
    assert "folder_dir.mkdir" not in src, (
        "worker_certifications no longer needs folder_dir.mkdir")
    # Both save_upload sites present with the shared document_library
    # subdir so `_serve_async` picks them up.
    save_hits = re.findall(
        r'"document_library",\s*\[sub_folder\["id"\],\s*stored_name\]',
        src,
    )
    assert len(save_hits) == 2, (
        f"expected 2 save_upload sites in worker_certifications, "
        f"found {len(save_hits)}")
    assert 'module="worker_certifications"' in src


def test_workers_inductions_upload_uses_gridfs():
    src = _read(WI)
    assert 'target.open("wb")' not in src, (
        "workers_inductions must have no local-disk writes left")
    assert "folder_dir.mkdir" not in src
    assert '"document_library", [sub_folder["id"], stored_name]' in src
    assert 'module="workers_inductions"' in src


def test_swms_phase45_scan_uses_gridfs_with_tempfile_for_ocr():
    src = _read(SWMS)
    # The old scan-root disk write must be gone.
    assert 'scan_root = Path(__file__).parent / "uploads"' not in src, (
        "old scan_root disk write must be removed")
    assert 'SCAN_DIR_NAME, [stored_name], data' in src
    assert 'SCAN_DIR_NAME = "swms_scans"' in src
    # OCR toolchain still needs a real path — short-lived NamedTemporaryFile
    # is the documented exception (see task 2 note in intake analysis).
    assert "NamedTemporaryFile" in src
    assert 'module="swms_phase45"' in src


def test_ai_hazard_vision_uses_gridfs():
    src = _read(AI)
    # Old disk write is gone.
    assert "save_path.write_bytes(raw)" not in src, (
        "hazard-vision disk write must be removed")
    assert '"hazards", [name], raw' in src
    assert 'module="hazards"' in src


def test_dashboard_serves_migrated_subdirs_via_serve_async():
    src = _read(DASH)
    for subdir in ("hazards", "document_library",
                   "form_photos", "swms_scans"):
        # There is exactly one file-serve route per subdir; each must
        # use the GridFS-first async reader post-.132gh.
        pat = re.compile(
            rf'await _serve_async\("{subdir}"',
        )
        assert pat.search(src), (
            f"dashboard serve for {subdir} must use _serve_async")


def test_migration_script_tracks_new_subdirs():
    src = _read(MIGRATE)
    for subdir in ("swms_scans", "hazards"):
        assert f'"{subdir}"' in src, (
            f"migration script missing {subdir} in MIGRATED_MODULES")


# ─── Behavioural: attach-cert file → GridFS blob → download ───


def test_attach_cert_upload_writes_to_gridfs_not_disk():
    h = _login()

    # Find (or create) a worker + a cert row we can attach to.
    workers = requests.get(f"{API}/workers", headers=h, timeout=15)
    if workers.status_code != 200 or not workers.json():
        pytest.skip("no workers to test against")
    # Pick the first live worker.
    worker = next((w for w in workers.json() if w.get("id")), None)
    if not worker:
        pytest.skip("no live worker rows")
    wid = worker["id"]

    # Find any existing cert row for this worker, else create one.
    certs = requests.get(
        f"{API}/workers/{wid}/certifications", headers=h, timeout=15,
    )
    cert_id = None
    if certs.status_code == 200 and certs.json():
        cert_id = certs.json()[0]["id"]
    else:
        stamp = uuid.uuid4().hex[:8]
        make = requests.post(
            f"{API}/workers/{wid}/certifications",
            headers=h, timeout=15,
            json={"name": f"gh-probe-{stamp}"},
        )
        if make.status_code not in (200, 201):
            pytest.skip(f"could not create probe cert: {make.text[:120]}")
        cert_id = make.json()["id"]

    stamp = uuid.uuid4().hex[:8]
    body = f"gh-{stamp}".encode()
    upload = requests.post(
        f"{API}/workers/{wid}/certifications/{cert_id}/upload",
        headers=h, timeout=30,
        files={"file": (f"gh-{stamp}.txt", body, "text/plain")},
    )
    if upload.status_code == 400 and "Unsupported file type" in upload.text:
        # Extension whitelist doesn't include .txt on this pod build;
        # use a .csv (guaranteed via _safe_ext).
        upload = requests.post(
            f"{API}/workers/{wid}/certifications/{cert_id}/upload",
            headers=h, timeout=30,
            files={"file": (f"gh-{stamp}.csv", body, "text/csv")},
        )
    assert upload.status_code in (200, 201), upload.text
    payload = upload.json()
    file_meta = payload["file"]
    file_url = file_meta["file_url"]  # /api/files/document_library/<folder>/<stored>

    # Confirm GridFS holds the blob for this stored_name.
    import os
    import motor.motor_asyncio as motor
    import asyncio

    async def _find():
        client = motor.AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        row = await db.upload_storage.files.find_one(
            {"metadata.module": "worker_certifications",
             "metadata.parts.1": file_url.split("/")[-1]},
        )
        client.close()
        return row

    row = asyncio.get_event_loop().run_until_complete(_find())
    assert row is not None, (
        "attached cert file missing from GridFS bucket after .132gh")
    assert row["metadata"]["subdir"] == "document_library"

    # Download round-trip via the doc-library file id.
    fid = file_meta["id"]
    dl = requests.get(
        f"{API}/document-library/files/{fid}/download",
        headers=h, params={"download": 1}, timeout=30,
    )
    assert dl.status_code == 200, dl.text
    assert dl.content == body, "downloaded bytes must match uploaded bytes"


# ─── Version lockstep ─────────────────────────────────────────


def test_version_bumped_to_132gh():
    js = _read(VERSION_JS)
    sw = _read(SW)
    assert re.search(r"RUNNING_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gh'", js)
    assert re.search(r"EXPECTED_CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gh'", js)
    assert re.search(r"CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gh'", sw)


# ─── Admin missing-files surface (incident response) ─────────


def test_admin_missing_files_scan_returns_grouped_orphans():
    h = _login()
    r = requests.get(f"{API}/admin/missing-files/scan", headers=h, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body.keys()) >= {"total", "by_kind", "items"}
    assert isinstance(body["total"], int)
    # Every item must carry the reupload wiring.
    for item in body["items"]:
        assert "parent_kind" in item
        assert "reupload_endpoint" in item
        assert item.get("reason") in ("missing_source", "missing_metadata")


def test_admin_missing_files_scan_is_admin_only():
    # Anonymous → 401 / 403.
    r = requests.get(f"{API}/admin/missing-files/scan", timeout=15)
    assert r.status_code in (401, 403), r.status_code

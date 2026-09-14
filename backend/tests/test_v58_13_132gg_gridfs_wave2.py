"""v58.13.132gg — Object-storage migration wave 2.

Migrates document_library, forms (attachments + photos), and
asset_service (schedule attachments) to the `.132gf` shared
`uploads_storage` helper. Reads prefer GridFS, fall back to disk
for pre-migration files.
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

DOC_LIB = BE / "document_library.py"
FORMS = BE / "forms.py"
ASSETS = BE / "asset_service.py"
MIGRATE = APP_ROOT / "scripts" / "migrate_ephemeral_to_gridfs.py"
VERSION_JS = FRONTEND / "src" / "lib" / "version.js"
SW = FRONTEND / "public" / "service-worker.js"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def _login() -> dict:
    r = requests.post(f"{API}/auth/login",
                        json={"email": ADMIN_EMAIL, "password": ADMIN_PWD},
                        timeout=30)
    if r.status_code == 429:
        pytest.skip("rate-limited")
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


# ─── Source pins ───────────────────────────────────────────────

def test_doc_library_upload_uses_gridfs():
    src = _read(DOC_LIB)
    assert "target.open(\"wb\")" not in src, (
        "old local-disk write must be gone")
    assert "from uploads_storage import save_upload" in src
    assert '"document_library", [folder["id"], stored_name], data' in src


def test_doc_library_download_prefers_gridfs():
    src = _read(DOC_LIB)
    assert 'read_upload("document_library"' in src
    assert 'return Response(content=data' in src
    # Disk fallback retained.
    assert 'path = UPLOAD_DIR / doc["folder_id"]' in src


def test_forms_attachments_and_photos_use_gridfs():
    src = _read(FORMS)
    # No more disk writes.
    assert "dest.write_bytes(data)" not in src
    assert "target_path.open(\"wb\")" not in src
    # Both save_upload sites present with the right subdirs.
    assert '"form_attachments", [submission_id, stored_name], data' in src
    assert '"form_photos", [submission_id, stored_name]' in src
    # Both download surfaces read GridFS first.
    assert 'read_upload("form_attachments"' in src
    assert 'read_upload("form_photos"' in src


def test_asset_service_schedule_attachments_use_gridfs():
    src = _read(ASSETS)
    assert '(dest_dir / stored_name).write_bytes(data)' not in src
    assert '"schedule_attachments", [sid, stored_name], data' in src
    assert 'read_upload("schedule_attachments"' in src


def test_migration_script_tracks_new_subdirs():
    src = _read(MIGRATE)
    for subdir in ("document_library", "form_attachments",
                     "form_photos", "schedule_attachments"):
        assert f'"{subdir}"' in src, (
            f"migration script missing {subdir} in MIGRATED_MODULES")


# ─── Behavioural: doc-library upload/download round-trip ──────

def test_doc_library_upload_writes_to_gridfs_not_disk():
    h = _login()
    r = requests.get(f"{API}/document-library/folders",
                        headers=h, timeout=15)
    if r.status_code != 200 or not r.json():
        pytest.skip("no folders")
    folder_id = r.json()[0]["id"]
    stamp = uuid.uuid4().hex[:8]
    body = f"gg-{stamp}".encode()
    upload = requests.post(
        f"{API}/document-library/folders/{folder_id}/files",
        headers=h, timeout=30,
        files={"files": (f"gg-{stamp}.txt", body, "text/plain")},
    )
    assert upload.status_code in (200, 201), upload.text
    saved = upload.json().get("saved") or []
    assert saved, upload.json()
    file_id = saved[0]["id"]

    # Confirm GridFS holds the blob for this stored_name.
    import os
    import motor.motor_asyncio as motor
    import asyncio

    async def _find():
        client = motor.AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        row = await db.upload_storage.files.find_one(
            {"metadata.module": "document_library",
             "metadata.parts.1": saved[0]["file_url"].split("/")[-1]},
        )
        client.close()
        return row
    row = asyncio.get_event_loop().run_until_complete(_find())
    assert row is not None, (
        "uploaded doc-library file missing from GridFS bucket")
    assert row["metadata"]["orig_filename"] == f"gg-{stamp}.txt"

    # Round-trip: `?download=1` streams the same bytes back.
    dl = requests.get(
        f"{API}/document-library/files/{file_id}/download",
        headers=h, params={"download": 1}, timeout=30,
    )
    assert dl.status_code == 200, dl.text
    assert dl.content == body


# ─── Version lockstep ─────────────────────────────────────────

def test_version_bumped_to_132gg():
    js = _read(VERSION_JS)
    sw = _read(SW)
    assert re.search(r"RUNNING_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gg'", js)
    assert re.search(r"EXPECTED_CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gg'", js)
    assert re.search(r"CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gg'", sw)

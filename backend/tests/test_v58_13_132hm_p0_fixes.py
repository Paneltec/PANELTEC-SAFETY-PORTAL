"""v58.13.132hm — P0 bug fixes.

Two independent P0 bugs resolved in one ship:

1. Session-timeout PATCH returns 422 for `minutes: 10080` because
   the Pydantic validator was gated at `le=1440` while the FE
   `TIMEOUT_OPTIONS` in `TopbarPills.jsx` offers a "7 days · extended"
   preset (= 10080 min). Selecting it fired the FE `saveTimeout`
   handler, caught the 422 and surfaced Mel's "Could not save"
   toast. Fix: raise `le` to 10080.

2. Folder delete only soft-deleted the target folder and its
   DIRECT files. Subfolders and their files were left active with
   a `parent_folder_id` pointing at a now-deleted parent — orphan
   data that no longer surfaced in the tree but still consumed
   rows in `/folders/all`. Fix: BFS the descendant subtree and
   soft-delete every folder + every file whose folder_id lands in
   that subtree.
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
DL_BE = APP_ROOT / "backend" / "document_library.py"
ST_BE = APP_ROOT / "backend" / "session_timeout.py"
VJS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


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


# ─────────────── Session timeout ───────────────


def test_session_timeout_validator_accepts_7_days():
    src = _read(ST_BE)
    # New cap.
    assert "le=10080" in src, "UserTimeoutIn should cap at 10080 (7 days)"
    # Old cap gone from the UserTimeoutIn model.
    assert not re.search(r"minutes: int = Field\(\.\.\., ge=5, le=1440\)", src)


def test_session_timeout_patch_accepts_10080_live():
    h = _login()
    r = requests.patch(
        f"{API}/settings/session-timeout/me",
        json={"minutes": 10080},
        headers=h,
        timeout=15,
    )
    assert r.status_code == 200, r.text
    assert r.json().get("effective_minutes") == 10080


def test_session_timeout_patch_rejects_above_7_days():
    h = _login()
    r = requests.patch(
        f"{API}/settings/session-timeout/me",
        json={"minutes": 10081},
        headers=h,
        timeout=15,
    )
    assert r.status_code == 422


# ─────────────── Folder cascade ───────────────


def test_delete_folder_source_pins_bfs_cascade():
    src = _read(DL_BE)
    # Signature marker + the BFS loop over descendant folders.
    assert "v58.13.132hm — Recursive cascade" in src
    assert "frontier: list = [folder_id]" in src
    assert '"parent_folder_id": {"$in": frontier}' in src
    # Bulk update instead of the two prior single-target updates.
    assert (
        'await db.doc_folders.update_many(\n        {"id": {"$in": to_delete}'
        in src
    )
    assert (
        'await db.doc_files.update_many(\n        {"folder_id": {"$in": to_delete}'
        in src
    )
    # The old single-folder soft-delete line is gone.
    assert (
        'await db.doc_folders.update_one(\n        {"id": folder_id, "org_id": user["org_id"]},\n        {"$set": {"deleted_at": ts, "updated_at": ts}},\n    )'
        not in src
    )


def _post_folder(h: dict, name: str, parent: str | None = None) -> str:
    body: dict = {"name": name}
    if parent:
        body["parent_folder_id"] = parent
    r = requests.post(
        f"{API}/document-library/folders", json=body, headers=h, timeout=15
    )
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def test_delete_folder_cascades_to_grandchildren_live():
    """Two-level tree, delete root → both children gone from /folders/all."""
    h = _login()
    stamp = uuid.uuid4().hex[:6]
    root = _post_folder(h, f"hm-root-{stamp}")
    child = _post_folder(h, f"hm-child-{stamp}", parent=root)
    grandchild = _post_folder(h, f"hm-gc-{stamp}", parent=child)

    d = requests.delete(
        f"{API}/document-library/folders/{root}", headers=h, timeout=15
    )
    assert d.status_code in (200, 204), d.text

    all_rows = requests.get(
        f"{API}/document-library/folders/all", headers=h, timeout=15
    ).json()
    ids = {row["id"] for row in all_rows}
    assert root not in ids, "root still present after delete"
    assert child not in ids, "child NOT cascaded (bug)"
    assert grandchild not in ids, "grandchild NOT cascaded (bug)"


def test_delete_leaf_folder_still_works_live():
    """No descendants → still succeeds, only self is removed."""
    h = _login()
    stamp = uuid.uuid4().hex[:6]
    fid = _post_folder(h, f"hm-leaf-{stamp}")
    d = requests.delete(
        f"{API}/document-library/folders/{fid}", headers=h, timeout=15
    )
    assert d.status_code in (200, 204), d.text
    all_rows = requests.get(
        f"{API}/document-library/folders/all", headers=h, timeout=15
    ).json()
    assert fid not in {row["id"] for row in all_rows}


# ─────────────── Version lockstep ───────────────


def test_version_bumped_to_132hm():
    js, sw = _read(VJS), _read(SW)
    assert re.search(
        r"RUNNING_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132hm'", js
    )
    assert re.search(
        r"EXPECTED_CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132hm'", js
    )
    assert re.search(r"CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132hm'", sw)

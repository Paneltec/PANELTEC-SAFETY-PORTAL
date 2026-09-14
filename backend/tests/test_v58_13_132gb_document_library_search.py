"""v58.13.132gb — Document Library search enhancements.

Backend:
  · GET /api/document-library/search now accepts `folder_id` (optional)
    and `recursive=true` (default) query params.
  · Matches on filename + AI tags + `uploaded_by_name` (new — the
    third field per Stephen's brief).
  · Returns `folder_path` (breadcrumb) + `match_field` marker for
    each hit.
  · Case-insensitive substring; up to 60 results.

Frontend:
  · Global Smart Search on `/document-library` groups results by
    folder; click navigates to `/document-library/<id>?highlight=<file_id>`.
  · Per-folder search on `/document-library/<id>` (recursive against
    subfolders) filters the file list live.
  · `?highlight=<file_id>` on the folder page pulses the target row
    amber for 2 s via `.g132gb-highlight-row` in `index.css`.
"""
from __future__ import annotations

import os
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
DOC_LIB_BE = BE / "document_library.py"
DOC_LIB_FE = FRONTEND / "src" / "pages" / "DocumentLibrary.jsx"
INDEX_CSS = FRONTEND / "src" / "index.css"
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


def _list_folders(h: dict) -> list[dict]:
    r = requests.get(f"{API}/document-library/folders",
                       headers=h, timeout=15)
    r.raise_for_status()
    return r.json()


def _create_folder(h: dict, name: str,
                     parent_id: str | None = None) -> str:
    if parent_id is None:
        r = requests.post(f"{API}/document-library/folders",
                            headers={**h, "Content-Type": "application/json"},
                            json={"name": name}, timeout=15)
        assert r.status_code == 201, r.text
        return r.json()["id"]
    # Subfolders can only be created via the per-worker cert upload
    # flow in prod; for isolated backend tests we insert directly.
    import pymongo
    from datetime import datetime, timezone

    me = requests.get(f"{API}/auth/me", headers=h, timeout=15)
    me.raise_for_status()
    client = pymongo.MongoClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    fid = uuid.uuid4().hex
    db.doc_folders.insert_one({
        "id": fid,
        "org_id": me.json()["org_id"],
        "name": name,
        "color_key": "sky",
        "sort_order": 999999,
        "is_system": False,
        "parent_folder_id": parent_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "created_by": me.json().get("id"),
        "deleted_at": None,
    })
    client.close()
    return fid


def _delete_folder(h: dict, fid: str) -> None:
    # Hard-delete directly to bypass "folder not empty" guards from
    # the API delete endpoint (subfolder rows created via Mongo are
    # already file-less by the time we reach here in tests).
    try:
        import pymongo
        client = pymongo.MongoClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        db.doc_folders.delete_one({"id": fid})
        client.close()
    except Exception: pass


def _upload_file(h: dict, folder_id: str, filename: str,
                  content: bytes = b"hello world") -> str:
    files = {"files": (filename, content, "text/plain")}
    r = requests.post(
        f"{API}/document-library/folders/{folder_id}/files",
        headers=h, files=files, timeout=30,
    )
    assert r.status_code == 201, r.text
    saved = r.json().get("saved") or []
    assert saved, f"upload rejected: {r.json()}"
    return saved[0]["id"]


def _delete_file(h: dict, fid: str) -> None:
    try: requests.delete(f"{API}/document-library/files/{fid}",
                            headers=h, timeout=10)
    except Exception: pass


# ─── Source pins ───────────────────────────────────────────────

def test_backend_search_accepts_new_params():
    src = _read(DOC_LIB_BE)
    # Signature carries the new params.
    assert "folder_id: Optional[str] = None" in src
    assert "recursive: bool = True" in src
    # Uploader name is now part of the $or match.
    assert '{"uploaded_by_name": {"$regex": pattern, "$options": "i"}}' in src


def test_backend_search_returns_folder_path_and_match_field():
    src = _read(DOC_LIB_BE)
    assert '"folder_path": await _folder_path(f["folder_id"])' in src
    assert '"match_field": _match_field(f)' in src
    # Match field derivation checks filename → tags → uploader.
    assert 'return "filename"' in src
    assert 'return "tags"' in src
    assert 'return "uploader"' in src


def test_backend_search_recursive_bfs_descent():
    src = _read(DOC_LIB_BE)
    # BFS with a depth guard so a pathological cycle can't infinite-loop.
    assert "for _ in range(20):" in src
    assert '"parent_folder_id": {"$in": frontier}' in src


def test_frontend_folder_page_carries_per_folder_search():
    src = _read(DOC_LIB_FE)
    assert 'data-testid="folder-search-input"' in src
    assert 'data-testid="folder-search-clear"' in src
    # Debounced search effect hits the same /search endpoint with
    # folder_id + recursive:true params.
    assert "folder_id: folderId" in src
    assert "recursive: 'true'" in src
    # Search-active tbody swap.
    assert "folderSearchResults" in src
    assert "'SEARCH'" in src
    # Cross-subfolder path hint on rows that don't belong to this folder.
    assert 'data-testid={`file-subfolder-path-${f.id}`}' in src


def test_frontend_global_search_groups_by_folder_and_deep_links():
    src = _read(DOC_LIB_FE)
    assert "groupedSearchResults" in src
    assert 'data-testid="smart-search-groups"' in src
    # Deep-link pattern with highlight query.
    assert '?highlight=${r.file_id || r.id}' in src
    # Match-field pill per row.
    assert 'data-testid={`smart-search-match-field-${r.file_id || r.id}`}' in src


def test_frontend_highlight_amber_pulse_present():
    src = _read(INDEX_CSS)
    assert "@keyframes g132gb-highlight-fade-kf" in src
    assert "tr.g132gb-highlight-row" in src
    assert "animation: g132gb-highlight-fade-kf 2s" in src


def test_frontend_highlight_effect_wired_into_folder_page():
    src = _read(DOC_LIB_FE)
    assert "const highlightFileId = searchParams.get('highlight')" in src
    assert "setHighlightActive(highlightFileId)" in src
    assert "scrollIntoView({ behavior: 'smooth', block: 'center' })" in src
    # 2 s clear timer (accept 2000-2300 range for future tuning).
    assert re.search(r"setHighlightActive\(''\)\s*,\s*2\d{3}\s*\)", src)


# ─── Behavioural: live backend ────────────────────────────────

def _drug_folder(h: dict) -> str:
    """Return an existing root folder id we can safely seed files
    into. Uses the default-seeded 'Alcohol & Drug Screening' when
    present; falls back to the first non-system folder."""
    folders = _list_folders(h)
    for f in folders:
        if f["name"] == "Alcohol & Drug Screening":
            return f["id"]
    for f in folders:
        return f["id"]
    pytest.skip("no folders available")


def test_search_matches_filename_case_insensitive():
    h = _login()
    root = _drug_folder(h)
    stamp = uuid.uuid4().hex[:8]
    fid = _upload_file(h, root, f"AsBesTos-report-{stamp}.txt",
                          content=b"asbestos handling report body")
    try:
        r = requests.get(f"{API}/document-library/search",
                          headers=h, params={"q": f"asbestos-report-{stamp}"},
                          timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        ids = [row["file_id"] for row in data["results"]]
        assert fid in ids, "case-insensitive filename match failed"
        # match_field is 'filename'.
        hit = next(row for row in data["results"] if row["file_id"] == fid)
        assert hit["match_field"] == "filename"
        assert hit["folder_path"], "folder_path must be populated"
    finally:
        _delete_file(h, fid)


def test_search_matches_uploader_name():
    """v58.13.132gb — Uploader-name match is the new field. Upload
    a file with a distinct filename that does NOT contain the
    uploader's name, then search for the uploader — the row must
    surface with `match_field:"uploader"`."""
    h = _login()
    # Fetch uploader name from /auth/me.
    me = requests.get(f"{API}/auth/me", headers=h, timeout=15)
    assert me.status_code == 200, me.text
    uploader_name = (me.json().get("full_name")
                      or me.json().get("name")
                      or "").strip()
    if not uploader_name or len(uploader_name.split()) < 1:
        pytest.skip("admin user has no full_name to search against")
    # Distinctive filename that does NOT contain the uploader's name.
    root = _drug_folder(h)
    stamp = uuid.uuid4().hex[:8]
    fid = _upload_file(h, root, f"unrelated-doc-{stamp}.txt",
                          content=b"body")
    try:
        needle = uploader_name.split()[0]
        r = requests.get(f"{API}/document-library/search",
                          headers=h, params={"q": needle},
                          timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        # Our specific upload should be in there with match_field=uploader.
        hits = [row for row in data["results"] if row["file_id"] == fid]
        assert hits, (
            f"uploaded file did not match on uploader name '{needle}'")
        assert hits[0]["match_field"] == "uploader"
    finally:
        _delete_file(h, fid)


def test_search_scoped_to_folder_and_recursive():
    """Search inside a parent folder with `recursive=true` must
    return files in a subfolder too. Non-recursive must NOT."""
    h = _login()
    stamp = uuid.uuid4().hex[:6]
    parent = _create_folder(h, f".132gb-parent-{stamp}")
    child = _create_folder(h, f".132gb-child-{stamp}", parent_id=parent)
    other = _create_folder(h, f".132gb-other-{stamp}")
    parent_file = _upload_file(h, parent, f"parent-doc-{stamp}.txt")
    child_file = _upload_file(h, child, f"child-doc-{stamp}.txt")
    other_file = _upload_file(h, other, f"other-doc-{stamp}.txt")
    try:
        needle = f"doc-{stamp}"

        # Global search (no folder filter) — all three surface.
        r_all = requests.get(f"{API}/document-library/search",
                              headers=h, params={"q": needle}, timeout=15)
        ids_all = {row["file_id"] for row in r_all.json()["results"]}
        assert parent_file in ids_all
        assert child_file in ids_all
        assert other_file in ids_all

        # Folder-scoped recursive — parent + child, NOT other.
        r_rec = requests.get(f"{API}/document-library/search",
                              headers=h,
                              params={"q": needle,
                                      "folder_id": parent,
                                      "recursive": "true"},
                              timeout=15)
        ids_rec = {row["file_id"] for row in r_rec.json()["results"]}
        assert parent_file in ids_rec
        assert child_file in ids_rec, (
            "recursive folder search must descend into subfolders")
        assert other_file not in ids_rec, (
            "folder-scoped search must not leak into unrelated folders")

        # Folder-scoped non-recursive — parent only.
        r_flat = requests.get(f"{API}/document-library/search",
                                headers=h,
                                params={"q": needle,
                                        "folder_id": parent,
                                        "recursive": "false"},
                                timeout=15)
        ids_flat = {row["file_id"] for row in r_flat.json()["results"]}
        assert parent_file in ids_flat
        assert child_file not in ids_flat, (
            "recursive=false must NOT descend into subfolders")
    finally:
        _delete_file(h, parent_file)
        _delete_file(h, child_file)
        _delete_file(h, other_file)
        _delete_folder(h, child)
        _delete_folder(h, parent)
        _delete_folder(h, other)


def test_search_empty_for_non_existent_needle():
    h = _login()
    r = requests.get(f"{API}/document-library/search",
                      headers=h,
                      params={"q": f"__does_not_exist_{uuid.uuid4().hex}"},
                      timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert data["count"] == 0
    assert data["results"] == []


# ─── Version lockstep ──────────────────────────────────────────

def test_version_bumped_to_132gb():
    js = _read(VERSION_JS)
    sw = _read(SW)
    assert re.search(r"RUNNING_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gb'", js)
    assert re.search(r"EXPECTED_CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gb'", js)
    assert re.search(r"CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gb'", sw)

"""v58.13.132gp — Doc Library folder-delete crash regression guard."""
from __future__ import annotations
import re, uuid
from pathlib import Path
import pytest, requests
from tests.conftest import ADMIN_EMAIL, ADMIN_PWD, API

pytestmark = pytest.mark.live_db_writes

APP_ROOT = Path(__file__).resolve().parents[2]
DL = APP_ROOT / "frontend" / "src" / "pages" / "DocumentLibrary.jsx"
VJS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


def _read(p): return p.read_text(encoding="utf-8")


def _login():
    r = requests.post(f"{API}/auth/login",
                        json={"email": ADMIN_EMAIL, "password": ADMIN_PWD},
                        timeout=30)
    if r.status_code == 429: pytest.skip("rate-limited")
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_confirm_delete_state_captures_folder_object():
    src = _read(DL)
    # New state name present, old one gone.
    assert 'const [confirmDeleteTarget, setConfirmDeleteTarget]' in src
    assert 'setConfirmDeleteId(' not in src
    assert 'confirmDeleteId !== f.id' not in src


def test_optimistic_setFolders_removed_from_deleteFolder():
    src = _read(DL)
    # The .132gl-a optimistic path must be gone (it was the crash root cause).
    assert 'setFolders((prev) => prev.filter((x) => x.id !== f.id))' not in src
    # The reverted flow: API first, then close modal.
    assert 'await api.delete(`/document-library/folders/${f.id}`)' in src
    assert 'setConfirmDeleteTarget(null)' in src


def test_modal_reads_target_from_state_not_only_from_folders_find():
    src = _read(DL)
    # Modal must guard against the target being missing from `folders`
    # by falling back to the captured object.
    assert 'const fresh = folders.find((x) => x.id === confirmDeleteTarget.id);' in src
    assert 'const target = fresh || confirmDeleteTarget;' in src


def test_folder_create_and_delete_still_works_end_to_end():
    """Backend contract: create → delete → 204 → not in list."""
    h = _login()
    stamp = uuid.uuid4().hex[:6]
    r = requests.post(f"{API}/document-library/folders",
                        json={"name": f"gp-py-{stamp}"},
                        headers=h, timeout=15)
    assert r.status_code in (200, 201), r.text
    fid = r.json()["id"]
    d = requests.delete(f"{API}/document-library/folders/{fid}",
                          headers=h, timeout=15)
    assert d.status_code in (200, 204), d.text
    lst = requests.get(f"{API}/document-library/folders?limit=500",
                         headers=h, timeout=15).json()
    items = lst.get("items") if isinstance(lst, dict) else lst
    assert not any(row["id"] == fid for row in (items or []))


def test_version_bumped_to_132gp():
    js, sw = _read(VJS), _read(SW)
    assert re.search(r"RUNNING_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gp'", js)
    assert re.search(r"EXPECTED_CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gp'", js)
    assert re.search(r"CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gp'", sw)

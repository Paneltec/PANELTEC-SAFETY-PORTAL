"""v58.13.132ht — Three fixes bundled in one ship. Root causes proved
by live browser reproduction on 2026-09-17.

Fix 1 · Settings sidebar folder delete (the actual bug Stephen hit)
    Symptom: "Clicking the trash on a New folder crashes the page.
    Folder isn't deleted. Three orphan New folder entries pile up."

    Live reproduction: clicked the trash → modal opened → clicked
    Confirm → nothing. `document.elementFromPoint(cx,cy)` at the
    center of the Confirm button returned `<TH>Role</TH>` — the
    Users page table header — proving the modal was rendered INSIDE
    a lower stacking context (the AppShell sidebar / dnd-kit
    DragOverlay applies a `transform` which anchors the local
    stacking context). Even bumping `z-50 → z-[100]` didn't escape.

    Root cause: `<DeleteFolderModal>` in `SettingsNav.jsx` was
    rendered in-place inside a `transform`-ed ancestor. `.132ht`
    ports it through `createPortal(body, document.body)` so its
    z-[100] is authoritative against every page.

    Second sub-fix: the trash icon used `opacity-0
    group-hover/folder:opacity-100` — invisible on iPad (Stephen's
    primary form factor). Bumped to `opacity-60` idle,
    `opacity-100` on hover / focus-within.

Fix 2 · Doc Library tree action pill (pre-existing polish)
    Same hover-only visibility guard on `DocumentLibraryTree.jsx`.
    Also relaxed to always-visible.

Fix 3 · Workers toolbar rollback of .132hq worker-company chip filter.
    The chip row displaced the search input on narrow viewports.
    Backend `worker_companies` collection + endpoints are kept
    dormant (open question with Stephen re: full purge).

Tests below lock all three regressions.
"""
from __future__ import annotations

import re
import uuid
from pathlib import Path

import pytest
import requests

pytestmark = pytest.mark.live_db_writes


VJS = Path("/app/frontend/src/lib/version.js")
SW = Path("/app/frontend/public/service-worker.js")
DOC_TREE = Path("/app/frontend/src/pages/DocumentLibraryTree.jsx")
SETTINGS_NAV = Path("/app/frontend/src/components/settings/SettingsNav.jsx")
WORKERS = Path("/app/frontend/src/pages/Workers.jsx")


def _read(p: Path) -> str:
    return p.read_text()


def _api(_mongo) -> str:
    from tests.conftest import API as _api_url
    return _api_url


# ── Backend regression guards ───────────────────────────────────────

def test_delete_empty_doc_library_folder_returns_204(
    _mongo, ephemeral_admin, ephemeral_org_id,
):
    api = _api(_mongo)
    tok = ephemeral_admin["token"]
    name = f"pytest-ht-{uuid.uuid4().hex[:6]}"
    r = requests.post(
        f"{api}/document-library/folders",
        json={"name": name},
        headers={"Authorization": f"Bearer {tok}"}, timeout=15,
    )
    assert r.status_code == 201, r.text
    fid = r.json()["id"]
    try:
        r2 = requests.delete(
            f"{api}/document-library/folders/{fid}",
            headers={"Authorization": f"Bearer {tok}"}, timeout=15,
        )
        assert r2.status_code == 204, r2.text
        row = _mongo.doc_folders.find_one({"id": fid}, {"_id": 0})
        assert row["deleted_at"], "folder should be soft-deleted"
    finally:
        _mongo.doc_folders.delete_one({"id": fid})


def test_nav_layout_put_persists_folder_removal(
    _mongo, ephemeral_admin, ephemeral_org_id,
):
    """`SettingsNav.doDeleteFolder` writes to `/api/settings/nav-layout`
    via a debounced PUT. Verify the endpoint accepts a payload with
    a folder removed and stores it as-is.

    The backend validator requires every registered nav key to appear
    exactly once, so we start from the caller's current layout, add
    two decoy folders, PUT it, then PUT it again with one folder
    removed and assert only the surviving folder + all nav keys
    stay intact.
    """
    api = _api(_mongo)
    tok = ephemeral_admin["token"]

    # Snapshot the current server-side layout so we don't clobber
    # any seed defaults.
    current = requests.get(
        f"{api}/settings/nav-layout",
        headers={"Authorization": f"Bearer {tok}"}, timeout=15,
    ).json()["layout"]
    original = [n for n in current
                if not (n.get("type") == "folder"
                        and (n.get("label") or "").startswith("pytest-"))]

    layout = list(original) + [
        {"type": "folder", "id": "folder_pytestA",
         "label": "pytest-Alpha", "children": []},
        {"type": "folder", "id": "folder_pytestB",
         "label": "pytest-Beta", "children": []},
    ]
    r = requests.put(
        f"{api}/settings/nav-layout",
        json={"layout": layout},
        headers={"Authorization": f"Bearer {tok}"}, timeout=15,
    )
    assert r.status_code in (200, 204), r.text

    got = requests.get(
        f"{api}/settings/nav-layout",
        headers={"Authorization": f"Bearer {tok}"}, timeout=15,
    ).json()["layout"]
    ids = [n["id"] for n in got if n.get("type") == "folder"]
    assert "folder_pytestA" in ids and "folder_pytestB" in ids

    try:
        layout2 = [n for n in layout if n.get("id") != "folder_pytestA"]
        r2 = requests.put(
            f"{api}/settings/nav-layout",
            json={"layout": layout2},
            headers={"Authorization": f"Bearer {tok}"}, timeout=15,
        )
        assert r2.status_code in (200, 204), r2.text
        got2 = requests.get(
            f"{api}/settings/nav-layout",
            headers={"Authorization": f"Bearer {tok}"}, timeout=15,
        ).json()["layout"]
        ids2 = [n["id"] for n in got2 if n.get("type") == "folder"]
        assert "folder_pytestA" not in ids2, \
            "Alpha should have been removed after PUT"
        assert "folder_pytestB" in ids2, "Beta should remain"
    finally:
        # Restore original.
        requests.put(
            f"{api}/settings/nav-layout",
            json={"layout": original},
            headers={"Authorization": f"Bearer {tok}"}, timeout=15,
        )


# ── Frontend source guards ──────────────────────────────────────────

def test_settings_nav_modal_uses_portal_and_z100():
    """`SettingsNav.DeleteFolderModal` must render via `createPortal`
    into `document.body` at z-[100] — the only way to escape the
    AppShell sidebar's dnd-kit stacking context. Reproduction proved
    that anything short of a portal keeps `<TH>Role</TH>` on top of
    Confirm and the tap misses the button."""
    src = _read(SETTINGS_NAV)
    assert "import { createPortal } from 'react-dom'" in src, \
        "createPortal import missing — modal will be trapped in sidebar stack"
    assert "createPortal(body, document.body)" in src, \
        "DeleteFolderModal must portal to document.body"
    assert "z-[100]" in src, "modal must render at z-[100]"


def test_settings_nav_trash_button_not_opacity_zero():
    """The per-folder trash button in the settings sidebar must NOT
    idle at `opacity-0` — that hid it on iPad where Stephen operates.
    Regression guard for the .132ht always-visible fix."""
    src = _read(SETTINGS_NAV)
    # Locate the trash button by testid then read forward to className.
    idx = src.find("settings-nav-folder-${folder.id}-delete`")
    assert idx > 0, "settings-nav-folder trash testid not present"
    window = src[idx:idx + 800]
    m = re.search(r'className="([^"]+)"', window)
    assert m, f"className not found near trash testid:\n{window}"
    class_str = m.group(1)
    assert "opacity-0" not in class_str, \
        f"trash button is idle-hidden by opacity-0: {class_str!r}"
    assert "opacity-60" in class_str or "opacity-100" in class_str, \
        f"trash button must have a visible idle opacity: {class_str!r}"


def test_doc_tree_action_pill_is_not_hover_only():
    src = _read(DOC_TREE)
    offenders = [
        ln for ln in src.splitlines()
        if "hidden group-hover:inline-flex" in ln and "className" in ln
    ]
    assert not offenders, (
        "Doc library tree action pill re-hidden by hover-only guard: "
        + "\n".join(offenders)
    )
    assert re.search(r"data-testid=\{['\"]tree-actions-", src), \
        "tree-actions-<id> testid missing"
    assert re.search(r"data-testid=\{['\"]tree-delete-", src), \
        "tree-delete-<id> testid missing"


def test_workers_toolbar_has_search_and_no_company_chip_filter():
    src = _read(WORKERS)
    assert 'data-testid="search-input"' in src, "workers search input missing"
    for banned in (
        'data-testid="worker-company-filter"',
        'data-testid={`worker-company-chip-',
        "const [companyFilter",
        "setCompanyFilter",
        "const [workerCompanies",
    ):
        assert banned not in src, f"leftover .132hq chip-filter code: {banned!r}"


# ── Version lockstep ───────────────────────────────────────────────

def test_version_pin_v132ht():
    js = _read(VJS)
    sw = _read(SW)
    assert re.search(
        r"RUNNING_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132ht'", js
    ), "RUNNING_VERSION not bumped to .132ht"
    assert re.search(
        r"EXPECTED_CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132ht'", js
    ), "EXPECTED_CACHE_VERSION not bumped to .132ht"
    assert re.search(
        r"CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132ht'", sw
    ), "service-worker CACHE_VERSION not bumped to .132ht"

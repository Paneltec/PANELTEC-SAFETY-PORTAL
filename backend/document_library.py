"""Document Library — predefined folders + file uploads.

Web-only for this turn. Files land in `/app/backend/uploads/document_library/{folder_id}/`.
Serve via the shared `/api/files/document_library/{folder_id}/{name}` route in
`dashboard.py`.

Write endpoints (create folder / rename / delete folder / upload / delete file)
are gated to roles `admin` and `hseq_lead`. The Uncategorised folder is
non-deletable and seeded automatically.
"""
from __future__ import annotations
import re
import shutil
import uuid
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from pymongo import ReturnDocument

from auth import get_current_user
from permissions import require_permission, require_module
from permissions_scope import scope_filter  # v160.3.9.28
from db import db
from missing_file_response import missing_file_response  # v58.13.132fq
from models import new_id, now_iso

router = APIRouter(
    prefix="/document-library", tags=["document-library"],
    dependencies=[Depends(require_module("document_library"))],  # v160.0.9
)

UPLOAD_DIR = Path(__file__).parent / "uploads" / "document_library"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

WRITE_ROLES = {"admin", "hseq_lead"}
DELETE_FOLDER_ROLES = {"admin"}
MAX_FILE_BYTES = 50 * 1024 * 1024  # 50 MB

# v58.13.73 — Extended inline-render whitelist. Browsers can render
# these MIMEs / extensions natively in a normal tab, so a filename
# click in the Document Library should open a viewer popup rather
# than triggering a "Save As" dialog. Anything not on this list
# (Office, archives, unknown binary) stays `attachment` because
# save-to-disk is the correct affordance.
#
# CSV is intentionally excluded — technically renderable, but users
# almost always want it in Excel/Numbers, not a bare browser tab.
INLINE_MIMES = frozenset({
    "application/pdf",
    "image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml",
    "text/plain",
    "application/json", "application/xml", "text/xml",
})
INLINE_EXTS = frozenset({
    ".pdf",
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg",
    ".txt", ".log", ".md",
    ".json", ".xml",
})


def _is_browser_renderable(doc: dict) -> bool:
    """Return True iff the browser can render this file inline in a
    normal tab (no download prompt). Consulted by `download_file` when
    the caller does NOT pass `?download=1`.

    Uses MIME first (more precise) with a filename-extension fallback
    so a file uploaded with a generic `application/octet-stream` MIME
    still gets the inline treatment when the extension makes the
    format obvious.
    """
    mime = (doc.get("mime") or "").lower()
    if mime in INLINE_MIMES:
        return True
    fname = (doc.get("filename") or "").lower()
    for ext in INLINE_EXTS:
        if fname.endswith(ext):
            return True
    return False

ALLOWED_EXTS = {
    ".pdf", ".doc", ".docx", ".xls", ".xlsx",
    ".png", ".jpg", ".jpeg", ".txt", ".csv",
}
ALLOWED_MIMES = {
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "image/png", "image/jpeg",
    "text/plain", "text/csv",
}

PASTEL_CYCLE = ["mint", "sky", "peach", "blush", "lavender", "butter", "sage", "coral", "lilac"]

# Order matters — controls default sort_order on seed.
DEFAULT_FOLDERS = [
    "Alcohol & Drug Screening", "Asbestos", "Audits", "Australian Standards",
    "Barriers", "BYDA (Before You Dig)", "Calibration Certificates",
    "Carbon Reduction", "CCF (Civil Contractors Federation)", "Checklists",
    "Chemical Storage & Handling", "CodeSafe", "Committees & Memberships",
    "Competencies Matrices", "Confined Space", "Contract Management",
    "Electrical Safety", "Emergency Management", "Environmental Management",
    "First Aid", "Forms", "Working at Heights", "Hot Work", "Incident Reports",
    "Inductions", "Insurance", "ITPs (Inspection & Test Plans)",
    "JSEA / Risk Assessments", "Licences & Tickets", "Manuals & Procedures",
    "Permits to Work", "Plant & Equipment", "Company Policies", "PPE",
    "Procurement", "Rehabilitation & RTW", "Reports",
    "SDS (Safety Data Sheets)", "Site Management", "Subcontractor Management",
    "SWMS", "Toolbox Talks", "Traffic Management", "Training Records",
    "WHS Acts & Regulations",
]
UNCATEGORISED = "Uncategorised"

# v58.13.132gy Phase 1 (Doc Library restructure) — Nested tree.
#
# Shape: {parent_name: [child_name, ...] OR {sub_parent: [grandchildren]}}.
# The 12 new parents get created idempotently. Existing folders whose
# name matches a leaf get `parent_folder_id` set to point at the
# resolved parent id. `Uncategorised` stays at root (system folder).
# `Work`, `Archives`, `IMS (Integrated Management System)`, and the
# `Compliance & Safety / SDS (Safety Data Sheets)` node all render as
# leaf-parents (no seeded children) — users add children via the
# folder-create form which now accepts `parent_folder_id`.
#
# IMS numbered folders (0.IMS Index / 1..6.) are user-created and
# nested via a name-prefix match `^\d+\.\s` OR the exact known
# names — see `IMS_LEAF_PATTERNS`.
DEFAULT_FOLDER_TREE: dict = {
    "Compliance & Safety": {
        "WHS Framework": [
            "WHS Acts & Regulations", "Australian Standards",
            "Company Policies", "Manuals & Procedures",
        ],
        "Risk & Hazard": [
            "JSEA / Risk Assessments", "SWMS", "Working at Heights",
            "Confined Space", "Hot Work", "Electrical Safety",
            "Chemical Storage & Handling", "Asbestos",
            "Permits to Work", "BYDA (Before You Dig)",
        ],
        "Site Operations": [
            "Traffic Management", "Site Management", "PPE",
            "Barriers", "Plant & Equipment",
        ],
        "Environmental": [
            "Environmental Management", "Carbon Reduction",
        ],
        "Incidents & Emergency": [
            "Incident Reports", "Emergency Management",
            "First Aid", "Rehabilitation & RTW",
        ],
        "Audits & Inspections": [
            "Audits", "Checklists", "ITPs (Inspection & Test Plans)",
            "Reports",
        ],
        "SDS (Safety Data Sheets)": [],
    },
    "Training & Competency": [
        "Inductions", "TasWater Inductions", "Toolbox Talks",
        "Competencies Matrices", "Training Records",
        "Licences & Tickets", "Alcohol & Drug Screening", "CodeSafe",
    ],
    "Administration": [
        "Contract Management", "Subcontractor Management",
        "Procurement", "Insurance", "Committees & Memberships",
        "CCF (Civil Contractors Federation)", "Forms",
    ],
    "Equipment & Assets": ["Calibration Certificates"],
    "IMS (Integrated Management System)": [],
    "Archives": [],
    "Work": [],
}

# IMS folders are user-created with prefixes like `0.IMS Index`,
# `1. Management & Quality…`, `SWMS-CURRENT IMS - 2025 2026`. Any
# top-level folder whose name matches one of these patterns gets
# reparented under `IMS (Integrated Management System)`.
IMS_LEAF_PATTERNS = [
    r"^\d+\.",               # `0.IMS Index`, `1. Management…`, etc.
    r"^SWMS-CURRENT IMS",    # `SWMS-CURRENT IMS - 2025 2026`
]

# Parents that must NEVER be reparented themselves. Includes the
# tree parents (once created) + the Uncategorised system folder.
TREE_PARENT_NAMES = {
    "Compliance & Safety", "WHS Framework", "Risk & Hazard",
    "Site Operations", "Environmental", "Incidents & Emergency",
    "Audits & Inspections", "SDS (Safety Data Sheets)",
    "Training & Competency", "Administration", "Equipment & Assets",
    "IMS (Integrated Management System)", "Archives", "Work",
}


def _flatten_tree_leaves(tree: dict) -> dict:
    """Return {leaf_name: parent_name} for the reparent mapping.

    Walks `DEFAULT_FOLDER_TREE` — sub-parents (like "WHS Framework")
    are leaves-of-their-grandparent AND parents-of-their-own-children;
    both mappings are emitted so the reparent step can resolve either.
    """
    out: dict = {}
    for top, val in tree.items():
        if isinstance(val, dict):
            for sub_parent, leaves in val.items():
                out[sub_parent] = top
                for leaf in leaves:
                    out[leaf] = sub_parent
        elif isinstance(val, list):
            for leaf in val:
                out[leaf] = top
    return out


LEAF_TO_PARENT = _flatten_tree_leaves(DEFAULT_FOLDER_TREE)


def _require(user: dict, roles: set, action: str = "edit"):
    if user.get("role") not in roles:
        raise HTTPException(403, f"Permission denied: document_library.{action}")


def _serialise_folder(doc: dict, file_count: int = 0, subfolder_count: int = 0) -> dict:
    return {
        "id": doc["id"],
        "name": doc["name"],
        "color_key": doc.get("color_key") or "sky",
        "sort_order": doc.get("sort_order", 0),
        "is_system": bool(doc.get("is_system")),
        "file_count": file_count,
        "subfolder_count": subfolder_count,
        "parent_folder_id": doc.get("parent_folder_id"),
        "worker_id": doc.get("worker_id"),
        "created_at": doc.get("created_at"),
        "updated_at": doc.get("updated_at"),
        # v58.13.132km — Expose the shared_reference toggle so the FE
        # can render the `SHARED` pill on folder cards and pre-hydrate
        # the admin toggle state without a second fetch.
        "shared_reference": bool(doc.get("shared_reference")),
    }


def _serialise_file(doc: dict) -> dict:
    return {
        "id": doc["id"],
        "folder_id": doc["folder_id"],
        "filename": doc["filename"],
        "mime": doc.get("mime"),
        "size": doc.get("size", 0),
        "file_url": doc.get("file_url"),
        "uploaded_by": doc.get("uploaded_by"),
        "uploaded_by_name": doc.get("uploaded_by_name"),
        "uploaded_at": doc.get("uploaded_at"),
        "ai_tags": doc.get("ai_tags") or [],
        # v58.13.132gt Phase 2 — SDS module enhancements: expose the
        # optional expiry_date + updated_at so the FE can render
        # tinted rows, sort by expiry, and show "Renamed by" hints.
        "expiry_date": doc.get("expiry_date"),
        "updated_at": doc.get("updated_at"),
        # v58.13.132if — Archive metadata. `archived_at` is set either
        # by the auto-expiry sweep in `list_files` or manually via
        # `/library/files/{id}/archive`. Semantic separation from
        # `deleted_at`: archived files are kept + browsable in the
        # Archived accordion; deleted files are soft-deleted + hidden.
        "archived_at": doc.get("archived_at"),
        "archived_reason": doc.get("archived_reason"),
    }


async def _seed_default_folders(org_id: str, created_by: str) -> None:
    has_any = await db.doc_folders.find_one(
        {"org_id": org_id, "deleted_at": None}, {"_id": 1}
    )
    if has_any:
        return
    docs = []
    for i, name in enumerate(DEFAULT_FOLDERS):
        docs.append({
            "id": new_id(), "org_id": org_id, "name": name,
            "color_key": PASTEL_CYCLE[i % len(PASTEL_CYCLE)],
            "sort_order": (i + 1) * 10,
            "is_system": False,
            "created_at": now_iso(), "updated_at": now_iso(),
            "created_by": created_by, "deleted_at": None,
        })
    # Uncategorised — system folder, always last, neutral colour.
    docs.append({
        "id": new_id(), "org_id": org_id, "name": UNCATEGORISED,
        "color_key": "slate",
        "sort_order": (len(DEFAULT_FOLDERS) + 1) * 10,
        "is_system": True,
        "created_at": now_iso(), "updated_at": now_iso(),
        "created_by": created_by, "deleted_at": None,
    })
    await db.doc_folders.insert_many(docs)


# v58.13.132gy — Doc Library restructure engine.
#
# `_compute_reorganise_diff(org_id)` produces an idempotent diff:
# which new parent folders need creating, which existing leaves
# need reparenting. `_apply_reorganise(org_id, ...)` commits it.
# Both are safe to call repeatedly.

import re as _re


def _is_ims_leaf(name: str) -> bool:
    for pat in IMS_LEAF_PATTERNS:
        if _re.search(pat, name):
            return True
    return False


async def _compute_reorganise_diff(org_id: str, actor_id: str) -> dict:
    """Return `{parents_to_create: [name…], reparents: [{id, name,
    current_parent, target_parent_name}], skipped: [name…]}`.

    Idempotent: if the tree is already applied, all three lists
    come back empty except for `skipped` (which surfaces every
    leaf that already sits in the right place)."""
    # Snapshot everything for the org.
    all_folders: list = []
    async for f in db.doc_folders.find(
        {"org_id": org_id, "deleted_at": None},
        {"_id": 0, "id": 1, "name": 1, "parent_folder_id": 1,
         "is_system": 1, "worker_id": 1},
    ):
        all_folders.append(f)
    by_name: dict = {}
    by_id: dict = {}
    for f in all_folders:
        by_id[f["id"]] = f
        # If two folders share a name we keep the one at the root
        # (parent_folder_id None) — new parents will collide by name.
        cur = by_name.get(f["name"])
        if cur is None or (
            not f.get("parent_folder_id") and cur.get("parent_folder_id")
        ):
            by_name[f["name"]] = f

    parents_to_create: list = []
    for parent_name in TREE_PARENT_NAMES:
        if parent_name not in by_name:
            parents_to_create.append(parent_name)

    reparents: list = []
    skipped: list = []

    def _target_for(leaf_name: str) -> Optional[str]:
        # Direct match in the leaf→parent map.
        if leaf_name in LEAF_TO_PARENT:
            return LEAF_TO_PARENT[leaf_name]
        # IMS numbered / SWMS-CURRENT belong under the IMS parent.
        if _is_ims_leaf(leaf_name):
            return "IMS (Integrated Management System)"
        return None

    for f in all_folders:
        # Skip system folder + per-worker folders — those keep their
        # existing parent (a worker profile) and never get retargeted.
        if f.get("is_system") or f.get("worker_id"):
            skipped.append(f["name"])
            continue
        # Skip the new tree parents themselves — they stay at root.
        if f["name"] in TREE_PARENT_NAMES:
            skipped.append(f["name"])
            continue

        target_parent_name = _target_for(f["name"])
        if not target_parent_name:
            # Not in the mapping — leave it at root (safety net).
            skipped.append(f["name"])
            continue

        current_parent_id = f.get("parent_folder_id")
        current_parent = (
            by_id.get(current_parent_id) if current_parent_id else None
        )
        current_parent_name = current_parent.get("name") if current_parent else None

        if current_parent_name == target_parent_name:
            skipped.append(f["name"])
            continue

        reparents.append({
            "id": f["id"],
            "name": f["name"],
            "current_parent": current_parent_name,
            "target_parent_name": target_parent_name,
        })

    return {
        "parents_to_create": parents_to_create,
        "reparents": reparents,
        "skipped": skipped,
        "counts": {
            "parents_to_create": len(parents_to_create),
            "reparents": len(reparents),
            "skipped": len(skipped),
        },
    }


async def _apply_reorganise(org_id: str, actor_id: str) -> dict:
    """Commit `_compute_reorganise_diff`. Returns the counts of
    actions taken. Idempotent — re-running is a no-op."""
    diff = await _compute_reorganise_diff(org_id, actor_id)
    # 1. Create missing parents. Order matters: tree parents that
    # ARE children of other tree parents (e.g. "WHS Framework" ⊂
    # "Compliance & Safety") need their own parent id resolved,
    # so we do two passes.
    top_level_parents = set(DEFAULT_FOLDER_TREE.keys())
    sub_parents: dict = {}
    for top, val in DEFAULT_FOLDER_TREE.items():
        if isinstance(val, dict):
            for sub in val.keys():
                sub_parents[sub] = top

    # Pass 1: create top-level parents.
    now = now_iso()
    for i, name in enumerate(diff["parents_to_create"]):
        if name not in top_level_parents:
            continue
        await db.doc_folders.update_one(
            {"org_id": org_id, "name": name, "deleted_at": None},
            {"$setOnInsert": {
                "id": new_id(), "org_id": org_id, "name": name,
                "color_key": PASTEL_CYCLE[i % len(PASTEL_CYCLE)],
                "sort_order": 100000 + i * 10,
                "is_system": False, "parent_folder_id": None,
                "created_at": now, "updated_at": now,
                "created_by": actor_id, "deleted_at": None,
            }},
            upsert=True,
        )

    # Rebuild the name→id map now that top-levels exist.
    name_to_id: dict = {}
    async for f in db.doc_folders.find(
        {"org_id": org_id, "deleted_at": None,
         "name": {"$in": list(TREE_PARENT_NAMES)}},
        {"_id": 0, "id": 1, "name": 1},
    ):
        name_to_id[f["name"]] = f["id"]

    # Pass 2: create sub-parents under their top-level parent.
    # MongoDB rejects the same field in both $setOnInsert and $set,
    # so we do a two-step: upsert (create-if-missing) then a
    # separate $set to lock in the parent_folder_id (idempotent).
    for i, name in enumerate(diff["parents_to_create"]):
        if name in top_level_parents:
            continue
        parent_top = sub_parents.get(name)
        parent_id = name_to_id.get(parent_top) if parent_top else None
        await db.doc_folders.update_one(
            {"org_id": org_id, "name": name, "deleted_at": None},
            {"$setOnInsert": {
                "id": new_id(), "org_id": org_id, "name": name,
                "color_key": PASTEL_CYCLE[(i + 5) % len(PASTEL_CYCLE)],
                "sort_order": 200000 + i * 10,
                "is_system": False,
                "created_at": now, "updated_at": now,
                "created_by": actor_id, "deleted_at": None,
            }},
            upsert=True,
        )
        # Lock in the parent_folder_id regardless of whether we
        # inserted or matched an existing row.
        if parent_id:
            await db.doc_folders.update_one(
                {"org_id": org_id, "name": name, "deleted_at": None},
                {"$set": {"parent_folder_id": parent_id,
                            "updated_at": now}},
            )

    # Refresh the name→id map after all parents exist.
    async for f in db.doc_folders.find(
        {"org_id": org_id, "deleted_at": None,
         "name": {"$in": list(TREE_PARENT_NAMES)}},
        {"_id": 0, "id": 1, "name": 1},
    ):
        name_to_id[f["name"]] = f["id"]

    # 3. Reparent leaves.
    reparented = 0
    for rp in diff["reparents"]:
        target_id = name_to_id.get(rp["target_parent_name"])
        if not target_id:
            continue
        r = await db.doc_folders.update_one(
            {"id": rp["id"], "org_id": org_id, "deleted_at": None},
            {"$set": {"parent_folder_id": target_id,
                        "updated_at": now}},
        )
        if r.modified_count:
            reparented += 1

    return {
        "parents_created": len(diff["parents_to_create"]),
        "reparented": reparented,
        "skipped": len(diff["skipped"]),
    }


async def _ensure_tree_structure(org_id: str, actor_id: str) -> None:
    """Auto-apply the reorganise on every list_folders call. Cheap
    when idempotent (a no-op after the first run) and means fresh
    orgs get the tree without waiting for an admin to hit the
    reorganise endpoint."""
    diff = await _compute_reorganise_diff(org_id, actor_id)
    if diff["parents_to_create"] or diff["reparents"]:
        await _apply_reorganise(org_id, actor_id)


async def _file_counts(org_id: str) -> dict:
    """Return {folder_id: count} for non-deleted files."""
    pipeline = [
        {"$match": {"org_id": org_id, "deleted_at": None}},
        {"$group": {"_id": "$folder_id", "n": {"$sum": 1}}},
    ]
    out: dict = {}
    async for row in db.doc_files.aggregate(pipeline):
        out[row["_id"]] = row["n"]
    return out


# ────────────────────── Folders ──────────────────────

class FolderIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    color_key: Optional[str] = Field(default=None, max_length=20)
    # v58.13.132gy — Doc Library restructure. Allow admins to nest a
    # new folder under any existing folder at create time. Cycle
    # safety isn't a concern on create (a brand-new folder can't be
    # its own ancestor).
    parent_folder_id: Optional[str] = Field(default=None, max_length=64)


class FolderPatch(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    color_key: Optional[str] = Field(default=None, max_length=20)
    sort_order: Optional[int] = Field(default=None, ge=0, le=1000000)
    # v58.13.132gy — Reparent an existing folder. Pass `null` (JSON
    # null) or an explicit sentinel to move a folder back to root;
    # since Pydantic can't distinguish "field absent" from "field
    # explicitly null" with default=None, we use a "-" sentinel
    # meaning "move to root" and default=None meaning "no change".
    parent_folder_id: Optional[str] = Field(default=None, max_length=64)
    # v58.13.132km — Toggle worker-visibility for shared reference
    # material (SDS, Chemical Register, Australian Standards, etc.).
    # Only privileged roles can flip it (WRITE_ROLES enforced in the
    # endpoint). See permissions rationale in
    # `memory/v58_13_132km_shared_reference_folders.md`.
    shared_reference: Optional[bool] = None


@router.post("/reorganise")
async def reorganise(
    dry_run: bool = True,
    user: dict = Depends(require_permission("documents", "edit")),
):
    """v58.13.132gy — Doc Library restructure admin endpoint.

    · `?dry_run=true` (default): returns the diff without touching
      any data. Safe to poll from the FE Settings surface.
    · `?dry_run=false`: applies the diff. Idempotent — re-running
      is a no-op. Only admins can flip dry_run off.
    """
    _require(user, {"admin"}, action="reorganise")
    if dry_run:
        return await _compute_reorganise_diff(user["org_id"], user["id"])
    return await _apply_reorganise(user["org_id"], user["id"])


@router.get("/counts")
async def library_counts(user: dict = Depends(get_current_user)):
    """v58.13.132ha — Self-serve counts pill on the Document Library
    header. Returns totals so admins can answer "how many folders /
    files do we have?" at a glance, without eyeballing every subtree.

    · `folders_active` — non-deleted folders (any depth, includes
      per-worker leaves).
    · `folders_deleted` — soft-deleted folders (informational).
    · `files_active` — non-deleted files (any folder).
    · `files_deleted` — soft-deleted files.
    · `files_missing_binary` — active doc_files rows whose file_url
      does not resolve to a GridFS blob or a legacy-disk file.
      Cheap to compute: single aggregate joining metadata.key on
      upload_storage.files.
    """
    org_id = user["org_id"]
    folders_active = await db.doc_folders.count_documents(
        {"org_id": org_id, "deleted_at": None},
    )
    folders_deleted = await db.doc_folders.count_documents(
        {"org_id": org_id, "deleted_at": {"$ne": None}},
    )
    files_active = await db.doc_files.count_documents(
        {"org_id": org_id, "deleted_at": None},
    )
    files_deleted = await db.doc_files.count_documents(
        {"org_id": org_id, "deleted_at": {"$ne": None}},
    )
    # Missing-binary probe: pull the list of active file_url values,
    # extract each metadata.key ("document_library/<folder>/<hash>.ext"),
    # then count how many are absent from upload_storage.files. Batch
    # in one aggregate — cheap enough at Stephen-scale (~700 rows).
    keys: list[str] = []
    async for r in db.doc_files.find(
        {"org_id": org_id, "deleted_at": None, "file_url": {"$ne": None}},
        {"_id": 0, "file_url": 1},
    ):
        url = r.get("file_url") or ""
        if url.startswith("/api/files/"):
            keys.append(url[len("/api/files/"):])
    files_missing_binary = 0
    if keys:
        present = set()
        async for row in db["upload_storage.files"].find(
            {"metadata.key": {"$in": keys}},
            {"_id": 0, "metadata.key": 1},
        ):
            present.add((row.get("metadata") or {}).get("key"))
        files_missing_binary = sum(1 for k in keys if k not in present)
    return {
        "folders_active": folders_active,
        "folders_deleted": folders_deleted,
        "files_active": files_active,
        "files_deleted": files_deleted,
        "files_missing_binary": files_missing_binary,
    }


@router.get("/counts/missing-binary")
async def list_missing_binary(
    user: dict = Depends(require_permission("documents", "edit")),
):
    """v58.13.132hd — Admin drill-down for the amber "missing binary"
    chip on the counts pill. Returns each doc_files row whose
    `file_url` doesn't resolve to a GridFS blob — the pre-`.132gh`
    migration tail. Payload is intentionally CSV-friendly so admins
    can export and hand off for original-recovery.

    Admin-only (documents.edit). Includes folder_path (breadcrumb)
    so Stephen can see where each orphan lived without a second
    call.
    """
    _require(user, {"admin"}, action="missing-binary")
    org_id = user["org_id"]

    # Collect every active row + build a folder_id -> folder map for
    # cheap folder_path resolution (walked once per unique folder).
    files: list = []
    async for r in db.doc_files.find(
        {"org_id": org_id, "deleted_at": None, "file_url": {"$ne": None}},
        {"_id": 0},
    ):
        files.append(r)

    keys_needed: list = []
    for f in files:
        url = f.get("file_url") or ""
        if url.startswith("/api/files/"):
            keys_needed.append(url[len("/api/files/"):])

    present: set = set()
    if keys_needed:
        async for row in db["upload_storage.files"].find(
            {"metadata.key": {"$in": keys_needed}},
            {"_id": 0, "metadata.key": 1},
        ):
            present.add((row.get("metadata") or {}).get("key"))

    # Folder map for breadcrumb resolution.
    folder_map: dict = {}
    folder_ids = list({f.get("folder_id") for f in files if f.get("folder_id")})
    if folder_ids:
        async for fd in db.doc_folders.find(
            {"org_id": org_id, "id": {"$in": folder_ids}},
            {"_id": 0, "id": 1, "name": 1, "parent_folder_id": 1},
        ):
            folder_map[fd["id"]] = fd

    async def _path_for(folder_id: str) -> str:
        parts: list = []
        cur = folder_map.get(folder_id)
        seen: set = set()
        while cur and cur["id"] not in seen and len(parts) < 8:
            seen.add(cur["id"])
            parts.append(cur["name"])
            parent_id = cur.get("parent_folder_id")
            if not parent_id:
                break
            cur = folder_map.get(parent_id)
            if cur is None:
                nxt = await db.doc_folders.find_one(
                    {"org_id": org_id, "id": parent_id},
                    {"_id": 0, "id": 1, "name": 1, "parent_folder_id": 1},
                )
                if nxt:
                    folder_map[parent_id] = nxt
                    cur = nxt
                else:
                    cur = None
        return " / ".join(reversed(parts))

    orphans: list = []
    for f in files:
        url = f.get("file_url") or ""
        if not url.startswith("/api/files/"):
            continue
        key = url[len("/api/files/"):]
        if key in present:
            continue
        orphans.append({
            "id": f["id"],
            "filename": f.get("filename"),
            "folder_id": f.get("folder_id"),
            "folder_path": await _path_for(f.get("folder_id") or ""),
            "size": f.get("size", 0),
            "mime": f.get("mime"),
            "uploaded_at": f.get("uploaded_at"),
            "uploaded_by": f.get("uploaded_by"),
            "uploaded_by_name": f.get("uploaded_by_name"),
            "file_url": url,
        })
    orphans.sort(key=lambda x: x.get("uploaded_at") or "")
    return {"count": len(orphans), "orphans": orphans}


@router.post("/files/{file_id}/replace-binary")
async def replace_missing_binary(
    file_id: str,
    replacement: UploadFile = File(...),
    user: dict = Depends(require_permission("documents", "edit")),
):
    """v58.13.132hd — Re-upload a replacement binary for a missing
    orphan. Writes to the SAME `metadata.key` so the existing
    `file_url` continues to resolve — no doc_files fields change
    besides `size`, `mime`, and `updated_at`. Admin-only.
    """
    _require(user, {"admin"}, action="replace-binary")
    org_id = user["org_id"]
    doc = await db.doc_files.find_one(
        {"id": file_id, "org_id": org_id, "deleted_at": None},
    )
    if not doc:
        raise HTTPException(404, "File not found")
    url = doc.get("file_url") or ""
    if not url.startswith("/api/files/"):
        raise HTTPException(400, "File has no restorable path")
    key = url[len("/api/files/"):]
    parts = key.split("/")
    if len(parts) < 2:
        raise HTTPException(400, "File path is malformed")
    subdir = parts[0]

    buf = bytearray()
    while True:
        chunk = await replacement.read(1024 * 1024)
        if not chunk:
            break
        buf.extend(chunk)
        if len(buf) > MAX_FILE_BYTES:
            raise HTTPException(413, "Replacement exceeds 50 MB limit")
    data = bytes(buf)
    from uploads_storage import save_upload  # noqa: WPS433 — lazy
    await save_upload(
        subdir, parts[1:], data,
        module="document_library",
        org_id=org_id,
        mime=replacement.content_type or doc.get("mime"),
        orig_filename=doc.get("filename"),
    )
    await db.doc_files.update_one(
        {"id": file_id, "org_id": org_id},
        {"$set": {
            "size": len(data),
            "mime": replacement.content_type or doc.get("mime") or "application/octet-stream",
            "updated_at": now_iso(),
        }},
    )
    await db.doc_files_audit.insert_one({
        "id": new_id(),
        "org_id": org_id,
        "file_id": file_id,
        "action": "binary_replaced",
        "actor_id": user["id"],
        "actor_name": user.get("name") or user.get("email"),
        "size": len(data),
        "created_at": now_iso(),
    })
    return {"ok": True, "size": len(data)}


@router.post("/files/{file_id}/mark-gone")
async def mark_binary_gone(
    file_id: str,
    user: dict = Depends(require_permission("documents", "edit")),
):
    """v58.13.132hd — Soft-delete an orphan whose binary is
    unrecoverable, with an audit trail. Row is set to `deleted_at`
    (moves to Archive alongside normal soft-deletes) and the audit
    reason is stamped `permanently_gone`. Admin-only.
    """
    _require(user, {"admin"}, action="mark-gone")
    org_id = user["org_id"]
    doc = await db.doc_files.find_one(
        {"id": file_id, "org_id": org_id, "deleted_at": None},
    )
    if not doc:
        raise HTTPException(404, "File not found or already archived")
    await db.doc_files.update_one(
        {"id": file_id, "org_id": org_id},
        {"$set": {
            "deleted_at": now_iso(),
            "deleted_by": user["id"],
            "deleted_reason": "permanently_gone_missing_binary",
            "updated_at": now_iso(),
        }},
    )
    await db.doc_files_audit.insert_one({
        "id": new_id(),
        "org_id": org_id,
        "file_id": file_id,
        "action": "marked_permanently_gone",
        "actor_id": user["id"],
        "actor_name": user.get("name") or user.get("email"),
        "filename": doc.get("filename"),
        "created_at": now_iso(),
    })
    return {"ok": True}


@router.get("/folders/all")
async def list_all_folders(user: dict = Depends(get_current_user)):
    """v58.13.132gy — Flat list of every non-deleted folder in the
    org (roots + sub-parents + leaves + per-worker folders).
    Powers the admin "Parent" dropdown on the folder-create form so
    admins can nest new folders under any sub-parent like `WHS
    Framework` or `Risk & Hazard`. Kept lightweight — only id,
    name, parent_folder_id, is_system.

    v58.13.132gz — Extended with `file_count`, `color_key`,
    `sort_order` so the frontend tree view can render the whole
    hierarchy from a single fetch and compute recursive rollups
    client-side without an N+1 subfolders walk. Per-worker folders
    are still excluded — they're not tree nodes."""
    await _seed_default_folders(user["org_id"], user["id"])
    await _ensure_tree_structure(user["org_id"], user["id"])
    counts = await _file_counts(user["org_id"])
    out: list = []
    async for f in db.doc_folders.find(
        {"org_id": user["org_id"], "deleted_at": None},
        {"_id": 0, "id": 1, "name": 1, "parent_folder_id": 1,
         "is_system": 1, "worker_id": 1, "color_key": 1,
         "sort_order": 1, "shared_reference": 1},
    ).sort([("sort_order", 1), ("name", 1)]):
        # Skip per-worker folders — they're not meaningful parents
        # for user-created top-level or sub-folders.
        if f.get("worker_id"):
            continue
        out.append({
            "id": f["id"],
            "name": f["name"],
            "parent_folder_id": f.get("parent_folder_id"),
            "is_system": bool(f.get("is_system")),
            "file_count": counts.get(f["id"], 0),
            "color_key": f.get("color_key") or "sky",
            "sort_order": f.get("sort_order", 0),
            # v58.13.132km — Included for the folder-tree admin UI so
            # the shared-reference pill renders in every listing surface.
            "shared_reference": bool(f.get("shared_reference")),
        })
    return out


@router.get("/folders")
async def list_folders(user: dict = Depends(get_current_user)):
    """Top-level folders only. Per-worker subfolders (created via the
    Worker Certifications upload flow) are returned via
    `GET /folders/{id}/subfolders`.

    v58.13.132gy — Auto-applies the tree restructure on first call
    per org (idempotent). Fresh orgs seed the base folders first,
    then the ensure-tree helper creates the 12 new parents + nests
    everything under them."""
    await _seed_default_folders(user["org_id"], user["id"])
    await _ensure_tree_structure(user["org_id"], user["id"])
    cursor = db.doc_folders.find(
        {"org_id": user["org_id"], "deleted_at": None,
         "$or": [{"parent_folder_id": None}, {"parent_folder_id": {"$exists": False}}]},
        {"_id": 0},
    ).sort([("sort_order", 1), ("name", 1)])
    folders = await cursor.to_list(500)
    counts = await _file_counts(user["org_id"])
    # Sub-folder counts so the UI can decorate "N subfolders" if it wants.
    sub_pipeline = [
        {"$match": {"org_id": user["org_id"], "deleted_at": None,
                    "parent_folder_id": {"$ne": None}}},
        {"$group": {"_id": "$parent_folder_id", "n": {"$sum": 1}}},
    ]
    sub_counts: dict = {}
    async for row in db.doc_folders.aggregate(sub_pipeline):
        sub_counts[row["_id"]] = row["n"]
    return [
        _serialise_folder(f, counts.get(f["id"], 0), sub_counts.get(f["id"], 0))
        for f in folders
    ]


@router.get("/folders/{folder_id}/subfolders")
async def list_subfolders(folder_id: str, user: dict = Depends(get_current_user)):
    """Children of a single folder (used by the Document Library to navigate
    into per-worker certification folders)."""
    parent = await db.doc_folders.find_one(
        {"id": folder_id, "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0},
    )
    if not parent:
        raise HTTPException(404, "Folder not found")
    cursor = db.doc_folders.find(
        {"org_id": user["org_id"], "parent_folder_id": folder_id, "deleted_at": None},
        {"_id": 0},
    ).sort([("name", 1)])
    children = await cursor.to_list(2000)
    counts = await _file_counts(user["org_id"])
    return {
        "parent": _serialise_folder(parent, counts.get(parent["id"], 0)),
        "children": [_serialise_folder(c, counts.get(c["id"], 0)) for c in children],
    }


@router.post("/folders", status_code=201)
async def create_folder(body: FolderIn, user: dict = Depends(require_permission("documents", "edit"))):
    _require(user, WRITE_ROLES)
    # v58.13.132gy — Validate parent (if supplied) belongs to the
    # same org and isn't soft-deleted. Empty string / "-" is treated
    # as "no parent" so the FE can pass either.
    parent_id: Optional[str] = None
    raw_parent = (body.parent_folder_id or "").strip()
    if raw_parent and raw_parent != "-":
        parent = await db.doc_folders.find_one(
            {"id": raw_parent, "org_id": user["org_id"], "deleted_at": None},
            {"_id": 0, "id": 1},
        )
        if not parent:
            raise HTTPException(400, "Parent folder not found")
        parent_id = raw_parent

    last = await db.doc_folders.find_one(
        {"org_id": user["org_id"], "deleted_at": None},
        {"_id": 0, "sort_order": 1},
        sort=[("sort_order", -1)],
    )
    next_order = ((last or {}).get("sort_order") or 0) + 10
    color = (body.color_key or PASTEL_CYCLE[next_order // 10 % len(PASTEL_CYCLE)]).strip().lower()
    doc = {
        "id": new_id(), "org_id": user["org_id"],
        "name": body.name.strip(), "color_key": color,
        "sort_order": next_order, "is_system": False,
        "parent_folder_id": parent_id,
        "created_at": now_iso(), "updated_at": now_iso(),
        "created_by": user["id"], "deleted_at": None,
    }
    await db.doc_folders.insert_one(doc)
    return _serialise_folder(doc, 0)


@router.patch("/folders/{folder_id}")
async def rename_folder(
    folder_id: str, body: FolderPatch, user: dict = Depends(require_permission("documents", "edit")),
):
    _require(user, WRITE_ROLES)
    existing = await db.doc_folders.find_one(
        {"id": folder_id, "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0},
    )
    if not existing:
        raise HTTPException(404, "Folder not found")
    if existing.get("is_system") and body.name is not None:
        raise HTTPException(400, "Cannot rename the system folder")
    update: dict = {"updated_at": now_iso()}
    if body.name is not None:
        update["name"] = body.name.strip()
    if body.color_key is not None:
        update["color_key"] = body.color_key.strip().lower()
    if body.sort_order is not None:
        update["sort_order"] = int(body.sort_order)
    # v58.13.132gy — Reparent path. "-" sentinel = detach to root.
    # Any other non-empty string = new parent id (validated + cycle
    # checked). Empty/None = no change.
    if body.parent_folder_id is not None:
        raw = body.parent_folder_id.strip()
        if raw == "" or raw == "-":
            update["parent_folder_id"] = None
        elif raw == folder_id:
            raise HTTPException(400, "A folder cannot be its own parent")
        else:
            new_parent = await db.doc_folders.find_one(
                {"id": raw, "org_id": user["org_id"], "deleted_at": None},
                {"_id": 0, "id": 1, "parent_folder_id": 1},
            )
            if not new_parent:
                raise HTTPException(400, "Parent folder not found")
            # Cycle check — walk ancestors of the proposed parent
            # and reject if we hit our own id.
            visited = set()
            cur = new_parent
            while cur and cur.get("parent_folder_id"):
                pid = cur["parent_folder_id"]
                if pid in visited:
                    break  # safety: existing bad data — bail gracefully
                if pid == folder_id:
                    raise HTTPException(
                        400,
                        "Reparent would create a cycle "
                        "(target parent is a descendant of this folder)",
                    )
                visited.add(pid)
                cur = await db.doc_folders.find_one(
                    {"id": pid, "org_id": user["org_id"], "deleted_at": None},
                    {"_id": 0, "id": 1, "parent_folder_id": 1},
                )
            update["parent_folder_id"] = raw
    # v58.13.132km — Persist the shared_reference toggle. The endpoint is
    # already privileged-only via `_require(user, WRITE_ROLES)` above +
    # `require_permission("documents","edit")` on the Depends; no extra
    # role check needed here.
    if body.shared_reference is not None:
        update["shared_reference"] = bool(body.shared_reference)
    if len(update) == 1:
        raise HTTPException(400, "No editable fields supplied")
    result = await db.doc_folders.find_one_and_update(
        {"id": folder_id, "org_id": user["org_id"], "deleted_at": None},
        {"$set": update},
        projection={"_id": 0},
        return_document=ReturnDocument.AFTER,
    )
    counts = await _file_counts(user["org_id"])
    return _serialise_folder(result, counts.get(folder_id, 0))


@router.delete("/folders/{folder_id}", status_code=204)
async def delete_folder(folder_id: str, user: dict = Depends(require_permission("documents", "delete"))):
    _require(user, DELETE_FOLDER_ROLES, action="delete")
    existing = await db.doc_folders.find_one(
        {"id": folder_id, "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0},
    )
    if not existing:
        raise HTTPException(404, "Folder not found")
    if existing.get("is_system"):
        raise HTTPException(400, "Cannot delete the system folder")
    ts = now_iso()
    # v58.13.132hm — Recursive cascade. Prior to `.132hm` the delete
    # only marked the target folder + its DIRECT files as deleted;
    # any subfolders (and their files) were left active with a
    # `parent_folder_id` pointing at a now-deleted parent — orphaned
    # data that no longer surfaced in the tree but still consumed
    # rows in `/folders/all`. Now we do a BFS over descendants and
    # soft-delete every folder id + every file whose folder_id sits
    # anywhere in the subtree.
    to_delete: list = [folder_id]
    frontier: list = [folder_id]
    seen: set = {folder_id}
    while frontier:
        children_cursor = db.doc_folders.find(
            {"org_id": user["org_id"], "deleted_at": None,
             "parent_folder_id": {"$in": frontier}},
            {"_id": 0, "id": 1},
        )
        next_frontier: list = []
        async for c in children_cursor:
            cid = c["id"]
            if cid in seen:
                continue
            seen.add(cid)
            next_frontier.append(cid)
            to_delete.append(cid)
        frontier = next_frontier
    await db.doc_folders.update_many(
        {"id": {"$in": to_delete}, "org_id": user["org_id"]},
        {"$set": {"deleted_at": ts, "updated_at": ts}},
    )
    await db.doc_files.update_many(
        {"folder_id": {"$in": to_delete}, "org_id": user["org_id"], "deleted_at": None},
        {"$set": {"deleted_at": ts, "updated_at": ts}},
    )
    return None


# ────────────────────── Files ──────────────────────

async def _resolve_folder(folder_id: str, org_id: str) -> dict:
    folder = await db.doc_folders.find_one(
        {"id": folder_id, "org_id": org_id, "deleted_at": None},
        {"_id": 0},
    )
    if not folder:
        raise HTTPException(404, "Folder not found")
    return folder


def _safe_ext(filename: Optional[str]) -> str:
    ext = (Path(filename or "").suffix or "").lower()
    return ext if ext in ALLOWED_EXTS else ""


# MOCKED: AI tag extraction is a filename-keyword stub for this turn.
# When PDF/DOCX text extraction is wired in, swap this for a Claude call over
# the first ~2000 chars of extracted_text (see plan in ask.py for a pattern).
def _stub_ai_tags(filename: str) -> List[str]:
    stem = Path(filename).stem.lower()
    # Strip dates, version markers and other noise before tokenising.
    cleaned = re.sub(r"[\d_\-\.]+", " ", stem)
    tokens = [t for t in re.split(r"\s+", cleaned) if len(t) >= 3]
    # Dedupe preserving order, cap at 5
    seen, out = set(), []
    for t in tokens:
        if t not in seen:
            seen.add(t)
            out.append(t)
        if len(out) >= 5:
            break
    return out


@router.get("/folders/{folder_id}/files")
async def list_files(folder_id: str, user: dict = Depends(get_current_user)):
    # v160.3.9.28.1 — Regression fix (matches contractors list). Previously
    # gated by `require_permission("documents","view")` which 403'd for
    # workers (worker.documents.view=False). Per Phase 3b brief: list
    # GETs open to authenticated users must narrow via scope_filter, not
    # reject. Worker sees only their own uploads / assignments.
    #
    # v58.13.132km — Shared-reference short-circuit. WHS legal risk fix:
    # non-privileged users (workers, general_users, preview-mode viewers)
    # were seeing an empty SDS folder because `scope_filter("documents")`
    # narrows to `{created_by: uid} OR {assignee_id: uid}` and shared
    # reference files were uploaded by admins. Under AU WHS Regulation
    # 344 employers MUST make SDS available to any worker handling the
    # chemicals — a fail-narrow scope was hiding legally-required
    # documents. Folders marked `shared_reference:True` bypass the
    # user-level narrowing entirely; the org boundary (org_id) is still
    # enforced, and the per-record `category_visible(...)` post-filter
    # still runs so category-level access controls are honoured.
    folder = await _resolve_folder(folder_id, user["org_id"])
    if folder.get("shared_reference"):
        _scope: dict = {}
    else:
        _scope = scope_filter(user, "documents")
        if _scope.get("__scope_no_match__"):
            return []
    # v58.13.132if — Auto-archive-on-fetch sweep. Any doc_file in this
    # folder whose `expiry_date < today` AND `archived_at IS NULL`
    # AND `deleted_at IS NULL` is flipped to `archived_at = now()`.
    # Idempotent (second run matches 0 docs). Scoped per-folder so
    # the write blast radius is bounded per request.
    from datetime import date as _date
    today_iso = _date.today().isoformat()
    await db.doc_files.update_many(
        {
            "folder_id": folder_id, "org_id": user["org_id"],
            "deleted_at": None,
            "archived_at": None,
            "expiry_date": {"$lt": today_iso, "$ne": None},
        },
        {"$set": {"archived_at": now_iso(),
                  "archived_reason": "auto_expired"}},
    )
    cursor = db.doc_files.find(
        {"folder_id": folder_id, "org_id": user["org_id"], "deleted_at": None,
         **_scope},
        {"_id": 0},
    ).sort([("uploaded_at", -1)])
    files = await cursor.to_list(500)
    # v160.1 — per-record category visibility. Records without a
    # `category_id` behave exactly as before this cycle (migration-safe).
    from document_categories import category_visible  # local import: avoids circular
    visible: list = []
    for f in files:
        if await category_visible(user, f.get("category_id"), f.get("subject_worker_id")):
            visible.append(f)
    return [_serialise_file(f) for f in visible]


@router.post("/folders/{folder_id}/files", status_code=201)
async def upload_files(
    folder_id: str,
    files: List[UploadFile] = File(...),
    user: dict = Depends(require_permission("documents", "edit")),
):
    _require(user, WRITE_ROLES, action="upload")
    folder = await _resolve_folder(folder_id, user["org_id"])
    folder_dir = UPLOAD_DIR / folder["id"]
    folder_dir.mkdir(parents=True, exist_ok=True)

    saved = []
    rejected = []
    # v58.13.132gg — Bytes now go to GridFS via the shared helper
    # (`uploads_storage`). Size cap enforced pre-flight against an
    # in-memory buffer instead of a partial disk write, so a huge
    # upload never leaves an orphan file behind.
    from uploads_storage import save_upload  # noqa: WPS433 — lazy
    for upload in files:
        ext = _safe_ext(upload.filename)
        if not ext:
            rejected.append({
                "filename": upload.filename,
                "reason": "Unsupported file type — allowed: PDF, DOC, DOCX, XLS, XLSX, PNG, JPG, JPEG, TXT, CSV",
            })
            continue
        stored_name = f"{uuid.uuid4().hex}{ext}"
        # Enforce the 50 MB cap while draining the stream.
        buf = bytearray()
        oversize = False
        while True:
            chunk = await upload.read(1024 * 1024)
            if not chunk:
                break
            buf.extend(chunk)
            if len(buf) > MAX_FILE_BYTES:
                oversize = True
                break
        if oversize:
            rejected.append({"filename": upload.filename,
                              "reason": "Exceeds 50 MB limit"})
            continue
        size = len(buf)
        data = bytes(buf)
        await save_upload(
            "document_library", [folder["id"], stored_name], data,
            module="document_library",
            org_id=user["org_id"],
            mime=upload.content_type,
            orig_filename=upload.filename,
        )
        doc = {
            "id": new_id(),
            "org_id": user["org_id"],
            "folder_id": folder["id"],
            "filename": upload.filename or stored_name,
            "stored_name": stored_name,
            "mime": upload.content_type or "application/octet-stream",
            "size": size,
            "file_url": f"/api/files/document_library/{folder['id']}/{stored_name}",
            "uploaded_by": user["id"],
            "uploaded_by_name": user.get("name") or user.get("email"),
            "uploaded_at": now_iso(),
            "updated_at": now_iso(),
            "ai_tags": _stub_ai_tags(upload.filename or stored_name),
            "deleted_at": None,
        }
        await db.doc_files.insert_one(doc)
        # v58.13.132hf — Kick text extraction off in the background
        # using the buffer we already have in memory. Never blocks
        # the upload response; failures are logged and picked up by
        # the admin backfill worker on next sweep.
        try:
            import asyncio as _asyncio
            _asyncio.create_task(_extract_and_persist(
                doc["id"], user["org_id"], upload.filename or stored_name,
                doc["mime"], data,
            ))
        except Exception as _e:
            log_ex = _e
            del log_ex  # keep upload path silent
        saved.append(_serialise_file(doc))

    return {"saved": saved, "rejected": rejected}


# ─────────── v58.13.132hf — Text extraction pipeline ───────────
# Extracted-text lives on the doc_files row alongside the metadata
# it belongs to. On upload we kick off `_extract_and_persist` from
# the in-memory buffer; a boot-time backfill task sweeps every row
# whose `extracted_text` is still null.

_BACKFILL_STATE: dict = {
    "running": False,
    "started_at": None,
    "finished_at": None,
    "total": 0,
    "done": 0,
    "ok": 0,
    "failed": 0,
    "current_id": None,
    "cancel_requested": False,
    "engines": {},
}


async def _extract_and_persist(
    file_id: str, org_id: str, filename: str, mime: str, data: bytes,
) -> dict:
    """Run text_extraction and stamp the doc_files row. Never
    raises. Returns the extraction result dict."""
    try:
        from text_extraction import extract_text
        import asyncio as _asyncio
        # Extraction is CPU-bound (esp. Tesseract) so hop to a thread
        # to avoid blocking the event loop.
        result = await _asyncio.to_thread(
            extract_text, data, mime=mime, filename=filename,
        )
    except Exception as e:
        result = {"text": "", "engine": "unknown", "status": "failed", "chars": 0}
        try:
            import logging as _l
            _l.getLogger("paneltec.document_library").info(
                "extract_and_persist failed for %s: %s", file_id, e,
            )
        except Exception:
            pass
    patch: dict = {
        "extracted_text": result.get("text") or "",
        "extracted_text_at": now_iso(),
        "extraction_engine": result.get("engine"),
        "extraction_status": result.get("status"),
        "extracted_chars": result.get("chars", 0),
    }
    if result.get("status") != "ok":
        patch["extraction_failed_count"] = 1  # rebuilt via $inc below
        await db.doc_files.update_one(
            {"id": file_id, "org_id": org_id},
            {"$set": {k: v for k, v in patch.items()
                       if k != "extraction_failed_count"},
             "$inc": {"extraction_failed_count": 1}},
        )
    else:
        await db.doc_files.update_one(
            {"id": file_id, "org_id": org_id},
            {"$set": patch, "$unset": {"extraction_failed_count": ""}},
        )
    return result


async def _load_binary_for_file(doc: dict) -> Optional[bytes]:
    """Fetch the binary for a doc_files row from GridFS (preferred)
    or the legacy disk fallback."""
    url = doc.get("file_url") or ""
    if not url.startswith("/api/files/"):
        return None
    key = url[len("/api/files/"):]
    row = await db["upload_storage.files"].find_one(
        {"metadata.key": key}, {"_id": 1},
    )
    if row:
        from motor.motor_asyncio import AsyncIOMotorGridFSBucket
        bucket = AsyncIOMotorGridFSBucket(db, bucket_name="upload_storage")
        stream = await bucket.open_download_stream(row["_id"])
        buf = bytearray()
        while True:
            chunk = await stream.readchunk()
            if not chunk:
                break
            buf.extend(chunk)
            if len(buf) > 60 * 1024 * 1024:  # ~50 MB cap + slack
                break
        return bytes(buf)
    # Legacy disk fallback (pre-.132gh migrations)
    disk = UPLOAD_DIR.parent / key
    if disk.exists():
        try:
            return disk.read_bytes()
        except Exception:
            return None
    return None


async def _run_backfill(org_id: Optional[str] = None) -> None:
    """Sweep every doc_files row whose extracted_text is still
    unpopulated and run the extractor. Progress is tracked in the
    module-level `_BACKFILL_STATE` dict so the admin status endpoint
    can report on it. Cancel-safe: sets a flag the loop watches."""
    if _BACKFILL_STATE["running"]:
        return
    _BACKFILL_STATE.update({
        "running": True,
        "started_at": now_iso(),
        "finished_at": None,
        "total": 0,
        "done": 0,
        "ok": 0,
        "failed": 0,
        "current_id": None,
        "cancel_requested": False,
        "engines": {},
    })
    try:
        query: dict = {
            "deleted_at": None,
            "$or": [
                {"extracted_text": {"$exists": False}},
                {"extracted_text": None},
                {"extracted_text": ""},
            ],
        }
        if org_id:
            query["org_id"] = org_id
        _BACKFILL_STATE["total"] = await db.doc_files.count_documents(query)
        cursor = db.doc_files.find(query, {"_id": 0}).batch_size(20)
        async for doc in cursor:
            if _BACKFILL_STATE["cancel_requested"]:
                break
            _BACKFILL_STATE["current_id"] = doc.get("id")
            data = await _load_binary_for_file(doc)
            if data is None:
                # No binary — mark failed and move on.
                await db.doc_files.update_one(
                    {"id": doc["id"], "org_id": doc["org_id"]},
                    {"$set": {
                        "extraction_status": "failed",
                        "extraction_engine": "missing-binary",
                        "extracted_text_at": now_iso(),
                    }},
                )
                _BACKFILL_STATE["failed"] += 1
                _BACKFILL_STATE["engines"]["missing-binary"] = \
                    _BACKFILL_STATE["engines"].get("missing-binary", 0) + 1
            else:
                res = await _extract_and_persist(
                    doc["id"], doc["org_id"], doc.get("filename") or "",
                    doc.get("mime") or "", data,
                )
                if res.get("status") == "ok":
                    _BACKFILL_STATE["ok"] += 1
                else:
                    _BACKFILL_STATE["failed"] += 1
                eng = res.get("engine") or "unknown"
                _BACKFILL_STATE["engines"][eng] = \
                    _BACKFILL_STATE["engines"].get(eng, 0) + 1
            _BACKFILL_STATE["done"] += 1
    finally:
        _BACKFILL_STATE["running"] = False
        _BACKFILL_STATE["finished_at"] = now_iso()
        _BACKFILL_STATE["current_id"] = None


@router.post("/admin/backfill-extracted-text")
async def start_backfill(
    scope_org: bool = True,
    user: dict = Depends(require_permission("documents", "edit")),
):
    """v58.13.132hf — Admin: kick off the extraction backfill. Runs
    as a background asyncio task so the call returns immediately.
    Idempotent: if a backfill is already running, returns the
    current state instead of starting a second one.
    Set `scope_org=false` (admin-of-admins) to sweep every org.
    """
    _require(user, {"admin"}, action="backfill-extracted-text")
    if _BACKFILL_STATE["running"]:
        return {"already_running": True, **_BACKFILL_STATE}
    import asyncio as _asyncio
    scope = user["org_id"] if scope_org else None
    _asyncio.create_task(_run_backfill(scope))
    return {"started": True, "scope_org": scope}


@router.get("/admin/backfill-extracted-text/status")
async def backfill_status(
    user: dict = Depends(require_permission("documents", "edit")),
):
    """v58.13.132hf — Admin: current backfill progress."""
    _require(user, {"admin"}, action="backfill-status")
    return dict(_BACKFILL_STATE)


@router.post("/admin/backfill-extracted-text/cancel")
async def cancel_backfill(
    user: dict = Depends(require_permission("documents", "edit")),
):
    """v58.13.132hf — Admin: request the backfill loop to stop after
    its current row. Idempotent no-op if nothing is running."""
    _require(user, {"admin"}, action="backfill-cancel")
    _BACKFILL_STATE["cancel_requested"] = True
    return {"cancel_requested": True}

@router.post("/files/{file_id}/retry-extract-ai")
async def retry_extract_ai(
    file_id: str,
    user: dict = Depends(require_permission("documents", "edit")),
):
    """v58.13.132hg — On-demand Claude Vision retry for a single
    file whose local extraction failed. Per user PII posture:
    user-triggered per file only, never automatic, never batch.
    Uses `emergentintegrations` + Claude Sonnet 4.5 via the
    Emergent LLM key. Cost estimate: ~$0.01 per file (multi-page
    PDFs may run a little higher).
    """
    _require(user, {"admin"}, action="retry-extract-ai")
    org_id = user["org_id"]
    doc = await db.doc_files.find_one(
        {"id": file_id, "org_id": org_id, "deleted_at": None},
    )
    if not doc:
        raise HTTPException(404, "File not found")
    data = await _load_binary_for_file(doc)
    if data is None:
        raise HTTPException(410, "Binary not available in storage")

    import base64
    import asyncio as _asyncio
    mime_l = (doc.get("mime") or "").lower()
    filename = doc.get("filename") or ""

    def _to_images() -> list:
        from PIL import Image
        import io as _io
        images: list = []
        if mime_l == "application/pdf" or filename.lower().endswith(".pdf"):
            # v58.13.132lc — pdf2image (Poppler) → pymupdf in-process.
            import fitz  # pymupdf
            with fitz.open(stream=data, filetype="pdf") as pdf:
                for i, page in enumerate(pdf):
                    if i >= 8:
                        break
                    zoom = 180.0 / 72.0
                    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom))
                    jpeg = pix.tobytes("jpeg", jpg_quality=75)
                    images.append(base64.b64encode(jpeg).decode())
        elif mime_l.startswith("image/"):
            img = Image.open(_io.BytesIO(data))
            if img.mode not in ("L", "RGB"): img = img.convert("RGB")
            buf = _io.BytesIO(); img.save(buf, "JPEG", quality=80)
            images.append(base64.b64encode(buf.getvalue()).decode())
        elif filename.lower().endswith(".docx") or mime_l == \
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
            # v58.13.132lc — .docx AI retry: pipe through file_pdf's
            # in-process python-docx→reportlab pipeline (was LibreOffice).
            from file_pdf import _docx_to_pdf
            import fitz  # pymupdf
            pdf_bytes, _ = _docx_to_pdf(data, filename or "document.docx")
            with fitz.open(stream=pdf_bytes, filetype="pdf") as pdf:
                for i, page in enumerate(pdf):
                    if i >= 8:
                        break
                    zoom = 180.0 / 72.0
                    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom))
                    jpeg = pix.tobytes("jpeg", jpg_quality=75)
                    images.append(base64.b64encode(jpeg).decode())
        elif filename.lower().endswith(".xlsx") or mime_l == \
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
            from file_pdf import _xlsx_to_pdf
            import fitz  # pymupdf
            pdf_bytes = _xlsx_to_pdf(data, filename or "document.xlsx")
            with fitz.open(stream=pdf_bytes, filetype="pdf") as pdf:
                for i, page in enumerate(pdf):
                    if i >= 8:
                        break
                    zoom = 180.0 / 72.0
                    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom))
                    jpeg = pix.tobytes("jpeg", jpg_quality=75)
                    images.append(base64.b64encode(jpeg).decode())
        else:
            raise HTTPException(
                415,
                "AI retry: this file format is not supported for "
                "in-process rasterisation. Please download the "
                "original and re-upload as PDF.",
            )
        return images

    try:
        images_b64 = await _asyncio.to_thread(_to_images)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(415, f"AI retry rasterisation failed: {e}") from e
    if not images_b64:
        raise HTTPException(415, "AI retry: no pages")

    from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent
    import os as _os2
    import uuid as _uuid
    key = _os2.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise HTTPException(503, "Emergent LLM key not configured")
    chat = LlmChat(
        api_key=key, session_id=str(_uuid.uuid4()),
        system_message=(
            "You are a text extraction assistant. Return ONLY the plain "
            "text content of the document image(s). No commentary, no "
            "markdown. Preserve paragraph structure faithfully. If a "
            "page is unreadable, output '[unreadable]'."
        ),
    ).with_model("anthropic", "claude-sonnet-4-5-20250929")
    msg = UserMessage(
        text="Extract every readable text token from these document images verbatim.",
        file_contents=[ImageContent(image_base64=b) for b in images_b64],
    )
    try:
        reply = await chat.send_message(msg)
    except Exception as e:
        raise HTTPException(503, f"AI extract failed: {e}") from e
    text = reply if isinstance(reply, str) else getattr(reply, "content", str(reply))
    text = (text or "").strip()
    if not text:
        raise HTTPException(422, "AI returned no text")
    from text_extraction import MAX_EXTRACTED_CHARS
    if len(text) > MAX_EXTRACTED_CHARS:
        text = text[:MAX_EXTRACTED_CHARS] + "…[truncated]"
    await db.doc_files.update_one(
        {"id": file_id, "org_id": org_id},
        {"$set": {
            "extracted_text": text,
            "extracted_text_at": now_iso(),
            "extraction_engine": "claude",
            "extraction_status": "ok",
            "extracted_chars": len(text),
        },
         "$unset": {"extraction_failed_count": ""}},
    )
    await db.doc_files_audit.insert_one({
        "id": new_id(),
        "org_id": org_id,
        "file_id": file_id,
        "action": "extract_ai_retry",
        "actor_id": user["id"],
        "actor_name": user.get("name") or user.get("email"),
        "pages": len(images_b64),
        "chars": len(text),
        "created_at": now_iso(),
    })
    return {"ok": True, "engine": "claude", "pages": len(images_b64), "chars": len(text)}




async def schedule_boot_backfill(delay_seconds: int = 300) -> None:
    """v58.13.132hf — Server-boot hook. Waits `delay_seconds` (so
    backend startup isn't stalled) then kicks the backfill across
    every org whose files still have unpopulated `extracted_text`.
    Called from server.py once during app startup."""
    import asyncio as _asyncio
    try:
        await _asyncio.sleep(delay_seconds)
        if _BACKFILL_STATE["running"]:
            return
        await _run_backfill(org_id=None)
    except Exception:
        pass


# v58.13.132gt Phase 2 — SDS module enhancements. File rename +
# expiry_date. `filename` extension is preserved: renames that
# change the extension are rejected (defence against .exe /
# script uploads slipping through the display).
class FilePatch(BaseModel):
    filename: Optional[str] = Field(default=None, min_length=1, max_length=200)
    expiry_date: Optional[str] = Field(default=None, max_length=32)
    clear_expiry: bool = Field(default=False)
    # v58.13.132he — File DnD between folders. When set, the file is
    # moved to the target folder (same-org validated). Audited as
    # `file_moved` with old_folder_id → new_folder_id.
    folder_id: Optional[str] = Field(default=None, min_length=1, max_length=64)


@router.patch("/files/{file_id}")
async def rename_or_update_file(
    file_id: str,
    body: FilePatch,
    user: dict = Depends(require_permission("documents", "edit")),
):
    _require(user, WRITE_ROLES, action="edit")
    existing = await db.doc_files.find_one(
        {"id": file_id, "org_id": user["org_id"], "deleted_at": None},
    )
    if not existing:
        raise HTTPException(404, "File not found")

    patch: dict = {}
    if body.filename is not None:
        new_name = body.filename.strip()
        if not new_name:
            raise HTTPException(400, "Filename cannot be empty")
        old_ext = _safe_ext(existing.get("filename"))
        new_ext = _safe_ext(new_name)
        # v58.13.132gt Phase 2 — Guard rename against extension drift
        # AND against non-allow-listed extensions in the incoming name.
        # `_safe_ext` returns "" for anything not in ALLOWED_EXTS, so a
        # rename to `foo.exe` collapses to `new_ext=""` — we detect that
        # by re-parsing the raw suffix and rejecting when it doesn't
        # match the file's current extension.
        raw_new_suffix = Path(new_name).suffix.lower()
        if raw_new_suffix and raw_new_suffix != old_ext:
            raise HTTPException(400, "Cannot change file extension")
        if old_ext and new_ext and old_ext != new_ext:
            raise HTTPException(400, "Cannot change file extension")
        # If the user typed a name without an extension, auto-append
        # the original one so downstream MIME + inline-preview logic
        # continues to work.
        if old_ext and not raw_new_suffix:
            new_name = f"{new_name}{old_ext}"
        patch["filename"] = new_name

    if body.clear_expiry:
        patch["expiry_date"] = None
    elif body.expiry_date is not None:
        # Validate ISO-8601 YYYY-MM-DD (or full ISO datetime).
        import re as _re
        raw = body.expiry_date.strip()
        if not _re.match(r"^\d{4}-\d{2}-\d{2}", raw):
            raise HTTPException(400, "expiry_date must be ISO-8601 (YYYY-MM-DD)")
        patch["expiry_date"] = raw[:10]

    # v58.13.132he — File-move via folder_id. Validates the target
    # folder exists in the same org and isn't soft-deleted. No-op if
    # the file is already there.
    move_from_folder = None
    move_to_folder = None
    if body.folder_id is not None:
        target = body.folder_id.strip()
        if not target:
            raise HTTPException(400, "folder_id cannot be empty")
        if target != existing.get("folder_id"):
            target_doc = await db.doc_folders.find_one(
                {"id": target, "org_id": user["org_id"], "deleted_at": None},
                {"_id": 0, "id": 1, "name": 1},
            )
            if not target_doc:
                raise HTTPException(404, "Target folder not found")
            move_from_folder = existing.get("folder_id")
            move_to_folder = target
            patch["folder_id"] = target

    if not patch:
        raise HTTPException(400, "Nothing to update")

    patch["updated_at"] = now_iso()
    patch["updated_by"] = user["id"]

    r = await db.doc_files.find_one_and_update(
        {"id": file_id, "org_id": user["org_id"], "deleted_at": None},
        {"$set": patch},
        return_document=ReturnDocument.AFTER,
    )
    if not r:
        raise HTTPException(404, "File not found")
    # v58.13.132he — Emit audit trail on folder move.
    if move_to_folder is not None:
        await db.doc_files_audit.insert_one({
            "id": new_id(),
            "org_id": user["org_id"],
            "file_id": file_id,
            "action": "file_moved",
            "actor_id": user["id"],
            "actor_name": user.get("name") or user.get("email"),
            "filename": r.get("filename"),
            "old_folder_id": move_from_folder,
            "new_folder_id": move_to_folder,
            "created_at": now_iso(),
        })
    return _serialise_file(r)


@router.delete("/files/{file_id}", status_code=204)
async def delete_file(file_id: str, user: dict = Depends(require_permission("documents", "delete"))):
    _require(user, WRITE_ROLES, action="delete")
    ts = now_iso()
    # Snapshot filename BEFORE the update so the audit row can name
    # the file (v58.13.132fj — Section E delete-audit).
    existing = await db.doc_files.find_one(
        {"id": file_id, "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0, "filename": 1},
    )
    result = await db.doc_files.update_one(
        {"id": file_id, "org_id": user["org_id"], "deleted_at": None},
        {"$set": {"deleted_at": ts, "updated_at": ts}},
    )
    if result.matched_count == 0:
        raise HTTPException(404, "File not found")
    # v58.13.132fj — archive_audit trail.
    from archive_audit_helpers import record_file_archive_audit
    await record_file_archive_audit(
        module="documents", resource="doc_files",
        resource_id=file_id,
        filename=(existing or {}).get("filename"),
        user=user,
    )
    return None


# v58.13.132if — Manual archive / restore for Doc Library files.
# Pairs with the auto-archive-on-fetch sweep in `list_files` so
# expired compliance docs (SDS / Licences & Tickets etc.) drop
# into the Archived accordion without needing a cron.
@router.post("/files/{file_id}/archive")
async def archive_file(file_id: str, user: dict = Depends(require_permission("documents", "edit"))):
    _require(user, WRITE_ROLES, action="archive")
    ts = now_iso()
    existing = await db.doc_files.find_one(
        {"id": file_id, "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0},
    )
    if not existing:
        raise HTTPException(404, "File not found")
    await db.doc_files.update_one(
        {"id": file_id, "org_id": user["org_id"]},
        {"$set": {"archived_at": ts, "archived_reason": "manual",
                  "archived_by": user["id"], "updated_at": ts}},
    )
    fresh = await db.doc_files.find_one({"id": file_id}, {"_id": 0})
    return _serialise_file(fresh)


@router.post("/files/{file_id}/restore")
async def restore_file(file_id: str, user: dict = Depends(require_permission("documents", "edit"))):
    _require(user, WRITE_ROLES, action="restore")
    ts = now_iso()
    existing = await db.doc_files.find_one(
        {"id": file_id, "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0},
    )
    if not existing:
        raise HTTPException(404, "File not found")
    await db.doc_files.update_one(
        {"id": file_id, "org_id": user["org_id"]},
        {"$set": {"archived_at": None, "archived_reason": None,
                  "archived_by": None, "updated_at": ts}},
    )
    fresh = await db.doc_files.find_one({"id": file_id}, {"_id": 0})
    return _serialise_file(fresh)


@router.get("/files/{file_id}/download")
async def download_file(
    file_id: str,
    # v58.13.72 — Default disposition is `inline` for PDFs so a
    # filename click opens the file in the browser's PDF viewer
    # instead of triggering a "Save As" dialog. v58.13.73 extends
    # the inline set to every MIME the browser can render natively:
    # PDF, common raster/vector images, plain text, JSON, XML. CSV
    # is intentionally kept as `attachment` because users almost
    # always want to open it in Excel/Numbers, not a bare browser
    # tab. Office formats (docx/xlsx/pptx/odt), archives (zip/rar)
    # and everything else stay `attachment` — browsers can't render
    # them and click-to-save is the correct affordance.
    #
    # `?download=1` forces `attachment` for ANY MIME (matches the
    # v58.13.51 pattern used across cert/forms/pdf_routes).
    download: int = Query(0, ge=0, le=1),
    user: dict = Depends(require_permission("documents", "view")),
):
    doc = await db.doc_files.find_one(
        {"id": file_id, "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0},
    )
    if not doc:
        raise HTTPException(404, "File not found")
    # v58.13.132gg — Try GridFS first (post-.132gf), fall back to
    # the pre-migration local-disk path so files uploaded before
    # `scripts/migrate_ephemeral_to_gridfs.py --run` still stream.
    from uploads_storage import read_upload  # noqa: WPS433 — lazy
    hit = await read_upload("document_library",
                              [doc["folder_id"], doc["stored_name"]])
    if download:
        disp = "attachment"
    else:
        disp = "inline" if _is_browser_renderable(doc) else "attachment"
    if hit is not None:
        data, mime = hit
        from fastapi.responses import Response
        headers = {
            "Content-Disposition": f'{disp}; filename="{doc["filename"]}"',
        }
        return Response(content=data,
                          media_type=mime or doc.get("mime")
                          or "application/octet-stream",
                          headers=headers)
    path = UPLOAD_DIR / doc["folder_id"] / doc["stored_name"]
    if not path.exists():
        raise missing_file_response()
    return FileResponse(
        str(path),
        media_type=doc.get("mime") or "application/octet-stream",
        filename=doc.get("filename"),
        content_disposition_type=disp,
    )


# MOCKED: This is a basic Mongo regex search across filename + ai_tags only.
# Future work: ingest extracted_text (PDF parsing) and switch to a vector RAG
# index for true semantic Smart Search.
@router.get("/search")
async def search(
    q: str = Query(min_length=1, max_length=120),
    folder_id: Optional[str] = None,
    recursive: bool = True,
    user: dict = Depends(require_permission("documents", "view")),
):
    """v58.13.132gb — Document Library search.

    Enhanced from the pre-`.132gb` endpoint:
      · Adds `folder_id` (optional) + `recursive=true` (default) —
        restrict search to a folder and its descendants.
      · Matches uploader name (`uploaded_by_name`) as well as
        filename + AI tags.
      · Returns `folder_path` (breadcrumb) + `match_field` for each
        hit so the UI can annotate the reason a row matched.

    v58.13.132hb — Separator-agnostic matching.
      Underscore / hyphen / whitespace are treated as interchangeable
      in BOTH the DB regex and the client-side `match_field` scoring.
      So `SF_22`, `SF-22`, `SF 22`, `SF22` all resolve to the same
      hit `2025_SF-22_Bomb_Threat_Report V10.0.docx`. Fixes a
      recurring UX papercut where Stephen's memory of a code (`SF_22`)
      doesn't match the source-of-truth punctuation (`SF-22`).

    Case-insensitive substring match. Returns up to 60 rows sorted
    by upload date desc.
    """
    org_id = user["org_id"]
    raw = q.strip()

    # v58.13.132hb — Build a separator-agnostic pattern.
    # Strip all separator characters (space / _ / -) from the query
    # to get the meaningful "core" characters, then interleave the
    # separator group `[ _-]*` between them. So `SF_22`, `SF-22`,
    # `SF 22`, and `SF22` all normalise to `S[ _-]*F[ _-]*2[ _-]*2`
    # which matches every punctuation variant in the DB.
    def _normalised_pattern(needle: str) -> str:
        seps = set(" _-")
        core = [ch for ch in needle if ch not in seps]
        if not core:
            return re.escape(needle)
        return "[ _-]*".join(re.escape(c) for c in core)

    pattern = _normalised_pattern(raw)

    query: dict = {
        "org_id": org_id,
        "deleted_at": None,
        "$or": [
            {"filename": {"$regex": pattern, "$options": "i"}},
            {"ai_tags": {"$regex": pattern, "$options": "i"}},
            {"uploaded_by_name": {"$regex": pattern, "$options": "i"}},
        ],
    }
    # v58.13.132hg — Content-search additive branch. If the query is
    # long enough to be meaningful (>= 2 chars), also match against
    # `extracted_text` via a case-insensitive regex on the SAME
    # separator-agnostic pattern. Regex hits above filename are
    # already covered by the top $or; this branch surfaces files
    # whose CONTENTS mention the query even when the filename does
    # not (e.g. "harness" hitting a SWMS page).
    if len(raw) >= 2:
        query["$or"].append(
            {"extracted_text": {"$regex": pattern, "$options": "i"}},
        )
    # v58.13.132gb — Folder scope with optional recursive descent.
    # When `folder_id` is provided we resolve every descendant folder
    # (BFS) so a search from "Alcohol & Drug Screening" also finds
    # files in a per-worker subfolder inside it.
    if folder_id:
        allowed_ids: list = [folder_id]
        if recursive:
            frontier: list = [folder_id]
            visited: set = {folder_id}
            for _ in range(20):  # depth guard — 20 levels is generous
                if not frontier:
                    break
                cursor = db.doc_folders.find(
                    {"org_id": org_id,
                     "parent_folder_id": {"$in": frontier},
                     "deleted_at": None},
                    {"_id": 0, "id": 1},
                )
                next_frontier: list = []
                async for fd in cursor:
                    if fd["id"] in visited:
                        continue
                    visited.add(fd["id"])
                    allowed_ids.append(fd["id"])
                    next_frontier.append(fd["id"])
                frontier = next_frontier
        query["folder_id"] = {"$in": allowed_ids}

    cursor = db.doc_files.find(query, {"_id": 0}).sort(
        [("uploaded_at", -1)]).limit(60)
    files = await cursor.to_list(60)

    # Attach folder name + path for context.
    folder_ids = list({f["folder_id"] for f in files})
    folder_map: dict = {}
    if folder_ids:
        async for fd in db.doc_folders.find(
            {"id": {"$in": folder_ids}, "org_id": org_id},
            {"_id": 0, "id": 1, "name": 1, "color_key": 1,
             "parent_folder_id": 1},
        ):
            folder_map[fd["id"]] = fd

    # Build a folder_path (breadcrumb) for each hit — walk parent
    # links up to a small depth. Cached across hits in the same
    # response so a big result set doesn't re-walk repeatedly.
    path_cache: dict = {}

    async def _folder_path(fid: Optional[str]) -> str:
        if not fid:
            return ""
        if fid in path_cache:
            return path_cache[fid]
        parts: list = []
        cur = folder_map.get(fid)
        seen: set = set()
        while cur and cur["id"] not in seen and len(parts) < 8:
            seen.add(cur["id"])
            parts.append(cur["name"])
            parent_id = cur.get("parent_folder_id")
            if not parent_id:
                break
            cur = folder_map.get(parent_id)
            if not cur:
                nxt = await db.doc_folders.find_one(
                    {"id": parent_id, "org_id": org_id},
                    {"_id": 0, "id": 1, "name": 1,
                     "parent_folder_id": 1, "color_key": 1},
                )
                if nxt:
                    folder_map[parent_id] = nxt
                    cur = nxt
                else:
                    cur = None
        path = " / ".join(reversed(parts))
        path_cache[fid] = path
        return path

    def _match_field(doc: dict) -> str:
        # v58.13.132hb — Mirror the DB-side separator normalisation
        # here so the UI label agrees with the actual hit. Both the
        # haystack (filename / tag / uploader) and the needle collapse
        # separator characters to nothing before the substring check.
        # v58.13.132hg — Content match returns `content` and drives
        # snippet rendering downstream.
        def _strip_seps(s: str) -> str:
            return "".join(c for c in (s or "").lower() if c not in " _-")

        needle = _strip_seps(q)
        if needle and needle in _strip_seps(doc.get("filename") or ""):
            return "filename"
        for t in (doc.get("ai_tags") or []):
            if needle and needle in _strip_seps(t):
                return "tags"
        if needle and needle in _strip_seps(doc.get("uploaded_by_name") or ""):
            return "uploader"
        if needle and needle in _strip_seps(doc.get("extracted_text") or ""):
            return "content"
        return "filename"

    def _content_snippet(doc: dict) -> Optional[str]:
        """v58.13.132hg — 120-char window around the first content
        match. Returns None when this row is not a content hit."""
        text = doc.get("extracted_text") or ""
        if not text:
            return None
        # Use the same normalised pattern so hyphen/underscore/space
        # queries all resolve. Compile case-insensitive.
        try:
            match = re.search(pattern, text, re.I)
        except re.error:
            return None
        if not match:
            return None
        start = max(0, match.start() - 60)
        end = min(len(text), match.end() + 60)
        prefix = "…" if start > 0 else ""
        suffix = "…" if end < len(text) else ""
        snippet = text[start:end].replace("\n", " ").replace("  ", " ")
        return prefix + snippet.strip() + suffix

    results = []
    for f in files:
        mf = _match_field(f)
        entry = {
            **_serialise_file(f),
            "file_id": f["id"],
            "folder": folder_map.get(f["folder_id"]),
            "folder_path": await _folder_path(f["folder_id"]),
            "match_field": mf,
        }
        if mf == "content":
            entry["snippet"] = _content_snippet(f)
        results.append(entry)
    # v58.13.132hg — Rank filename/tags/uploader ABOVE content hits
    # so exact-name lookups (`SF-22`, uploader "Stephen") keep top
    # slots. Within each tier, preserve the DB's uploaded-desc sort.
    rank = {"filename": 0, "tags": 1, "uploader": 2, "content": 3}
    results.sort(key=lambda r: rank.get(r.get("match_field") or "filename", 4))
    return {"query": q, "count": len(results), "results": results,
              "folder_id": folder_id, "recursive": bool(recursive)}



# ────────────────────── Supplier-scoped folders ──────────────────────
# Sibling routes that filter `doc_folders` by `supplier_id`. Files reuse the
# main `/api/document-library/folders/{id}/files` endpoints — once a folder
# exists, supplier scoping is just a query filter on the listing side.

from fastapi import APIRouter as _AR

supplier_folders_router = _AR(prefix="/suppliers", tags=["supplier-folders"])


@supplier_folders_router.get("/{supplier_id}/folders")
async def supplier_list_folders(supplier_id: str, user: dict = Depends(get_current_user)):
    cursor = db.doc_folders.find(
        {"org_id": user["org_id"], "supplier_id": supplier_id, "deleted_at": None},
        {"_id": 0},
    ).sort([("sort_order", 1), ("name", 1)])
    folders = await cursor.to_list(500)
    counts = await _file_counts(user["org_id"])
    return [_serialise_folder(f, counts.get(f["id"], 0)) for f in folders]


@supplier_folders_router.post("/{supplier_id}/folders", status_code=201)
async def supplier_create_folder(
    supplier_id: str, body: FolderIn, user: dict = Depends(require_permission("documents", "edit")),
):
    _require(user, WRITE_ROLES)
    last = await db.doc_folders.find_one(
        {"org_id": user["org_id"], "supplier_id": supplier_id, "deleted_at": None},
        {"_id": 0, "sort_order": 1},
        sort=[("sort_order", -1)],
    )
    next_order = ((last or {}).get("sort_order") or 0) + 10
    color = (body.color_key or PASTEL_CYCLE[next_order // 10 % len(PASTEL_CYCLE)]).strip().lower()
    doc = {
        "id": new_id(), "org_id": user["org_id"],
        "supplier_id": supplier_id,
        "name": body.name.strip(), "color_key": color,
        "sort_order": next_order, "is_system": False,
        "created_at": now_iso(), "updated_at": now_iso(),
        "created_by": user["id"], "deleted_at": None,
    }
    await db.doc_folders.insert_one(doc)
    return _serialise_folder(doc, 0)


async def supplier_folder_file_counts(org_id: str) -> dict:
    """Total file count grouped by supplier_id (for the Folders chip badge)."""
    pipeline = [
        {"$match": {"org_id": org_id, "deleted_at": None,
                    "supplier_id": {"$exists": True, "$ne": None}}},
        {"$lookup": {
            "from": "doc_files",
            "let": {"fid": "$id"},
            "pipeline": [
                {"$match": {"$expr": {"$and": [
                    {"$eq": ["$folder_id", "$$fid"]},
                    {"$eq": ["$deleted_at", None]},
                ]}}},
                {"$count": "n"},
            ],
            "as": "files",
        }},
        {"$group": {
            "_id": "$supplier_id",
            "n": {"$sum": {"$ifNull": [{"$arrayElemAt": ["$files.n", 0]}, 0]}},
        }},
    ]
    out: dict = {}
    async for row in db.doc_folders.aggregate(pipeline):
        if row["_id"]:
            out[row["_id"]] = row["n"]
    return out

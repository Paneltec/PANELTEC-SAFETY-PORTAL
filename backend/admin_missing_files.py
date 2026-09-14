"""v58.13.132gh — Admin surface for files whose bytes are missing.

Post-`.132gh` reality:
  · Every existing file on pod disk has been swept into the shared
    GridFS `upload_storage` bucket by `scripts/migrate_ephemeral_to_gridfs.py`.
  · A small residue of `doc_files` (and future extensions) still have
    a live DB row but no disk file AND no GridFS blob — these are the
    records that raise `410 file_missing_on_disk` when Stephen opens
    them (see `backend/missing_file_response.py`).

This module scans for that residue and returns a grouped, admin-only
report so the FE can render a "Files needing reupload" surface with
prominent Reupload / Remove affordances.

Scope
-----
Current scan covers `doc_files` only (the highest-volume, highest-
visibility store). Extension points are commented — worker_certs,
form_photos, form_attachments, contractor_docs, schedule_attachments,
hazards, and swms_scans all check out clean after the `.132gh` sweep
(0 disk-only rows remain), but a future scan should span them once
a new class of orphan appears.

The scan is READ-ONLY — no data is written to the DB. This is
intentional: an admin can rescan safely at any time, and the result
is always live.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from auth import get_current_user
from db import db
from uploads_storage import has_upload

log = logging.getLogger("paneltec.admin.missing_files")

router = APIRouter(prefix="/admin/missing-files",
                   tags=["admin-missing-files"])

UPLOAD_ROOT = Path(__file__).resolve().parent / "uploads"


def _require_admin(user: dict) -> None:
    if (user or {}).get("role") != "admin":
        raise HTTPException(403, "Admin only")


async def _scan_doc_files(org_id: str) -> list[dict[str, Any]]:
    """Return every non-deleted `doc_files` row whose bytes are gone
    (no local disk file AND no GridFS blob). Each item is enriched
    with the parent record (worker_certification, induction, etc.)
    so the FE can route the Reupload action to the right endpoint."""
    orphans: list[dict[str, Any]] = []

    async for f in db.doc_files.find(
        {"org_id": org_id, "deleted_at": None},
        {"_id": 0, "id": 1, "folder_id": 1, "stored_name": 1,
         "filename": 1, "mime": 1, "size": 1,
         "uploaded_by_name": 1, "uploaded_at": 1,
         "uploaded_via": 1, "worker_id": 1, "worker_name": 1,
         "seed_folder": 1},
    ):
        stored = f.get("stored_name")
        folder = f.get("folder_id")
        if not stored or not folder:
            # Old rows can lack these — treat as orphaned metadata.
            orphans.append({**f, "reason": "missing_metadata"})
            continue
        # GridFS check first (fastest, matches serve order).
        if await has_upload("document_library", [folder, stored]):
            continue
        disk_path = UPLOAD_ROOT / "document_library" / folder / stored
        if disk_path.is_file():
            continue
        # Byte-less. Find the parent record so the FE can reupload.
        parent = await _find_parent_record(f["id"], org_id)
        orphans.append({**f, "reason": "missing_source", **parent})
    return orphans


async def _find_parent_record(file_id: str, org_id: str) -> dict[str, Any]:
    """Best-effort parent lookup so the FE can wire a Reupload button
    at the right endpoint. Returns `{}` if no parent is found."""
    # Worker certification (most common — Stephen's original 410).
    cert = await db.worker_certifications.find_one(
        {"doc_file_id": file_id, "org_id": org_id, "deleted_at": None},
        {"_id": 0, "id": 1, "worker_id": 1, "name": 1, "category": 1,
         "column_key": 1},
    )
    if cert:
        return {
            "parent_kind": "worker_certification",
            "parent_id": cert["id"],
            "parent_label": cert.get("name") or "Certification",
            "parent_worker_id": cert.get("worker_id"),
            "reupload_endpoint": (
                f"/api/workers/{cert['worker_id']}/certifications/"
                f"{cert['id']}/upload"
            ),
        }
    # Induction (via card upload endpoint).
    ind = await db.worker_certifications.find_one(
        {"doc_file_id": file_id, "org_id": org_id, "deleted_at": None,
         "category": {"$in": ["site_induction", "competency", "license"]}},
        {"_id": 0, "id": 1, "worker_id": 1},
    )
    if ind:
        return {
            "parent_kind": "induction",
            "parent_id": ind["id"],
            "parent_worker_id": ind["worker_id"],
            "reupload_endpoint": (
                f"/api/workers/{ind['worker_id']}/inductions/"
                f"{ind['id']}/file"
            ),
        }
    # No parent — the record is a plain Document Library file.
    return {
        "parent_kind": "document_library",
        "parent_id": None,
        "reupload_endpoint": None,
    }


@router.get("/scan")
async def scan_missing_files(user: dict = Depends(get_current_user)):
    """Admin-only scan of orphaned file records.

    Returns:
        {
          "total": int,
          "by_kind": {"worker_certification": int, ...},
          "items": [
            {id, filename, folder_id, stored_name, mime, size,
             uploaded_at, uploaded_by_name, worker_id, worker_name,
             seed_folder, reason,
             parent_kind, parent_id, parent_label,
             parent_worker_id, reupload_endpoint}
          ]
        }

    `items` is capped at 500 to keep the response responsive; if
    Paneltec ever accrues more than 500 orphans the sweep script
    needs a rerun.
    """
    _require_admin(user)
    items = await _scan_doc_files(user["org_id"])
    by_kind: dict[str, int] = {}
    for it in items:
        k = it.get("parent_kind") or "document_library"
        by_kind[k] = by_kind.get(k, 0) + 1
    items.sort(key=lambda x: (x.get("uploaded_at") or ""), reverse=True)
    return {
        "total": len(items),
        "by_kind": by_kind,
        "items": items[:500],
    }


@router.delete("/files/{file_id}", status_code=204)
async def hard_remove_orphan(
    file_id: str, user: dict = Depends(get_current_user),
):
    """Admin-only tombstone for a truly-lost file record.

    Different from the standard soft-delete: we mark the record with
    `deleted_reason="admin_removed_orphan_v58.13.132gh"` so an audit
    can distinguish "user removed" from "byte-less cleanup".
    Cascades to any `worker_certifications.doc_file_id` reference so
    the cert row loses its stale pointer.
    """
    _require_admin(user)
    doc = await db.doc_files.find_one(
        {"id": file_id, "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0, "id": 1, "filename": 1},
    )
    if not doc:
        raise HTTPException(404, "File record not found")

    from datetime import datetime, timezone
    ts = datetime.now(timezone.utc).isoformat()
    await db.doc_files.update_one(
        {"id": file_id, "org_id": user["org_id"]},
        {"$set": {"deleted_at": ts, "deleted_by": user["id"],
                  "deleted_reason": "admin_removed_orphan_v58.13.132gh"}},
    )
    # Cascade: null out doc_file_id on any cert pointing here.
    await db.worker_certifications.update_many(
        {"doc_file_id": file_id, "org_id": user["org_id"]},
        {"$set": {"doc_file_id": None, "doc_folder_id": None,
                  "updated_at": ts}},
    )
    await db.archive_audit.insert_one({
        "id": ts.replace(":", "").replace(".", "")[:24],
        "module": "admin_missing_files",
        "resource": "doc_files",
        "resource_id": file_id,
        "action": "admin_removed_orphan",
        "timestamp": ts,
        "affected_count": 1,
        "note": f"file: {doc.get('filename')}",
        "actor_id": user["id"],
        "actor_name": user.get("name") or user.get("email"),
    })

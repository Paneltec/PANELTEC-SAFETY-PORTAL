"""v58.13.132ma — Document Library: Phase 1 backend.

Extends `document_library.py` with:
    · Explicit file sharing (`doc_shares`) — targets `user` / `all_workers`
      with `view` / `download` permissions. `group` target deferred to
      Phase 2 (no user-groups collection exists yet).
    · Bulk ZIP download for multi-select on the admin toolbar.
    · Folder recursive ZIP download.
    · Hard-delete for files + folders (existing endpoints soft-delete).
    · Folder-tree upload preserving relative paths.
    · `/shared-with-me` non-admin endpoint + share-scoped download.
    · One-shot migration: for every `doc_folder` with
      `shared_reference:True`, create `all_workers/download` shares
      for every file underneath so day-1 web behaviour is preserved.

Mounted under the existing `/document-library` prefix.

Storage backend note: Phase 1 uses the existing `uploads_storage`
(GridFS) write path — same as the legacy single-file upload. Phase 2
will land a `nas_client.fetch_and_put`-based flow for files > ~100 MB
via a pre-signed pod-hosted upload URL. Per-file cap for THIS ship
is 200 MB (raised from the legacy 50 MB); 5 GB requires the pre-signed
NAS upload flow which is deferred. Existing files' `storage_backend`
field is NEVER touched — the Dropbox → NAS migration is the
authoritative writer of that during its concurrent run.
"""
from __future__ import annotations

import io
import logging
import zipfile
from typing import Any, Dict, List, Optional

from fastapi import (
    APIRouter, Body, Depends, File, Form, HTTPException, UploadFile,
)
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from auth import get_current_user
from db import db
from models import new_id, now_iso
from permissions import require_module

log = logging.getLogger("paneltec.doclib.shares")

# Mount under the same prefix as the legacy doc lib so the UI can
# stay on one axios base URL.
router = APIRouter(
    prefix="/document-library",
    tags=["document-library"],
    dependencies=[Depends(require_module("document_library"))],
)

MAX_TREE_FILE_BYTES = 200 * 1024 * 1024   # 200 MB; 5 GB deferred to Phase 2
MAX_BULK_FILES = 500                        # sanity cap for zip download


# ── Admin guard ──────────────────────────────────────────────────
def _require_admin(user: dict = Depends(get_current_user)) -> dict:
    """Hard-cutover gate. Only role_id == 'admin' passes."""
    if (user or {}).get("role_id") != "admin":
        raise HTTPException(
            403, "administrators only — Document Library is admin-scoped",
        )
    return user


# ── Reused helpers (delegate to legacy module to avoid drift) ────
async def _resolve_folder(folder_id: str, org_id: str) -> dict:
    from document_library import _resolve_folder as _rf
    return await _rf(folder_id, org_id)


async def _resolve_file(file_id: str, org_id: str) -> dict:
    """Match legacy semantics — file must belong to caller's org and
    not be soft-deleted. Hard-delete callers still see soft-deleted
    rows (they're going away anyway) via `include_deleted=True`."""
    doc = await db.doc_files.find_one({
        "id": file_id, "org_id": org_id, "deleted_at": None,
    })
    if not doc:
        raise HTTPException(404, "file not found")
    return doc


def _serialise_file(doc: dict) -> dict:
    from document_library import _serialise_file as _sf
    return _sf(doc)


# ── Data model ───────────────────────────────────────────────────
class ShareCreate(BaseModel):
    target_type: str = Field(..., pattern=r"^(user|all_workers)$")
    target_id: Optional[str] = None
    permission: str = Field("view", pattern=r"^(view|download)$")


def _serialise_share(s: dict, target_name: Optional[str] = None) -> dict:
    return {
        "id": s["id"],
        "file_id": s["file_id"],
        "target_type": s["target_type"],
        "target_id": s.get("target_id"),
        "target_name": target_name,
        "permission": s["permission"],
        "granted_by": s.get("granted_by"),
        "granted_by_name": s.get("granted_by_name"),
        "created_at": s["created_at"],
        "revoked_at": s.get("revoked_at"),
    }


# ── Shares CRUD ──────────────────────────────────────────────────
@router.post("/files/{file_id}/shares", status_code=201)
async def create_share(file_id: str, body: ShareCreate,
                          user: dict = Depends(_require_admin)):
    doc = await _resolve_file(file_id, user["org_id"])
    if body.target_type == "user":
        if not body.target_id:
            raise HTTPException(400, "target_id required for target_type=user")
        target = await db.users.find_one(
            {"id": body.target_id, "org_id": user["org_id"]},
            {"_id": 0, "id": 1, "name": 1, "email": 1},
        )
        if not target:
            raise HTTPException(404, "target user not found in your org")

    share = {
        "id": new_id(),
        "org_id": user["org_id"],
        "file_id": doc["id"],
        "target_type": body.target_type,
        "target_id": body.target_id if body.target_type == "user" else None,
        "permission": body.permission,
        "granted_by": user["id"],
        "granted_by_name": user.get("name") or user.get("email"),
        "created_at": now_iso(),
        "revoked_at": None,
    }
    await db.doc_shares.insert_one(share)
    return _serialise_share(share)


@router.get("/files/{file_id}/shares")
async def list_shares(file_id: str,
                        user: dict = Depends(_require_admin)):
    doc = await _resolve_file(file_id, user["org_id"])
    cursor = db.doc_shares.find(
        {"file_id": doc["id"], "org_id": user["org_id"],
         "revoked_at": None},
        {"_id": 0},
    ).sort([("created_at", -1)])
    shares = await cursor.to_list(200)
    # Enrich with target user name when applicable.
    out: List[Dict[str, Any]] = []
    for s in shares:
        name = None
        if s["target_type"] == "user" and s.get("target_id"):
            u = await db.users.find_one(
                {"id": s["target_id"]},
                {"_id": 0, "name": 1, "email": 1},
            )
            if u:
                name = u.get("name") or u.get("email")
        elif s["target_type"] == "all_workers":
            name = "All Workers"
        out.append(_serialise_share(s, target_name=name))
    return out


@router.delete("/shares/{share_id}", status_code=204)
async def revoke_share(share_id: str,
                          user: dict = Depends(_require_admin)):
    r = await db.doc_shares.update_one(
        {"id": share_id, "org_id": user["org_id"], "revoked_at": None},
        {"$set": {"revoked_at": now_iso(),
                    "revoked_by": user["id"]}},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "share not found or already revoked")


# ── Shared with me (non-admin visible) ───────────────────────────
def _shares_query_for_user(user: dict) -> dict:
    """Mongo query matching active shares that grant `user` access."""
    return {
        "org_id": user["org_id"],
        "revoked_at": None,
        "$or": [
            {"target_type": "all_workers"},
            {"target_type": "user", "target_id": user["id"]},
        ],
    }


@router.get("/shared-with-me")
async def shared_with_me(user: dict = Depends(get_current_user)):
    """Non-admin endpoint. Returns files the current user has an
    active share on — deduped when multiple share rows point at the
    same file, preferring the highest permission."""
    shares = await db.doc_shares.find(
        _shares_query_for_user(user), {"_id": 0},
    ).to_list(2000)

    # Collapse to strongest permission per file_id.
    best: Dict[str, dict] = {}
    for s in shares:
        prev = best.get(s["file_id"])
        if prev is None or (
            prev["permission"] == "view" and s["permission"] == "download"
        ):
            best[s["file_id"]] = s
    if not best:
        return []

    files_cur = db.doc_files.find(
        {"id": {"$in": list(best.keys())},
         "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0},
    )
    out: List[Dict[str, Any]] = []
    async for f in files_cur:
        s = best[f["id"]]
        # Folder path context — 1 level up is enough for v1 UI.
        folder = await db.doc_folders.find_one(
            {"id": f.get("folder_id"), "org_id": user["org_id"]},
            {"_id": 0, "name": 1},
        )
        row = _serialise_file(f)
        row["shared_permission"] = s["permission"]
        row["shared_at"] = s["created_at"]
        row["shared_by"] = s.get("granted_by_name")
        row["folder_name"] = (folder or {}).get("name")
        out.append(row)
    return out


async def _user_has_download_share(user: dict, file_id: str) -> bool:
    if user.get("role_id") == "admin":
        return True
    n = await db.doc_shares.count_documents({
        **_shares_query_for_user(user),
        "file_id": file_id,
        "permission": "download",
    })
    return n > 0


async def _user_has_any_share(user: dict, file_id: str) -> bool:
    if user.get("role_id") == "admin":
        return True
    n = await db.doc_shares.count_documents({
        **_shares_query_for_user(user),
        "file_id": file_id,
    })
    return n > 0


@router.get("/shared-with-me/files/{file_id}/download")
async def shared_download(file_id: str,
                             user: dict = Depends(get_current_user)):
    """Share-scoped download. 403 if no download-permission share
    exists for this user + file combination. Admins bypass and get
    the raw stream (mirrors the legacy download endpoint's shape)."""
    if not await _user_has_download_share(user, file_id):
        raise HTTPException(
            403, "no download permission on this file",
        )
    doc = await _resolve_file(file_id, user["org_id"])
    from uploads_storage import read_upload
    got = await read_upload(
        "document_library", [doc["folder_id"], doc["stored_name"]],
    )
    if not got:
        raise HTTPException(410, "file bytes missing on backend")
    buf, mime = got

    def _iter():
        yield buf

    # v58.13.132mf — clean the hex-prefix off the filename before
    # sending it to the user; storage still uses the prefixed name.
    from display_filename import display_filename
    _disp_name = display_filename(doc["filename"]) or doc["filename"]
    headers = {
        "Content-Disposition":
            f'attachment; filename="{_disp_name}"',
        "Content-Length": str(len(buf)),
    }
    return StreamingResponse(
        _iter(),
        media_type=doc.get("mime") or mime or "application/octet-stream",
        headers=headers,
    )


# ── Bulk + folder ZIP (admin only) ───────────────────────────────
def _sanitise_zip_name(name: str) -> str:
    return name.replace("\x00", "").lstrip("/") or "file"


async def _zip_stream_from_files(files: List[dict]) -> StreamingResponse:
    """Stream a ZIP containing the given file docs. Reads each
    file's bytes from `uploads_storage`. Uses `zipfile.ZIP_STORED`
    so we don't pay CPU for compression on already-compressed
    PDFs/JPGs — the copy is bandwidth-bound anyway."""
    from uploads_storage import read_upload
    # v58.13.132mf — clean the hex-prefix off each ZIP entry name so
    # unzipping delivers user-friendly filenames. Only the last path
    # segment is stripped (folder names in `zip_path` are preserved).
    from display_filename import display_zip_arcname

    async def _gen():
        buf = io.BytesIO()
        with zipfile.ZipFile(
            buf, "w", compression=zipfile.ZIP_STORED,
        ) as zf:
            for f in files:
                got = await read_upload(
                    "document_library",
                    [f["folder_id"], f["stored_name"]],
                )
                if not got:
                    log.warning("[zip] skip %s (bytes missing)",
                                   f.get("id"))
                    continue
                body, _mime = got
                raw = _sanitise_zip_name(
                    f.get("zip_path") or f.get("filename") or "file",
                )
                arcname = display_zip_arcname(raw) or raw
                zf.writestr(arcname, body)
                yield buf.getvalue()
                buf.seek(0)
                buf.truncate()
        yield buf.getvalue()

    return StreamingResponse(
        _gen(),
        media_type="application/zip",
        headers={"Content-Disposition":
                     'attachment; filename="documents.zip"'},
    )


class BulkDownloadBody(BaseModel):
    file_ids: List[str]


@router.post("/download/bulk")
async def bulk_download(body: BulkDownloadBody,
                          user: dict = Depends(_require_admin)):
    if not body.file_ids:
        raise HTTPException(400, "file_ids empty")
    if len(body.file_ids) > MAX_BULK_FILES:
        raise HTTPException(
            400, f"too many files (max {MAX_BULK_FILES})",
        )
    cursor = db.doc_files.find(
        {"id": {"$in": body.file_ids},
         "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0},
    )
    files = await cursor.to_list(len(body.file_ids))
    if not files:
        raise HTTPException(404, "no matching files")
    return await _zip_stream_from_files(files)


@router.get("/folders/{folder_id}/download-zip")
async def folder_download_zip(folder_id: str,
                                 user: dict = Depends(_require_admin)):
    folder = await _resolve_folder(folder_id, user["org_id"])
    # Recursive walk: collect the folder + all descendants.
    all_folder_ids = [folder["id"]]
    stack = [folder["id"]]
    while stack:
        fid = stack.pop()
        async for sub in db.doc_folders.find(
            {"parent_folder_id": fid, "org_id": user["org_id"],
             "deleted_at": None},
            {"_id": 0, "id": 1, "name": 1, "parent_folder_id": 1},
        ):
            all_folder_ids.append(sub["id"])
            stack.append(sub["id"])

    # Build zip_path per file: <folder-name-chain>/<filename>.
    # Precompute name-per-id map.
    names: Dict[str, str] = {}
    parents: Dict[str, Optional[str]] = {}
    async for fdoc in db.doc_folders.find(
        {"id": {"$in": all_folder_ids}},
        {"_id": 0, "id": 1, "name": 1, "parent_folder_id": 1},
    ):
        names[fdoc["id"]] = fdoc["name"]
        parents[fdoc["id"]] = fdoc.get("parent_folder_id")

    def _path_for(fid: str) -> str:
        parts: List[str] = []
        cur = fid
        while cur and cur in names and cur != folder["id"]:
            parts.append(names[cur])
            cur = parents.get(cur)
        parts.append(names[folder["id"]])
        return "/".join(reversed(parts))

    files: List[dict] = []
    async for f in db.doc_files.find(
        {"folder_id": {"$in": all_folder_ids},
         "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0},
    ):
        f["zip_path"] = f"{_path_for(f['folder_id'])}/{f['filename']}"
        files.append(f)
    if not files:
        raise HTTPException(404, "folder is empty")
    return await _zip_stream_from_files(files)


# ── Hard delete (admin only) ─────────────────────────────────────
async def _hard_delete_file_row(doc: dict) -> None:
    """Delete GridFS bytes + doc_files row + revoke any shares.
    NAS-backed rows: enqueue a `delete_file` op via nas_client so
    the agent removes the bytes off the NAS. Ignores errors — the
    row is being purged regardless."""
    if doc.get("storage_backend") == "nas" and doc.get("nas_path"):
        try:
            import nas_client
            await nas_client.delete_file(doc["nas_path"])
        except Exception as e:   # noqa: BLE001
            log.warning("[hard-delete] NAS delete failed for %s: %s",
                           doc.get("id"), e)
    else:
        try:
            from uploads_storage import _bucket, _key
            key = _key(
                "document_library",
                [doc["folder_id"], doc["stored_name"]],
            )
            fs = _bucket()
            async for f in db.upload_storage.files.find(
                {"metadata.key": key}, {"_id": 1},
            ):
                try:
                    await fs.delete(f["_id"])
                except Exception:
                    pass
        except Exception as e:   # noqa: BLE001
            log.warning("[hard-delete] GridFS delete failed for %s: %s",
                           doc.get("id"), e)
    await db.doc_files.delete_one({"id": doc["id"]})
    await db.doc_shares.delete_many({"file_id": doc["id"]})


@router.delete("/files/{file_id}/hard", status_code=204)
async def hard_delete_file(file_id: str,
                              user: dict = Depends(_require_admin)):
    doc = await db.doc_files.find_one({
        "id": file_id, "org_id": user["org_id"],
    })
    if not doc:
        raise HTTPException(404, "file not found")
    await _hard_delete_file_row(doc)


@router.delete("/folders/{folder_id}/hard", status_code=204)
async def hard_delete_folder(folder_id: str,
                                user: dict = Depends(_require_admin)):
    folder = await _resolve_folder(folder_id, user["org_id"])
    if folder.get("is_system"):
        raise HTTPException(
            400, "system folders cannot be hard-deleted",
        )
    # Recursive purge.
    stack = [folder["id"]]
    all_ids = [folder["id"]]
    while stack:
        fid = stack.pop()
        async for sub in db.doc_folders.find(
            {"parent_folder_id": fid, "org_id": user["org_id"]},
            {"_id": 0, "id": 1},
        ):
            all_ids.append(sub["id"])
            stack.append(sub["id"])
    async for f in db.doc_files.find(
        {"folder_id": {"$in": all_ids},
         "org_id": user["org_id"]},
        {"_id": 0},
    ):
        await _hard_delete_file_row(f)
    await db.doc_folders.delete_many(
        {"id": {"$in": all_ids}, "org_id": user["org_id"]},
    )


# ── Folder tree upload (admin only) ──────────────────────────────
@router.post("/folders/{folder_id}/upload-tree", status_code=201)
async def upload_tree(
    folder_id: str,
    files: List[UploadFile] = File(...),
    paths: List[str] = Form(...),
    user: dict = Depends(_require_admin),
):
    """Multi-file upload preserving relative paths.
    Each `files[i]` corresponds to `paths[i]` — a forward-slashed
    relative path like `subdir/other/thing.pdf`. Intermediate
    `doc_folders` are auto-created under `folder_id`.
    Per-file cap: 200 MB (5 GB requires the NAS pre-signed upload
    flow which is deferred to Phase 2).
    """
    if len(files) != len(paths):
        raise HTTPException(
            400, "files[] and paths[] length mismatch",
        )
    parent = await _resolve_folder(folder_id, user["org_id"])
    from uploads_storage import save_upload

    folder_cache: Dict[str, str] = {"": parent["id"]}   # dir → folder_id

    async def _ensure_folder_chain(rel_dir: str) -> str:
        if rel_dir in folder_cache:
            return folder_cache[rel_dir]
        parent_dir, _, this_name = rel_dir.rpartition("/")
        parent_id = await _ensure_folder_chain(parent_dir)
        # Look up existing by (parent_id, name) to make tree upload
        # idempotent for re-runs.
        existing = await db.doc_folders.find_one({
            "org_id": user["org_id"],
            "parent_folder_id": parent_id,
            "name": this_name,
            "deleted_at": None,
        })
        if existing:
            fid = existing["id"]
        else:
            fid = new_id()
            await db.doc_folders.insert_one({
                "id": fid, "org_id": user["org_id"],
                "name": this_name,
                "parent_folder_id": parent_id,
                "created_at": now_iso(),
                "created_by": user["id"],
                "deleted_at": None,
                "is_system": False,
                "sort_order": 100,
            })
        folder_cache[rel_dir] = fid
        return fid

    saved: List[dict] = []
    rejected: List[dict] = []
    for upload, rel_path in zip(files, paths):
        rel = (rel_path or "").strip().lstrip("/").replace("\\", "/")
        if not rel:
            rejected.append({"path": rel_path, "reason": "empty path"})
            continue
        rel_dir, _, filename = rel.rpartition("/")
        target_folder_id = await _ensure_folder_chain(rel_dir)

        buf = bytearray()
        oversize = False
        while True:
            chunk = await upload.read(1024 * 1024)
            if not chunk:
                break
            buf.extend(chunk)
            if len(buf) > MAX_TREE_FILE_BYTES:
                oversize = True
                break
        if oversize:
            rejected.append({
                "path": rel_path,
                "reason": f">{MAX_TREE_FILE_BYTES // (1024*1024)} MB "
                          "cap (Phase 1); use Dropbox until 5 GB "
                          "path lands",
            })
            continue

        # Reuse legacy safe-ext + stored-name conventions.
        from document_library import _safe_ext
        ext = _safe_ext(filename)
        if not ext:
            rejected.append({
                "path": rel_path,
                "reason": "unsupported file type",
            })
            continue
        stored_name = f"{new_id()}{ext}"
        await save_upload(
            "document_library",
            [target_folder_id, stored_name],
            bytes(buf),
            module="document_library",
            org_id=user["org_id"],
            mime=upload.content_type or "application/octet-stream",
            orig_filename=filename,
        )
        doc = {
            "id": new_id(),
            "org_id": user["org_id"],
            "folder_id": target_folder_id,
            "filename": filename,
            "stored_name": stored_name,
            "mime": upload.content_type or "application/octet-stream",
            "size": len(buf),
            "file_url": (
                f"/api/files/document_library/"
                f"{target_folder_id}/{stored_name}"
            ),
            "uploaded_by": user["id"],
            "uploaded_by_name": user.get("name") or user.get("email"),
            "uploaded_at": now_iso(),
            "updated_at": now_iso(),
            "deleted_at": None,
            "storage_backend": "gridfs",
        }
        await db.doc_files.insert_one(doc)
        saved.append(_serialise_file(doc))

    return {"saved": saved, "rejected": rejected,
              "saved_count": len(saved),
              "rejected_count": len(rejected)}


# ── One-shot migration: shared_reference folders → doc_shares ────
@router.post("/admin/seed-shares-from-shared-reference")
async def seed_shares_from_shared_reference(
    user: dict = Depends(_require_admin),
):
    """Idempotent migration. For every folder with
    `shared_reference=True`, ensure every non-deleted file
    underneath has an active `target_type=all_workers`,
    `permission=download` share so day-1 web behaviour is
    preserved after the hard-cutover access model lands.

    Idempotency: skips files that already have an active
    all_workers/download share (regardless of who created it)."""
    folders = await db.doc_folders.find(
        {"shared_reference": True, "deleted_at": None,
         "org_id": user["org_id"]},
        {"_id": 0, "id": 1, "name": 1},
    ).to_list(5000)
    folder_ids = [f["id"] for f in folders]
    if not folder_ids:
        return {"created": 0, "skipped_existing": 0, "folders": 0}

    files = await db.doc_files.find(
        {"folder_id": {"$in": folder_ids},
         "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0, "id": 1, "folder_id": 1},
    ).to_list(20000)
    created = 0
    skipped = 0
    for f in files:
        existing = await db.doc_shares.find_one({
            "file_id": f["id"], "org_id": user["org_id"],
            "target_type": "all_workers", "permission": "download",
            "revoked_at": None,
        })
        if existing:
            skipped += 1
            continue
        await db.doc_shares.insert_one({
            "id": new_id(),
            "org_id": user["org_id"],
            "file_id": f["id"],
            "target_type": "all_workers",
            "target_id": None,
            "permission": "download",
            "granted_by": user["id"],
            "granted_by_name": user.get("name") or user.get("email"),
            "granted_reason": "seed:shared_reference_folder",
            "created_at": now_iso(),
            "revoked_at": None,
        })
        created += 1
    log.info("[seed-shares] folders=%d files=%d created=%d skipped=%d",
                len(folders), len(files), created, skipped)
    return {
        "created": created,
        "skipped_existing": skipped,
        "folders": len(folders),
        "files_scanned": len(files),
    }


# ── v58.13.132mg — Expiry-code queries ───────────────────────────
@router.get("/expiries")
async def list_by_expiry(status: str = "all",
                            user: dict = Depends(_require_admin)):
    """Return doc_files with a parsed `expires_at`, bucketed by
    status. `status` is one of `expired`, `expiring_soon`, `ok`,
    `unknown`, or `all`. Powers the future "SDS Expiring Soon"
    dashboard widget."""
    from datetime import date, timedelta
    today = date.today()
    soon_cutoff = today + timedelta(days=183)
    q: Dict[str, Any] = {"org_id": user["org_id"], "deleted_at": None}
    if status == "expired":
        q["expires_at"] = {"$lt": today.isoformat(), "$ne": None}
    elif status == "expiring_soon":
        q["expires_at"] = {"$gte": today.isoformat(),
                              "$lte": soon_cutoff.isoformat()}
    elif status == "ok":
        q["expires_at"] = {"$gt": soon_cutoff.isoformat()}
    elif status == "unknown":
        q["$or"] = [{"expires_at": None}, {"expires_at": {"$exists": False}}]
    # `all` — no extra filter.
    rows = []
    async for f in db.doc_files.find(q, {
        "_id": 0, "id": 1, "filename": 1, "display_name": 1,
        "expires_at": 1, "folder_id": 1, "size_bytes": 1,
        "mime": 1, "created_at": 1,
    }).sort([("expires_at", 1)]).limit(500):
        rows.append(f)
    return {"status": status, "count": len(rows), "files": rows}

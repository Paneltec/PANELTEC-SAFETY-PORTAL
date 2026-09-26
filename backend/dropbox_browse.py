"""v58.13.132n2 — In-app Dropbox file browser (phases A + B: read + write).

Replaces the external-tab launcher from `.132n0` with a proper
in-app browsing experience. All operations are scoped to the
team folder (`DROPBOX_TEAM_FOLDER_NAME`); paths that try to
escape return HTTP 403.

Endpoints (mounted at `/api/dropbox/browse`, gated on
`integrations.view`):

  GET    /api/dropbox/browse?path=<optional>
  GET    /api/dropbox/browse/download?path=<full_path>
  POST   /api/dropbox/browse/upload         (multipart: path + file)
  POST   /api/dropbox/browse/mkdir          (json: {path})
  DELETE /api/dropbox/browse?path=<full_path>

Deferred to phase C: rename, move, previews, tags, server-side
search. Their absence is deliberate — the sidebar entry surfaces
this page as a read+write launcher; heavier UX is future work.
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from auth import get_current_user
from db import db
from permissions import require_permission

log = logging.getLogger("paneltec.dropbox.browse")
router = APIRouter(prefix="/dropbox/browse", tags=["dropbox-browse"])

# ── team-folder guardrails ─────────────────────────────────────
_TEAM_FOLDER_NAME = os.environ.get(
    "DROPBOX_TEAM_FOLDER_NAME", "Paneltec-General Administration"
)
_TEAM_FOLDER_ROOT = "/" + _TEAM_FOLDER_NAME  # e.g. "/Paneltec-General Administration"

# Rate-limit uploads (per-user) so a single admin can't saturate
# Dropbox's rate quota. 5 concurrent uploads is generous but
# capped enough to leave headroom for the migration engine.
_UPLOAD_SEMS: Dict[str, asyncio.Semaphore] = {}

# `.132n2b` — separate per-user semaphore for preview streams so
# a burst of preview clicks can't block an in-flight upload (and
# vice-versa). Same 5-concurrent cap as uploads.
_PREVIEW_SEMS: Dict[str, asyncio.Semaphore] = {}

# Chunked upload threshold — files bigger than 150 MB must use
# `/2/files/upload_session/*` per Dropbox spec.
_CHUNK_THRESHOLD_BYTES = 150 * 1024 * 1024
_CHUNK_SIZE_BYTES = 8 * 1024 * 1024  # 8 MiB per chunk


# ── path validation ────────────────────────────────────────────
def _normalise_path(path: Optional[str]) -> str:
    """Normalise a caller-supplied path into a canonical form that
    the team-namespace-scoped Dropbox client understands.

    Because the SDK client is already scoped via
    `with_path_root(PathRoot.namespace_id(...))` (see
    `dropbox_folder_mirror._get_dbx_root_client`), Dropbox interprets
    every path relative to the TEAM NAMESPACE. That means:

      · The team folder root is `""` at the SDK layer, and Dropbox
        surfaces child folders as `path_display = "/Foo/Bar"` — NOT
        `"/Paneltec-General Administration/Foo/Bar"`.
      · A malicious caller CANNOT escape the namespace regardless of
        the path they submit — Dropbox will look inside the namespace
        for whatever they name.

    Accepted input forms (any of these normalise to the SAME output):

      · ``, `None`, `"/"`, `"/Paneltec-General Administration"`
          → team folder root (`_TEAM_FOLDER_ROOT` sentinel)
      · `"/Foo/Bar"` (namespace-relative)
          → `"/Foo/Bar"`
      · `"/Paneltec-General Administration/Foo/Bar"`
          → `"/Foo/Bar"` (prefix stripped so the SDK receives the
             correct namespace-relative form; the frontend can pass
             either shape).

    Still rejected as a defence-in-depth measure:
      · `..` segments (path traversal artefacts)
      · `//` double slashes
    """
    if path is None or path == "" or path == "/" or path == _TEAM_FOLDER_ROOT:
        return _TEAM_FOLDER_ROOT
    if not path.startswith("/"):
        path = "/" + path
    # Reject syntactic garbage regardless of intent.
    if "//" in path or "/../" in path or path.endswith("/.."):
        raise HTTPException(400, "path contains invalid segments")
    # Strip the team-folder prefix if the caller passed the "absolute"
    # form (matching Dropbox web URLs). Only strip when the next char
    # is `/` so we don't turn `/Paneltec-General AdministrationXYZ`
    # into `XYZ` and let it through unlabelled — that shape is a bug
    # in the caller, treat it as namespace-relative literally.
    if path.startswith(_TEAM_FOLDER_ROOT + "/"):
        path = path[len(_TEAM_FOLDER_ROOT):]
    # Dropbox rejects trailing slashes.
    if path.endswith("/") and path != "/":
        path = path.rstrip("/")
    return path


def _team_root_arg(path: str) -> str:
    """Dropbox's `/2/files/list_folder` uses empty-string for the
    root of the current path-root namespace. When a caller asks
    for the team folder root we hand Dropbox `""` (empty), because
    the SDK client is already scoped to the team's path-root
    namespace via `with_path_root(PathRoot.namespace_id(...))`.
    Everything else passes through unchanged.
    """
    if path == _TEAM_FOLDER_ROOT:
        return ""
    return path


# ── Dropbox client (team-folder-scoped path root) ──────────────
# `.132n2a` fix: `_get_dbx_root_client()` scopes to the USER'S
# root namespace (`DROPBOX_ROOT_NAMESPACE_ID` — `2673752851` for
# stephen@paneltec.com.au). That's fine for the migration engine
# (it enumerates the shared team folder path from the user's root),
# but it's the WRONG scope for the browse endpoints:
#
#   · LIST would return the user's PRIVATE root (6 personal folders)
#     instead of the team folder (18 folders, 1447 files).
#   · WRITE (mkdir / upload / delete) fails with `no_write_permission`
#     because the Dropbox app is a Team app and can't mutate a user's
#     private namespace via a shared-folder mount.
#
# Fix: for browse only, rewrite `path_root` to the TEAM FOLDER's
# namespace ID. Paths are then interpreted as relative to the team
# folder root — which matches what `_normalise_path` already
# produces (`""` = team folder root, `"/Foo/Bar"` = subfolder).
# The migration engine's client (`_get_dbx_root_client`) is
# untouched — its enum logic depends on the user-namespace shape.
_TEAM_NS_FALLBACK = "5079287136"  # captured in `.132lb` audit


def _get_team_namespace_id() -> str:
    """Team folder namespace ID lookup, in priority order:

      1. `DROPBOX_TEAM_FOLDER_ID` env var (explicit override).
      2. `.132lb` audit artifact (same source `/health` uses).
      3. Hardcoded fallback (matches `_live_probe` behaviour).
    """
    env = os.environ.get("DROPBOX_TEAM_FOLDER_ID", "").strip()
    if env:
        return env
    # Read artifact directly to avoid a circular import against
    # `integrations_dropbox`. The path is stable — the audit is
    # only re-run when the source folder is rebuilt (rare).
    try:
        import json
        from pathlib import Path
        art_path = Path("/app/memory/dropbox_phase0_audit_v58_13_132lb.json")
        if art_path.exists():
            art = json.loads(art_path.read_text())
            tfi = (art.get("team_folder_id") or "").strip()
            if tfi:
                return tfi
    except Exception as exc:
        log.warning("team_folder_id artifact read failed: %s", exc)
    return _TEAM_NS_FALLBACK


def _get_dbx():
    """Returns a Dropbox client scoped to the TEAM FOLDER's
    namespace via `with_path_root(PathRoot.namespace_id(<team>))`.
    All browse paths are interpreted relative to the team folder
    root — matching `_normalise_path`'s output contract."""
    # Late import so this module can be imported even when the
    # dropbox SDK isn't installed (unit tests can mock it).
    from dropbox_folder_mirror import _get_dbx_root_client
    from dropbox.common import PathRoot
    team_ns = _get_team_namespace_id()
    # `with_path_root` returns a NEW client with a fresh header —
    # calling it again on an already-scoped client cleanly
    # overrides the previous path_root selection.
    return _get_dbx_root_client().with_path_root(
        PathRoot.namespace_id(team_ns)
    )


# ── entry serialisation ────────────────────────────────────────
def _serialise_entry(e: Any) -> Dict[str, Any]:
    """Coerce a Dropbox `FolderMetadata` / `FileMetadata` into the
    JSON shape the frontend expects. Never leaks SDK types."""
    from dropbox.files import FolderMetadata, FileMetadata
    base: Dict[str, Any] = {
        "name": e.name,
        "path": e.path_display,
    }
    if isinstance(e, FolderMetadata):
        base["type"] = "folder"
        base["size"] = None
        base["modified"] = None
        base["mime_type"] = None
    elif isinstance(e, FileMetadata):
        base["type"] = "file"
        base["size"] = getattr(e, "size", None)
        m = getattr(e, "server_modified", None) or getattr(e, "client_modified", None)
        base["modified"] = m.isoformat() if m else None
        base["mime_type"] = _guess_mime(e.name)
    else:
        # DeletedMetadata / unknown — surface as generic file so
        # the frontend can still render (rare edge case).
        base["type"] = "file"
        base["size"] = None
        base["modified"] = None
        base["mime_type"] = None
    return base


def _guess_mime(name: str) -> Optional[str]:
    import mimetypes
    mime, _ = mimetypes.guess_type(name)
    return mime


# ── audit log ─────────────────────────────────────────────────
async def _audit(user: dict, action: str, path: str, meta: Optional[Dict] = None) -> None:
    """Log a mutating action to `dropbox_browse_audit` so admins
    can see who did what. Non-blocking — never raises."""
    try:
        await db.dropbox_browse_audit.insert_one({
            "at": datetime.now(timezone.utc).isoformat(),
            "user_id": user.get("id") or user.get("user_id"),
            "user_email": user.get("email"),
            "action": action,
            "path": path,
            "meta": meta or {},
        })
    except Exception as exc:
        log.warning("dropbox_browse_audit insert failed: %s", exc)


def _wrap_dropbox_error(exc: Exception, verb: str) -> HTTPException:
    """Translate common Dropbox API errors into helpful HTTP responses.

    The big one for `.132n2` is the "missing scope" error — the
    Dropbox app is currently authorised with read-only scopes, so
    any write endpoint (mkdir/upload/delete) surfaces
    `files.content.write missing` until an admin re-consents.
    Callers see a clear 403 instead of an opaque 502.
    """
    msg = str(exc)
    lower = msg.lower()
    if "required scope" in lower and "files.content.write" in lower:
        return HTTPException(
            403,
            "Dropbox token is missing the 'files.content.write' scope. "
            "An admin must re-authorise Dropbox from Settings → Integrations "
            "so the app can mint a new refresh token with write access.",
        )
    if "conflict" in lower:
        return HTTPException(409, f"path conflict during {verb}")
    if "not_found" in lower or "path_not_found" in lower:
        return HTTPException(404, f"path not found for {verb}")
    # `.132n2b` — `files_get_preview` responds with these codes when
    # the source file has no rendered preview available (either the
    # extension isn't supported, or Dropbox rendered a preview that
    # is now permanently unavailable).
    if "unsupported_extension" in lower or "unsupported_content" in lower or "in_progress" in lower:
        return HTTPException(400, f"no preview available for this file")
    return HTTPException(502, f"Dropbox {verb} failed: {type(exc).__name__}")


# ── endpoints ──────────────────────────────────────────────────
@router.get("")
async def list_folder(
    path: str = Query("", description="Dropbox path; empty = team folder root"),
    user: dict = Depends(get_current_user),
    _: None = Depends(require_permission("integrations", "view")),
):
    """List folders + files at `path` in the team folder.

    Response:
        {
          "path": "/Paneltec-General Administration/Foo",
          "entries": [
            {"name": "Bar", "path": "/…/Foo/Bar", "type": "folder", ...},
            {"name": "quote.pdf", "path": "/…/Foo/quote.pdf", "type": "file",
             "size": 12345, "modified": "2026-…", "mime_type": "application/pdf"}
          ]
        }
    """
    resolved = _normalise_path(path)
    dbx = _get_dbx()
    dbx_arg = _team_root_arg(resolved)
    try:
        res = await asyncio.to_thread(dbx.files_list_folder, dbx_arg)
        entries = [_serialise_entry(e) for e in res.entries]
        while res.has_more:
            res = await asyncio.to_thread(dbx.files_list_folder_continue, res.cursor)
            entries.extend(_serialise_entry(e) for e in res.entries)
    except HTTPException:
        raise
    except Exception as exc:
        log.warning("[browse.list] %s: %s", resolved, exc)
        raise _wrap_dropbox_error(exc, "list")
    return {"path": resolved, "entries": entries}


@router.get("/download")
async def download_link(
    path: str = Query(..., description="Full Dropbox path to a file"),
    user: dict = Depends(get_current_user),
    _: None = Depends(require_permission("integrations", "view")),
):
    """Return a short-lived (4h) Dropbox temporary-link URL for
    direct client download. Bytes are NOT streamed through the
    backend — this endpoint is only a signed-link proxy.

    Response: `{"path": "...", "url": "https://uc-....dropbox.com/...", "expires_in": 14400}`
    """
    resolved = _normalise_path(path)
    if resolved == _TEAM_FOLDER_ROOT:
        raise HTTPException(400, "cannot download the team folder root")
    dbx = _get_dbx()
    try:
        res = await asyncio.to_thread(dbx.files_get_temporary_link, resolved)
    except Exception as exc:
        log.warning("[browse.download] %s: %s", resolved, exc)
        raise _wrap_dropbox_error(exc, "get_temporary_link")
    return {
        "path": resolved,
        "url": res.link,
        # Dropbox docs: temporary links expire after 4 hours.
        "expires_in": 4 * 60 * 60,
    }


class MkdirBody(BaseModel):
    path: str = Field(..., description="Full Dropbox path of the new folder")


@router.post("/mkdir")
async def make_directory(
    body: MkdirBody,
    user: dict = Depends(get_current_user),
    _: None = Depends(require_permission("integrations", "view")),
):
    """Create a folder at `path`. Idempotent-ish: Dropbox will
    surface a `path/conflict/folder/...` error if the folder
    already exists — surface that as 409.

    Response: `{"path": "/NewFolder"}` (namespace-relative)
    """
    resolved = _normalise_path(body.path)
    if resolved == _TEAM_FOLDER_ROOT:
        raise HTTPException(400, "cannot recreate the team folder root")
    dbx = _get_dbx()
    try:
        res = await asyncio.to_thread(dbx.files_create_folder_v2, resolved)
        new_path = res.metadata.path_display
    except Exception as exc:
        log.warning("[browse.mkdir] %s: %s", resolved, exc)
        raise _wrap_dropbox_error(exc, "create_folder")
    await _audit(user, "mkdir", new_path)
    return {"path": new_path}


@router.delete("")
async def delete_entry(
    path: str = Query(..., description="Full Dropbox path (file or folder)"),
    user: dict = Depends(get_current_user),
    _: None = Depends(require_permission("integrations", "view")),
):
    """Delete a file or folder. Recursive by default for folders
    (Dropbox `/2/files/delete_v2` semantics). Refuses to delete
    the team folder root itself."""
    resolved = _normalise_path(path)
    if resolved == _TEAM_FOLDER_ROOT:
        raise HTTPException(400, "cannot delete the team folder root")
    dbx = _get_dbx()
    try:
        await asyncio.to_thread(dbx.files_delete_v2, resolved)
    except Exception as exc:
        log.warning("[browse.delete] %s: %s", resolved, exc)
        raise _wrap_dropbox_error(exc, "delete")
    await _audit(user, "delete", resolved)
    return {"path": resolved, "deleted": True}


@router.post("/upload")
async def upload_file(
    path: str = Form(..., description="Destination folder path"),
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
    _: None = Depends(require_permission("integrations", "view")),
):
    """Upload `file` into the folder at `path`. Uses one-shot
    `/2/files/upload` for ≤150 MB, chunked
    `/2/files/upload_session/*` above that. Per-user semaphore
    caps concurrency at 5 so a single admin can't hog Dropbox's
    rate quota.

    Response: `{"path": "/…/uploaded.pdf", "size": 12345, "modified": "..."}`
    """
    dest_folder = _normalise_path(path)
    filename = os.path.basename(file.filename or "upload.bin")
    if not filename:
        raise HTTPException(400, "file has no name")
    # Build the final Dropbox path, THEN re-normalise so the prefix
    # gets stripped (if the caller passed the "absolute" form) and
    # the SDK receives a namespace-relative path.
    raw_dest = (dest_folder.rstrip("/") + "/" + filename) if dest_folder != _TEAM_FOLDER_ROOT else ("/" + filename)
    dest_path = _normalise_path(raw_dest)

    user_key = str(user.get("id") or user.get("user_email") or "anon")
    sem = _UPLOAD_SEMS.setdefault(user_key, asyncio.Semaphore(5))
    async with sem:
        contents = await file.read()
        size = len(contents)
        dbx = _get_dbx()
        try:
            if size <= _CHUNK_THRESHOLD_BYTES:
                from dropbox.files import WriteMode
                res = await asyncio.to_thread(
                    dbx.files_upload, contents, dest_path,
                    mode=WriteMode("overwrite"), autorename=False, mute=True,
                )
            else:
                res = await _chunked_upload(dbx, contents, dest_path)
        except Exception as exc:
            log.warning("[browse.upload] %s: %s", dest_path, exc)
            raise _wrap_dropbox_error(exc, "upload")

    modified = getattr(res, "server_modified", None) or getattr(res, "client_modified", None)
    await _audit(user, "upload", res.path_display, meta={"size": size})
    return {
        "path": res.path_display,
        "size": getattr(res, "size", size),
        "modified": modified.isoformat() if modified else None,
    }


async def _chunked_upload(dbx, contents: bytes, dest_path: str):
    """Upload `contents` to `dest_path` using Dropbox's chunked
    session API (required for files >150 MB)."""
    from dropbox.files import CommitInfo, WriteMode, UploadSessionCursor
    total = len(contents)
    # Start session with first chunk.
    first = contents[:_CHUNK_SIZE_BYTES]
    start_res = await asyncio.to_thread(dbx.files_upload_session_start, first)
    cursor = UploadSessionCursor(session_id=start_res.session_id, offset=len(first))
    # Append middle chunks.
    offset = len(first)
    while (total - offset) > _CHUNK_SIZE_BYTES:
        chunk = contents[offset:offset + _CHUNK_SIZE_BYTES]
        await asyncio.to_thread(dbx.files_upload_session_append_v2, chunk, cursor)
        offset += len(chunk)
        cursor = UploadSessionCursor(session_id=start_res.session_id, offset=offset)
    # Finish with the last chunk + commit.
    last = contents[offset:]
    commit = CommitInfo(path=dest_path, mode=WriteMode("overwrite"),
                        autorename=False, mute=True)
    res = await asyncio.to_thread(dbx.files_upload_session_finish, last, cursor, commit)
    return res



# ── `.132n2b` — inline preview proxy ──────────────────────────
#
# Dispatch table: which Dropbox call to make per source extension.
#   · office types           → `files_get_preview` (returns PDF or HTML
#                               depending on source; xlsx/ods → HTML,
#                               docx/rtf/pptx → PDF)
#   · everything else that
#     the frontend flags as
#     inline-previewable      → `files_download` (raw file bytes streamed
#                               back with the file's own mime type)
#
# Why we can't just use Dropbox temp links for the "raw" cases:
# `files_get_temporary_link` responses carry
# `Content-Disposition: attachment` + `Content-Security-Policy:
# sandbox`, both of which force browsers to trigger a save dialog
# rather than render inline. Proxying the bytes through this
# endpoint lets us re-write the disposition to `inline` and
# forward the correct `Content-Type` so the caller's
# <iframe>/<img>/<video>/<audio> paints as expected.
_PREVIEW_OFFICE_EXTS = {
    ".doc", ".docx", ".rtf",
    ".ppt", ".pptx",
    ".xls", ".xlsm", ".xlsx",
    ".ods", ".odt", ".odp",
}


@router.get("/preview")
async def preview_file(
    path: str = Query(..., description="Full Dropbox path to a file"),
    user: dict = Depends(get_current_user),
    _: None = Depends(require_permission("integrations", "view")),
):
    """Stream file bytes back to the caller for inline browser
    display. Two upstream Dropbox calls dispatched by extension:

      · Office formats (`.doc/.docx/.rtf/.ppt/.pptx/.xls/.xlsm/
        .xlsx/.ods/.odt/.odp`) → `/2/files/get_preview` — Dropbox
        renders a preview (PDF for text-flow docs, HTML for
        spreadsheets) and streams it here.
      · Everything else → `/2/files/download` — raw file bytes
        streamed straight back to the caller.

    Response headers, regardless of dispatch branch:
      · Content-Type — forwarded from Dropbox (`get_preview`) OR
        the guessed mime for the source name (`download`).
      · Content-Disposition — `inline; filename="…"`. Overrides
        Dropbox's default `attachment` so browsers render the
        payload in-place.
      · Cache-Control — `private, max-age=60`. Short cache so a
        rapid double-click doesn't re-fetch; stale after a minute
        so post-edit re-previews stay honest.

    Errors:
      · 400 — trying to preview the team-folder root, or the file
              type isn't previewable per Dropbox.
      · 404 — file no longer exists.
      · 502 — any other Dropbox API failure.
    """
    resolved = _normalise_path(path)
    if resolved == _TEAM_FOLDER_ROOT:
        raise HTTPException(400, "cannot preview the team folder root")

    user_key = str(user.get("id") or user.get("user_email") or "anon")
    sem = _PREVIEW_SEMS.setdefault(user_key, asyncio.Semaphore(5))

    ext = os.path.splitext(resolved)[1].lower()
    use_get_preview = ext in _PREVIEW_OFFICE_EXTS

    async with sem:
        dbx = _get_dbx()
        try:
            if use_get_preview:
                # (FileMetadata, requests.Response). `.iter_content(…)`
                # streams the rendered preview back chunk-by-chunk.
                meta, response = await asyncio.to_thread(
                    dbx.files_get_preview, resolved,
                )
            else:
                # Same tuple shape; Dropbox streams the raw file
                # bytes as the response body.
                meta, response = await asyncio.to_thread(
                    dbx.files_download, resolved,
                )
        except HTTPException:
            raise
        except Exception as exc:  # noqa: BLE001
            log.warning("[browse.preview] %s: %s", resolved, exc)
            raise _wrap_dropbox_error(exc, "get_preview")

    # Determine content type. `get_preview` populates the response
    # Content-Type reliably (application/pdf for docx, text/html for
    # xlsx). `files_download` responses use `application/octet-stream`
    # so we guess from the source filename instead.
    upstream_ct = (response.headers.get("Content-Type") or "").split(";")[0].strip()
    if use_get_preview:
        content_type = upstream_ct or "application/pdf"
    else:
        guessed = _guess_mime(os.path.basename(resolved))
        content_type = guessed or upstream_ct or "application/octet-stream"

    def _iter():
        # 64 KiB chunks — small enough to start the caller's render
        # pipeline within the first RTT, big enough to avoid excess
        # syscall/HTTP framing overhead on multi-MB payloads.
        for chunk in response.iter_content(chunk_size=64 * 1024):
            if chunk:
                yield chunk

    safe_name = os.path.basename(resolved).replace('"', '')
    return StreamingResponse(
        _iter(),
        media_type=content_type,
        headers={
            "Content-Disposition": f'inline; filename="{safe_name}"',
            "Cache-Control": "private, max-age=60",
        },
    )

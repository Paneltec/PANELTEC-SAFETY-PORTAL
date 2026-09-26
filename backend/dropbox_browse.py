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
import time
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


# `.132n4c` — preview size guard.  Dropbox's `get_preview` starts
# timing out around 50 MB and the browser blob-URL PDF viewer
# gets unreliable much sooner than that.  Skip the preview
# altogether over this threshold; the FE renders a clean
# "too large — download instead" panel.
_PREVIEW_MAX_BYTES = 50 * 1024 * 1024


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
      · 400 — trying to preview the team-folder root.
      · 404 — file no longer exists.
      · 413 — file is >50 MB (skips the preview to avoid Dropbox
              timing out on the render pipeline; caller should
              fall back to Download instead).  Added in `.132n4c`.
      · 415 — Dropbox refused to preview this content
              (`unsupported_extension` / `unsupported_content`).
              Caller should fall back to Download.  Added in
              `.132n4c`.
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

        # `.132n4c` — size guard.  Dropbox's `get_preview` and
        # `files_download` both stream, but the browser-side blob
        # allocation for a 100+ MB file crashes preview in most
        # clients, and Dropbox's `get_preview` itself times out on
        # anything over ~50 MB anyway.  Fail fast with 413 so the
        # FE can surface a "Download instead" fallback without a
        # dead spinner.
        try:
            meta = await asyncio.to_thread(dbx.files_get_metadata, _team_root_arg(resolved))
        except Exception as exc:  # noqa: BLE001
            log.info("[browse.preview] metadata pre-check failed for %s: %s",
                     resolved, exc)
            meta = None
        size_bytes = getattr(meta, "size", None) if meta is not None else None
        if size_bytes is not None and size_bytes > _PREVIEW_MAX_BYTES:
            raise HTTPException(
                413,
                f"file too large to preview ({size_bytes // (1024*1024)} MB > "
                f"{_PREVIEW_MAX_BYTES // (1024*1024)} MB limit) — please Download instead",
            )

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
            # `.132n4c` — surface Dropbox's "can't preview this" as
            # a 415 so the FE can render a clean fallback rather
            # than the browser's broken-document icon inside a
            # useless iframe. `get_preview` sends
            # `unsupported_extension` for types it doesn't render
            # (e.g. `.zip`, `.psd`) and `unsupported_content` for
            # DRM'd or malformed files.
            err_str = str(exc).lower()
            if ("unsupported_extension" in err_str
                    or "unsupported_content" in err_str
                    or "in_progress" in err_str):
                raise HTTPException(
                    415,
                    "Dropbox can't preview this file type. Download it to view it locally.",
                )
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


# ── `.132n4a` — folder file-count (lazy, in-process cache) ────
#
# The list endpoint returns entries but not per-folder child
# counts. Dropbox's API doesn't expose "how many items are inside
# folder X" as a metadata property; the only way is
# `files_list_folder` on that folder. That's expensive per row,
# so we:
#   · Expose a dedicated endpoint the frontend hits lazily
#     (parallel, capped at 5 concurrent per user).
#   · Cache results in-process for 5 min so re-rendering the
#     same folder view doesn't re-hit Dropbox.
#   · Only count the first page of `files_list_folder` (2000
#     entries by default) — folders larger than that are marked
#     `is_partial=true` so the FE can render "2000+ items".
_COUNT_CACHE: Dict[str, tuple[float, dict]] = {}
_COUNT_TTL_SECONDS = 300


def _count_cache_get(path: str) -> Optional[dict]:
    entry = _COUNT_CACHE.get(path)
    if not entry:
        return None
    ts, payload = entry
    if (time.time() - ts) > _COUNT_TTL_SECONDS:
        _COUNT_CACHE.pop(path, None)
        return None
    return payload


def _count_cache_put(path: str, payload: dict) -> None:
    _COUNT_CACHE[path] = (time.time(), payload)


@router.get("/count")
async def count_folder(
    path: str = Query(..., description="Full Dropbox path to a folder"),
    user: dict = Depends(get_current_user),
    _: None = Depends(require_permission("integrations", "view")),
):
    """Return `{path, item_count, is_partial, ttl_seconds}` for a
    folder. First-page-only count (up to 2000 entries) — folders
    with more items report `is_partial: true`. Cached in-process
    for 5 min.

    The frontend uses this to render a subtle "N items" badge on
    each folder row after the parent list has painted, with client-
    side concurrency capped at 5 to match the server semaphore.
    """
    resolved = _normalise_path(path)

    cached = _count_cache_get(resolved)
    if cached is not None:
        return cached

    user_key = str(user.get("id") or user.get("user_email") or "anon")
    sem = _PREVIEW_SEMS.setdefault(user_key, asyncio.Semaphore(5))

    async with sem:
        dbx = _get_dbx()
        try:
            res = await asyncio.to_thread(
                dbx.files_list_folder,
                _team_root_arg(resolved),
                recursive=False,
            )
        except HTTPException:
            raise
        except Exception as exc:  # noqa: BLE001
            log.warning("[browse.count] %s: %s", resolved, exc)
            # Return a "no count available" sentinel rather than
            # exposing a 5xx that would trigger frontend error state
            # for a purely decorative badge.
            payload = {
                "path": resolved,
                "item_count": None,
                "is_partial": False,
                "ttl_seconds": _COUNT_TTL_SECONDS,
            }
            return payload

    item_count = len(res.entries or [])
    payload = {
        "path": resolved,
        "item_count": item_count,
        "is_partial": bool(getattr(res, "has_more", False)),
        "ttl_seconds": _COUNT_TTL_SECONDS,
    }
    _count_cache_put(resolved, payload)
    return payload


# ── `.132n4a` — rename / move / revisions / restore ───────────
#
# All four flow through `files_move_v2` (rename == move within
# the same parent) or `files_list_revisions` + `files_restore`.
# Every path goes through `_normalise_path` and every write is
# wrapped in `_wrap_dropbox_error` so scope/conflict/not-found
# errors surface with a clean HTTP shape.
class RenameIn(BaseModel):
    from_path: str = Field(..., description="Current namespace-relative path")
    new_name: str = Field(..., description="New basename (no path segments)")


class MoveIn(BaseModel):
    from_path: str
    to_folder: str = Field(..., description="Destination folder — namespace-relative")


class RestoreIn(BaseModel):
    path: str
    rev: str


def _validate_basename(name: str) -> str:
    """Rename target must be a plain basename — no path separators,
    no absolute paths, no empty. Preserves Dropbox's own rules while
    catching obvious mistakes at the API boundary."""
    n = (name or "").strip()
    if not n or "/" in n or "\\" in n or n in {".", ".."}:
        raise HTTPException(400, "invalid new_name")
    return n


@router.post("/rename")
async def rename_entry(
    body: RenameIn,
    user: dict = Depends(get_current_user),
    _: None = Depends(require_permission("integrations", "view")),
):
    """Rename a file or folder in-place. Implementation: Dropbox
    doesn't have a dedicated rename endpoint — a rename is a `move`
    within the same parent, so we compose the destination path
    from the resolved source's parent + validated new basename."""
    src = _normalise_path(body.from_path)
    if src == _TEAM_FOLDER_ROOT:
        raise HTTPException(400, "cannot rename the team folder root")
    new_name = _validate_basename(body.new_name)

    # `posixpath.dirname` returns `"/"` for top-level entries (parent
    # of `/foo` is `/`), but our namespace-relative paths use `""`
    # for the team-folder root. Collapse both `""` and `"/"` to `""`
    # so we don't emit a `//` double-slash into the destination.
    parent = os.path.dirname(src) or ""
    if parent == "/":
        parent = ""
    dst = (parent + "/" + new_name) if parent else "/" + new_name

    if dst == src:
        # No-op — Dropbox would return an ApiError anyway. Save a
        # round-trip.
        return {"path": src, "renamed": False, "reason": "same_name"}

    dbx = _get_dbx()
    try:
        res = await asyncio.to_thread(
            dbx.files_move_v2,
            _team_root_arg(src),
            _team_root_arg(dst),
            autorename=False,
        )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        log.warning("[browse.rename] %s -> %s: %s", src, dst, exc)
        raise _wrap_dropbox_error(exc, "rename")

    # Invalidate parent count cache — child count didn't change but
    # the child name did, and the response the FE gets from this
    # endpoint includes the new path so no stale row-count issue.
    _COUNT_CACHE.pop(parent, None)
    await _audit(user, "rename", src, {"dst": dst})
    return {"path": dst, "renamed": True, "previous_path": src,
            "entry": _serialise_entry(res.metadata)}


@router.post("/move")
async def move_entry(
    body: MoveIn,
    user: dict = Depends(get_current_user),
    _: None = Depends(require_permission("integrations", "view")),
):
    """Move a file or folder into a different destination folder.
    Destination path is the resolved destination folder + the
    source's basename. `to_folder` may be `""` (team folder root)
    or any namespace-relative folder path."""
    src = _normalise_path(body.from_path)
    if src == _TEAM_FOLDER_ROOT:
        raise HTTPException(400, "cannot move the team folder root")
    dst_folder = _normalise_path(body.to_folder or "")
    src_base = os.path.basename(src)
    dst = (dst_folder + "/" + src_base) if dst_folder else "/" + src_base

    if dst == src:
        return {"path": src, "moved": False, "reason": "same_location"}

    dbx = _get_dbx()
    try:
        res = await asyncio.to_thread(
            dbx.files_move_v2,
            _team_root_arg(src),
            _team_root_arg(dst),
            autorename=True,   # Dropbox appends " (1)" on conflict
        )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        log.warning("[browse.move] %s -> %s: %s", src, dst, exc)
        raise _wrap_dropbox_error(exc, "move")

    # Invalidate both source and destination folder count caches —
    # the child count of both has changed.
    src_parent = os.path.dirname(src) or ""
    if src_parent == "/":
        src_parent = ""
    _COUNT_CACHE.pop(src_parent, None)
    _COUNT_CACHE.pop(dst_folder, None)
    await _audit(user, "move", src, {"dst": dst})
    return {"path": dst, "moved": True, "previous_path": src,
            "entry": _serialise_entry(res.metadata)}


@router.get("/revisions")
async def list_revisions(
    path: str = Query(...),
    limit: int = Query(10, ge=1, le=100),
    user: dict = Depends(get_current_user),
    _: None = Depends(require_permission("integrations", "view")),
):
    """Return up to `limit` prior revisions of a file. Response
    entries carry `rev` (opaque server ID), `server_modified`,
    `size`, and a `restorable` flag. Only files have revisions —
    a folder path returns 400."""
    resolved = _normalise_path(path)
    if resolved == _TEAM_FOLDER_ROOT:
        raise HTTPException(400, "cannot list revisions of the team folder root")

    dbx = _get_dbx()
    try:
        res = await asyncio.to_thread(
            dbx.files_list_revisions,
            _team_root_arg(resolved),
            limit=limit,
        )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        log.warning("[browse.revisions] %s: %s", resolved, exc)
        raise _wrap_dropbox_error(exc, "list_revisions")

    entries = []
    for e in res.entries:
        entries.append({
            "rev":              e.rev,
            "size":             getattr(e, "size", None),
            "server_modified":  getattr(e, "server_modified", None)
                                   and e.server_modified.isoformat(),
            "client_modified":  getattr(e, "client_modified", None)
                                   and e.client_modified.isoformat(),
            "name":             getattr(e, "name", None),
        })
    return {
        "path":       resolved,
        "is_deleted": bool(getattr(res, "is_deleted", False)),
        "entries":    entries,
    }


@router.post("/restore")
async def restore_revision(
    body: RestoreIn,
    user: dict = Depends(get_current_user),
    _: None = Depends(require_permission("integrations", "view")),
):
    """Restore a file to a prior revision. Creates a new revision
    on top rather than replacing the current one — Dropbox's own
    behaviour. Requires `files.content.write`."""
    resolved = _normalise_path(body.path)
    if resolved == _TEAM_FOLDER_ROOT:
        raise HTTPException(400, "cannot restore the team folder root")
    rev = (body.rev or "").strip()
    if not rev:
        raise HTTPException(400, "rev is required")

    dbx = _get_dbx()
    try:
        res = await asyncio.to_thread(
            dbx.files_restore, _team_root_arg(resolved), rev,
        )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        log.warning("[browse.restore] %s @ %s: %s", resolved, rev, exc)
        raise _wrap_dropbox_error(exc, "restore")

    await _audit(user, "restore", resolved, {"rev": rev})
    return {"path": resolved, "restored": True,
            "entry": _serialise_entry(res)}


# ── `.132n4b` — sharing / permissions ─────────────────────────
#
# Enables end-user sharing through the browse UI now that the
# Dropbox App Console has `sharing.read` + `sharing.write` scopes
# ticked (verified 2026-02-26 via live SDK probe against the
# team-scoped client).
#
# Model:
#   · Shared LINKS (URL-based, team-only or public) work on both
#     files AND folders through the same SDK endpoints.
#   · Shared MEMBERS are split by target kind:
#       - files:   sharing_add/list/remove_file_member*
#       - folders: sharing_share_folder → sharing_add/remove_folder_member
#     Folder membership listing pulls from
#     `sharing_list_folder_members` when the folder already has a
#     `shared_folder_id`; otherwise we surface an empty list (the
#     folder inherits its parent's membership).
#
# Every endpoint routes through the same team-namespace-scoped
# `_get_dbx()` client, wraps errors via `_wrap_dropbox_error`
# (extended below to catch sharing-specific errors), and audits
# mutations to `dropbox_browse_audit`.


class ShareLinkIn(BaseModel):
    path: str
    # 'team_only' (default — restricts to Paneltec team members),
    # 'public' (anyone-with-link), 'password' (public + password).
    visibility: str = Field("team_only")
    password: Optional[str] = None


class RevokeLinkIn(BaseModel):
    url: str


class InviteIn(BaseModel):
    path: str
    email: str
    access_level: str = Field("viewer")  # 'viewer' | 'editor'
    message: Optional[str] = None


class RemoveMemberIn(BaseModel):
    path: str
    email: str


def _tag_str(obj: Any) -> Optional[str]:
    """Extract the `_tag` from a Dropbox union type (e.g.
    `AccessLevel('viewer', None)` → 'viewer'). Returns None if
    the object doesn't have a tag."""
    if obj is None:
        return None
    return getattr(obj, "_tag", None) or None


def _serialise_link(link: Any) -> Dict[str, Any]:
    """Coerce a `SharedLinkMetadata` (`File-` or `FolderLinkMetadata`)
    into the JSON shape the frontend expects."""
    perms = getattr(link, "link_permissions", None)
    resolved = _tag_str(getattr(perms, "resolved_visibility", None)) if perms else None
    return {
        "url":         link.url,
        "path":        getattr(link, "path_lower", None),
        "name":        link.name,
        "visibility":  resolved,  # 'public' | 'team_only' | 'password' | 'no_one'
        "expires":     link.expires.isoformat() if link.expires else None,
        "can_revoke":  bool(getattr(perms, "can_revoke", True)) if perms else True,
    }


def _serialise_member(m: Any) -> Dict[str, Any]:
    """Coerce a `UserFileMembershipInfo` /
    `UserMembershipInfo` (folder) into the shared JSON shape."""
    user = getattr(m, "user", None)
    return {
        "email":         getattr(user, "email", None),
        "display_name":  getattr(user, "display_name", None),
        "same_team":     bool(getattr(user, "same_team", False)) if user else False,
        "account_id":    getattr(user, "account_id", None),
        "access_level":  _tag_str(getattr(m, "access_type", None)),
        "is_inherited":  bool(getattr(m, "is_inherited", False)),
        "is_owner":      _tag_str(getattr(m, "access_type", None)) == "owner",
    }


def _serialise_invitee(inv: Any) -> Dict[str, Any]:
    """Coerce a pending InviteeMembershipInfo (email-only, not yet
    accepted) into the same shape as an accepted member so the FE
    can render both in one list."""
    invitee = getattr(inv, "invitee", None)
    email = getattr(invitee, "get_email", lambda: None)() if invitee else None
    return {
        "email":         email,
        "display_name":  email,
        "same_team":     False,
        "account_id":    None,
        "access_level":  _tag_str(getattr(inv, "access_type", None)),
        "is_inherited":  False,
        "is_owner":      False,
        "is_invitee":    True,   # not yet accepted
    }


def _visibility_settings(visibility: str, password: Optional[str]):
    """Build a `SharedLinkSettings` matching the requested
    visibility. Falls back to `team_only` for unknown inputs so
    the safer default wins."""
    from dropbox.sharing import SharedLinkSettings, RequestedVisibility
    v = (visibility or "team_only").lower().strip()
    if v == "public":
        return SharedLinkSettings(requested_visibility=RequestedVisibility.public)
    if v == "password":
        return SharedLinkSettings(
            requested_visibility=RequestedVisibility.password,
            link_password=password or "",
        )
    return SharedLinkSettings(requested_visibility=RequestedVisibility.team_only)


def _wrap_sharing_error(exc: Exception, verb: str) -> HTTPException:
    """Sharing-specific error translation. Chains to the general
    `_wrap_dropbox_error` for shared error paths."""
    msg = str(exc)
    lower = msg.lower()
    if "required scope" in lower and ("sharing.read" in lower or "sharing.write" in lower):
        return HTTPException(
            403,
            "Dropbox token is missing the 'sharing' scope. An admin must "
            "re-authorise Dropbox from Settings → Integrations.",
        )
    if "shared_link_already_exists" in lower:
        return HTTPException(409, "a shared link already exists for this path")
    if "email_unverified" in lower:
        return HTTPException(400, "the invited email is not a verified Dropbox account")
    if "team_folder" in lower and "inside" in lower:
        # Some sharing operations refuse to run on paths inside a
        # nested team folder. Surface with a clean message so admins
        # aren't left guessing.
        return HTTPException(400, "this path is inside a nested team folder and can't be shared directly")
    return _wrap_dropbox_error(exc, verb)


def _is_folder_path(dbx, path: str) -> bool:
    """Look up whether a path resolves to a folder. Falls back to
    False on lookup failure — safer to treat as file (fewer async
    branches)."""
    from dropbox.files import FolderMetadata
    try:
        md = dbx.files_get_metadata(_team_root_arg(path))
        return isinstance(md, FolderMetadata)
    except Exception:  # noqa: BLE001
        return False


def _get_shared_folder_id(dbx, path: str) -> Optional[str]:
    """Return an already-set `shared_folder_id` for a folder, or
    None. Not the same as SHARING one — a folder can be a formal
    Dropbox shared folder without our app knowing about it, or
    it can just be a plain folder inside a team space."""
    try:
        md = dbx.files_get_metadata(_team_root_arg(path))
        return getattr(md, "shared_folder_id", None)
    except Exception:  # noqa: BLE001
        return None


def _ensure_shared_folder_id(dbx, path: str, log_verb: str) -> str:
    """Guarantee that a folder has a `shared_folder_id`. Converts
    a plain folder into a shared folder via
    `sharing_share_folder`, polling the returned async job until
    complete (up to 10 s). Raises HTTPException on timeout."""
    existing = _get_shared_folder_id(dbx, path)
    if existing:
        return existing
    from dropbox.sharing import (
        MemberPolicy, AclUpdatePolicy, SharedLinkPolicy,
    )
    launch = dbx.sharing_share_folder(
        _team_root_arg(path),
        member_policy=MemberPolicy.team,
        acl_update_policy=AclUpdatePolicy.editors,
        shared_link_policy=SharedLinkPolicy.team,
        force_async=False,
    )
    # `launch` is a union — Complete (synchronous share succeeded)
    # or AsyncJobId (Dropbox needs to spin up the shared folder).
    if launch.is_complete():
        return launch.get_complete().shared_folder_id
    job_id = launch.get_async_job_id()
    import time as _time
    for _ in range(20):
        _time.sleep(0.5)
        status = dbx.sharing_check_share_job_status(job_id)
        if status.is_complete():
            return status.get_complete().shared_folder_id
        # `.is_failed` on failure — surface the reason.
        if status.is_failed():
            raise HTTPException(502, f"Dropbox share_folder job failed during {log_verb}")
    raise HTTPException(504, f"Dropbox share_folder job did not complete in 10 s during {log_verb}")


# ── endpoints ──────────────────────────────────────────────────
@router.get("/share")
async def get_share_state(
    path: str = Query(..., description="Full Dropbox path to a file or folder"),
    user: dict = Depends(get_current_user),
    _: None = Depends(require_permission("integrations", "view")),
):
    """Return the sharing state (links + members) for a path.
    Response:
      {
        "path": "/Foo/bar.pdf",
        "is_folder": false,
        "links":   [{"url", "visibility", "expires", "can_revoke"}, …],
        "members": [{"email", "display_name", "access_level",
                     "is_inherited", "is_owner", "is_invitee"?}, …],
        "invitees": […],  # pending invites
        "member_source": "file" | "folder" | "empty",
      }
    """
    resolved = _normalise_path(path)
    if resolved == _TEAM_FOLDER_ROOT:
        raise HTTPException(400, "cannot share the team folder root")

    dbx = _get_dbx()
    is_folder = _is_folder_path(dbx, resolved)

    # Links: same endpoint for files + folders.
    try:
        link_res = await asyncio.to_thread(
            dbx.sharing_list_shared_links, path=_team_root_arg(resolved), direct_only=True,
        )
        links = [_serialise_link(l) for l in link_res.links]
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        log.warning("[share.list_links] %s: %s", resolved, exc)
        raise _wrap_sharing_error(exc, "list_shared_links")

    # Members: file → sharing_list_file_members;
    #           folder → sharing_list_folder_members IF shared,
    #                    otherwise empty (folder inherits membership).
    members: List[Dict[str, Any]] = []
    invitees: List[Dict[str, Any]] = []
    member_source = "empty"
    try:
        if is_folder:
            sfid = _get_shared_folder_id(dbx, resolved)
            if sfid:
                fm = await asyncio.to_thread(dbx.sharing_list_folder_members, sfid)
                members = [_serialise_member(u) for u in (fm.users or [])]
                invitees = [_serialise_invitee(i) for i in (fm.invitees or [])]
                member_source = "folder"
        else:
            fm = await asyncio.to_thread(dbx.sharing_list_file_members, _team_root_arg(resolved))
            members = [_serialise_member(u) for u in (fm.users or [])]
            invitees = [_serialise_invitee(i) for i in (fm.invitees or [])]
            member_source = "file"
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        # Members list can fail with `access_error/file_not_found`
        # or `access_error/no_permission` on files that inherit
        # from a parent the app can't introspect. Downgrade to a
        # soft empty response — the FE renders "No direct members".
        log.info("[share.list_members] soft-fail %s: %s", resolved, exc)

    return {
        "path":           resolved,
        "is_folder":      is_folder,
        "links":          links,
        "members":        members,
        "invitees":       invitees,
        "member_source":  member_source,
    }


@router.post("/share/link")
async def create_shared_link(
    body: ShareLinkIn,
    user: dict = Depends(get_current_user),
    _: None = Depends(require_permission("integrations", "view")),
):
    """Create a shared link on `path`. If a link already exists
    with matching visibility, return the existing one instead of
    409-ing — Dropbox web UX behaviour."""
    resolved = _normalise_path(body.path)
    if resolved == _TEAM_FOLDER_ROOT:
        raise HTTPException(400, "cannot create a link for the team folder root")

    dbx = _get_dbx()
    settings = _visibility_settings(body.visibility, body.password)
    try:
        link = await asyncio.to_thread(
            dbx.sharing_create_shared_link_with_settings,
            _team_root_arg(resolved), settings,
        )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        # Already-exists → fetch and return it (idempotent behaviour).
        if "shared_link_already_exists" in str(exc).lower():
            r = await asyncio.to_thread(
                dbx.sharing_list_shared_links, path=_team_root_arg(resolved), direct_only=True,
            )
            if r.links:
                await _audit(user, "share_link_existing", resolved, {"visibility": body.visibility})
                return _serialise_link(r.links[0])
        log.warning("[share.create_link] %s: %s", resolved, exc)
        raise _wrap_sharing_error(exc, "create_shared_link")

    await _audit(user, "share_link_create", resolved, {"visibility": body.visibility})
    return _serialise_link(link)


@router.post("/share/link/revoke")
async def revoke_shared_link(
    body: RevokeLinkIn,
    user: dict = Depends(get_current_user),
    _: None = Depends(require_permission("integrations", "view")),
):
    """Revoke a shared link by URL. Idempotent on 404 (link not
    found) — surfaces as a 200 so the FE can re-fetch the state
    without a special-case."""
    url = (body.url or "").strip()
    if not url:
        raise HTTPException(400, "url is required")

    dbx = _get_dbx()
    try:
        await asyncio.to_thread(dbx.sharing_revoke_shared_link, url)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        lower = str(exc).lower()
        if "shared_link_not_found" in lower or "not_found" in lower:
            await _audit(user, "share_link_revoke_already_gone", url, {})
            return {"revoked": True, "already_gone": True}
        log.warning("[share.revoke_link] %s: %s", url[:80], exc)
        raise _wrap_sharing_error(exc, "revoke_shared_link")

    await _audit(user, "share_link_revoke", url, {})
    return {"revoked": True}


@router.post("/share/invite")
async def invite_member(
    body: InviteIn,
    user: dict = Depends(get_current_user),
    _: None = Depends(require_permission("integrations", "view")),
):
    """Invite a person to a path. Routes to
    `sharing_add_file_member` for files or
    `sharing_add_folder_member` for folders. Folders are
    auto-converted to shared folders (via `_ensure_shared_folder_id`)
    if they aren't already."""
    resolved = _normalise_path(body.path)
    if resolved == _TEAM_FOLDER_ROOT:
        raise HTTPException(400, "cannot invite to the team folder root")
    email = (body.email or "").strip().lower()
    if not email or "@" not in email:
        raise HTTPException(400, "invalid email")

    from dropbox.sharing import (
        AccessLevel, MemberSelector, AddMember, AddFileMemberError,
    )
    from dropbox import sharing as dbx_sharing

    level = AccessLevel.editor if (body.access_level or "").lower() == "editor" else AccessLevel.viewer

    dbx = _get_dbx()
    is_folder = _is_folder_path(dbx, resolved)

    try:
        if is_folder:
            sfid = _ensure_shared_folder_id(dbx, resolved, "invite")
            members = [AddMember(member=MemberSelector.email(email), access_level=level)]
            await asyncio.to_thread(
                dbx.sharing_add_folder_member, sfid, members,
                quiet=False, custom_message=body.message or None,
            )
        else:
            members = [MemberSelector.email(email)]
            add_res = await asyncio.to_thread(
                dbx.sharing_add_file_member,
                _team_root_arg(resolved), members,
                custom_message=body.message or None,
                quiet=False,
                access_level=level,
            )
            # `sharing_add_file_member` returns a list of per-member
            # results. Surface a per-email 400 if the SDK reported
            # an error tag rather than success.
            for r in (add_res or []):
                res = getattr(r, "result", None)
                if res is not None and hasattr(res, "get_member_error"):
                    err = res.get_member_error()
                    raise HTTPException(400, f"invite failed: {getattr(err, '_tag', str(err))}")
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        log.warning("[share.invite] %s ← %s: %s", resolved, email, exc)
        raise _wrap_sharing_error(exc, "invite_member")

    await _audit(user, "share_invite", resolved, {"email": email, "access_level": body.access_level})
    return {"invited": True, "email": email, "access_level": body.access_level}


@router.post("/share/remove-member")
async def remove_member(
    body: RemoveMemberIn,
    user: dict = Depends(get_current_user),
    _: None = Depends(require_permission("integrations", "view")),
):
    """Remove a person from a shared file or folder. Inherited
    members can't be removed at this scope — they inherit from a
    parent folder and Dropbox will 400. The FE hides Remove on
    `is_inherited` rows to avoid the round-trip."""
    resolved = _normalise_path(body.path)
    if resolved == _TEAM_FOLDER_ROOT:
        raise HTTPException(400, "cannot remove from the team folder root")
    email = (body.email or "").strip().lower()
    if not email or "@" not in email:
        raise HTTPException(400, "invalid email")

    from dropbox.sharing import MemberSelector

    dbx = _get_dbx()
    is_folder = _is_folder_path(dbx, resolved)

    try:
        if is_folder:
            sfid = _get_shared_folder_id(dbx, resolved)
            if not sfid:
                # Nothing to remove — folder isn't a shared folder.
                raise HTTPException(404, "folder is not shared; nothing to remove")
            await asyncio.to_thread(
                dbx.sharing_remove_folder_member, sfid,
                MemberSelector.email(email), leave_a_copy=False,
            )
        else:
            await asyncio.to_thread(
                dbx.sharing_remove_file_member_2,
                _team_root_arg(resolved), MemberSelector.email(email),
            )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        log.warning("[share.remove] %s ← %s: %s", resolved, email, exc)
        raise _wrap_sharing_error(exc, "remove_member")

    await _audit(user, "share_remove", resolved, {"email": email})
    return {"removed": True, "email": email}

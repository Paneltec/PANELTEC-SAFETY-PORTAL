"""v58.13.132le — Dropbox integration Phase 1: folder tree mirror.

Mirrors the full folder tree of `/Paneltec-General Administration`
(or whatever `DROPBOX_TEAM_FOLDER_NAME` points at) from Dropbox into
the org's `doc_folders` collection. Folder structure ONLY — file bytes
are Phase 2.

Idempotent: safe to re-run. Existing folders keyed on
`dropbox_folder_id` are UPDATED in place (name, parent, last_seen,
slug) rather than duplicated. Never soft-deletes anything —
disappeared folders just fall out of the `dropbox_last_seen_at`
freshness window and get logged for future Phase 3 webhook logic.

Access control default: `shared_reference: False`. Admins can flip
per-folder via the existing `.132km` toggle.

Public surface:
    async def run_mirror(dry_run: bool = False, on_progress=None) -> Dict[str, Any]
    async def ensure_indexes() -> None
"""
from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional

from db import db
from models import new_id, now_iso

log = logging.getLogger("paneltec.dropbox.mirror")

# Stephen's org — canonical for the initial Phase 1 mirror. Kept
# behind an env var so a future migration can point at a different
# org without a code change.
_DEFAULT_ORG_ID = os.environ.get(
    "DROPBOX_MIRROR_ORG_ID", "3116f250-a4eb-43f3-98a5-2a3656d6cb63"
)
_SYSTEM_ACTOR_ID = os.environ.get("DROPBOX_MIRROR_ACTOR_ID", "system:dropbox-mirror")
_TEAM_FOLDER_NAME = os.environ.get(
    "DROPBOX_TEAM_FOLDER_NAME", "Paneltec-General Administration"
)
_ROOT_NS = os.environ.get("DROPBOX_ROOT_NAMESPACE_ID", "2673752851")


# ── slug helper ────────────────────────────────────────────────
def _slugify(name: str) -> str:
    """Kebab-case URL-safe slug. Strips apostrophes, spaces →
    hyphens, lowercases, collapses runs of separators."""
    s = name.strip().lower()
    s = s.replace("'", "").replace("\u2019", "")  # ' + curly '
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s or "folder"


# ── index bootstrap ────────────────────────────────────────────
async def ensure_indexes() -> None:
    """Create the indexes the mirror + reconciler need. Idempotent —
    Mongo silently no-ops if the same index already exists."""
    await db.doc_folders.create_index(
        [("org_id", 1), ("dropbox_folder_id", 1)],
        name="doc_folders_dropbox_folder_id",
        sparse=True,
    )
    await db.doc_folders.create_index(
        [("org_id", 1), ("dropbox_path_lower", 1)],
        name="doc_folders_dropbox_path_lower",
        sparse=True,
    )
    await db.doc_folders.create_index(
        [("org_id", 1), ("source", 1)],
        name="doc_folders_source",
        sparse=True,
    )


# ── Dropbox client ─────────────────────────────────────────────
def _get_dbx_root_client():
    """Returns a `dropbox.Dropbox` client already scoped to the
    account's root namespace (via `with_path_root`). Auto-refresh
    kicks in when `oauth2_refresh_token` + app creds are present."""
    import dropbox
    from dropbox.common import PathRoot
    refresh = os.environ.get("DROPBOX_REFRESH_TOKEN", "").strip()
    access = os.environ.get("DROPBOX_ACCESS_TOKEN", "").strip()
    app_key = os.environ.get("DROPBOX_APP_KEY", "").strip()
    app_secret = os.environ.get("DROPBOX_APP_SECRET", "").strip()
    if refresh and app_key and app_secret:
        dbx = dropbox.Dropbox(
            oauth2_access_token=access or None,
            oauth2_refresh_token=refresh,
            app_key=app_key,
            app_secret=app_secret,
        )
    elif access:
        dbx = dropbox.Dropbox(access)
    else:
        raise RuntimeError("no Dropbox credentials configured")
    return dbx.with_path_root(PathRoot.namespace_id(_ROOT_NS))


# ── recursive walk ─────────────────────────────────────────────
async def _list_folder_recursive(dbx_root, path: str) -> List[Dict[str, Any]]:
    """Full recursive listing under `path`. Uses `asyncio.to_thread`
    so the (blocking) Dropbox SDK calls don't stall the event loop
    — critical when this runs as a background task alongside live
    HTTP traffic."""
    import asyncio
    from dropbox.files import FolderMetadata
    out: List[Dict[str, Any]] = []
    res = await asyncio.to_thread(
        dbx_root.files_list_folder, path, True,  # recursive=True positional
    )

    def _absorb(batch):
        for e in batch.entries:
            if isinstance(e, FolderMetadata):
                out.append({
                    "id": e.id,
                    "name": e.name,
                    "path_lower": e.path_lower,
                    "path_display": e.path_display,
                    "shared_folder_id": getattr(e, "shared_folder_id", None),
                })

    _absorb(res)
    while res.has_more:
        res = await asyncio.to_thread(
            dbx_root.files_list_folder_continue, res.cursor,
        )
        _absorb(res)
    return out


# ── mirror upsert ──────────────────────────────────────────────
async def _upsert_root_folder(org_id: str, actor_id: str,
                                team_folder_id: str,
                                team_folder_path: str,
                                dry_run: bool) -> Dict[str, Any]:
    """Ensure the top-level anchor folder exists. Returns the row."""
    existing = await db.doc_folders.find_one(
        {"org_id": org_id,
         "dropbox_folder_id": team_folder_id,
         "deleted_at": None},
        {"_id": 0},
    )
    if existing:
        # Refresh last_seen + name (name could change on Dropbox side).
        if not dry_run:
            await db.doc_folders.update_one(
                {"id": existing["id"]},
                {"$set": {
                    "name": _TEAM_FOLDER_NAME,
                    "dropbox_path": team_folder_path,
                    "dropbox_path_lower": team_folder_path.lower(),
                    "dropbox_last_seen_at": now_iso(),
                    "updated_at": now_iso(),
                }},
            )
        return existing

    # Give the anchor a stable place at the end of the sort order.
    last = await db.doc_folders.find_one(
        {"org_id": org_id, "deleted_at": None},
        {"_id": 0, "sort_order": 1},
        sort=[("sort_order", -1)],
    )
    next_order = ((last or {}).get("sort_order") or 0) + 10

    doc = {
        "id": new_id(),
        "org_id": org_id,
        "name": _TEAM_FOLDER_NAME,
        "color_key": "sky",
        "sort_order": next_order,
        "is_system": False,
        "parent_folder_id": None,
        "source": "dropbox",
        "dropbox_folder_id": team_folder_id,
        "dropbox_path": team_folder_path,
        "dropbox_path_lower": team_folder_path.lower(),
        "dropbox_last_seen_at": now_iso(),
        "shared_reference": False,
        "slug": _slugify(_TEAM_FOLDER_NAME),
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "created_by": actor_id,
        "deleted_at": None,
    }
    if not dry_run:
        await db.doc_folders.insert_one(doc)
    return doc


async def _upsert_child(org_id: str, actor_id: str, entry: Dict[str, Any],
                          parent_id: str, dry_run: bool) -> str:
    """Upsert a single child folder keyed on `dropbox_folder_id`.
    Returns "created" / "updated"."""
    now = now_iso()
    existing = await db.doc_folders.find_one(
        {"org_id": org_id, "dropbox_folder_id": entry["id"]},
        {"_id": 0, "id": 1, "deleted_at": 1},
    )
    if existing:
        if not dry_run:
            await db.doc_folders.update_one(
                {"id": existing["id"]},
                {"$set": {
                    "name": entry["name"],
                    "parent_folder_id": parent_id,
                    "dropbox_path": entry["path_display"],
                    "dropbox_path_lower": entry["path_lower"],
                    "dropbox_last_seen_at": now,
                    "updated_at": now,
                    # If it was soft-deleted between runs, revive.
                    "deleted_at": None,
                    "source": "dropbox",
                }},
            )
        return "updated"

    doc = {
        "id": new_id(),
        "org_id": org_id,
        "name": entry["name"],
        "color_key": "sky",
        "sort_order": 0,
        "is_system": False,
        "parent_folder_id": parent_id,
        "source": "dropbox",
        "dropbox_folder_id": entry["id"],
        "dropbox_path": entry["path_display"],
        "dropbox_path_lower": entry["path_lower"],
        "dropbox_last_seen_at": now,
        "shared_reference": False,
        "slug": _slugify(entry["name"]),
        "created_at": now,
        "updated_at": now,
        "created_by": actor_id,
        "deleted_at": None,
    }
    if not dry_run:
        await db.doc_folders.insert_one(doc)
    return "created"


# ── orchestrator ───────────────────────────────────────────────
async def run_mirror(
    dry_run: bool = False,
    on_progress: Optional[Callable[[Dict[str, Any]], None]] = None,
    org_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Execute the full folder-tree mirror. Returns a summary dict.

    `on_progress` receives dicts like:
      {"phase": "walk", "folders_seen": N}
      {"phase": "upsert", "depth": D, "created": N, "updated": N,
       "current_path": "/…"}
      {"phase": "done", "totals": {...}}

    `dry_run=True` performs every read but skips every write.
    """
    org = org_id or _DEFAULT_ORG_ID
    started_at = datetime.now(timezone.utc)
    summary: Dict[str, Any] = {
        "dry_run": dry_run,
        "org_id": org,
        "team_folder_name": _TEAM_FOLDER_NAME,
        "team_folder_id": None,
        "root_created_or_present": False,
        "folders_seen": 0,
        "created": 0,
        "updated": 0,
        "skipped_missing_parent": 0,
        "max_depth": 0,
        "stale_folders": 0,
        "started_at": started_at.isoformat(),
        "finished_at": None,
        "elapsed_s": None,
        "errors": [],
    }

    def _emit(**kw):
        if on_progress:
            try:
                on_progress({**kw})
            except Exception:  # noqa: BLE001
                pass

    await ensure_indexes()

    # Load Dropbox client + walk the tree.
    try:
        dbx_root = _get_dbx_root_client()
    except Exception as e:  # noqa: BLE001
        summary["errors"].append(f"dropbox client init failed: {e}")
        summary["finished_at"] = datetime.now(timezone.utc).isoformat()
        return summary

    team_folder_path = "/" + _TEAM_FOLDER_NAME
    # Team folder ID is not exposed by files/list_folder from
    # inside the folder; we look it up at the root ns level.
    import asyncio as _aio
    from dropbox.files import FolderMetadata
    try:
        root_entries = (await _aio.to_thread(
            dbx_root.files_list_folder, "", False,
        )).entries
        for e in root_entries:
            if isinstance(e, FolderMetadata) and e.name == _TEAM_FOLDER_NAME:
                summary["team_folder_id"] = getattr(
                    e, "shared_folder_id", None
                ) or e.id
                break
    except Exception as e:  # noqa: BLE001
        log.warning("root ns probe failed: %s", e)

    _emit(phase="walk", folders_seen=0)
    try:
        folders = await _list_folder_recursive(dbx_root, team_folder_path)
    except Exception as e:  # noqa: BLE001
        summary["errors"].append(f"list_folder failed: {e}")
        summary["finished_at"] = datetime.now(timezone.utc).isoformat()
        return summary
    summary["folders_seen"] = len(folders)
    _emit(phase="walk", folders_seen=len(folders))

    # Upsert the anchor folder (top-level Paneltec-General Administration
    # inside the app's doc_folders).
    root = await _upsert_root_folder(
        org_id=org, actor_id=_SYSTEM_ACTOR_ID,
        team_folder_id=summary["team_folder_id"] or "unknown",
        team_folder_path=team_folder_path,
        dry_run=dry_run,
    )
    summary["root_created_or_present"] = True

    # Sort by path depth ascending so parents land before children.
    def _depth(p: str) -> int:
        return p.count("/")
    folders.sort(key=lambda e: (_depth(e["path_lower"]), e["path_lower"]))

    # Path → doc_folder.id lookup, seeded with the anchor.
    path_to_id: Dict[str, str] = {
        team_folder_path.lower(): root["id"],
    }
    # Also — when dry-run, we synthesise placeholder ids so downstream
    # children can still resolve their parent by path.
    if dry_run:
        for entry in folders:
            path_to_id[entry["path_lower"]] = f"dry:{entry['id']}"

    log_every = 50
    for i, entry in enumerate(folders, 1):
        parent_path = entry["path_lower"].rsplit("/", 1)[0]
        parent_id = path_to_id.get(parent_path)
        if not parent_id:
            # Look up in Mongo by dropbox_path_lower — handles the case
            # where the parent already exists from a previous run.
            parent_doc = await db.doc_folders.find_one(
                {"org_id": org, "dropbox_path_lower": parent_path,
                 "deleted_at": None},
                {"_id": 0, "id": 1},
            )
            if parent_doc:
                parent_id = parent_doc["id"]
                path_to_id[parent_path] = parent_id
        if not parent_id:
            summary["skipped_missing_parent"] += 1
            log.warning("skip %s — missing parent %s", entry["path_display"], parent_path)
            continue

        result = await _upsert_child(
            org_id=org, actor_id=_SYSTEM_ACTOR_ID,
            entry=entry, parent_id=parent_id, dry_run=dry_run,
        )
        if result == "created":
            summary["created"] += 1
        else:
            summary["updated"] += 1

        # Remember this folder for downstream children.
        if not dry_run:
            path_to_id[entry["path_lower"]] = (
                (await db.doc_folders.find_one(
                    {"org_id": org, "dropbox_folder_id": entry["id"]},
                    {"_id": 0, "id": 1},
                )) or {}
            ).get("id", path_to_id.get(entry["path_lower"], ""))

        d = _depth(entry["path_lower"])
        if d > summary["max_depth"]:
            summary["max_depth"] = d

        if i % log_every == 0:
            _emit(
                phase="upsert", index=i, total=len(folders),
                created=summary["created"], updated=summary["updated"],
                depth=d, current_path=entry["path_display"],
            )
            log.info(
                "[dropbox-mirror] progress %d/%d created=%d updated=%d depth=%d",
                i, len(folders),
                summary["created"], summary["updated"], d,
            )

    # Stale-folder drift detector — non-destructive: just counts
    # rows with a source='dropbox' where dropbox_last_seen_at is
    # older than the run started. These will be actionable in
    # Phase 3's webhook reconciler; for now they only surface via
    # the summary.
    stale = await db.doc_folders.count_documents({
        "org_id": org,
        "source": "dropbox",
        "deleted_at": None,
        "dropbox_last_seen_at": {"$lt": started_at.isoformat()},
    })
    summary["stale_folders"] = stale

    finished_at = datetime.now(timezone.utc)
    summary["finished_at"] = finished_at.isoformat()
    summary["elapsed_s"] = (finished_at - started_at).total_seconds()
    _emit(phase="done", totals=summary)

    log.info(
        "[dropbox-mirror] DONE dry_run=%s created=%d updated=%d "
        "skipped=%d stale=%d max_depth=%d elapsed=%.1fs",
        dry_run, summary["created"], summary["updated"],
        summary["skipped_missing_parent"], stale,
        summary["max_depth"], summary["elapsed_s"],
    )
    return summary

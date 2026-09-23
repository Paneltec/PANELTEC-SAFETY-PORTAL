"""v58.13.132lb — Dropbox Phase 0 audit script.

Verifies:
  1. Access token is valid and scoped to a team admin.
  2. `Paneltec-General Administration` team folder exists → captures
     the team_folder_id + team-space namespace id.
  3. Top-level contents of that team folder (folders + files).
  4. Size estimate — top 2 levels exhaustively, then 3 random sampled
     deeper subfolders projected to the whole tree.

NEVER logs the access token value. All prints scrub any token-looking
substring.

Run locally with:
    cd /app/backend && python scripts/dropbox_phase0_audit.py
"""
from __future__ import annotations

import json
import os
import random
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv

# Load /app/backend/.env
BE_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(BE_ROOT / ".env")

import dropbox
from dropbox import DropboxTeam
from dropbox.common import PathRoot
from dropbox.exceptions import ApiError, AuthError, BadInputError
from dropbox.files import FolderMetadata, FileMetadata


# ── secret-safe printing ─────────────────────────────────────────
_TOKEN = os.environ.get("DROPBOX_ACCESS_TOKEN", "")
_APP_SECRET = os.environ.get("DROPBOX_APP_SECRET", "")


def safe_print(*args, **kwargs) -> None:
    parts = []
    for a in args:
        s = a if isinstance(a, str) else json.dumps(a, default=str)
        if _TOKEN and _TOKEN in s:
            s = s.replace(_TOKEN, "[REDACTED_TOKEN]")
        if _APP_SECRET and _APP_SECRET in s:
            s = s.replace(_APP_SECRET, "[REDACTED_APP_SECRET]")
        # Redact any 60+ char sl.u.* dropbox-token-shaped substring.
        s = re.sub(r"sl\.u\.[A-Za-z0-9_\-]{40,}", "[REDACTED_SL_TOKEN]", s)
        parts.append(s)
    print(*parts, **kwargs)


# ── main ─────────────────────────────────────────────────────────

def _human_size(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024:
            return f"{n:.2f} {unit}"
        n /= 1024
    return f"{n:.2f} PB"


def list_folder_all(dbx, path: str) -> List[Any]:
    """List all entries in a folder (paginated). Non-recursive."""
    entries: List[Any] = []
    try:
        res = dbx.files_list_folder(path, recursive=False)
    except ApiError as e:
        safe_print(f"  ! list_folder failed on {path!r}: {e}")
        return entries
    entries.extend(res.entries)
    while res.has_more:
        res = dbx.files_list_folder_continue(res.cursor)
        entries.extend(res.entries)
    return entries


def list_folder_recursive_counts(dbx, path: str, limit_entries: int = 20000) -> Dict[str, int]:
    """Recursively list a folder; return count + total size + file count."""
    files = 0
    folders = 0
    total_bytes = 0
    seen = 0
    try:
        res = dbx.files_list_folder(path, recursive=True)
    except ApiError as e:
        safe_print(f"  ! list_folder recursive failed on {path!r}: {e}")
        return {"files": 0, "folders": 0, "bytes": 0, "truncated": True}
    while True:
        for e in res.entries:
            seen += 1
            if isinstance(e, FileMetadata):
                files += 1
                total_bytes += (e.size or 0)
            elif isinstance(e, FolderMetadata):
                folders += 1
            if seen >= limit_entries:
                return {"files": files, "folders": folders,
                        "bytes": total_bytes, "truncated": True}
        if not res.has_more:
            break
        res = dbx.files_list_folder_continue(res.cursor)
    return {"files": files, "folders": folders, "bytes": total_bytes,
            "truncated": False}


def main() -> Dict[str, Any]:
    if not _TOKEN:
        safe_print("FATAL: DROPBOX_ACCESS_TOKEN missing from env.")
        sys.exit(2)

    result: Dict[str, Any] = {
        "connected": False,
        "team_admin": False,
        "team_folder_found": False,
        "team_folder_name": os.environ.get("DROPBOX_TEAM_FOLDER_NAME",
                                            "Paneltec-General Administration"),
        "team_folder_id": None,
        "team_namespace_id": None,
        "root_folder_id": None,
        "top_level": [],
        "top_level_folder_count": 0,
        "top_level_file_count": 0,
        "top_level_bytes": 0,
        "level2_folder_count": 0,
        "level2_file_count": 0,
        "level2_bytes": 0,
        "sampled_subtrees": [],
        "estimated_total_files": 0,
        "estimated_total_bytes": 0,
        "errors": [],
    }

    # Step 1 — TEAM token check.
    try:
        dbx_team = DropboxTeam(_TOKEN)
        team_info = dbx_team.team_get_info()
        safe_print("[1/5] Team connect OK:")
        safe_print(f"      team_name      = {team_info.name}")
        safe_print(f"      team_id        = {team_info.team_id}")
        safe_print(f"      num_licensed   = {team_info.num_licensed_users}")
        safe_print(f"      num_provisioned= {team_info.num_provisioned_users}")
        result["connected"] = True
        result["team_admin"] = True  # Team-scoped token implies team-admin OAuth.
    except (AuthError, BadInputError) as e:
        # Fall back — token is USER-scoped (individual OAuth), not team-scoped.
        safe_print("[1/5] Team-scoped auth NOT available (user-scoped token). "
                     "Falling back to user client + path_root routing.")
        result["errors"].append({"step": "team_get_info",
                                   "detail": type(e).__name__})
        dbx_team = None

    # Step 1b — user account.
    dbx_user = dropbox.Dropbox(_TOKEN)
    try:
        me = dbx_user.users_get_current_account()
        safe_print(f"      account_type   = {me.account_type._tag}")
        safe_print(f"      account_id     = {me.account_id}")
        safe_print(f"      email          = {me.email}")
        safe_print(f"      is_teammember  = {getattr(me, 'team_member_id', None) is not None}")
        # Namespace hints
        root_info = me.root_info
        result["root_folder_id"] = root_info.root_namespace_id
        safe_print(f"      root_ns_id     = {root_info.root_namespace_id}")
        safe_print(f"      home_ns_id     = {root_info.home_namespace_id}")
        result["connected"] = True
    except AuthError as e:
        safe_print(f"FATAL: user auth failed: {e}")
        result["errors"].append({"step": "users_get_current_account",
                                   "detail": str(e)})
        return result

    # Step 2 — team_folder/list.
    target_name = result["team_folder_name"]
    target_folder = None
    if dbx_team is not None:
        try:
            safe_print(f"\n[2/5] Listing team folders (target={target_name!r})...")
            tf_res = dbx_team.team_team_folder_list(limit=1000)
            safe_print(f"      {len(tf_res.team_folders)} team folder(s) found:")
            for tf in tf_res.team_folders:
                safe_print(f"        · {tf.name}  (id={tf.team_folder_id}, status={tf.status._tag})")
                if tf.name.strip().lower() == target_name.strip().lower():
                    target_folder = tf
        except (ApiError, AuthError) as e:
            safe_print(f"      ! team_folder/list failed: {e}")
            result["errors"].append({"step": "team_folder_list",
                                       "detail": str(e)})
    else:
        safe_print("\n[2/5] Skipping team_folder/list — team client unavailable.")

    if target_folder is not None:
        result["team_folder_found"] = True
        result["team_folder_id"] = target_folder.team_folder_id
        # Team folder namespace_id == team_folder_id for path-root.
        result["team_namespace_id"] = target_folder.team_folder_id
        safe_print(f"      ✓ target team folder found: id={target_folder.team_folder_id}")
    else:
        # Fallback: user-scoped token can still see mounted team folders as
        # entries at the root of the user's root_namespace_id. Their
        # `shared_folder_id` is the team-folder namespace id we need to
        # scope path_root against.
        safe_print(f"      ! target team folder {target_name!r} NOT found via team_folder/list.")
        safe_print(f"      → falling back to root-namespace listing (user-scoped discovery).")
        try:
            root_ns = result["root_folder_id"]
            dbx_probe = dbx_user.with_path_root(PathRoot.namespace_id(root_ns))
            for e in list_folder_all(dbx_probe, ""):
                if isinstance(e, FolderMetadata) and \
                    e.name.strip().lower() == target_name.strip().lower():
                    sfid = getattr(e, "shared_folder_id", None)
                    if sfid:
                        result["team_folder_found"] = True
                        result["team_folder_id"] = sfid
                        result["team_namespace_id"] = sfid
                        safe_print(f"      ✓ resolved via root scan: shared_folder_id={sfid}")
                    else:
                        # Not a shared/team folder — still record path.
                        result["team_folder_found"] = True
                        result["team_folder_id"] = e.id
                        result["team_namespace_id"] = None
                        result["team_folder_path"] = e.path_lower
                        safe_print(f"      ✓ resolved via root scan: path={e.path_lower} (not a namespace)")
                    break
        except ApiError as e:
            safe_print(f"      ! root-scan fallback failed: {e}")
            result["errors"].append({"step": "root_scan_fallback",
                                       "detail": str(e)})

    # Step 3 — enter team space namespace and list the target folder root.
    #
    # We route the user client through the team-space namespace so
    # `/` resolves inside the team folder, not the user's personal
    # home.
    ns_id = result["team_namespace_id"]
    if ns_id:
        dbx_root = dbx_user.with_path_root(PathRoot.namespace_id(ns_id))
        root_path = ""
        safe_print(f"\n[3/5] Listing root of team ns_id={ns_id}...")
    else:
        # Fallback: use root_namespace_id + folder-path scoping.
        dbx_root = dbx_user.with_path_root(PathRoot.namespace_id(result["root_folder_id"]))
        root_path = result.get("team_folder_path") or f"/{target_name}"
        safe_print(f"\n[3/5] Listing team folder by path {root_path!r} "
                     f"(root ns_id={result['root_folder_id']})...")
    try:
        top_entries = list_folder_all(dbx_root, root_path)
    except ApiError as e:
        safe_print(f"      ! list_folder({root_path!r}) failed: {e}")
        result["errors"].append({"step": "list_top", "detail": str(e)})
        top_entries = []

    top_folders: List[FolderMetadata] = []
    top_files: List[FileMetadata] = []
    for e in top_entries:
        if isinstance(e, FolderMetadata):
            top_folders.append(e)
        elif isinstance(e, FileMetadata):
            top_files.append(e)

    result["top_level_folder_count"] = len(top_folders)
    result["top_level_file_count"] = len(top_files)
    result["top_level_bytes"] = sum((f.size or 0) for f in top_files)
    result["top_level"] = [
        {"type": "folder", "name": f.name, "path_lower": f.path_lower}
        for f in top_folders
    ] + [
        {"type": "file", "name": f.name, "size": f.size,
         "path_lower": f.path_lower}
        for f in top_files
    ]
    safe_print(f"      top-level: {len(top_folders)} folder(s), "
                 f"{len(top_files)} file(s), "
                 f"{_human_size(result['top_level_bytes'])}")
    for f in top_folders[:20]:
        safe_print(f"        📁 {f.name}")
    for f in top_files[:5]:
        safe_print(f"        📄 {f.name}  ({_human_size(f.size or 0)})")

    # Step 4 — exhaustive level 2 counts.
    safe_print(f"\n[4/5] Walking level 2 inside {len(top_folders)} top folder(s)...")
    l2_files = 0
    l2_folders = 0
    l2_bytes = 0
    per_top: List[Dict[str, Any]] = []
    for f in top_folders:
        try:
            children = list_folder_all(dbx_root, f.path_lower)
        except ApiError as e:
            safe_print(f"      ! failed at {f.path_lower}: {e}")
            continue
        cf = sum(1 for c in children if isinstance(c, FolderMetadata))
        cfi = sum(1 for c in children if isinstance(c, FileMetadata))
        cby = sum((c.size or 0) for c in children if isinstance(c, FileMetadata))
        l2_folders += cf
        l2_files += cfi
        l2_bytes += cby
        per_top.append({"path": f.path_lower, "child_folders": cf,
                          "child_files": cfi, "child_bytes": cby})
        safe_print(f"        · {f.name}: {cf}f/{cfi}fi ({_human_size(cby)})")

    result["level2_folder_count"] = l2_folders
    result["level2_file_count"] = l2_files
    result["level2_bytes"] = l2_bytes
    safe_print(f"      level-2 totals: {l2_folders} folder(s), "
                 f"{l2_files} file(s), {_human_size(l2_bytes)}")

    # Step 5 — sample 3 random level-2 subtrees for deep projection.
    safe_print(f"\n[5/5] Sampling 3 random level-2 subtrees for projection...")
    all_l2_dirs: List[str] = []
    for f in top_folders:
        try:
            for c in list_folder_all(dbx_root, f.path_lower):
                if isinstance(c, FolderMetadata):
                    all_l2_dirs.append(c.path_lower)
        except ApiError:
            continue
    safe_print(f"      pool: {len(all_l2_dirs)} level-2 subfolders available")
    sample = random.sample(all_l2_dirs, k=min(3, len(all_l2_dirs))) if all_l2_dirs else []

    sample_totals = {"files": 0, "folders": 0, "bytes": 0}
    for path in sample:
        safe_print(f"      → recursing {path} ...")
        stats = list_folder_recursive_counts(dbx_root, path, limit_entries=20000)
        sample_totals["files"] += stats["files"]
        sample_totals["folders"] += stats["folders"]
        sample_totals["bytes"] += stats["bytes"]
        result["sampled_subtrees"].append({"path": path, **stats})
        safe_print(f"          {stats['files']} files, {stats['folders']} folders, "
                     f"{_human_size(stats['bytes'])}"
                     + ("  [truncated]" if stats["truncated"] else ""))

    # Projection.
    est_files = result["top_level_file_count"] + result["level2_file_count"]
    est_bytes = result["top_level_bytes"] + result["level2_bytes"]
    if sample and len(sample) > 0:
        avg_files_per_l2 = sample_totals["files"] / len(sample)
        avg_bytes_per_l2 = sample_totals["bytes"] / len(sample)
        # Project across ALL level-2 subfolders (including unsampled).
        unsampled_l2 = max(0, l2_folders - len(sample))
        est_files += int(avg_files_per_l2 * unsampled_l2)
        est_bytes += int(avg_bytes_per_l2 * unsampled_l2)
    result["estimated_total_files"] = est_files
    result["estimated_total_bytes"] = est_bytes

    safe_print("\n─────────────────────────────────────────────")
    safe_print("SUMMARY")
    safe_print("─────────────────────────────────────────────")
    safe_print(f"  connected             : {result['connected']}")
    safe_print(f"  team_admin            : {result['team_admin']}")
    safe_print(f"  team_folder_found     : {result['team_folder_found']}")
    safe_print(f"  team_folder_id        : {result['team_folder_id']}")
    safe_print(f"  top-level folders     : {result['top_level_folder_count']}")
    safe_print(f"  top-level files       : {result['top_level_file_count']}")
    safe_print(f"  top-level bytes       : {_human_size(result['top_level_bytes'])}")
    safe_print(f"  level-2 folders       : {result['level2_folder_count']}")
    safe_print(f"  level-2 files         : {result['level2_file_count']}")
    safe_print(f"  level-2 bytes         : {_human_size(result['level2_bytes'])}")
    safe_print(f"  sampled subtrees      : {len(sample)}")
    safe_print(f"  projected total files : {result['estimated_total_files']}")
    safe_print(f"  projected total size  : {_human_size(result['estimated_total_bytes'])}")

    # Persist artifact for the ship memo (token/secret redacted).
    artifact = BE_ROOT.parent / "memory" / "dropbox_phase0_audit_v58_13_132lb.json"
    artifact.parent.mkdir(parents=True, exist_ok=True)
    with open(artifact, "w") as f:
        json.dump(result, f, indent=2, default=str)
    safe_print(f"\n  artifact saved: {artifact}")

    return result


if __name__ == "__main__":
    main()

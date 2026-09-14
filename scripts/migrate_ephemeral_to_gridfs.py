"""v58.13.132gf — Sweep ephemeral local-disk uploads into GridFS.

Scans every module currently migrated to `uploads_storage.py` and,
for each local-disk file that lacks a GridFS twin, streams the
bytes into the shared `upload_storage` bucket and writes an
`archive_audit` row so the migration is retraceable.

Usage:
    python3 scripts/migrate_ephemeral_to_gridfs.py            # report only
    python3 scripts/migrate_ephemeral_to_gridfs.py --run      # actually migrate

Safe to re-run; a matching GridFS row (by `metadata.key`) makes the
file a no-op on the next sweep. Missing local files are logged with
action `ephemeral_to_gridfs_missing_source` — the DB record is NOT
touched.
"""
from __future__ import annotations

import argparse
import asyncio
import mimetypes
import os
import re
import sys
from pathlib import Path
from datetime import datetime, timezone

APP_ROOT = Path(__file__).resolve().parents[1]
BACKEND = APP_ROOT / "backend"
sys.path.insert(0, str(BACKEND))

# Load backend/.env (MONGO_URL/DB_NAME) before importing motor via db.
be_env = (BACKEND / ".env").read_text()
for m in re.finditer(r"(?m)^([A-Z_][A-Z0-9_]*)=(.+)$", be_env):
    os.environ.setdefault(m.group(1),
                            m.group(2).strip().strip('"').strip("'"))

from db import db  # noqa: E402
from uploads_storage import save_upload, has_upload  # noqa: E402

UPLOAD_ROOT = BACKEND / "uploads"

# (subdir, glob pattern relative to UPLOAD_ROOT/<subdir>, module tag)
MIGRATED_MODULES = [
    ("contractor_docs",       "*",           "contractors"),
    ("renewals",              "*/*",         "renewals"),
    # v58.13.132gg
    ("document_library",      "*/*",         "document_library"),
    ("form_attachments",      "*/*",         "forms"),
    ("form_photos",           "*/*",         "forms"),
    ("schedule_attachments",  "*/*",         "asset_service"),
    # v58.13.132gh — SWMS signed-evidence scans + Hazards vision uploads.
    # Cert / induction uploads already land under `document_library/*/*`.
    ("swms_scans",            "*",           "swms_phase45"),
    ("hazards",               "*",           "hazards"),
]


async def _audit(action: str, subdir: str, parts: list[str],
                   *, module: str,
                   size: int = 0, note: str = "") -> None:
    await db.archive_audit.insert_one({
        "id": os.urandom(8).hex(),
        "module": "uploads_storage",
        "resource": module,
        "resource_id": "/".join([subdir, *parts]),
        "action": action,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "affected_count": 1,
        "note": note,
        "size": size,
    })


async def sweep(*, dry_run: bool) -> dict:
    stats = {"scanned": 0, "already_in_gridfs": 0,
             "migrated": 0, "missing": 0, "errors": 0}
    for subdir, pattern, module in MIGRATED_MODULES:
        base = UPLOAD_ROOT / subdir
        if not base.exists():
            print(f"  · {subdir}: no local dir — skip")
            continue
        for path in base.glob(pattern):
            if not path.is_file():
                continue
            stats["scanned"] += 1
            parts = path.relative_to(base).parts
            if await has_upload(subdir, list(parts)):
                stats["already_in_gridfs"] += 1
                continue
            if dry_run:
                print(f"  · would migrate {subdir}/{'/'.join(parts)} "
                      f"({path.stat().st_size} bytes)")
                stats["migrated"] += 1
                continue
            try:
                data = path.read_bytes()
                mime, _ = mimetypes.guess_type(str(path))
                await save_upload(
                    subdir, list(parts), data,
                    module=module,
                    mime=mime,
                    orig_filename=path.name,
                )
                await _audit(
                    "ephemeral_to_gridfs_migration",
                    subdir, list(parts),
                    module=module, size=len(data),
                )
                stats["migrated"] += 1
                print(f"  ✓ migrated {subdir}/{'/'.join(parts)} "
                      f"({len(data)} bytes)")
            except FileNotFoundError:
                stats["missing"] += 1
                await _audit(
                    "ephemeral_to_gridfs_missing_source",
                    subdir, list(parts),
                    module=module,
                    note="local file vanished mid-sweep",
                )
            except Exception as e:  # pragma: no cover
                stats["errors"] += 1
                print(f"  ! error migrating {path}: {e}",
                      file=sys.stderr)
    return stats


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", action="store_true",
                     help="Actually perform the migration.")
    args = ap.parse_args()
    dry = not args.run
    print(f"[migrate] mode={'DRY RUN' if dry else 'EXECUTE'} "
          f"across {len(MIGRATED_MODULES)} module(s)")
    stats = await sweep(dry_run=dry)
    print(f"\n[migrate] stats: {stats}")
    return 0 if stats["errors"] == 0 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

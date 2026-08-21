#!/usr/bin/env python3
"""v58.13.16 — One-shot orphan-blob cleanup for schedule attachments.

Scans `SCHEDULE_ATTACHMENT_ROOT/*` for sid directories. For each sid
dir, checks whether a matching NON-soft-deleted schedule exists in
Mongo:
    · dir found + live schedule       → keep (blobs still referenced)
    · dir found + no matching schedule → delete (orphan)
    · dir found + soft-deleted schedule → delete (v58.13.16 policy:
      soft-delete cascades to blob delete going forward, so pre-fix
      orphans should be swept too)

Usage:
    python /app/backend/scripts/cleanup_orphan_schedule_attachments_v58_13_16.py

Idempotent — safe to run more than once. Prints a summary line at the
end. Log the result in the v58.13.16 ship report.
"""
from __future__ import annotations

import asyncio
import os
import shutil
import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_BACKEND))

# Load /app/backend/.env before any backend module is imported so
# `db.py` can read `MONGO_URL`.
_env = _BACKEND / ".env"
if _env.exists():
    for _line in _env.read_text(encoding="utf-8").splitlines():
        _line = _line.strip()
        if not _line or _line.startswith("#") or "=" not in _line:
            continue
        _k, _, _v = _line.partition("=")
        os.environ.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))

from asset_service import SCHEDULE_ATTACHMENT_ROOT  # noqa: E402
from db import db  # noqa: E402


async def _run() -> int:
    if not SCHEDULE_ATTACHMENT_ROOT.exists():
        print(f"[v58.13.16] {SCHEDULE_ATTACHMENT_ROOT} does not exist — "
              "nothing to clean.")
        return 0
    sid_dirs = [p for p in SCHEDULE_ATTACHMENT_ROOT.iterdir() if p.is_dir()]
    print(f"[v58.13.16] scanning {len(sid_dirs)} sid directories under "
          f"{SCHEDULE_ATTACHMENT_ROOT}")
    kept = 0
    deleted_soft = 0
    deleted_missing = 0
    skipped_error = 0
    for sid_dir in sid_dirs:
        sid = sid_dir.name
        # Include BOTH live and soft-deleted rows in the lookup so
        # we can categorise correctly.
        doc = await db.asset_service_schedules.find_one(
            {"id": sid}, {"deleted_at": 1, "_id": 0},
        )
        if doc and doc.get("deleted_at") is None:
            kept += 1
            continue
        reason = "soft-deleted" if doc else "missing"
        try:
            shutil.rmtree(sid_dir, ignore_errors=False)
            if reason == "soft-deleted":
                deleted_soft += 1
            else:
                deleted_missing += 1
            print(f"[v58.13.16] rmtree sid={sid} reason={reason}")
        except OSError as e:
            skipped_error += 1
            print(f"[v58.13.16] SKIP sid={sid} reason={reason} err={e}")
    print(
        f"[v58.13.16] done. kept={kept} "
        f"deleted_soft_deleted={deleted_soft} "
        f"deleted_missing={deleted_missing} skipped_error={skipped_error}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(_run()))

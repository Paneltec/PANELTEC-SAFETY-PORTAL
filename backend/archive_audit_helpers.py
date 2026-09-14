"""v58.13.132fj — Shared archive_audit helper for file-attachment
soft-deletes.

Design goal: every place in the app that soft-deletes a file-carrying
row writes a matching entry into `db.archive_audit` so admins have a
single source of truth for "who deleted what, when, from which
surface". Restore/purge already goes through `crud.py`'s
`bulk_archive` flow — this helper mirrors its `archive_audit` schema
so both event kinds coexist in the same collection.

Schema (matches crud.py::_write_audit):
  {
    "id": str,
    "module": str,            # e.g. "documents", "certifications", "insurance"
    "resource": str,          # collection name — pinpoints the row
    "resource_id": str,       # doc/file id being deleted
    "worker_id": str | None,  # optional foreign key for worker-scoped rows
    "filename": str | None,   # human-friendly identifier for the audit log
    "actor_user_id": str,
    "actor_email": str,
    "action": "soft_delete",
    "batch_id": None,         # single-row deletes have no batch
    "criteria": {},
    "affected_count": 1,
    "reason": str | None,
    "timestamp": iso8601,
  }

Best-effort — a failed audit write must NOT block the delete. The
audit collection may not exist in stale test envs; we swallow the
insert error and log-only.
"""
from __future__ import annotations

import logging
from typing import Optional

from db import db
from models import new_id, now_iso

log = logging.getLogger(__name__)


async def record_file_archive_audit(
    *,
    module: str,
    resource: str,
    resource_id: str,
    filename: Optional[str],
    user: dict,
    worker_id: Optional[str] = None,
    reason: Optional[str] = None,
) -> None:
    """Insert a soft_delete audit row. Best-effort; swallows errors."""
    try:
        await db.archive_audit.insert_one({
            "id": new_id(),
            "module": module,
            "resource": resource,
            "resource_id": resource_id,
            "worker_id": worker_id,
            "filename": filename,
            "actor_user_id": user.get("id"),
            "actor_email": user.get("email") or "",
            "action": "soft_delete",
            "batch_id": None,
            "criteria": {},
            "affected_count": 1,
            "reason": reason,
            "timestamp": now_iso(),
            "org_id": user.get("org_id"),
        })
    except Exception as e:  # pragma: no cover — silent by design
        log.warning("archive_audit write failed: %s", e)

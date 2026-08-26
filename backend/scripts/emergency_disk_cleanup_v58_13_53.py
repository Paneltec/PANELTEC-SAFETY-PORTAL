"""v58.13.53 — Emergency disk-cleanup migration script.

Context: a production deploy of `whs-compliance` failed because the
target Mongo cluster hit its disk-usage threshold and blocked all
user writes (`UserWritesBlocked`), including the deployer's own
`dropDatabase` cleanup step. Investigation on the preview cluster
found the same disk-bloat root cause: orphaned GridFS chunks in
the `bk_fs.*` backup bucket (922 orphan blobs, 405 MB), plus a
handful of large prunable collections (`bulk_import_pdf_cache`,
`bulk_import_dryrun`, `bulk_import_reextract_v58_13_35_audit`).

This script is a **one-shot, idempotent, safe-to-re-run** manual
cleanup runner. It does everything the fixed retention loop now
does automatically, plus a handful of prune-old-rows sweeps that
haven't been TTL-indexed yet (see PRD backlog: `bulk_import_pdf_cache`
needs an `expires_at` BSON Date field migration before a TTL index
can be added).

Usage:
    cd /app/backend
    python3 -m scripts.emergency_disk_cleanup_v58_13_53
    #   or
    python3 -m scripts.emergency_disk_cleanup_v58_13_53 --dry-run

Guardrails baked in:
  · NEVER touches `bk_snapshots` metadata (only the orphaned
    GridFS blobs that already have no metadata row).
  · NEVER touches `bulk_import_failed_pdfs` GridFS for the
    running bulk-import job `14433131-…` (or any job the DB
    marks `state=processing`).
  · `bulk_import_pdf_cache` prune parses the ISO string
    `cached_at` field — no format changes.
  · Final `compact` is best-effort; failure is logged, not
    fatal.

Reports:
  { orphans_swept, orphan_bytes, cache_pruned, dryrun_pruned,
    reextract_audit_pruned, failed_pdfs_pruned, compact_bytes_freed }
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterable

_BACKEND = Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))
_env = _BACKEND / ".env"
if _env.exists():
    for _line in _env.read_text(encoding="utf-8").splitlines():
        _line = _line.strip()
        if not _line or _line.startswith("#") or "=" not in _line:
            continue
        _k, _, _v = _line.partition("=")
        os.environ.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorGridFSBucket

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s %(message)s",
)
log = logging.getLogger("v58_13_53_cleanup")

# Fixed retention windows for one-shot sweeps.
PDF_CACHE_TTL_DAYS = 30
DRYRUN_TTL_DAYS = 30
REEXTRACT_AUDIT_TTL_DAYS = 90
FAILED_PDF_TTL_DAYS = 30

# The running bulk-import job listed in the PRD memory. Even if the
# DB says it's failed, we NEVER prune its blobs — human review only.
KNOWN_RUNNING_JOB_ID = "14433131-29a9-4fa8-9d7e-af18f86145cf"


async def _sweep_orphan_bk_fs(db, dry: bool) -> Dict[str, int]:
    valid = set()
    async for r in db.bk_snapshots.find({}, {"_id": 0, "gridfs_id": 1}):
        if r.get("gridfs_id"):
            valid.add(str(r["gridfs_id"]))
    if not valid:
        log.warning("bk_snapshots is empty — refusing to sweep bk_fs (fail-safe)")
        return {"orphans_swept": 0, "orphan_bytes": 0, "skipped": True}
    fs = AsyncIOMotorGridFSBucket(db, bucket_name="bk_fs")
    swept, freed = 0, 0
    async for r in db["bk_fs.files"].find({}, {"_id": 1, "length": 1}):
        if str(r["_id"]) in valid:
            continue
        if dry:
            swept += 1; freed += int(r.get("length") or 0)
            continue
        try:
            await fs.delete(r["_id"])
            swept += 1
            freed += int(r.get("length") or 0)
        except Exception as e:  # noqa: BLE001
            log.warning("bk_fs orphan delete failed for %s: %s", r["_id"], e)
    log.info("bk_fs orphans: %d swept, %d bytes", swept, freed)
    return {"orphans_swept": swept, "orphan_bytes": freed}


def _iso_cutoff(days: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


async def _prune_iso_string_ts(db, collection: str, field: str, days: int, dry: bool) -> int:
    """Prune rows where `<field>` (stored as ISO 8601 string) is older
    than `days`. We compare strings because ISO 8601 sorts
    lexicographically for the year-first format we use everywhere.
    """
    cutoff = _iso_cutoff(days)
    q = {field: {"$lt": cutoff}}
    if dry:
        n = await db[collection].count_documents(q)
    else:
        r = await db[collection].delete_many(q)
        n = r.deleted_count
    log.info("%s: %d row(s) older than %d day(s) [dry=%s]", collection, n, days, dry)
    return n


async def _prune_failed_pdfs(db, dry: bool) -> Dict[str, int]:
    """Delete GridFS blobs from `bulk_import_failed_pdfs` whose job
    is done/failed AND older than `FAILED_PDF_TTL_DAYS`. Never touch
    a blob tied to a job in `state=processing` or the known
    running job id.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=FAILED_PDF_TTL_DAYS)
    # Job state map so we don't hit bulk_import_jobs per file.
    protected: set = {KNOWN_RUNNING_JOB_ID}
    async for j in db.bulk_import_jobs.find(
        {"state": {"$in": ["processing", "queued"]}},
        {"_id": 0, "id": 1},
    ):
        if j.get("id"):
            protected.add(j["id"])
    fs = AsyncIOMotorGridFSBucket(db, bucket_name="bulk_import_failed_pdfs")
    deleted, freed = 0, 0
    async for r in db["bulk_import_failed_pdfs.files"].find(
        {}, {"_id": 1, "length": 1, "uploadDate": 1, "metadata.job_id": 1},
    ):
        job_id = (r.get("metadata") or {}).get("job_id")
        if job_id in protected:
            continue
        upload_date = r.get("uploadDate")
        # uploadDate is a real BSON Date already.
        if not upload_date or upload_date > cutoff.replace(tzinfo=None):
            continue
        if dry:
            deleted += 1; freed += int(r.get("length") or 0); continue
        try:
            await fs.delete(r["_id"])
            deleted += 1
            freed += int(r.get("length") or 0)
        except Exception as e:  # noqa: BLE001
            log.warning("failed_pdfs delete err: %s", e)
    log.info(
        "bulk_import_failed_pdfs: %d blob(s) pruned / %d bytes "
        "(protected job_ids: %d)",
        deleted, freed, len(protected),
    )
    return {"failed_pdfs_pruned": deleted, "failed_pdfs_bytes": freed}


async def _compact_after(db, collections: Iterable[str]) -> Dict[str, int]:
    """Best-effort disk-return to the filesystem. `bytesFreed` is
    reported for WiredTiger; some builds return 0 even when they
    successfully return space, so this is informational only.
    """
    total = 0
    for c in collections:
        try:
            r = await db.command("compact", c, force=True)
            b = int(r.get("bytesFreed") or 0)
            log.info("compact %s: bytesFreed=%d ok=%s", c, b, r.get("ok"))
            total += b
        except Exception as e:  # noqa: BLE001
            log.warning("compact %s failed: %s", c, e)
    return {"compact_bytes_freed": total}


async def main(dry: bool) -> Dict[str, Any]:
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME", "test_database")
    if not mongo_url:
        raise SystemExit("MONGO_URL not set in env")
    c = AsyncIOMotorClient(mongo_url, serverSelectionTimeoutMS=10_000)
    db = c[db_name]
    log.info("Connected to %s (dry_run=%s)", db_name, dry)
    report: Dict[str, Any] = {}

    # 1. Confirm writes are permitted (fail loud if not).
    try:
        await db.app_state.update_one(
            {"_id": "v58_13_53_cleanup_probe"},
            {"$set": {"ok": 1}}, upsert=True,
        )
        if not dry:
            await db.app_state.delete_one({"_id": "v58_13_53_cleanup_probe"})
    except Exception as e:  # noqa: BLE001
        report["write_check"] = f"BLOCKED: {e}"
        log.error("writes BLOCKED — nothing further can be done from here: %s", e)
        return report
    report["write_check"] = "ok"

    # 2. Sweep orphan bk_fs GridFS blobs (root of the 405 MB leak).
    report.update(await _sweep_orphan_bk_fs(db, dry))

    # 3. Prune stale bulk_import_pdf_cache (ISO string field).
    report["cache_pruned"] = await _prune_iso_string_ts(
        db, "bulk_import_pdf_cache", "cached_at", PDF_CACHE_TTL_DAYS, dry,
    )

    # 4. Prune stale bulk_import_dryrun rows (ISO string field).
    report["dryrun_pruned"] = await _prune_iso_string_ts(
        db, "bulk_import_dryrun", "at", DRYRUN_TTL_DAYS, dry,
    )

    # 5. Prune stale reextract audit rows (ISO string field).
    report["reextract_audit_pruned"] = await _prune_iso_string_ts(
        db, "bulk_import_reextract_v58_13_35_audit", "at",
        REEXTRACT_AUDIT_TTL_DAYS, dry,
    )

    # 6. Prune stale failed-PDF GridFS blobs (BSON Date field).
    report.update(await _prune_failed_pdfs(db, dry))

    # 7. Compact the GridFS chunk collections to return disk to OS.
    if not dry:
        report.update(await _compact_after(db, [
            "bk_fs.chunks",
            "bulk_import_failed_pdfs.chunks",
            "bulk_import_pdf_cache",
            "bulk_import_dryrun",
            "bulk_import_reextract_v58_13_35_audit",
        ]))

    # 8. Final DB size snapshot.
    li = await c["admin"].command("listDatabases")
    for d in li.get("databases", []):
        if d.get("name") == db_name:
            report["final_size_bytes"] = d.get("sizeOnDisk", 0)
            report["final_size_gb"] = round(d.get("sizeOnDisk", 0) / (1024 ** 3), 3)
            log.info(
                "final %s sizeOnDisk = %s bytes (%s GB)",
                db_name, report["final_size_bytes"], report["final_size_gb"],
            )
    return report


def _parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true",
                   help="Count and log but do not delete or compact.")
    return p.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    result = asyncio.run(main(dry=args.dry_run))
    print()
    print("=== v58.13.53 emergency disk cleanup report ===")
    for k, v in result.items():
        print(f"  {k:<28} = {v}")

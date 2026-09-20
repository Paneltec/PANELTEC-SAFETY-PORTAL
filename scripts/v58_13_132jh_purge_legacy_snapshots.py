"""
v58.13.132jh — One-shot purge of legacy in-Mongo backup snapshots.

Root cause context (see /app/memory/v58_13_132jh_backup_routine_externalize.md):
- `backup_service.py::_do_snapshot` writes full-DB snapshot ZIPs (~400 MB each)
  into GridFS collections `bk_fs.files` + `bk_fs.chunks` on the SAME Mongo
  instance whose data it is dumping.
- Age-based retention (7 days + GFS tier) was not sufficient; at time of ship
  there are 41 snapshot manifests in `bk_snapshots` and ~5 GB of chunks in
  `bk_fs.chunks`, driving the /app partition to 98% full.
- Emergent-managed backups + PITR are the safety net for live data. These
  in-Mongo snapshots are duplicative and unsafe (they cannot survive the DB
  they live in). Green-lit by user to purge in full.

This script:
  1. Reports current bk_snapshots / bk_fs.files / bk_fs.chunks state.
  2. Deletes every doc in bk_snapshots, bk_fs.files, bk_fs.chunks.
  3. Runs `compact` on each of the three collections so storageSize is
     actually returned to the OS.
  4. Prints before/after `df -h /app` and bytes freed.

Safe to re-run — it is idempotent (delete + compact are no-ops on an
already-empty collection).
"""
import asyncio
import os
import shutil
import subprocess
from datetime import datetime, timezone


def _load_env():
    env_path = "/app/backend/.env"
    if not os.path.exists(env_path):
        return
    for line in open(env_path):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k, v.strip().strip('"').strip("'"))


def _df_app():
    try:
        out = subprocess.check_output(["df", "-h", "/app"], text=True)
        return out.strip()
    except Exception as e:
        return f"df failed: {e}"


async def main():
    _load_env()
    from motor.motor_asyncio import AsyncIOMotorClient

    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]

    print(f"=== v58.13.132jh purge started at {datetime.now(timezone.utc).isoformat()} ===")
    print("\n--- DISK BEFORE ---")
    print(_df_app())

    # Baseline stats
    snap_count = await db.bk_snapshots.count_documents({})
    files_count = await db["bk_fs.files"].count_documents({})
    chunks_count = await db["bk_fs.chunks"].count_documents({})

    files_bytes = 0
    async for f in db["bk_fs.files"].find({}, {"length": 1}):
        files_bytes += int(f.get("length") or 0)

    stats_before = await db.command("dbStats")

    print("\n--- COUNTS BEFORE ---")
    print(f"  bk_snapshots     rows: {snap_count}")
    print(f"  bk_fs.files      rows: {files_count}  bytes: {files_bytes}  ({round(files_bytes/1024/1024,1)} MB)")
    print(f"  bk_fs.chunks     rows: {chunks_count}")
    print(f"  dbStats.storageSize: {round(stats_before.get('storageSize',0)/1024/1024,1)} MB")
    print(f"  dbStats.dataSize:    {round(stats_before.get('dataSize',0)/1024/1024,1)} MB")

    # Delete phase — order matters: chunks first (largest), then files, then manifests.
    print("\n--- DELETING ---")
    r = await db["bk_fs.chunks"].delete_many({})
    print(f"  bk_fs.chunks:    deleted {r.deleted_count}")
    r = await db["bk_fs.files"].delete_many({})
    print(f"  bk_fs.files:     deleted {r.deleted_count}")
    r = await db.bk_snapshots.delete_many({})
    print(f"  bk_snapshots:    deleted {r.deleted_count}")

    # Compact — this is what actually gives disk back to the OS on WT.
    # Compact holds a database-level exclusive lock on WT but on a 10GB
    # collection it typically completes in seconds. Log per-collection.
    print("\n--- COMPACTING ---")
    for coll in ("bk_fs.chunks", "bk_fs.files", "bk_snapshots"):
        try:
            t0 = datetime.now(timezone.utc)
            res = await db.command({"compact": coll})
            dt = (datetime.now(timezone.utc) - t0).total_seconds()
            print(f"  compact({coll}): ok={res.get('ok')} elapsed={dt:.1f}s")
        except Exception as e:
            # Some builds return 'ns does not exist' if the collection was
            # never materialized — treat as ok.
            print(f"  compact({coll}): skipped ({e})")

    # Also compact the top-level system collections that shrink well after a
    # large delete (best-effort; ignore failures).
    stats_after = await db.command("dbStats")

    print("\n--- COUNTS AFTER ---")
    snap_count2 = await db.bk_snapshots.count_documents({})
    files_count2 = await db["bk_fs.files"].count_documents({})
    chunks_count2 = await db["bk_fs.chunks"].count_documents({})
    print(f"  bk_snapshots     rows: {snap_count2}")
    print(f"  bk_fs.files      rows: {files_count2}")
    print(f"  bk_fs.chunks     rows: {chunks_count2}")
    print(f"  dbStats.storageSize: {round(stats_after.get('storageSize',0)/1024/1024,1)} MB")
    print(f"  dbStats.dataSize:    {round(stats_after.get('dataSize',0)/1024/1024,1)} MB")

    reclaim_bytes = stats_before.get("storageSize", 0) - stats_after.get("storageSize", 0)
    print(f"\n  Mongo storageSize reclaimed: {round(reclaim_bytes/1024/1024,1)} MB")
    print(f"  Snapshot rows evicted:       {snap_count}")
    print(f"  Snapshot bytes (metadata):   {files_bytes} ({round(files_bytes/1024/1024,1)} MB)")

    print("\n--- DISK AFTER ---")
    print(_df_app())

    print(f"\n=== v58.13.132jh purge done at {datetime.now(timezone.utc).isoformat()} ===")

    client.close()


if __name__ == "__main__":
    asyncio.run(main())

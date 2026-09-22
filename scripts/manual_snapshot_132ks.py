"""One-shot manual snapshot for .132ks catch-up.

Runs OUTSIDE the uvicorn worker so uvicorn --reload can't kill it
mid-flight. Duplicates the essential logic of
`backup_service.py::_do_snapshot` at the time of writing:
  · Enumerate collections, exclude EXCLUDE_COLLECTIONS + system.* + bk_fs.*
  · ZIP_DEFLATED into a BytesIO buffer
  · Atomic write to `${LAN_DELIVERY_DROP_ZONE}/paneltec-snapshot-<uuid>.zip`
    via a `.part` staging file
  · Insert manifest row into `bk_snapshots` with `status=ready`,
    `filepath`, `storage=filesystem`, `shipped_at=None`
  · Manage `system_backup_lock` (acquire + release)
"""
import asyncio, hashlib, io, json, os, sys, uuid, zipfile
from datetime import datetime, timezone
from motor.motor_asyncio import AsyncIOMotorClient

EXCLUDE = {
    "library_bm25_chunks", "request_log", "session_history",
    "email_outbox", "comms_outbox_blocked", "active_signons",
}
LOCK_DOC_ID = "backup_lock"


def _iso():
    return datetime.now(timezone.utc).isoformat()


async def main():
    with open("/app/backend/.env") as f:
        env = {}
        for l in f:
            l = l.strip()
            if "=" in l and not l.startswith("#"):
                k, v = l.split("=", 1)
                env[k] = v.strip('"').strip("'")
    mongo_url = env["MONGO_URL"]
    db_name = env["DB_NAME"]
    drop_zone = env.get("LAN_DELIVERY_DROP_ZONE", "/app/backups/outgoing")

    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    now = datetime.now(timezone.utc)
    await db.system_backup_lock.update_one(
        {"_id": LOCK_DOC_ID},
        {"$set": {"in_progress": True, "started_at": now.isoformat()}},
        upsert=True,
    )

    snap_id = str(uuid.uuid4())
    zbuf = io.BytesIO()
    included, total_docs = [], 0

    try:
        with zipfile.ZipFile(zbuf, "w", zipfile.ZIP_DEFLATED) as z:
            colls = await db.list_collection_names()
            for cname in sorted(colls):
                if cname in EXCLUDE or cname.startswith("system."):
                    continue
                if cname.startswith("bk_fs."):
                    continue
                rows = await db[cname].find({}, {"_id": 0}).to_list(length=None)
                z.writestr(
                    f"mongo/{cname}.json",
                    json.dumps(rows, default=str, ensure_ascii=False),
                )
                included.append(cname)
                total_docs += len(rows)
                if len(included) % 20 == 0:
                    print(f"  … packed {len(included)} colls, "
                          f"{total_docs} docs so far", flush=True)

            manifest = {
                "snapshot_id": snap_id,
                "created_at": _iso(),
                "scope": "full",
                "collections": included,
                "total_documents": total_docs,
                "app": "paneltec-hub",
                "trigger": "manual_132ks_catchup",
            }
            z.writestr("manifest.json", json.dumps(manifest, indent=2))

        data = zbuf.getvalue()
        sha = hashlib.sha256(data).hexdigest()
        print(f"ZIP built: {len(data)} bytes, sha256={sha[:16]}…",
              flush=True)

        os.makedirs(drop_zone, exist_ok=True)
        filepath = os.path.join(drop_zone,
                                f"paneltec-snapshot-{snap_id}.zip")
        staging = filepath + ".part"
        with open(staging, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(staging, filepath)
        print(f"Written to {filepath}", flush=True)

        await db.bk_snapshots.insert_one({
            "id": snap_id,
            "created_at": _iso(),
            "size": len(data),
            "sha256": sha,
            "collections": included,
            "total_documents": total_docs,
            "filepath": filepath,
            "storage": "filesystem",
            "shipped_at": None,
            "nas_path": None,
            "status": "ready",
            "trigger": "manual_132ks_catchup",
        })

        await db.system_backup_lock.update_one(
            {"_id": LOCK_DOC_ID},
            {"$set": {"in_progress": False,
                      "started_at": None,
                      "last_run_at": _iso()}},
            upsert=True,
        )
        r = await db.bk_snapshots.delete_many({"status": "queued"})
        print(f"placeholders deleted: {r.deleted_count}", flush=True)

        print(json.dumps({
            "ok": True,
            "snapshot_id": snap_id,
            "size": len(data),
            "sha256": sha,
            "documents": total_docs,
            "filepath": filepath,
        }, indent=2), flush=True)
    except Exception as e:
        await db.system_backup_lock.update_one(
            {"_id": LOCK_DOC_ID},
            {"$set": {"in_progress": False, "started_at": None}},
            upsert=True,
        )
        print(f"ERROR: {e}", flush=True)
        raise


if __name__ == "__main__":
    asyncio.run(main())

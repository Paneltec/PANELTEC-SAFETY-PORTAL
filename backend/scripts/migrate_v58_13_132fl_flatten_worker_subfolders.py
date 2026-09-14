"""v58.13.132fl — One-shot migration: flatten per-worker subfolders
under Document Library.

Root cause: `worker_certifications.py::upload_cert` used to route
cert uploads into a per-worker subfolder (see the pre-.132fl
`_find_or_create_worker_subfolder` call). Stephen: "Document
Library is meant to be shared across the whole team, not per-
worker." This script:

  1. Finds every doc_folders row with worker_id != None.
  2. For each mirrored file inside (uploaded_via='worker_certification'),
     re-points folder_id up to the parent (seed) folder.
  3. Soft-deletes the now-empty per-worker subfolder.
  4. Logs every move to archive_audit for restore safety.

Idempotent — a second run finds no worker-scoped subfolders and
exits cleanly. Files on disk are NOT moved (they're addressed by
stored_name inside the folder GridFS-alike layout); only the DB
pointer is updated. The `file_url` field is regenerated to match
the new folder_id.
"""
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from motor.motor_asyncio import AsyncIOMotorClient

from archive_audit_helpers import record_file_archive_audit
from models import now_iso


async def main():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]

    subfolders = await db.doc_folders.find(
        {"worker_id": {"$ne": None}, "deleted_at": None},
    ).to_list(None)
    print(f"Found {len(subfolders)} worker-scoped subfolders")

    moved_files = 0
    dropped_folders = 0
    system_user = {"id": "migration_132fl", "email": "migration_132fl@paneltec", "org_id": None}

    for sub in subfolders:
        parent_id = sub.get("parent_folder_id")
        if not parent_id:
            print(f"  skip {sub['id']} ({sub['name']!r}) — no parent")
            continue
        # Move files up.
        files = await db.doc_files.find(
            {"folder_id": sub["id"], "deleted_at": None},
        ).to_list(None)
        for f in files:
            new_url = f["file_url"].replace(f"/{sub['id']}/", f"/{parent_id}/")
            await db.doc_files.update_one(
                {"id": f["id"]},
                {"$set": {"folder_id": parent_id,
                          "file_url": new_url,
                          "updated_at": now_iso()}},
            )
            moved_files += 1
            actor = dict(system_user, org_id=f.get("org_id"))
            await record_file_archive_audit(
                module="documents", resource="doc_files",
                resource_id=f["id"], filename=f.get("filename"),
                user=actor,
                reason=f"flatten_per_worker_subfolder ({sub['name']!r} → parent)",
            )

        # Soft-delete the (now empty) subfolder.
        ts = now_iso()
        await db.doc_folders.update_one(
            {"id": sub["id"]},
            {"$set": {"deleted_at": ts, "updated_at": ts}},
        )
        dropped_folders += 1
        actor = dict(system_user, org_id=sub.get("org_id"))
        await record_file_archive_audit(
            module="documents", resource="doc_folders",
            resource_id=sub["id"], filename=sub.get("name"),
            user=actor,
            reason="flatten_per_worker_subfolder (subfolder emptied)",
        )
        print(f"  → moved {len(files)} files up from {sub['name']!r} → parent {parent_id}")

    print(f"\nMigration complete: {moved_files} files re-pointed, {dropped_folders} subfolders soft-deleted.")


if __name__ == "__main__":
    asyncio.run(main())

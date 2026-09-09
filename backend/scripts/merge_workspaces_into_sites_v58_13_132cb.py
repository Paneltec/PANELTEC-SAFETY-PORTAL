"""v58.13.132cb — Workspaces / Sites merge · Phase A migration.

Consolidates admin `workspaces` + Simpro-imported `simpro_sites` into a
single canonical `sites` collection, per Stephen's mental-model shift:

  · `simpro_sites` rows        → copied into `sites` with source='simpro'
                                 and `id = simpro_site_id`.
  · `workspaces` rows (active) → copied into `sites` with source=
                                 'workspace_promoted', preserving `id`
                                 so existing `workspace_id` FKs on
                                 pre_starts / swms / etc. still resolve
                                 against the new `sites` collection.
  · `orgs.default_site_id`     → stamped from the org's
                                 default_for_org=True workspace.

── Phase A vs Phase B ─────────────────────────────────────────────
This script is Phase A. It ONLY populates `sites`. It does NOT:
  · rename FK `workspace_id` → `site_id` on records,
  · rename `workspace_ids` → `site_ids` on users,
  · drop the `workspaces` collection,
  · retire the `workspaces` API endpoint.

Those are the Phase B sweep (`.132cb-b`) — a large-blast-radius
refactor across ~40 backend modules and ~20 frontend files. Shipping
Phase A first delivers the immediate UX promise (no more "Workspaces"
in the sidebar, canonical Sites register in the DB) without risking a
16k-record FK migration in a single ship.

── Idempotency ────────────────────────────────────────────────────
Safe to re-run. Each write is an upsert keyed on `id` + org_id. The
`_workspace_migrated_at` audit field is written once; re-runs never
overwrite it. Records already present in `sites` (e.g. from a partial
prior run) get their non-metadata fields refreshed but keep their
original migration timestamp.

── Usage ──────────────────────────────────────────────────────────
  python3 backend/scripts/merge_workspaces_into_sites_v58_13_132cb.py            # dry-run
  python3 backend/scripts/merge_workspaces_into_sites_v58_13_132cb.py --commit   # apply
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Make backend/ imports work regardless of invocation cwd.
BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(BACKEND_DIR / ".env")

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402


NOW = datetime.now(timezone.utc).isoformat()


def _client() -> AsyncIOMotorClient:
    url = os.environ["MONGO_URL"]
    return AsyncIOMotorClient(url)


def _db(client: AsyncIOMotorClient):
    return client[os.environ["DB_NAME"]]


async def _plan_simpro(db) -> list[dict[str, Any]]:
    """Rows to copy from `simpro_sites` into `sites`."""
    out: list[dict[str, Any]] = []
    async for s in db.simpro_sites.find({}):
        s.pop("_id", None)
        sid = s.get("simpro_site_id")
        if not sid:
            continue
        doc = {
            "id": str(sid),
            "org_id": s.get("org_id"),
            "name": s.get("name") or f"Simpro site {sid}",
            "address_full": s.get("address_full"),
            "suburb": s.get("suburb"),
            "state": s.get("state"),
            "latitude": s.get("latitude"),
            "longitude": s.get("longitude"),
            "scan_token": s.get("scan_token"),
            "signon_questions": s.get("signon_questions") or [],
            "source": "simpro",
            "simpro_site_id": sid,
            "created_at": s.get("created_at") or NOW,
            "updated_at": s.get("updated_at") or NOW,
            "deleted_at": s.get("deleted_at"),
        }
        out.append(doc)
    return out


async def _plan_workspaces(db) -> list[dict[str, Any]]:
    """Rows to promote from `workspaces` into `sites`.

    Only ACTIVE (deleted_at null/missing) workspaces are promoted so
    tombstoned admin partitions don't pollute the new Sites register.
    """
    out: list[dict[str, Any]] = []
    q = {"$or": [{"deleted_at": None}, {"deleted_at": {"$exists": False}}]}
    async for w in db.workspaces.find(q):
        w.pop("_id", None)
        wid = w.get("id")
        if not wid:
            continue
        doc = {
            "id": wid,
            "org_id": w.get("org_id"),
            "name": w.get("name") or "Workspace",
            "address_full": w.get("address"),
            "description": w.get("description"),
            "default_for_org": bool(w.get("default_for_org")),
            "source": "workspace_promoted",
            "created_at": w.get("created_at") or NOW,
            "updated_at": w.get("updated_at") or NOW,
        }
        out.append(doc)
    return out


async def _plan_org_defaults(db, promoted: list[dict[str, Any]]) -> list[tuple[str, str]]:
    """Return list of (org_id, default_site_id) tuples derived from the
    default_for_org workspace of each org. Orgs with no default keep
    whatever `default_site_id` is already there (or none)."""
    out: list[tuple[str, str]] = []
    by_org: dict[str, str] = {}
    for row in promoted:
        if row.get("default_for_org") and row.get("org_id") and row.get("id"):
            by_org.setdefault(row["org_id"], row["id"])
    for org_id, site_id in by_org.items():
        out.append((org_id, site_id))
    return out


async def _commit(db, simpro_rows: list[dict], workspace_rows: list[dict],
                  org_defaults: list[tuple[str, str]]) -> dict[str, int]:
    ins_simpro = 0
    ins_ws = 0
    upd_orgs = 0

    for row in simpro_rows:
        existing = await db.sites.find_one({"id": row["id"], "org_id": row["org_id"]},
                                           {"_id": 0, "_workspace_migrated_at": 1})
        set_fields = {**row}
        # Never overwrite a prior migration timestamp on re-run.
        if not existing or "_workspace_migrated_at" not in existing:
            set_fields["_workspace_migrated_at"] = NOW
        await db.sites.update_one(
            {"id": row["id"], "org_id": row["org_id"]},
            {"$set": set_fields},
            upsert=True,
        )
        ins_simpro += 1

    for row in workspace_rows:
        existing = await db.sites.find_one({"id": row["id"], "org_id": row["org_id"]},
                                           {"_id": 0, "_workspace_migrated_at": 1})
        set_fields = {**row}
        if not existing or "_workspace_migrated_at" not in existing:
            set_fields["_workspace_migrated_at"] = NOW
        await db.sites.update_one(
            {"id": row["id"], "org_id": row["org_id"]},
            {"$set": set_fields},
            upsert=True,
        )
        ins_ws += 1

    for org_id, site_id in org_defaults:
        res = await db.orgs.update_one(
            {"id": org_id},
            {"$set": {"default_site_id": site_id,
                      "_workspace_migrated_at": NOW}},
        )
        if res.matched_count:
            upd_orgs += 1

    return {"simpro": ins_simpro, "workspaces": ins_ws, "orgs": upd_orgs}


async def _report_before(db) -> dict[str, int]:
    return {
        "workspaces_active": await db.workspaces.count_documents({
            "$or": [{"deleted_at": None}, {"deleted_at": {"$exists": False}}]
        }),
        "workspaces_total": await db.workspaces.count_documents({}),
        "simpro_sites": await db.simpro_sites.count_documents({}),
        "sites": await db.sites.count_documents({}),
        "orgs": await db.orgs.count_documents({}),
    }


async def run(commit: bool) -> int:
    client = _client()
    try:
        db = _db(client)
        before = await _report_before(db)
        print(f"[.132cb] BEFORE state:")
        for k, v in before.items():
            print(f"  · {k:22s}: {v}")

        simpro_rows = await _plan_simpro(db)
        workspace_rows = await _plan_workspaces(db)
        org_defaults = await _plan_org_defaults(db, workspace_rows)

        print(f"\n[.132cb] Planned writes:")
        print(f"  · simpro   → sites : {len(simpro_rows)}")
        print(f"  · workspaces→sites : {len(workspace_rows)}")
        print(f"  · orgs.default_site_id set: {len(org_defaults)}")

        if not commit:
            print(f"\n[.132cb] DRY-RUN complete. Re-run with --commit to apply.")
            if simpro_rows:
                print(f"    sample simpro row: {simpro_rows[0]}")
            if workspace_rows:
                print(f"    sample workspace row: {workspace_rows[0]}")
            return 0

        stats = await _commit(db, simpro_rows, workspace_rows, org_defaults)
        after = await _report_before(db)

        print(f"\n[.132cb] COMMIT complete.")
        for k, v in stats.items():
            print(f"  · wrote {k:22s}: {v}")
        print(f"\n[.132cb] AFTER state:")
        for k, v in after.items():
            print(f"  · {k:22s}: {v}")
        return 0
    finally:
        client.close()


def main() -> int:
    ap = argparse.ArgumentParser(description="v58.13.132cb workspaces/sites merge (Phase A).")
    ap.add_argument("--commit", action="store_true",
                    help="Apply the migration. Default is dry-run.")
    ap.add_argument("--dry-run", action="store_true",
                    help="Explicit dry-run (default behaviour; accepted for symmetry).")
    args = ap.parse_args()
    return asyncio.run(run(commit=args.commit and not args.dry_run))


if __name__ == "__main__":
    sys.exit(main())

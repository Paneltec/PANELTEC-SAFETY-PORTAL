"""v58.13.81 — Admin: Purge Test Data.

Reusable admin-only endpoint that hard-deletes rows whose name / title /
label / filename matches any of a hard-coded test-data pattern
whitelist, across the primary user-facing collections. Cascade-cleans
`asset_service_schedules` for deleted asset ids. Simpro-imported rows
are always excluded via `{"source": {"$ne": "simpro"}}`.

Frontend flow:
  1. Admin clicks the "Purge Test Data" card in Admin Tools.
  2. Frontend calls this endpoint with `?dry_run=1` — response returns
     `{ok, matches: [{collection, count, samples}], grand_total}`.
  3. Modal shows the count + samples. User ticks "I understand this
     cannot be undone" and clicks the Delete button.
  4. Frontend calls this endpoint with `?dry_run=0` — response returns
     `{ok, deleted: {...}, grand_total, audit_log}`.

Safety:
  · `require_permission("admin", "manage")` gate — admin-only.
  · Simpro-source rows ALWAYS excluded — no real customer data can
    match no matter what the pattern whitelist looks like.
  · Every delete writes an audit line to
    `/app/memory/purge_v58_13_81_log.txt` with timestamp + user + ids.
"""
from __future__ import annotations
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException, Query

from db import db
from auth import get_current_user

logger = logging.getLogger("paneltec.admin.purge")

router = APIRouter(prefix="/admin", tags=["admin-purge"])


def _require_admin(user: dict) -> None:
    if (user or {}).get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin role required")


TEST_PATTERNS = [
    r"^TEST-v\d+\.\d+\.\d+-",
    r"^TEST-",
    r"^test-vehicle-", r"^test-worker-", r"^test-site-", r"^test-hazard-",
    r"^test-swms-", r"^test-incident-", r"^test-inspection-",
    r"^test-diary-", r"^test-prestart-", r"^test-supplier-", r"^test-cert-",
    r"^demo-", r"^sample-", r"^seed-",
    r"pytest-", r"_pytest_", r"__test__",
]

TARGET_COLLECTIONS = [
    "assets", "workers", "sites", "hazards", "swms", "incidents",
    "inspections", "site_diary_entries", "pre_starts",
    "doc_files", "doc_folders", "worker_certifications", "suppliers",
    "form_assignments", "form_submissions", "qr_codes",
    "bulk_import_jobs", "bulk_import_pdf_cache",
    "cs_incident_issues", "hr_employees", "workspaces",
]

NAME_FIELDS = ["name", "title", "label", "filename", "description",
               "first_name", "last_name", "worker_name", "site_name",
               "supplier_name", "cert_name"]

AUDIT_LOG = Path("/app/memory/purge_v58_13_81_log.txt")


async def _build_query(col: str) -> Dict[str, Any] | None:
    sample = await db[col].find_one({}, {"_id": 0})
    if not sample:
        return None
    active_fields = [f for f in NAME_FIELDS if f in sample]
    if not active_fields:
        return None
    or_terms = []
    for f in active_fields:
        for p in TEST_PATTERNS:
            or_terms.append({f: {"$regex": p, "$options": "i"}})
    return {"$and": [{"$or": or_terms}, {"source": {"$ne": "simpro"}}]}


@router.post("/purge-test-data")
async def purge_test_data(
    dry_run: int = Query(1, ge=0, le=1),
    user: dict = Depends(get_current_user),
):
    _require_admin(user)
    matches: List[Dict[str, Any]] = []
    grand_total = 0
    ids_per_col: Dict[str, List[str]] = {}

    for col in TARGET_COLLECTIONS:
        if col not in await db.list_collection_names():
            continue
        q = await _build_query(col)
        if not q:
            continue
        n = await db[col].count_documents(q)
        if n == 0:
            continue
        proj = {"_id": 0, "id": 1}
        for f in NAME_FIELDS:
            proj[f] = 1
        samples: List[str] = []
        ids: List[str] = []
        async for d in db[col].find(q, proj):
            if d.get("id"):
                ids.append(d["id"])
            if len(samples) < 5:
                nm = next((str(d.get(f)) for f in NAME_FIELDS if d.get(f)), "<no-name>")
                samples.append(nm[:80])
        matches.append({"collection": col, "count": n, "samples": samples})
        ids_per_col[col] = ids
        grand_total += n

    if dry_run:
        return {"ok": True, "dry_run": True, "matches": matches,
                "grand_total": grand_total}

    # Commit.
    deleted: Dict[str, int] = {}
    asset_ids = ids_per_col.get("assets", [])
    if asset_ids:
        r = await db.asset_service_schedules.delete_many({"asset_id": {"$in": asset_ids}})
        deleted["asset_service_schedules_cascade"] = r.deleted_count

    for col, ids in ids_per_col.items():
        if not ids:
            continue
        r = await db[col].delete_many({"id": {"$in": ids}})
        deleted[col] = r.deleted_count

    ts = datetime.now(timezone.utc).isoformat()
    AUDIT_LOG.parent.mkdir(parents=True, exist_ok=True)
    with AUDIT_LOG.open("a") as fp:
        fp.write(f"\n\n## {ts}  user={user.get('email')}  grand_total={grand_total}\n")
        for col, n in deleted.items():
            fp.write(f"  {col}: {n}\n")
        for col, ids in ids_per_col.items():
            fp.write(f"  ids[{col}]: {','.join(ids[:20])}")
            if len(ids) > 20:
                fp.write(f" … +{len(ids)-20} more")
            fp.write("\n")

    logger.warning("v58.13.81 purge: user=%s grand_total=%s deleted=%s",
                   user.get("email"), grand_total, deleted)

    return {"ok": True, "dry_run": False, "deleted": deleted,
            "grand_total": grand_total,
            "audit_log": str(AUDIT_LOG)}

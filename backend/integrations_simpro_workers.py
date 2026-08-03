"""Simpro Worker Sync — Phase C (live).

v160.3.1 — API-only enrichment path (per SIMPRO_IMPORT_AUDIT.md § 10 recommendation).

Endpoints:
  * POST /api/integrations/simpro/workers/refresh?dry_run=1
      admin | hseq_lead. Idempotent. Runs the diff planner from
      `scripts/simpro_worker_sync.py`, applies writes when `dry_run=0`.
      Returns counts + snapshot_id.
  * GET  /api/integrations/simpro/workers/snapshots
      List past runs.
  * GET  /api/integrations/simpro/workers/snapshots/{snapshot_id}
      Full diff.
  * POST /api/integrations/simpro/workers/rollback/{snapshot_id}
      admin only. Restore worker docs to pre-run state.

PII allowlist (locked at 2026-07-12 by user): date_of_birth, address,
emergency_contact. Denylist: banking, ssn, tfn, masked_ssn.
Read-side PII gating lives in workers.py `_serialise`.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query

from auth import require_roles
from permissions import require_permission
from db import db
from models import new_id, now_iso

log = logging.getLogger("paneltec.simpro.workers")

router = APIRouter(prefix="/integrations/simpro/workers", tags=["integrations-simpro-workers"])

# ─────────────────────────────────────────────────────────────
# Seed data
# ─────────────────────────────────────────────────────────────

SEED_DIR = Path(__file__).resolve().parent / "scripts" / "seed_data"
CERT_KINDS_SEED = SEED_DIR / "cert_kinds_seed.json"
LICENCE_MAP_SEED = SEED_DIR / "simpro_licence_mapping_seed.json"

PII_ALLOWLIST = {"date_of_birth", "address", "emergency_contact"}

# Simpro Company ID → Paneltec org slug (matches workers.COMPANY_MAP)
COMPANY_TO_ORG_LABEL = {"2": "Paneltec", "3": "Viatec"}


def _lower(s: Optional[str]) -> str:
    return (s or "").strip().lower()


def _load_licence_map() -> dict[str, dict]:
    """{raw_simpro_name → {slug, variant?, variant_class?}}."""
    if not LICENCE_MAP_SEED.exists():
        raise HTTPException(500, f"Missing seed file: {LICENCE_MAP_SEED}")
    rows = json.loads(LICENCE_MAP_SEED.read_text())
    out = {}
    for r in rows:
        out[r["simpro_licence_name_raw"]] = {
            "slug": r["cert_kind_slug"],
            "variant": r.get("variant"),
            "variant_class": r.get("variant_class"),
        }
    return out


async def seed_cert_kinds_on_startup() -> None:
    """Upsert cert_kinds + simpro_licence_mapping from JSON seeds. Idempotent."""
    if not CERT_KINDS_SEED.exists() or not LICENCE_MAP_SEED.exists():
        log.warning("cert_kinds/simpro_licence_mapping seed files missing — skipping seed load")
        return
    kinds = json.loads(CERT_KINDS_SEED.read_text())
    mapping = json.loads(LICENCE_MAP_SEED.read_text())
    ts = now_iso()
    for k in kinds:
        await db.cert_kinds.update_one(
            {"slug": k["slug"]},
            {"$set": {**k, "updated_at": ts}, "$setOnInsert": {"created_at": ts}},
            upsert=True,
        )
    for m in mapping:
        await db.simpro_licence_mapping.update_one(
            {"simpro_licence_name_raw": m["simpro_licence_name_raw"]},
            {"$set": {**m, "updated_at": ts}, "$setOnInsert": {"created_at": ts}},
            upsert=True,
        )
    log.info("cert_kinds seeded: %d rows · simpro_licence_mapping: %d rows",
             len(kinds), len(mapping))


# v160.3.3 — Hash-dedup unique index for HR docs. Idempotent.
async def ensure_hr_dedup_index() -> None:
    try:
        await db.worker_hr_documents.create_index(
            [("worker_id", 1), ("sha256", 1)],
            unique=True, sparse=True, name="uniq_worker_sha256",
        )
    except Exception as e:  # pragma: no cover
        log.warning("HR dedup index creation failed: %s", e)


# ─────────────────────────────────────────────────────────────
# Simpro fetch (reuses config from the main integrations_simpro module)
# ─────────────────────────────────────────────────────────────

async def _paginate(h: httpx.AsyncClient, url: str) -> list[dict]:
    out, page = [], 1
    while True:
        r = await h.get(url, params={"pageSize": 250, "page": page})
        if r.status_code != 200:
            break
        data = r.json()
        if not isinstance(data, list):
            data = data.get("data") or []
        out.extend(data)
        if 'rel="next"' not in (r.headers.get("link") or ""):
            break
        page += 1
        if page > 30:
            break
    return out


async def _fetch_simpro(cfg: dict) -> tuple[list[dict], list[dict]]:
    base = cfg["api_base_url"].rstrip("/")
    hdr = {"Authorization": f"Bearer {cfg['api_token']}", "Accept": "application/json"}
    company_ids = cfg.get("company_ids") or ([cfg["company_id"]] if cfg.get("company_id") else [])
    async with httpx.AsyncClient(timeout=45, headers=hdr) as h:
        stubs: list[dict] = []
        for cid in company_ids:
            lst = await _paginate(h, f"{base}/api/v1.0/companies/{cid}/employees/")
            for e in lst:
                e["_company_id"] = str(cid)
            stubs.extend(lst)

        details: list[dict] = []
        for i, e in enumerate(stubs):
            r = await h.get(f"{base}/api/v1.0/companies/{e['_company_id']}/employees/{e['ID']}")
            if r.status_code == 200:
                d = r.json()
                d["_company_id"] = e["_company_id"]
                details.append(d)
            if i % 20 == 19:
                await asyncio.sleep(0.4)
            else:
                await asyncio.sleep(0.02)

        licences: list[dict] = []
        for cid in company_ids:
            batch = await _paginate(h, f"{base}/api/v1.0/companies/{cid}/licences/")
            for l in batch:
                l["_company_id"] = str(cid)
            licences.extend(batch)

    return details, licences


# ─────────────────────────────────────────────────────────────
# Diff / plan
# ─────────────────────────────────────────────────────────────

def _extract_pii(detail: dict) -> dict:
    out: dict = {}
    dob = detail.get("DateOfBirth")
    if dob:
        out["date_of_birth"] = dob
    addr = detail.get("Address") or {}
    if any(addr.values()):
        out["address"] = {
            "street": addr.get("Address"), "city": addr.get("City"),
            "state": addr.get("State"), "postal_code": addr.get("PostalCode"),
            "country": addr.get("Country"),
        }
    ec = detail.get("EmergencyContact") or {}
    if any(ec.values()):
        out["emergency_contact"] = {
            "name": ec.get("Name"), "relationship": ec.get("Relationship"),
            "cell_phone": ec.get("CellPhone"), "work_phone": ec.get("WorkPhone"),
            "address": ec.get("Address"),
        }
    return out


def _split_name(full: str) -> tuple[str, str]:
    parts = (full or "").strip().split()
    if not parts:
        return "", ""
    if len(parts) == 1:
        return parts[0].title(), ""
    return parts[0].title(), " ".join(p.title() for p in parts[1:])


def _match_worker(detail: dict, by_simpro: dict, by_email: dict) -> tuple[Optional[dict], str]:
    sid = detail.get("ID")
    if sid is not None:
        # workers.simpro_employee_id is stored as string in some seed rows, int in others
        m = by_simpro.get(int(sid)) or by_simpro.get(str(sid))
        if m:
            return m, "simpro_employee_id"
    email = _lower((detail.get("PrimaryContact") or {}).get("Email"))
    if email and email in by_email:
        return by_email[email], "email_fallback"
    return None, "unmatched"


# ─────────────────────────────────────────────────────────────
# Refresh endpoint
# ─────────────────────────────────────────────────────────────

@router.post("/refresh")
async def refresh_workers(
    dry_run: int = Query(0, description="1 = plan only, no writes; 0 = execute writes"),
    user: dict = Depends(require_permission("integrations", "edit")),
):
    org_id = user["org_id"]
    cfg_doc = await db.integration_configs.find_one({"org_id": org_id, "kind": "simpro", "status": "connected"})
    if not cfg_doc:
        raise HTTPException(400, "Simpro integration not connected for this org")
    # v160.3.9.40 (SEC-003) — decrypt secrets on read.
    from integrations import hydrate_integration_config
    cfg = hydrate_integration_config(cfg_doc)
    if not cfg.get("api_token"):
        raise HTTPException(400, "Simpro api_token missing")

    slug_map = _load_licence_map()

    details, licences = await _fetch_simpro(cfg)

    # Load workers
    workers: list[dict] = []
    async for w in db.workers.find({"org_id": org_id, "deleted_at": None}):
        w.pop("_id", None)
        workers.append(w)
    by_simpro: dict = {}
    by_email: dict = {}
    for w in workers:
        sid = w.get("simpro_employee_id") or w.get("simpro_id")
        if sid is not None:
            try:
                by_simpro[int(sid)] = w
                by_simpro[str(sid)] = w
            except (TypeError, ValueError):
                by_simpro[str(sid)] = w
        e = _lower(w.get("email"))
        if e:
            by_email[e] = w

    # Load existing Simpro-sourced certifications, keyed by simpro_licence_id
    existing_simpro_certs: dict = {}
    async for c in db.worker_certifications.find(
        {"org_id": org_id, "deleted_at": None, "source": "simpro"}
    ):
        c.pop("_id", None)
        if c.get("simpro_licence_id") is not None:
            existing_simpro_certs[int(c["simpro_licence_id"])] = c

    # ─── Plan ───
    ts = now_iso()
    plan_new_workers: list[dict] = []
    plan_updates: list[dict] = []       # {worker_id, pii, simpro_snapshot, snapshot_before}
    plan_certs_add: list[dict] = []
    plan_certs_update: list[dict] = []
    plan_certs_unchanged: list[dict] = []
    unmatched_stats: list[dict] = []

    for d in details:
        w, reason = _match_worker(d, by_simpro, by_email)
        pii_new = _extract_pii(d)
        pc = d.get("PrimaryContact") or {}
        first, last = _split_name(d.get("Name") or "")
        base_snapshot = {
            "simpro_employee_id": d.get("ID"),
            "company_id": d.get("_company_id"),
            "position": d.get("Position"),
            "archived": bool(d.get("Archived")),
            "last_synced_at": ts,
            "source": "simpro",
            "pii": pii_new,
        }

        if not w:
            # New worker onboarding path (per user policy — invite all 10 unmatched)
            new_doc = {
                "id": new_id(), "org_id": org_id,
                "first_name": first or (d.get("Name") or "Unknown").split()[0],
                "last_name": last,
                "email": (pc.get("Email") or "").strip().lower() or None,
                "phone": (pc.get("CellPhone") or pc.get("WorkPhone") or "").strip() or None,
                "mobile": (pc.get("CellPhone") or "").strip() or None,
                "position": d.get("Position") or "",
                "active": not bool(d.get("Archived")),
                "source": "simpro",
                "simpro_employee_id": str(d.get("ID")),
                "simpro_company_id": d.get("_company_id"),
                "simpro_sync_snapshot": base_snapshot,
                "created_at": ts, "updated_at": ts, "deleted_at": None,
                "created_by": user["id"],
            }
            plan_new_workers.append({"new_doc": new_doc, "simpro_name": d.get("Name")})
            worker_id_for_certs = new_doc["id"]
        else:
            snapshot_before = w.get("simpro_sync_snapshot")
            # Merge PII: allowlist-gated
            merged_pii = dict((snapshot_before or {}).get("pii") or {})
            merged_pii.update(pii_new)
            new_snapshot = dict(base_snapshot)
            new_snapshot["pii"] = merged_pii
            plan_updates.append({
                "worker_id": w["id"],
                "simpro_sync_snapshot": new_snapshot,
                "snapshot_before": snapshot_before,
                "match_reason": reason,
            })
            worker_id_for_certs = w["id"]

        # Cert planning for this employee
        for l in licences:
            if l.get("EmployeeID") != d.get("ID"):
                continue
            raw = (l.get("Name") or "").strip()
            if not raw:
                continue
            map_row = slug_map.get(l.get("Name") or "") or slug_map.get(raw) or {"slug": "unmapped"}
            slug = map_row["slug"]
            simpro_lic_id = int(l["ID"])
            existing = existing_simpro_certs.get(simpro_lic_id)
            cert_doc = {
                "id": (existing or {}).get("id") or new_id(),
                "org_id": org_id, "worker_id": worker_id_for_certs,
                "name": raw,
                "issuer": "Simpro",
                "issue_date": None,
                "expiry_date": l.get("ExpiryDate"),
                "doc_file_id": (existing or {}).get("doc_file_id"),
                "doc_folder_id": (existing or {}).get("doc_folder_id"),
                "doc_seed_folder": (existing or {}).get("doc_seed_folder") or "",
                "notes": (l.get("Ref") or "").strip() or (existing or {}).get("notes") or "",
                # Simpro-linked fields
                "source": "simpro",
                "simpro_licence_id": simpro_lic_id,
                "cert_kind_slug": slug,
                "variant": map_row.get("variant"),
                "variant_class": map_row.get("variant_class"),
                "created_by": (existing or {}).get("created_by") or user["id"],
                "created_at": (existing or {}).get("created_at") or ts,
                "updated_at": ts,
                "deleted_at": None,
            }
            if existing is None:
                plan_certs_add.append(cert_doc)
            else:
                changed = (
                    existing.get("expiry_date") != cert_doc["expiry_date"]
                    or existing.get("notes") != cert_doc["notes"]
                    or existing.get("cert_kind_slug") != cert_doc["cert_kind_slug"]
                    or existing.get("worker_id") != cert_doc["worker_id"]
                )
                if changed:
                    plan_certs_update.append({"before": existing, "after": cert_doc})
                else:
                    plan_certs_unchanged.append(cert_doc)

    # Snapshot payload — same shape whether dry-run or live
    snapshot_id = new_id()
    counts = {
        "workers_matched":     len(plan_updates),
        "workers_new_created": len(plan_new_workers),
        "unmatched_skipped":   0,  # None skipped now: user chose to onboard the 10
        "certs_added":         len(plan_certs_add),
        "certs_updated":       len(plan_certs_update),
        "certs_unchanged":     len(plan_certs_unchanged),
        "pii_workers_updated": sum(1 for u in plan_updates if u["simpro_sync_snapshot"].get("pii")),
        "simpro_employees":    len(details),
        "simpro_licences":     len(licences),
    }

    if dry_run:
        return {
            "dry_run": True, "snapshot_id": None, "counts": counts,
            "new_workers_preview": [
                {"simpro_name": n["simpro_name"], "email": n["new_doc"].get("email"),
                 "position": n["new_doc"].get("position"),
                 "simpro_company": n["new_doc"].get("simpro_company_id")}
                for n in plan_new_workers
            ],
        }

    # ─── Apply writes ───
    for u in plan_updates:
        await db.workers.update_one(
            {"id": u["worker_id"], "org_id": org_id},
            {"$set": {"simpro_sync_snapshot": u["simpro_sync_snapshot"], "updated_at": ts}},
        )
    for n in plan_new_workers:
        await db.workers.insert_one(n["new_doc"])
    for c in plan_certs_add:
        await db.worker_certifications.insert_one(c)
    for pair in plan_certs_update:
        c = pair["after"]
        await db.worker_certifications.update_one(
            {"id": c["id"], "org_id": org_id},
            {"$set": {k: c[k] for k in (
                "expiry_date", "notes", "cert_kind_slug", "variant", "variant_class",
                "worker_id", "name", "updated_at"
            )}},
        )

    snapshot_doc = {
        "id": snapshot_id, "org_id": org_id,
        "run_at": ts, "triggered_by": user["id"],
        "counts": counts,
        # Compact diffs for rollback — enough to reverse each write
        "updates_before": [{"worker_id": u["worker_id"],
                             "snapshot_before": u["snapshot_before"]} for u in plan_updates],
        "new_worker_ids": [n["new_doc"]["id"] for n in plan_new_workers],
        "certs_added_ids": [c["id"] for c in plan_certs_add],
        "certs_updated_before": [{"id": p["before"]["id"],
                                   "before": {k: p["before"].get(k) for k in
                                              ("expiry_date","notes","cert_kind_slug",
                                               "variant","variant_class","worker_id","name")}}
                                  for p in plan_certs_update],
    }
    await db.worker_import_snapshots.insert_one(snapshot_doc)

    return {
        "dry_run": False, "snapshot_id": snapshot_id, "counts": counts,
        "new_worker_ids": [n["new_doc"]["id"] for n in plan_new_workers],
    }


# ─────────────────────────────────────────────────────────────
# Snapshot list + rollback
# ─────────────────────────────────────────────────────────────

@router.get("/snapshots")
async def list_snapshots(
    limit: int = Query(50, ge=1, le=200),
    user: dict = Depends(require_roles("admin", "hseq_lead")),
):
    rows: list[dict] = []
    async for s in db.worker_import_snapshots.find(
        {"org_id": user["org_id"]}
    ).sort([("run_at", -1)]).limit(limit):
        s.pop("_id", None)
        # Slim for the list view
        rows.append({
            "id": s["id"], "run_at": s["run_at"],
            "triggered_by": s.get("triggered_by"),
            "counts": s.get("counts") or {},
            "rolled_back_at": s.get("rolled_back_at"),
        })
    return {"snapshots": rows}


@router.get("/snapshots/{snapshot_id}")
async def snapshot_detail(
    snapshot_id: str,
    user: dict = Depends(require_roles("admin", "hseq_lead")),
):
    s = await db.worker_import_snapshots.find_one({"id": snapshot_id, "org_id": user["org_id"]})
    if not s:
        raise HTTPException(404, "Snapshot not found")
    s.pop("_id", None)
    return s


@router.post("/rollback/{snapshot_id}")
async def rollback_snapshot(
    snapshot_id: str,
    user: dict = Depends(require_permission("integrations", "delete")),
):
    s = await db.worker_import_snapshots.find_one({"id": snapshot_id, "org_id": user["org_id"]})
    if not s:
        raise HTTPException(404, "Snapshot not found")
    if s.get("rolled_back_at"):
        raise HTTPException(400, "Snapshot already rolled back")
    ts = now_iso()

    # 1. Restore workers.simpro_sync_snapshot to previous value
    for u in (s.get("updates_before") or []):
        prev = u.get("snapshot_before")
        upd = {"$set": {"updated_at": ts}}
        if prev is None:
            upd["$unset"] = {"simpro_sync_snapshot": ""}
        else:
            upd["$set"]["simpro_sync_snapshot"] = prev
        await db.workers.update_one({"id": u["worker_id"], "org_id": user["org_id"]}, upd)

    # 2. Soft-delete newly created workers
    for wid in (s.get("new_worker_ids") or []):
        await db.workers.update_one(
            {"id": wid, "org_id": user["org_id"]},
            {"$set": {"deleted_at": ts, "updated_at": ts}},
        )

    # 3. Soft-delete newly added certs
    for cid in (s.get("certs_added_ids") or []):
        await db.worker_certifications.update_one(
            {"id": cid, "org_id": user["org_id"]},
            {"$set": {"deleted_at": ts, "updated_at": ts}},
        )

    # 4. Restore updated cert rows to their `before` state
    for pair in (s.get("certs_updated_before") or []):
        await db.worker_certifications.update_one(
            {"id": pair["id"], "org_id": user["org_id"]},
            {"$set": {**pair["before"], "updated_at": ts}},
        )

    await db.worker_import_snapshots.update_one(
        {"id": snapshot_id, "org_id": user["org_id"]},
        {"$set": {"rolled_back_at": ts, "rolled_back_by": user["id"]}},
    )
    return {"ok": True, "snapshot_id": snapshot_id, "rolled_back_at": ts}

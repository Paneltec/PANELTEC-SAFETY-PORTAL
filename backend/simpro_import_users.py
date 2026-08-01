"""v160.3.9.26 — Simpro → users import (manual, admin-only, idempotent).

Reuses the existing Simpro client in `integrations_simpro_workers.py`.
This endpoint sync's Simpro **employees** into the Paneltec `users`
collection (as opposed to the workers collection, which is a different
concern owned by `integrations_simpro_workers.py::refresh_workers`).

Match rule (per doc 06 + decision #6b):
  1. `simpro_employee_id` primary
  2. `email` (lower-cased, trimmed) secondary
  3. no match → create a `pending_activation` user (role_id=null,
     legacy `role="worker"` for backwards-compat, is_archived from
     Simpro `Archived`).

Archival:
  Simpro says `Archived=true` → set `is_archived=true`,
  `activation_status="suspended"`. Never delete.

Reactivation:
  Simpro says `Archived=false` on a Paneltec user with
  `is_archived=true` → set `is_archived=false`, restore
  `activation_status="active"` (if `role_id` set) or
  `"pending_activation"` (if unset).

**No cron** — this endpoint is triggered manually from Phase 4 UI.

Endpoints:
  POST /api/admin/simpro/import-employees
      Body: { dry_run: bool = false, org_id?: str = actor.org_id }
      Returns: { created, updated, archived, reactivated, skipped, errors,
                 audit_id, dry_run }
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import require_roles
from db import db
from integrations_simpro_workers import _fetch_simpro, _lower, _split_name
from models import new_id, now_iso


router = APIRouter(prefix="/admin/simpro", tags=["admin-simpro-users"])


class ImportEmployeesIn(BaseModel):
    dry_run: bool = False


async def ensure_simpro_import_audit_indexes() -> None:
    try:
        await db.simpro_import_audit.create_index("ran_at")
    except Exception:
        pass
    try:
        await db.users.create_index("simpro_employee_id")
    except Exception:
        pass


def _pick_email(detail: dict) -> Optional[str]:
    pc = detail.get("PrimaryContact") or {}
    e = _lower(pc.get("Email"))
    if e:
        return e
    return None


def _pick_position(detail: dict) -> Optional[str]:
    return detail.get("Position") or None


def _pick_name(detail: dict) -> tuple[str, str]:
    # Simpro payload uses `GivenName` / `FamilyName`, but some tenants
    # only have `Name` as combined. Fall back through both.
    first = detail.get("GivenName") or detail.get("FirstName")
    last = detail.get("FamilyName") or detail.get("LastName")
    if not first and not last:
        first, last = _split_name(detail.get("Name") or "")
    return (first or ""), (last or "")


@router.post("/import-employees")
async def import_employees(
    body: ImportEmployeesIn,
    user: dict = Depends(require_roles("admin")),
):
    org_id = user["org_id"]
    cfg_doc = await db.integration_configs.find_one({
        "org_id": org_id, "kind": "simpro", "status": "connected",
    })
    if not cfg_doc:
        raise HTTPException(400, "Simpro integration not connected for this org")
    cfg = cfg_doc.get("config") or {}
    if not cfg.get("api_token"):
        raise HTTPException(400, "Simpro api_token missing")

    details, _licences = await _fetch_simpro(cfg)

    counts = {"created": 0, "updated": 0, "archived": 0,
              "reactivated": 0, "skipped": 0}
    errors: List[Dict[str, Any]] = []
    ts = now_iso()

    for d in details:
        sid = d.get("ID")
        email = _pick_email(d)
        if sid is None and not email:
            counts["skipped"] += 1
            errors.append({"reason": "no_id_and_no_email", "payload_id": None})
            continue

        first, last = _pick_name(d)
        position = _pick_position(d)
        is_archived_simpro = bool(d.get("Archived"))

        # Step 1 — primary match by simpro_employee_id.
        existing = None
        if sid is not None:
            existing = await db.users.find_one(
                {"org_id": org_id, "simpro_employee_id": str(sid)},
                {"_id": 0},
            )
        # Step 2 — secondary match by email.
        if not existing and email:
            existing = await db.users.find_one(
                {"org_id": org_id, "email": email},
                {"_id": 0},
            )

        if existing:
            # UPDATE path.
            was_archived = bool(existing.get("is_archived"))
            set_fields: Dict[str, Any] = {
                "simpro_employee_id": str(sid) if sid is not None else existing.get("simpro_employee_id"),
                "simpro_position": position,
                "simpro_last_synced_at": ts,
            }
            # Only overwrite name/email if Simpro has them.
            if email and existing.get("email") != email:
                set_fields["email"] = email
            if first and not existing.get("name"):
                set_fields["name"] = f"{first} {last}".strip()
            # Archival transitions.
            if is_archived_simpro and not was_archived:
                set_fields["is_archived"] = True
                set_fields["activation_status"] = "suspended"
                counts["archived"] += 1
            elif not is_archived_simpro and was_archived:
                set_fields["is_archived"] = False
                # Reactivate: if they already had role_id, back to active;
                # otherwise pending_activation.
                set_fields["activation_status"] = (
                    "active" if existing.get("role_id") else "pending_activation"
                )
                counts["reactivated"] += 1
            else:
                counts["updated"] += 1
            if body.dry_run:
                continue
            await db.users.update_one({"id": existing["id"]}, {"$set": set_fields})
            continue

        # Step 3 — CREATE path.
        if not email:
            counts["skipped"] += 1
            errors.append({"reason": "simpro_id_only_no_email",
                            "simpro_id": sid})
            continue
        new_doc = {
            "id": new_id(),
            "org_id": org_id,
            "email": email,
            "name": f"{first} {last}".strip() or email.split("@")[0],
            "password_hash": None,             # invited via renewal link
            "role": "worker",                   # legacy string preserved
            "role_id": None,                    # admin must promote
            "workspace_ids": [],
            "token_version": 0,
            "status": "invited",
            "activation_status": "pending_activation",
            "is_archived": is_archived_simpro,
            "simpro_employee_id": str(sid) if sid is not None else None,
            "simpro_position": position,
            "simpro_last_synced_at": ts,
            "created_at": ts,
        }
        if is_archived_simpro:
            new_doc["activation_status"] = "suspended"
            counts["archived"] += 1
        counts["created"] += 1
        if body.dry_run:
            continue
        await db.users.insert_one(new_doc)

    audit_id = new_id()
    audit_doc = {
        "id": audit_id,
        "org_id": org_id,
        "actor_user_id": user["id"],
        "ran_at": ts,
        "dry_run": body.dry_run,
        "counts": counts,
        "errors": errors,
        "simpro_employees_seen": len(details),
    }
    if not body.dry_run:
        await db.simpro_import_audit.insert_one(dict(audit_doc))

    return {
        **counts,
        "errors": errors,
        "audit_id": None if body.dry_run else audit_id,
        "dry_run": body.dry_run,
        "simpro_employees_seen": len(details),
    }

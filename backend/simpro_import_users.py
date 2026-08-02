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


# ─────────────────────────────────────────────────────────────
# v160.3.9.32-4b — Phase 4b: Simpro-first user provisioning.
#
# Adds picker + selective-import + sync endpoints. Invite flow is
# gone (see users.py + auth_invite.py 410 gates). The full-import
# endpoint above stays as-is for admin bulk seeding; selective is
# the new default path from the RolesAdmin / Users UI.
# ─────────────────────────────────────────────────────────────
from permissions import require_permission  # noqa: E402


class SelectiveImportIn(BaseModel):
    employee_ids: List[str]


@router.get("/employees/available")
async def list_available_simpro_employees(
    include_linked: bool = False,
    user: dict = Depends(require_permission("users", "edit")),
):
    """Picker helper. Returns Simpro employees with a boolean flag for
    whether they're already linked into a Paneltec user."""
    org_id = user["org_id"]
    cfg_doc = await db.integration_configs.find_one({
        "org_id": org_id, "kind": "simpro", "status": "connected",
    })
    if not cfg_doc:
        raise HTTPException(400, "Simpro integration not connected for this org")
    cfg = cfg_doc.get("config") or {}
    details, _ = await _fetch_simpro(cfg)
    # Existing linked sids for this org.
    linked_sids: set[str] = set()
    async for u in db.users.find(
        {"org_id": org_id, "simpro_employee_id": {"$exists": True, "$ne": None}},
        {"_id": 0, "simpro_employee_id": 1},
    ):
        linked_sids.add(str(u["simpro_employee_id"]))
    rows: List[Dict[str, Any]] = []
    for d in details:
        sid = str(d.get("ID") or "")
        if not sid:
            continue
        is_linked = sid in linked_sids
        if is_linked and not include_linked:
            continue
        first, last = _pick_name(d)
        rows.append({
            "simpro_employee_id": sid,
            "name": f"{first} {last}".strip() or d.get("Name") or "",
            "email": _pick_email(d),
            "position": _pick_position(d),
            "archived": bool(d.get("Archived")),
            "already_in_paneltec": is_linked,
            # Simpro REST does not expose a photo URL — kept as null for
            # schema parity. See phase-plan doc for Phase 5+ photo import.
            "photo_url": None,
        })
    rows.sort(key=lambda r: (r["already_in_paneltec"], (r["name"] or "").lower()))
    return {"count": len(rows), "employees": rows}


@router.post("/import-employees/selective")
async def import_employees_selective(
    body: SelectiveImportIn,
    user: dict = Depends(require_permission("users", "edit")),
):
    """Import only the listed Simpro employee IDs. Unlike the
    full-import endpoint (which creates everything as
    pending_activation), selective import lands users as
    `activation_status='active'` — admin picked them explicitly."""
    org_id = user["org_id"]
    wanted = set(str(x) for x in body.employee_ids)
    if not wanted:
        raise HTTPException(400, "employee_ids empty")
    cfg_doc = await db.integration_configs.find_one({
        "org_id": org_id, "kind": "simpro", "status": "connected",
    })
    if not cfg_doc:
        raise HTTPException(400, "Simpro integration not connected for this org")
    cfg = cfg_doc.get("config") or {}
    details, _ = await _fetch_simpro(cfg)

    counts = {"created": 0, "updated": 0, "archived": 0,
              "reactivated": 0, "skipped": 0}
    errors: List[Dict[str, Any]] = []
    ts = now_iso()

    for d in details:
        sid = str(d.get("ID") or "")
        if sid not in wanted:
            continue
        email = _pick_email(d)
        first, last = _pick_name(d)
        position = _pick_position(d)
        is_archived_simpro = bool(d.get("Archived"))
        existing = await db.users.find_one(
            {"org_id": org_id, "simpro_employee_id": sid}, {"_id": 0},
        )
        if not existing and email:
            existing = await db.users.find_one(
                {"org_id": org_id, "email": email}, {"_id": 0},
            )
        if existing:
            set_fields: Dict[str, Any] = {
                "simpro_employee_id": sid,
                "simpro_position": position,
                "position": position,
                "simpro_last_synced_at": ts,
                # v160.3.9.32-4b — schema-parity photo_url. Simpro REST
                # doesn't return one; kept nullable so future photo
                # pipelines can populate.
                "photo_url": existing.get("photo_url"),
            }
            if email and existing.get("email") != email:
                set_fields["email"] = email
            if first and not existing.get("name"):
                set_fields["name"] = f"{first} {last}".strip()
            was_archived = bool(existing.get("is_archived"))
            if is_archived_simpro and not was_archived:
                set_fields["is_archived"] = True
                set_fields["activation_status"] = "suspended"
                counts["archived"] += 1
            elif not is_archived_simpro and was_archived:
                set_fields["is_archived"] = False
                # v160.3.9.32-4b — selective ⇒ admin picked them ⇒ active.
                set_fields["activation_status"] = "active"
                counts["reactivated"] += 1
            else:
                counts["updated"] += 1
            await db.users.update_one({"id": existing["id"]}, {"$set": set_fields})
            continue
        if not email:
            counts["skipped"] += 1
            errors.append({"reason": "simpro_id_only_no_email", "simpro_id": sid})
            continue
        new_doc = {
            "id": new_id(),
            "org_id": org_id,
            "email": email,
            "name": f"{first} {last}".strip() or email.split("@")[0],
            "password_hash": None,
            "role": "worker",
            "role_id": None,
            "workspace_ids": [],
            "token_version": 0,
            "status": "active",
            # v160.3.9.32-4b — selective import lands active (not pending).
            "activation_status": "suspended" if is_archived_simpro else "active",
            "is_archived": is_archived_simpro,
            "simpro_employee_id": sid,
            "simpro_position": position,
            "position": position,
            "photo_url": None,
            "simpro_last_synced_at": ts,
            "created_at": ts,
        }
        if is_archived_simpro:
            counts["archived"] += 1
        else:
            counts["created"] += 1
        await db.users.insert_one(new_doc)

    audit_id = new_id()
    await db.simpro_import_audit.insert_one({
        "id": audit_id, "org_id": org_id, "actor_user_id": user["id"],
        "ran_at": ts, "kind": "selective", "counts": counts, "errors": errors,
        "requested_ids": sorted(wanted),
    })
    return {**counts, "errors": errors, "audit_id": audit_id,
            "requested_count": len(wanted)}


@router.post("/sync-linked")
async def sync_linked_users(
    user: dict = Depends(require_permission("users", "edit")),
):
    """Refresh position + archived state for every already-linked user.
    Doesn't create anything new. Returns per-user diff summary."""
    org_id = user["org_id"]
    cfg_doc = await db.integration_configs.find_one({
        "org_id": org_id, "kind": "simpro", "status": "connected",
    })
    if not cfg_doc:
        raise HTTPException(400, "Simpro integration not connected for this org")
    cfg = cfg_doc.get("config") or {}
    details, _ = await _fetch_simpro(cfg)
    by_sid = {str(d.get("ID")): d for d in details if d.get("ID") is not None}
    ts = now_iso()
    diffs: List[Dict[str, Any]] = []
    scanned = 0
    changed = 0
    async for u in db.users.find(
        {"org_id": org_id, "simpro_employee_id": {"$exists": True, "$ne": None}},
        {"_id": 0, "id": 1, "email": 1, "name": 1, "position": 1, "is_archived": 1,
         "simpro_employee_id": 1, "activation_status": 1},
    ):
        scanned += 1
        d = by_sid.get(str(u["simpro_employee_id"]))
        if not d:
            continue
        changes: Dict[str, Any] = {}
        new_pos = _pick_position(d)
        if new_pos and new_pos != u.get("position"):
            changes["position"] = new_pos
        arch = bool(d.get("Archived"))
        if arch != bool(u.get("is_archived")):
            changes["is_archived"] = arch
            changes["activation_status"] = "suspended" if arch else "active"
        if changes:
            changes["simpro_last_synced_at"] = ts
            await db.users.update_one({"id": u["id"]}, {"$set": changes})
            changed += 1
            diffs.append({"user_id": u["id"], "email": u["email"], "changes": changes})
    return {"scanned": scanned, "changed": changed, "diffs": diffs}


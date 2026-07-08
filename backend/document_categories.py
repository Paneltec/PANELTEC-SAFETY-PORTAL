"""v160.1 — Document Categorization system (Phase 1: backend + API).

Ships:
  • `document_categories` collection with CRUD + list-records endpoints.
  • Shared visibility helper `category_visible()` used by document /
    induction / certification list endpoints to enforce
    `employee`-scope (subject-worker-only) and `shared`-scope (role_acl).
  • Migration-safe: existing records without `category_id` /
    `subject_worker_id` remain visible under the pre-v160.1 permission
    gate. Admins bulk-categorise in Phase 3.

Scope guard: This module does NOT auto-migrate historic records and
does NOT ship the admin UI. Those are Phase 2 / Phase 3.
"""
from __future__ import annotations
import re
from typing import List, Optional, Literal, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from db import db
from models import new_id, now_iso
from permissions import require_permission

router = APIRouter(prefix="/document-categories", tags=["document-categories"])

CATEGORY_SURFACES = ("document", "induction", "certification")
PRIVILEGED_ROLES = {"admin", "hseq_lead", "supervisor"}


class CategoryIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    description: Optional[str] = None
    scope: Literal["employee", "shared"] = "shared"
    sensitive: bool = False
    applies_to: List[Literal["document", "induction", "certification"]] = ["document"]
    role_acl: Dict[str, bool] = Field(default_factory=dict)


def _slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", (name or "").lower()).strip("_")
    return s or "category"


def _out(doc: dict) -> dict:
    return {
        "id": doc["id"], "org_id": doc["org_id"],
        "name": doc["name"], "slug": doc["slug"],
        "description": doc.get("description") or "",
        "scope": doc.get("scope") or "shared",
        "sensitive": bool(doc.get("sensitive")),
        "applies_to": list(doc.get("applies_to") or []),
        "role_acl": dict(doc.get("role_acl") or {}),
        "created_at": doc.get("created_at"),
        "updated_at": doc.get("updated_at"),
        "created_by": doc.get("created_by"),
    }


async def _uniq_slug(org_id: str, base: str, exclude_id: Optional[str] = None) -> str:
    """Find a slug not yet taken by a sibling category in the same org."""
    candidate = base
    n = 2
    while True:
        q: dict = {"org_id": org_id, "slug": candidate}
        if exclude_id:
            q["id"] = {"$ne": exclude_id}
        exists = await db.document_categories.find_one(q, {"_id": 0, "id": 1})
        if not exists:
            return candidate
        candidate = f"{base}_{n}"
        n += 1


# ---------- Shared visibility helper ---------------------------------

async def category_visible(
    user: dict,
    category_id: Optional[str],
    subject_worker_id: Optional[str],
) -> bool:
    """Return True iff `user` may see a record with the given category +
    subject-worker. Called by list endpoints and detail routes.

    Rules:
      • Uncategorized (`category_id is None`) → visible (pre-v160.1
        permission gate applies elsewhere).
      • Admin / HSEQ Lead / Supervisor → always True.
      • `employee` scope → True iff `subject_worker_id == user's linked
        worker id`. Anyone else → False.
      • `shared` scope → True iff `role_acl.get(user.role, False)`.
      • Category missing (dangling FK) → False (fail-safe).
    """
    if not category_id:
        return True
    role = (user.get("role") or "").lower()
    if role in PRIVILEGED_ROLES:
        return True
    cat = await db.document_categories.find_one(
        {"id": category_id, "org_id": user["org_id"]},
        {"_id": 0, "scope": 1, "role_acl": 1},
    )
    if not cat:
        return False
    if cat.get("scope") == "employee":
        # Resolve caller's worker.id via user_id or email link.
        me = await db.workers.find_one(
            {"org_id": user["org_id"], "deleted_at": None,
             "$or": [{"user_id": user["id"]},
                     {"email": (user.get("email") or "").lower()}]},
            {"_id": 0, "id": 1},
        )
        my_worker_id = (me or {}).get("id")
        return bool(my_worker_id) and subject_worker_id == my_worker_id
    # scope == "shared"
    return bool((cat.get("role_acl") or {}).get(role))


# ---------- CRUD ----------------------------------------------------

@router.get("")
async def list_categories(user: dict = Depends(require_permission("documents", "view"))):
    """Categories the caller may see:
    • Privileged roles → all categories in org.
    • Others → categories with `role_acl[role]=true` OR any `employee`
      category the caller has at least one record under.
    """
    role = (user.get("role") or "").lower()
    cursor = db.document_categories.find(
        {"org_id": user["org_id"]}, {"_id": 0},
    ).sort([("name", 1)])
    rows = await cursor.to_list(500)
    if role in PRIVILEGED_ROLES:
        return [_out(r) for r in rows]
    # Filter for non-privileged callers.
    me = await db.workers.find_one(
        {"org_id": user["org_id"], "deleted_at": None,
         "$or": [{"user_id": user["id"]},
                 {"email": (user.get("email") or "").lower()}]},
        {"_id": 0, "id": 1},
    )
    my_worker_id = (me or {}).get("id")
    visible: List[dict] = []
    for r in rows:
        scope = r.get("scope") or "shared"
        if scope == "shared":
            if (r.get("role_acl") or {}).get(role):
                visible.append(r)
        elif scope == "employee" and my_worker_id:
            # Include only if caller owns ≥1 record in this category.
            hit = await db.doc_files.find_one(
                {"org_id": user["org_id"], "category_id": r["id"],
                 "subject_worker_id": my_worker_id, "deleted_at": None},
                {"_id": 0, "id": 1},
            )
            if hit:
                visible.append(r)
    return [_out(r) for r in visible]


@router.post("", status_code=201)
async def create_category(
    body: CategoryIn,
    user: dict = Depends(require_permission("documents", "edit")),
):
    base_slug = _slugify(body.name)
    slug = await _uniq_slug(user["org_id"], base_slug)
    doc = {
        "id": new_id(),
        "org_id": user["org_id"],
        "name": body.name.strip(),
        "slug": slug,
        "description": (body.description or "").strip() or None,
        "scope": body.scope,
        "sensitive": bool(body.sensitive),
        "applies_to": [s for s in body.applies_to if s in CATEGORY_SURFACES] or ["document"],
        "role_acl": {k: bool(v) for k, v in (body.role_acl or {}).items()},
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "created_by": user["id"],
    }
    await db.document_categories.insert_one(dict(doc))
    return _out(doc)


@router.put("/{cat_id}")
async def update_category(
    cat_id: str,
    body: CategoryIn,
    user: dict = Depends(require_permission("documents", "edit")),
):
    existing = await db.document_categories.find_one(
        {"id": cat_id, "org_id": user["org_id"]}, {"_id": 0},
    )
    if not existing:
        raise HTTPException(404, "Category not found")
    base_slug = _slugify(body.name)
    slug = existing["slug"]
    if base_slug != existing["slug"].split("_")[0] or body.name.strip() != existing["name"]:
        slug = await _uniq_slug(user["org_id"], base_slug, exclude_id=cat_id)
    update = {
        "name": body.name.strip(),
        "slug": slug,
        "description": (body.description or "").strip() or None,
        "scope": body.scope,
        "sensitive": bool(body.sensitive),
        "applies_to": [s for s in body.applies_to if s in CATEGORY_SURFACES] or ["document"],
        "role_acl": {k: bool(v) for k, v in (body.role_acl or {}).items()},
        "updated_at": now_iso(),
    }
    await db.document_categories.update_one({"id": cat_id, "org_id": user["org_id"]},
                                            {"$set": update})
    fresh = await db.document_categories.find_one({"id": cat_id}, {"_id": 0})
    return _out(fresh)


@router.delete("/{cat_id}")
async def delete_category(
    cat_id: str,
    user: dict = Depends(require_permission("documents", "delete")),
):
    """Refuse when N records still reference this category. Returns a
    409 with `{count, sample: [...ids]}` so the admin UI can prompt the
    user to bulk-reassign or clear category first."""
    existing = await db.document_categories.find_one(
        {"id": cat_id, "org_id": user["org_id"]}, {"_id": 0, "id": 1},
    )
    if not existing:
        raise HTTPException(404, "Category not found")

    docs_ct = await db.doc_files.count_documents(
        {"org_id": user["org_id"], "category_id": cat_id, "deleted_at": None},
    )
    inductions_ct = await db.worker_inductions.count_documents(
        {"org_id": user["org_id"], "category_id": cat_id, "deleted_at": None},
    )
    certs_ct = await db.worker_certifications.count_documents(
        {"org_id": user["org_id"], "category_id": cat_id, "deleted_at": None},
    )
    total = docs_ct + inductions_ct + certs_ct
    if total > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "message": (
                    f"Cannot delete — {total} record(s) still reference this "
                    f"category. Reassign or clear category_id first."
                ),
                "count": total,
                "breakdown": {
                    "documents": docs_ct,
                    "inductions": inductions_ct,
                    "certifications": certs_ct,
                },
            },
        )
    await db.document_categories.delete_one({"id": cat_id, "org_id": user["org_id"]})
    return {"ok": True, "id": cat_id}


@router.get("/{cat_id}/records")
async def category_records(
    cat_id: str,
    user: dict = Depends(require_permission("documents", "view")),
):
    """Return records (documents + inductions + certs) tagged with this
    category — filtered per caller visibility.
    """
    q = {"org_id": user["org_id"], "category_id": cat_id, "deleted_at": None}
    docs = await db.doc_files.find(q, {"_id": 0}).sort("uploaded_at", -1).to_list(500)
    inductions = await db.worker_inductions.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    certs = await db.worker_certifications.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    async def _keep(rec):
        return await category_visible(user, rec.get("category_id"),
                                       rec.get("subject_worker_id"))
    docs_v = [r for r in docs if await _keep(r)]
    ind_v = [r for r in inductions if await _keep(r)]
    cert_v = [r for r in certs if await _keep(r)]
    return {"documents": docs_v, "inductions": ind_v, "certifications": cert_v,
            "count": len(docs_v) + len(ind_v) + len(cert_v)}

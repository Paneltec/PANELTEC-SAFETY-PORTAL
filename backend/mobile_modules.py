"""Phase 4.3 — Per-role mobile app module allocator.

Admin can enable / disable individual modules for each role
(worker / supervisor / contractor). The Expo mobile client reads
`GET /api/me/mobile-modules` on login + foreground to decide which
tabs / drawer entries to render.

API surface (admin):
  GET  /api/settings/mobile-modules        → full matrix
  PUT  /api/settings/mobile-modules        → persist full matrix, audit-logged

API surface (any authenticated user):
  GET  /api/me/mobile-modules              → flat boolean map for caller's role

Storage: `org_settings` collection, document keyed by `org_id` with a
`mobile_modules` sub-document. Seeded with sensible defaults on first read.
"""
from typing import Dict, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

import logging

from auth import get_current_user
from db import db
from models import now_iso

router = APIRouter(prefix="/api", tags=["mobile-modules"])
log = logging.getLogger("paneltec.mobile_modules")

# ──────────────────────────────────────────────────────────────────────
# Module catalogue. Keep keys in sync with the friendly labels used by
# the web admin UI and the Expo mobile navigation.
# ──────────────────────────────────────────────────────────────────────
MODULE_KEYS = [
    "pre_start", "site_diary", "hazard", "incident", "inspection",
    "swms", "inductions", "plant_vehicles",
    "certifications", "ask_intel", "sign_on", "profile",
    # v158 — 5 new mobile modules exposed to admins in the allocator.
    # `service_maintenance` was retired (rolled into `plant_vehicles`) —
    # `_normalise` silently drops any legacy value stored under that key.
    "forms", "document_library", "contractors", "suppliers", "workers",
    # v159.1 — Users Directory tile (admin-only by default).
    "users_directory",
    # v160.0.2 — Compliance Snapshot chip row on phone Home.
    # Aggregated org counts (SWMS / Pre-starts / Site diary / Hazards /
    # Incidents / Inspections). Belt-and-braces gate on top of the
    # existing `attention_band='hidden'` server signal — either can hide.
    "compliance_snapshot",
]
ROLE_KEYS = ["worker", "supervisor", "contractor", "admin"]

# v158 — Keys we accept on read but never write. Any existing docs in
# `org_settings.mobile_modules` that were saved before v158 may still
# carry `service_maintenance`; `_normalise` will drop it silently.
_RETIRED_MODULE_KEYS = {"service_maintenance"}

# Default matrix. Workers / supervisors get the full operational kit.
# Contractors are deliberately minimal — they only need to sign-on, see
# their SWMS, complete inductions, and view their own profile.
DEFAULTS: Dict[str, Dict[str, bool]] = {
    "worker": {
        "pre_start": True, "site_diary": True, "hazard": True, "incident": True,
        "inspection": True, "swms": True, "inductions": True,
        # v159.0 hardening — worker no longer sees Plant & Vehicles module by
        # default. Reserved for supervisor+ per the audit §3 matrix.
        "plant_vehicles": False,
        "certifications": True, "ask_intel": False,
        "sign_on": True, "profile": True,
        # v159.0 — Document Library flipped OFF by default. Worker retrieves
        # own induction docs via the induction flow, not the library.
        # Contractors / suppliers / workers directory stay OFF.
        "forms": True, "document_library": False,
        "contractors": False, "suppliers": False, "workers": False,
        # v159.1 — workers never see the Users tile; admin only.
        "users_directory": False,
        # v160.0.2 — workers never see org-wide aggregate counts.
        "compliance_snapshot": False,
    },
    "supervisor": {k: True for k in MODULE_KEYS if k != "users_directory"} | {"users_directory": False},
    "contractor": {
        # v159.0 — contractors need to see hazards + incidents that pertain
        # to their crew, so hazard/incident flipped ON by default per audit §3.
        "pre_start": False, "site_diary": False, "hazard": True, "incident": True,
        "inspection": False, "swms": True, "inductions": True,
        "plant_vehicles": False,
        "certifications": False, "ask_intel": False,
        "sign_on": True, "profile": True,
        # v158 defaults per user brief.
        "forms": True, "document_library": True,
        "contractors": True, "suppliers": False, "workers": False,
        "users_directory": False,
        # v160.0.2 — contractors don't need org-wide compliance aggregates.
        "compliance_snapshot": False,
    },
    # Admin column is always-on in the UI and persisted as such so the
    # mobile app can ungate every module if an admin ever signs in there.
    "admin": {k: True for k in MODULE_KEYS},
}


# v159.1 — bump this string whenever DEFAULTS shift so we can nudge admins
# to review the new hardened matrix. Persisted alongside the stored doc as
# `defaults_version`; when missing/older, the GET /settings/mobile-modules
# response includes `needs_migration_review: true` so the admin UI can show
# a "New defaults available — review and save" banner.
DEFAULTS_VERSION = "v160.0.2"


def _normalise(matrix: Dict[str, Dict[str, bool]]) -> Dict[str, Dict[str, bool]]:
    """Coerce an incoming payload into the canonical shape. Unknown keys
    are dropped, missing keys fall back to the defaults, and the admin
    row is force-set to all-true so the UI lock can never be bypassed
    by a hand-crafted PUT.

    v158 — retired module keys (see `_RETIRED_MODULE_KEYS`) are silently
    dropped on read so pre-v158 documents don't leak stale toggles into
    the response payload."""
    out: Dict[str, Dict[str, bool]] = {}
    for role in ROLE_KEYS:
        row_in = (matrix or {}).get(role) or {}
        # Strip retired keys before we even look at them.
        row_in = {k: v for k, v in row_in.items() if k not in _RETIRED_MODULE_KEYS}
        row = {}
        for mod in MODULE_KEYS:
            if role == "admin":
                row[mod] = True
            elif mod in row_in:
                row[mod] = bool(row_in[mod])
            else:
                row[mod] = bool(DEFAULTS[role].get(mod, False))
        out[role] = row
    return out


async def _load_matrix(org_id: str) -> Dict[str, Dict[str, bool]]:
    """Read-with-seed. If `org_settings.mobile_modules` is missing for
    the org, we persist the defaults so subsequent reads + audit diffs
    have a stable baseline to compare against."""
    doc = await db.org_settings.find_one({"org_id": org_id})
    if doc and isinstance(doc.get("mobile_modules"), dict):
        return _normalise(doc["mobile_modules"])
    seeded = _normalise({})
    await db.org_settings.update_one(
        {"org_id": org_id},
        {"$set": {"mobile_modules": seeded, "updated_at": now_iso()},
         "$setOnInsert": {"org_id": org_id, "created_at": now_iso()}},
        upsert=True,
    )
    return seeded


class MobileModulesPayload(BaseModel):
    mobile_modules: Dict[str, Dict[str, bool]] = Field(default_factory=dict)


@router.get("/settings/mobile-modules")
async def get_mobile_modules(user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    matrix = await _load_matrix(user["org_id"])
    doc = await db.org_settings.find_one(
        {"org_id": user["org_id"]}, {"_id": 0, "defaults_version": 1},
    )
    stored_version = (doc or {}).get("defaults_version")
    needs_review = stored_version != DEFAULTS_VERSION
    return {
        "mobile_modules": matrix,
        "module_keys": MODULE_KEYS,
        "role_keys": ROLE_KEYS,
        "defaults": DEFAULTS,
        "defaults_version": DEFAULTS_VERSION,
        "stored_defaults_version": stored_version,
        "needs_migration_review": needs_review,
    }


@router.put("/settings/mobile-modules")
async def put_mobile_modules(
    body: MobileModulesPayload,
    user: dict = Depends(get_current_user),
):
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    before = await _load_matrix(user["org_id"])
    after = _normalise(body.mobile_modules)
    await db.org_settings.update_one(
        {"org_id": user["org_id"]},
        {"$set": {"mobile_modules": after, "defaults_version": DEFAULTS_VERSION,
                  "updated_at": now_iso()},
         "$setOnInsert": {"org_id": user["org_id"], "created_at": now_iso()}},
        upsert=True,
    )
    # Diff for the audit log — only emit what actually changed so the
    # log is grep-friendly when a worker reports "my tab disappeared".
    diff = []
    for role in ROLE_KEYS:
        if role == "admin":
            continue
        for mod in MODULE_KEYS:
            if before[role].get(mod) != after[role].get(mod):
                diff.append({"role": role, "module": mod,
                             "from": bool(before[role].get(mod)),
                             "to":   bool(after[role].get(mod))})
    if diff:
        await db.audit_logs.insert_one({
            "org_id":     user["org_id"],
            "actor_id":   user.get("id"),
            "actor_name": user.get("name") or user.get("email"),
            "action":     "mobile_modules.update",
            "at":         now_iso(),
            "diff":       diff,
        })
    return {"ok": True, "mobile_modules": after, "changes": len(diff)}


@router.get("/me/mobile-modules")
async def get_my_mobile_modules(
    as_role: Optional[str] = Query(None, description="Admin-only: preview another role's module set"),
    user: dict = Depends(get_current_user),
):
    """Flat boolean map for the calling user's role. Used by the Expo
    mobile app to gate bottom-tab + drawer nav. Unknown roles fall back
    to the most-restrictive `contractor` row so a misconfigured user
    can never accidentally see everything.

    Phase 4.4 — admins can pass `?as_role=worker|supervisor|contractor|admin`
    to preview another role's module set. The param is silently ignored
    for non-admin callers (so a worker copying an admin's link can't
    escalate). Usage is logged at INFO level for auditability."""
    matrix = await _load_matrix(user["org_id"])
    caller_role = (user.get("role") or "contractor").lower()
    effective_role = caller_role
    if as_role:
        ar = (as_role or "").lower()
        if caller_role == "admin" and ar in ROLE_KEYS:
            effective_role = ar
            log.info("mobile_modules.preview org=%s actor=%s actor_role=%s preview_as=%s",
                     user.get("org_id"), user.get("id") or user.get("email"),
                     caller_role, ar)
        # else: silently ignored — non-admin can't preview other roles.
    row = matrix.get(effective_role) or matrix.get("contractor") or {}
    return {
        "role": effective_role,
        "actual_role": caller_role,
        "previewed": effective_role != caller_role,
        "modules": row,
    }

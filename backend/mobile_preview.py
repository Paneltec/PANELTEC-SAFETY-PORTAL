"""v58.13.132o — Permission-Presets Live Preview backend.

Mints a short-lived read-only JWT for the mobile-app-in-iframe that
the admin embeds inside `/app/settings/permission-presets`.

.132o additions:
  · `?worker_id=<uuid>` — mint a preview session bound to that worker.
    Response `.user` reflects the worker's real profile (email, name,
    company, role) so downstream endpoints (`/mobile/home`,
    `/forms/templates`, `/swms`, `/mobile/daily-jobs/today`) surface
    the actual data that worker would see. Write-block enforcement
    stays server-side inside `auth.get_current_user` regardless.
  · New `POST /mobile/preview-user/reset` — pure client-directive
    endpoint. It doesn't do anything server-side (preview tokens are
    stateless JWTs); it exists so the admin UI can hit it as an
    audit-log anchor for "admin cleared their preview session".

The preview session:
  · Verifies the caller has a real admin JWT (via `require_perm`
    on `users:edit` — same gate as the presets page)
  · Emits a preview JWT with `type="preview"`, `preview=True`,
    `role_id=<selected>`, `org_id=<admin's org>`, 15-min expiry.
  · When bound to a worker, adds `preview_worker_id` + resolves the
    worker's Simpro company_id and role snapshot so the mobile app
    renders that worker's actual scoped experience.

Write-block is enforced inside `auth.get_current_user` — any
non-GET/HEAD/OPTIONS with a preview token → 403 `preview_mode_read_only`.
"""
from __future__ import annotations

import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from auth import (
    JWT_ALGORITHM, _secret,
)
from db import db
from permissions import require_permission
from mobile_modules_data import MODULE_KEYS, _load_matrix

logger = logging.getLogger("paneltec.mobile_preview")
router = APIRouter(prefix="/mobile", tags=["mobile-preview"])

# Short lifetime — preview sessions should never outlive the admin's
# active browser tab. 15 min matches the shortest session-timeout preset.
PREVIEW_EXP_MINUTES = 15

# v58.13.132p — collapsed preview scopes.
# Each scope maps to a *union* of the underlying 18 role rows' module
# allowlists, so a Live Preview admin sees a single "Paneltec Civil"
# option instead of 18 fine-grained roles. The underlying roles are
# preserved untouched — this is a preview-UX aggregation only.
#
# v58.13.132di — Added `external_contractor` scope. The FE 4-role
# picker (`SCOPES` set in `MobileModulesSection.jsx`) already includes
# it, so before .132di the Expo iframe would 400 when an admin picked
# External Contractor in the "Preview as role" dropdown. The mobile
# bundle surfaced the 400 as an error alert inside the bezel which
# read to admins like a broken preview.
SCOPE_KEYS = {"paneltec_civil", "viatec_traffic", "admin", "external_contractor"}
SCOPE_META = {
    "paneltec_civil":      {"label": "Paneltec Civil",
                            "company_id": "2",
                            "matches": ("paneltec", "civil")},
    "viatec_traffic":      {"label": "Viatec Traffic Solutions",
                            "company_id": "3",
                            "matches": ("viatec", "traffic")},
    "admin":               {"label": "Admin",
                            "company_id": None,
                            "matches": ("admin", "owner", "manager", "hseq")},
    # v58.13.132di — External Contractor union: any role_id containing
    # `contractor` or the canonical `external_contractor` matrix row.
    # Falls back to the `worker` baseline when a fresh org has no
    # contractor rows in the mobile-modules matrix.
    "external_contractor": {"label": "External Contractor",
                            "company_id": None,
                            "matches": ("contractor",)},
}


async def _resolve_scope_modules(org_id: str, scope: str) -> tuple[list[str], Optional[str]]:
    """Return the union module-allowlist + representative company_id for the
    given scope.

    Algorithm:
      admin  → every module key ON (full-access preview).
      others → walk the role matrix, keep every role whose id contains any
               of the scope's `matches` substrings (case-insensitive),
               OR-merge their module flags.
    """
    if scope == "admin":
        return list(MODULE_KEYS), None
    meta = SCOPE_META[scope]
    matches = meta["matches"]
    try:
        matrix = await _load_matrix(org_id)
    except Exception:
        matrix = {}
    modules_enabled: set[str] = set()
    for role_id, mods in (matrix or {}).items():
        rid = (role_id or "").lower()
        if not any(m in rid for m in matches):
            continue
        for mod_key, on in (mods or {}).items():
            if on:
                modules_enabled.add(mod_key)
    # Fallback: if the matrix doesn't have any role matching the scope
    # substrings (fresh org, no custom roles yet) — seed with the baseline
    # `worker` row so the tile grid isn't empty.
    if not modules_enabled and "worker" in (matrix or {}):
        for mod_key, on in matrix["worker"].items():
            if on:
                modules_enabled.add(mod_key)
    return sorted(modules_enabled), meta["company_id"]


class PreviewUserResponse(BaseModel):
    token: str
    user: dict
    expires_at: str
    preview: bool = True
    worker_scoped: bool = False


@router.get(
    "/preview-user",
    response_model=PreviewUserResponse,
    summary="Mint a read-only preview JWT for the mobile-app iframe",
)
async def mint_preview_user(
    role_id: Optional[str] = Query(
        None,
        description=(
            "Role key to preview as (legacy per-role preview, kept for "
            "backward compat with the .132j iframe wiring)."
        ),
    ),
    scope: Optional[str] = Query(
        None,
        description=(
            "v58.13.132p — collapsed scope: `paneltec_civil` | "
            "`viatec_traffic` | `admin`. When set, mints a preview JWT "
            "carrying the *union* of the underlying role rows that match "
            "the scope. Takes precedence over `role_id`."
        ),
    ),
    worker_id: Optional[str] = Query(
        None,
        description=(
            "v58.13.132o — optional worker UUID to bind the preview to."
        ),
    ),
    _admin: dict = Depends(require_permission("users", "edit")),
) -> PreviewUserResponse:
    # v58.13.132p — Guard: when this function is invoked directly (from
    # pytest), FastAPI's `Query(None, ...)` sentinels come through as the
    # FieldInfo objects themselves, not `None`. Normalise so both HTTP and
    # direct-call paths behave identically.
    if not isinstance(role_id, (str, type(None))): role_id = None
    if not isinstance(scope,   (str, type(None))): scope = None
    if not isinstance(worker_id, (str, type(None))): worker_id = None

    if not (scope or role_id):
        raise HTTPException(status_code=400, detail="role_id or scope required")
    if scope and scope not in SCOPE_KEYS:
        raise HTTPException(status_code=400,
                            detail=f"scope must be one of {sorted(SCOPE_KEYS)}")

    effective_role = role_id
    modules_override: Optional[list[str]] = None
    scope_company_id: Optional[str] = None
    if scope:
        modules_override, scope_company_id = await _resolve_scope_modules(
            _admin["org_id"], scope,
        )
        # Represent the scope as a role for downstream shims — admin scope
        # maps to `admin` so the mobile home resolves the full-access
        # matrix; the two field-worker scopes + `external_contractor`
        # map to `worker` since they all share the worker persona at
        # the mobile-home tile-grid level.
        effective_role = "admin" if scope == "admin" else "worker"

    role_id_final = (effective_role or "").strip()
    if not role_id_final:
        raise HTTPException(status_code=400, detail="role_id required")
    org_id = _admin["org_id"]

    # ── Optional worker binding ────────────────────────────────────────
    worker_snapshot: Optional[dict] = None
    if worker_id and worker_id.strip():
        worker = await db.workers.find_one(
            {"id": worker_id.strip(), "org_id": org_id, "deleted_at": None},
            {
                "_id": 0, "id": 1, "email": 1, "first_name": 1, "last_name": 1,
                "simpro_company_id": 1, "position": 1, "role": 1,
                "mobile": 1, "phone": 1, "avatar_initials": 1,
            },
        )
        if not worker:
            raise HTTPException(
                status_code=404,
                detail="worker not found in your org",
            )
        worker_snapshot = worker
        logger.info(
            "preview_user_worker_bound admin=%s worker=%s role=%s",
            _admin.get("id"), worker["id"], role_id_final,
        )

    subject = f"preview-{scope or role_id_final}-{secrets.token_hex(4)}"

    now = datetime.now(timezone.utc)
    exp = now + timedelta(minutes=PREVIEW_EXP_MINUTES)

    payload = {
        "sub": subject,
        "type": "preview",
        "preview": True,
        "role_id": role_id_final,
        "role": role_id_final,
        "org_id": org_id,
        "iat": now,
        "exp": exp,
    }
    # v58.13.132in — Human-readable role label persisted on the JWT so
    # `get_current_user` can echo it back on `/api/auth/me` without a
    # per-request lookup. SCOPE_META already carries the label; role_id
    # falls back to a Title-cased split of the role id.
    if scope and scope in SCOPE_META:
        payload["role_label"] = SCOPE_META[scope]["label"]
    elif role_id:
        payload["role_label"] = role_id.replace("_", " ").title()
    if scope:
        payload["preview_scope"] = scope
        payload["preview_modules"] = modules_override or []
    if worker_snapshot:
        payload["preview_worker_id"] = worker_snapshot["id"]
        payload["email"] = worker_snapshot.get("email") or f"{subject}@preview.paneltec.local"
    token = jwt.encode(payload, _secret(), algorithm=JWT_ALGORITHM)

    if worker_snapshot:
        first = worker_snapshot.get("first_name") or ""
        last = worker_snapshot.get("last_name") or ""
        full_name = (first + " " + last).strip() or worker_snapshot.get("email") or "Worker"
        synthetic_user = {
            "id": subject,
            "email": worker_snapshot.get("email") or f"{subject}@preview.paneltec.local",
            "name": full_name + " (preview)",
            "role": role_id_final,
            "role_id": role_id_final,
            "org_id": org_id,
            "workspace_ids": [],
            "company_id": worker_snapshot.get("simpro_company_id") or scope_company_id,
            "activation_status": "active",
            "preview": True,
            "preview_worker_id": worker_snapshot["id"],
            "preview_scope": scope,
            "worker_position": worker_snapshot.get("position"),
        }
    else:
        label = (SCOPE_META[scope]["label"] if scope
                 else f"Preview · {role_id_final}")
        synthetic_user = {
            "id": subject,
            "email": f"{subject}@preview.paneltec.local",
            "name": label,
            "role": role_id_final,
            "role_id": role_id_final,
            "org_id": org_id,
            "workspace_ids": [],
            "company_id": scope_company_id,
            "activation_status": "active",
            "preview": True,
            "preview_scope": scope,
        }

    return PreviewUserResponse(
        token=token,
        user=synthetic_user,
        expires_at=exp.isoformat(),
        preview=True,
        worker_scoped=bool(worker_snapshot),
    )


# ── v58.13.132o — worker picker feed ────────────────────────────────

class PreviewWorkerRow(BaseModel):
    id: str
    name: str
    email: Optional[str] = None
    company_id: Optional[str] = None
    position: Optional[str] = None


class PreviewWorkersResponse(BaseModel):
    workers: list[PreviewWorkerRow]


@router.get(
    "/preview-user/workers",
    response_model=PreviewWorkersResponse,
    summary="List workers eligible for the Live Preview worker dropdown",
)
async def list_preview_workers(
    _admin: dict = Depends(require_permission("users", "edit")),
) -> PreviewWorkersResponse:
    """Admin-only. Returns every active worker in the admin's org sorted
    by name, so the Live Preview panel can render a picker under the role
    dropdown. Same permission gate as `preview-user` itself.
    """
    org_id = _admin["org_id"]
    rows: list[PreviewWorkerRow] = []
    async for w in db.workers.find(
        {"org_id": org_id, "deleted_at": None},
        {"_id": 0, "id": 1, "email": 1, "first_name": 1, "last_name": 1,
         "simpro_company_id": 1, "position": 1},
    ):
        first = (w.get("first_name") or "").strip()
        last = (w.get("last_name") or "").strip()
        name = (first + " " + last).strip() or (w.get("email") or "Unnamed")
        rows.append(PreviewWorkerRow(
            id=w["id"],
            name=name,
            email=w.get("email"),
            company_id=(str(w["simpro_company_id"])
                        if w.get("simpro_company_id") else None),
            position=w.get("position"),
        ))
    rows.sort(key=lambda r: (r.name or "").lower())
    return PreviewWorkersResponse(workers=rows)

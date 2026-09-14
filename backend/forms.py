"""Forms Library — Phase 2.

Adds on top of Phase 1:
  • Photo uploads bound to a submission + field (`POST /submissions/{id}/photos`)
  • GPS / signature values are stored inline on the submission's field value
  • PDF generation per submission (`GET /submissions/{id}/pdf`)
  • Per-submission read-back of attached photos (`GET /submissions/{id}/photos`)

Submissions are workable by ANY authenticated org user (workers fill them out
on their phone). Template CRUD and submission delete remain admin/hseq_lead.

═════════════════════════════════════════════════════════════════════════════
STANDARD HEADER convention (established v160.1.6)
─────────────────────────────────────────────────────────────────────────────
Every operational Paneltec form should begin with the same four fields, in
this order, so operators build muscle memory across pre-starts, permits,
inspections and reports:

  1. `date`             — Label "Date".   `config.default_today: true`.
                          Renders as an editable calendar picker (see
                          `DatePickerField` in `mobile/app/forms/fill/[id].tsx`).
  2. `worker_picker`    — Label "Operator (Name)".
                          `config.inline_company_toggle: true` with
                          `company_options: [{Paneltec Civil, simpro_id:'2'},
                                             {Viatec,         simpro_id:'3'}]`.
  3. `gps`              — Label "Location".  `config.reverse_geocode: true`.
                          Renders the `GpsField` which populates a human-
                          readable street address alongside lat/lng.
  4. `vehicle_navixy`   — Label "Select Vehicle".  Only when the form is
                          vehicle- or plant-attached. Delete any standalone
                          `asset_scan` field — the NavixyVehiclePicker
                          embeds the Scan-QR primary CTA above the
                          searchable dropdown (v160.1.4/1.5).

Templates already migrated (as of v160.1.6): Vehicle Pre-Use Inspection,
Heavy Vehicle Daily Check.

v160.2.0 — Bulk migration executed via
`backend/scripts/migrate_v160_2_0_bulk.py`. All 26 remaining templates
were passed through the Standard-Header rules and snapshotted to
`form_templates_backup_v160_1_6` before the write. New templates
should continue to be built onto this header by default.

v160.2.6-cat — Seven categories now recognised: `general | pre_start
| inspection | near_miss | incident | toolbox | admin`. The 7th
(`admin`) is reserved for admin-only forms (e.g. Drug & Alcohol Test).
Workers NEVER see the `admin` category tile on the mobile Forms
Library and every admin-category template is auto-excluded from the
Worker allowlist by `migrate_v160_2_6cat_categorize.py`.
═════════════════════════════════════════════════════════════════════════════
"""
from __future__ import annotations
import io
import re
import uuid
from pathlib import Path
from typing import Any, List, Optional

from fastapi.responses import FileResponse, StreamingResponse  # noqa: F401
from fastapi import (
    APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile,
)
from fastapi.responses import Response
from pydantic import BaseModel, Field
from pymongo import ReturnDocument

from auth import get_current_user
from db import db
from form_routing import resolve_template_category  # v58.13.132dz
from missing_file_response import missing_file_response  # v58.13.132fq
from models import new_id, now_iso

from permissions import require_permission, require_module

router = APIRouter(
    prefix="/forms", tags=["forms"],
    dependencies=[Depends(require_module("forms"))],  # v160.0.9
)

WRITE_ROLES = {"admin", "hseq_lead"}
ALLOWED_CATEGORIES = {"incident", "inspection", "toolbox", "near_miss", "general", "pre_start", "admin",
                      # v160.3.0-adjust-13 — first-class categories for the new
                      # Capture-tab routing. `hazard` and `site_diary` were
                      # previously used as template-category strings but were
                      # normalised down to `general` on write. `risk_assessment`
                      # is brand new — routes to the /app/risk-assessments tab.
                      "hazard", "site_diary", "risk_assessment",
                      # v58.13.132l — SWMS surfaces as a mobile Forms category
                      # (records still live in db.swms; `list_templates` bridges
                      # them into the FormTemplate shape with is_swms=True).
                      "swms"}
ALLOWED_FIELD_TYPES = {"text", "textarea", "date", "number", "select", "radio",
                       "photo", "signature", "gps", "vehicle_navixy", "asset_scan",
                       "worker_picker", "job_picker", "site_picker", "customer_picker",
                       # v160.0.12 — Heavy Equipment Pre-Op enhancement
                       "company_selector", "auto_date",
                       # v160.2.3 — Time picker for permit issue/expiry and
                       # start/end times on toolbox / sign-in / induction.
                       "time",
                       # v160.3.9.58.12.0 — BYDA / Utility Awareness form.
                       # `reference_matrix` is a template-embedded read-only
                       # compliance table (never contributes to submission
                       # value). `attachment` is a multi-file field mirroring
                       # `photo` but with per-file name/description metadata
                       # and a broader MIME allowlist (see ATTACHMENT_*).
                       # `actions` is a repeatable follow-up-task row with
                       # server-stamped id, frozen actionee_name, and a
                       # Closed-row date-closed invariant enforced on write.
                       "reference_matrix", "attachment", "actions"}
ATTACHMENT_ALLOWED_MIMES = {
    "application/pdf", "image/png", "image/jpeg", "image/webp",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/csv", "text/plain",
}
MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
ATTACHMENT_ROOT = Path(__file__).parent / "uploads" / "form_attachments"
ATTACHMENT_ROOT.mkdir(parents=True, exist_ok=True)
PHOTO_ALLOWED_MIMES = {"image/png", "image/jpeg", "image/jpg", "image/webp", "image/heic", "image/heif"}
MAX_PHOTO_BYTES = 15 * 1024 * 1024

UPLOAD_ROOT = Path(__file__).parent / "uploads" / "form_photos"
UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)


def _require_write(user: dict, action: str = "edit"):
    if user.get("role") not in WRITE_ROLES:
        raise HTTPException(403, f"Permission denied: forms.{action}")


def _serialise(doc: dict) -> dict:
    return {k: v for k, v in doc.items() if k != "_id"}


def _norm_category(cat: str) -> str:
    c = (cat or "general").lower().replace(" ", "_").replace("-", "_")
    return c if c in ALLOWED_CATEGORIES else "general"


def _clean_field(f: dict) -> dict:
    cfg = f.get("config") or {}
    if not isinstance(cfg, dict):
        cfg = {}
    return {
        "id": str(f.get("id") or new_id())[:60],
        "label": str(f.get("label") or "").strip()[:200] or "Untitled",
        "type": f.get("type") if f.get("type") in ALLOWED_FIELD_TYPES else "text",
        "required": bool(f.get("required", False)),
        "options": list(f.get("options") or []),
        "placeholder": str(f.get("placeholder") or "")[:200],
        "config": cfg,
    }


def _clean_cert_slugs(slugs) -> list[str]:
    """v160.3.0 — Filter an inbound list to only slugs we know about.

    Silent drop is intentional: a payload with `["white_card", "made_up"]`
    persists as `["white_card"]` so the gate can't be fooled by hand-crafted
    JSON. Order is preserved (admins hand-pick the display order in the
    template editor).
    """
    from cert_kinds import ALL_SLUGS
    seen: set[str] = set()
    out: list[str] = []
    for raw in (slugs or []):
        s = str(raw or "").strip().lower()
        if s in ALL_SLUGS and s not in seen:
            seen.add(s)
            out.append(s)
    return out


class TemplateIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    category: str = "general"
    description: Optional[str] = Field(default="", max_length=2000)
    fields: list[dict] = []
    # v160.3.0 — Qualification gating. When non-empty, the mobile client
    # calls `/access-check` before opening the fill screen and blocks
    # if the worker is missing or expired on any listed slug.
    required_certifications: list[str] = Field(default_factory=list)
    # v58.12.13 — Simpro-position gating. When non-empty, the template
    # is ADDITIONALLY visible to callers whose `workers.position` is in
    # the list (OR-gate with the existing role_form_allowlist path in
    # `list_templates`). Legacy templates default to `[]` and behave
    # byte-identically.
    assigned_positions: list[str] = Field(default_factory=list)


class TemplatePatch(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    category: Optional[str] = None
    description: Optional[str] = Field(default=None, max_length=2000)
    fields: Optional[list[dict]] = None
    # v160.3.0 — Allow admins to add / remove cert gates without
    # re-uploading the whole template. Empty list = ungated.
    required_certifications: Optional[list[str]] = None
    # v58.12.13 — See TemplateIn.assigned_positions. Explicit `None` on
    # PATCH = leave unchanged; empty list = clear the gate.
    assigned_positions: Optional[list[str]] = None


class ImportPayload(BaseModel):
    app: Optional[str] = None
    exported_at: Optional[str] = None
    version: Optional[int] = 1
    count: Optional[int] = None
    templates: list[dict]


class SubmissionIn(BaseModel):
    fields: list[dict]
    # Phase 3.8 — when launched from a QR scan, the client stamps the
    # submission with the scan token + source so PDFs / audit exports can
    # attribute it to the asset that started the workflow.
    launched_via: Optional[str] = None  # "scan" | "manual" | None
    source_scan_token: Optional[str] = None
    source_asset_id: Optional[str] = None


@router.get("/fleet/vehicles")
async def list_fleet_for_forms(user: dict = Depends(get_current_user)):
    """Lightweight proxy to the Navixy fleet list — any authenticated user
    (including workers) can list vehicles for use in vehicle_navixy form
    fields. Annotates each vehicle with a derived `vehicle_type` slug used to
    filter the picker by a sibling "Vehicle Type" select."""
    from integrations import navixy_vehicles
    try:
        raw = await navixy_vehicles(tag_ids=None, user=user)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Navixy fleet unavailable: {e}")

    # Load admin overrides once.
    overrides_by_id: dict = {}
    async for row in db.vehicle_categorisation_overrides.find(
        {"org_id": user["org_id"]}, {"_id": 0, "navixy_id": 1, "vehicle_type": 1},
    ):
        try:
            overrides_by_id[int(row["navixy_id"])] = row["vehicle_type"]
        except (TypeError, ValueError):
            pass

    out = []
    for v in raw.get("vehicles", []) or []:
        tag_names = [
            t.get("name") for t in (v.get("tags") or [])
            if isinstance(t, dict) and t.get("name")
        ]
        vt = (
            overrides_by_id.get(v.get("id"))
            or _classify_vehicle_type(v.get("label") or "", tag_names)
        )
        out.append({**v, "vehicle_type": vt, "registration": v.get("plate")})
    return {**raw, "vehicles": out}


# ──────────────── Asset Scan helpers (Phase 2) ────────────────

# asset_type slug → vehicle_type slug surfaced on form `select` Vehicle Type
# fields. Mirror of the keyword classifier above so a scan can resolve to the
# same enum the existing Heavy Vehicle Daily Check expects.
_ASSET_TO_VEHICLE_TYPE = {
    "vacuum_truck": "vacuum_truck", "tipper": "tipper", "dump_truck": "dump_truck",
    "semi_trailer": "semi_trailer", "ute": "ute", "crane_truck": "crane_truck",
    "service_truck": "service_truck", "excavator": "excavator", "loader": "loader",
    "bulldozer": "bulldozer", "grader": "grader", "compactor": "compactor",
    "skid_steer": "skid_steer", "backhoe": "backhoe",
}


@router.get("/assets/lookup")
async def asset_lookup(token: str = Query(min_length=1, max_length=64),
                      user: dict = Depends(get_current_user)):
    """Authed wrapper around the public scan resolver. Same 404/410 semantics
    but adds enrichment (vehicle_type slug, GPS, odo/hours)."""
    doc = await db.assets.find_one(
        {"org_id": user["org_id"], "scan_token": token, "deleted_at": None},
        {"_id": 0},
    )
    if not doc:
        raise HTTPException(404, "Unknown scan token")
    if doc.get("status") == "retired":
        raise HTTPException(410, "Asset has been retired")
    asset_type = doc.get("asset_type") or "other"
    vehicle_type_slug = _ASSET_TO_VEHICLE_TYPE.get(asset_type, asset_type if asset_type in {"other"} else "other")
    return {
        "id": doc.get("id"),
        "name": doc.get("name"),
        "kind": doc.get("kind"),
        "asset_type": asset_type,
        "rego_serial": doc.get("rego_serial"),
        "navixy_device_id": doc.get("navixy_device_id"),
        "last_known_lat": doc.get("last_known_lat"),
        "last_known_lng": doc.get("last_known_lng"),
        "last_known_at": doc.get("last_known_at"),
        "odo_km": doc.get("odo_km"),
        "odo_km_updated_at": doc.get("odo_km_updated_at"),
        "odo_km_source": doc.get("odo_km_source"),
        "hours_meter": doc.get("hours_meter"),
        "hours_meter_updated_at": doc.get("hours_meter_updated_at"),
        "hours_meter_source": doc.get("hours_meter_source"),
        "vehicle_type_slug": vehicle_type_slug,
        "scan_token": doc.get("scan_token"),
    }


@router.get("/assets/picker")
async def asset_picker(q: Optional[str] = Query(None),
                       kind: Optional[str] = Query(None),
                       asset_type: Optional[str] = Query(None),
                       limit: int = Query(50, ge=1, le=200),
                       user: dict = Depends(get_current_user)):
    """Trimmed asset list for the manual-pick fallback inside an asset_scan
    field. Workspace-scoped: only returns assets the user can see."""
    ws_ids = user.get("workspace_ids") or []
    query: dict = {"org_id": user["org_id"], "deleted_at": None, "status": "active"}
    if kind and kind != "any":
        query["kind"] = kind
    if asset_type and asset_type != "any":
        query["asset_type"] = asset_type
    if q:
        rx = re.escape(q.strip())
        query["$or"] = [
            {"name": {"$regex": rx, "$options": "i"}},
            {"rego_serial": {"$regex": rx, "$options": "i"}},
        ]
    # Show workspace-scoped manual assets + org-wide Navixy-tracked vehicles.
    query["$and"] = [{"$or": [
        {"workspace_id": None},
        {"workspace_id": {"$in": ws_ids}} if ws_ids else {"workspace_id": None},
    ]}]
    rows: list[dict] = []
    fields_proj = {"_id": 0, "id": 1, "name": 1, "kind": 1, "asset_type": 1,
                   "rego_serial": 1, "navixy_device_id": 1, "scan_token": 1}
    async for row in db.assets.find(query, fields_proj).sort("name", 1).limit(limit):
        rows.append(row)
    return {"assets": rows, "returned": len(rows)}


VEHICLE_TYPE_KEYWORDS = [
    # order matters — first match wins
    ("dump truck", "dump_truck"),
    ("tipper", "tipper"),
    ("vacuum", "vacuum_truck"),
    ("vac", "vacuum_truck"),
    ("service truck", "service_truck"),
    # v58.13.125 — widened keywords to shrink the "Uncategorised"
    # bucket from 18 → 5. These match the current 13 mis-slotted
    # `other` rows plus common Paneltec fleet body-types.
    ("gas truck", "service_truck"),
    ("flocon", "service_truck"),
    ("tilt tray", "service_truck"),
    ("carbon / curtain", "service_truck"),
    ("prime mover", "crane_truck"),
    ("bt-50", "ute"),
    ("d/max", "ute"),
    ("d-max", "ute"),
    ("landcruiser", "ute"),
    ("hiace", "ute"),
    ("semi", "semi_trailer"),
    ("trailer", "semi_trailer"),
    ("crane", "crane_truck"),
    ("grader", "grader"),
    ("compactor", "compactor"),
    ("rammer", "compactor"),
    ("bulldozer", "bulldozer"),
    ("dozer", "bulldozer"),
    ("skid steer", "skid_steer"),
    ("backhoe", "backhoe"),
    ("excavator", "excavator"),
    (" exc ", "excavator"),
    ("loader", "loader"),
    ("dmax", "ute"),
    ("hilux", "ute"),
    ("ranger", "ute"),
    ("navara", "ute"),
    ("triton", "ute"),
    ("plumber", "ute"),
]


def _classify_vehicle_type(label: str, tag_names: Optional[list] = None) -> str:
    """Pick a vehicle_type slug from Navixy label + tag names.
    Tags are checked first because operators tend to label vehicles by free-form
    names (e.g. "Industrial - XT02AX", "Cap Recycler") but tag them with the
    function (e.g. "Vac Truck Dumping"). Falls back to label keyword matching."""
    haystacks = []
    for tn in tag_names or []:
        if isinstance(tn, str) and tn.strip():
            haystacks.append(f" {tn.lower()} ")
    haystacks.append(f" {(label or '').lower()} ")
    for hay in haystacks:
        for keyword, slug in VEHICLE_TYPE_KEYWORDS:
            if keyword in hay:
                return slug
    return "other"


class VehicleOverrideIn(BaseModel):
    navixy_id: int
    vehicle_type: str = Field(min_length=1, max_length=50)


@router.post("/fleet/vehicle-overrides")
async def set_vehicle_override(body: VehicleOverrideIn,
                               user: dict = Depends(get_current_user)):
    _require_write(user, action="vehicle_override")
    ts = now_iso()
    await db.vehicle_categorisation_overrides.update_one(
        {"org_id": user["org_id"], "navixy_id": body.navixy_id},
        {"$set": {
            "org_id": user["org_id"], "navixy_id": body.navixy_id,
            "vehicle_type": body.vehicle_type.strip().lower(),
            "updated_at": ts, "updated_by": user["id"],
        }, "$setOnInsert": {"created_at": ts}},
        upsert=True,
    )
    return {"ok": True}


# ──────────────── Templates ────────────────

@router.get("/templates")
async def list_templates(category: Optional[str] = None,
                         for_worker: Optional[str] = None,
                         show_all: bool = False,
                         user: dict = Depends(get_current_user)):
    """List form templates.

    Phase 3.9c — `for_worker` filters templates to the audience visible to
    that worker (universal `kinds:["any"]` + direct/role/company match).
    `for_worker=me` resolves to the calling user's worker record.
    `show_all=true` (admin/manager only) bypasses the filter for the
    "Show all" toolbar toggle in the Forms library.
    """
    q: dict = {"org_id": user["org_id"], "deleted_at": None}
    if category and category != "all":
        q["category"] = _norm_category(category)
    rows = await db.form_templates.find(q, {"_id": 0}).sort("name", 1).to_list(2000)
    # v58.13.132l — NOTE: the previous `if not rows: return []` short-circuit
    # was retired. When `category=='swms'` the form_templates query
    # legitimately returns zero rows and the SWMS bridge below is the only
    # source of results — so we must fall through even on empty rows.
    if not rows and category not in (None, "all", "swms"):
        return []
    # v160.0.13 — Per-role form allowlist. Workers/foremen only see the
    # templates enabled for their role in `org_settings.role_form_allowlist`.
    # Admins bypass entirely so they can curate for other roles. Missing
    # entry = backwards-compat "all enabled".
    # v58.12.13 — Additive OR-gate: template ALSO admitted if the
    # caller's `workers.position` is in `template.assigned_positions`.
    # Non-Simpro admins bypass the gate (via `caller_role in
    # {admin, owner}`) and never hit the position lookup.
    caller_role = (user.get("role") or "").lower()
    if caller_role not in ("admin", "owner") and not show_all:
        org = await db.orgs.find_one({"id": user["org_id"]}, {"_id": 0, "role_form_allowlist": 1}) or {}
        allowlist = ((org.get("role_form_allowlist") or {}).get(caller_role))
        caller_position: Optional[str] = None
        if user.get("email"):
            _w = await db.workers.find_one(
                {"org_id": user["org_id"], "email": user["email"], "deleted_at": None},
                {"_id": 0, "position": 1},
            )
            caller_position = ((_w or {}).get("position") or None) or None
        # Explicit `None` = no config yet = show all. Explicit list =
        # intersect. Empty list = the admin has hidden everything for
        # this role → position gate can still admit.
        if isinstance(allowlist, list):
            allowed = set(allowlist)
            rows = [
                r for r in rows
                if r["id"] in allowed
                or (caller_position and caller_position in (r.get("assigned_positions") or []))
            ]
    ids = [r["id"] for r in rows]
    counts: dict = {}
    pipeline = [
        {"$match": {"org_id": user["org_id"], "template_id": {"$in": ids},
                    "deleted_at": None}},
        {"$group": {"_id": "$template_id", "n": {"$sum": 1}}},
    ]
    async for c in db.form_submissions.aggregate(pipeline):
        counts[c["_id"]] = c["n"]

    if for_worker and not show_all:
        worker = None
        if for_worker == "me":
            if user.get("email"):
                worker = await db.workers.find_one(
                    {"org_id": user["org_id"], "email": user["email"],
                     "deleted_at": None},
                    {"_id": 0, "id": 1, "role": 1, "simpro_company_id": 1},
                )
        else:
            # Admin/manager can ask about a specific worker.
            if user.get("role") not in {"admin", "manager", "hseq_lead"}:
                raise HTTPException(403, "Only admins can browse another worker's forms")
            worker = await db.workers.find_one(
                {"id": for_worker, "org_id": user["org_id"], "deleted_at": None},
                {"_id": 0, "id": 1, "role": 1, "simpro_company_id": 1},
            )
        from form_assignment_notifier import resolve_forms_for_worker
        resolved = await resolve_forms_for_worker(
            org_id=user["org_id"], worker=worker, asset=None,
        )
        reasons_by_id = {r["template_id"]: r["match_reasons"] for r in resolved}
        rows = [r for r in rows if r["id"] in reasons_by_id]
        base = [
            {**_serialise(r), "submission_count": counts.get(r["id"], 0),
             "match_reasons": reasons_by_id.get(r["id"], [])}
            for r in rows
        ]
        # v58.13.132l — Bridge worker-scoped SWMS into the Forms list.
        swms_rows = await _list_swms_as_form_templates(
            org_id=user["org_id"],
            category=category,
            worker_id=(worker or {}).get("id"),
            admin_bypass=False,
        )
        return base + swms_rows
    # v58.13.132l — SWMS bridge for admin / show_all / no-worker paths.
    #   admin/manager/hseq_lead → all org SWMS (admin_bypass=True).
    #   preview session (type='preview' from mint_preview_user) → also
    #     admin_bypass so previewers see representative SWMS content
    #     without needing a matching worker row keyed by email.
    #   worker without for_worker → resolve their worker record and scope by
    #     applies_to.worker_ids so SWMS shows up in the mobile Forms tab
    #     alongside standard templates (no extra query param needed).
    swms_worker_id: Optional[str] = None
    is_preview = bool(user.get("preview")) or user.get("type") == "preview"
    swms_admin_bypass = (
        caller_role in ("admin", "owner", "manager", "hseq_lead")
        or show_all
        or is_preview
    )
    if not swms_admin_bypass and user.get("email"):
        _sw = await db.workers.find_one(
            {"org_id": user["org_id"], "email": user["email"], "deleted_at": None},
            {"_id": 0, "id": 1},
        )
        swms_worker_id = (_sw or {}).get("id")
    swms_admin = await _list_swms_as_form_templates(
        org_id=user["org_id"],
        category=category,
        worker_id=swms_worker_id,
        admin_bypass=swms_admin_bypass,
    )
    return [{**_serialise(r), "submission_count": counts.get(r["id"], 0)} for r in rows] + swms_admin


# ─────────────── v58.13.132l — SWMS → FormTemplate bridge ───────────────

async def _list_swms_as_form_templates(
    *, org_id: str, category: Optional[str], worker_id: Optional[str], admin_bypass: bool,
) -> list[dict]:
    """Return worker-scoped SWMS docs projected into the FormTemplate shape.

    Contract:
      - Category filter: emit only when `category` is unset, 'all', or 'swms'.
      - Worker scope: if `worker_id` set → filter by
        `applies_to.worker_ids includes worker_id`. If `admin_bypass` → return all
        non-superseded, non-deleted SWMS. Otherwise → return `[]` (a non-admin
        caller without a resolvable worker sees nothing).
      - Never mutates. Reads-only from `db.swms`.
      - Emits `is_swms=True` so the mobile Forms tab routes taps to the existing
        SWMS viewer at `/profile/swms/[id]` instead of the form runner.
    """
    if category and category not in ("all", "swms"):
        return []
    if not admin_bypass and not worker_id:
        return []
    q: dict = {"org_id": org_id, "deleted_at": None,
               "status": {"$ne": "superseded"}}
    out: list[dict] = []
    async for s in db.swms.find(q, {"_id": 0}):
        if not admin_bypass:
            worker_ids = ((s.get("applies_to") or {}).get("worker_ids") or [])
            if worker_id not in worker_ids:
                continue
        out.append({
            "id": s.get("id"),
            "name": (s.get("title") or "Untitled SWMS"),
            "category": "swms",
            "description": (s.get("job_description") or s.get("scope") or ""),
            "fields": [],
            "required_certifications": [],
            "assigned_positions": [],
            "submission_count": 0,
            "is_swms": True,
            "swms_status": s.get("status"),
            "swms_version": s.get("version"),
            "swms_code": s.get("code"),
        })
    out.sort(key=lambda r: (r["name"] or "").lower())
    return out


@router.get("/templates/{template_id}")
async def get_template(template_id: str, user: dict = Depends(get_current_user)):
    row = await db.form_templates.find_one(
        {"id": template_id, "org_id": user["org_id"], "deleted_at": None}, {"_id": 0},
    )
    if not row:
        raise HTTPException(404, "Template not found")
    n = await db.form_submissions.count_documents(
        {"template_id": template_id, "org_id": user["org_id"], "deleted_at": None},
    )
    return {**_serialise(row), "submission_count": n}


# ──────────────── v160.3.0 — Qualification gating ────────────────

# Roles that bypass the gate entirely — they can already write / audit
# everything anyway, so an in-app licence check would just get in the way.
GATE_BYPASS_ROLES: frozenset[str] = frozenset({"admin", "hseq_lead"})


@router.get("/cert-kinds")
async def list_cert_kinds(user: dict = Depends(get_current_user)):
    """v160.3.0 — Canonical cert-kind vocabulary.

    Serves the web admin's template-editor picker + is safe to expose to
    every authenticated caller (no PII, no per-org data). Kept in code
    (`cert_kinds.py`) rather than a DB collection — see module docstring
    for the reasoning.
    """
    from cert_kinds import KINDS
    return [{"slug": k.slug, "label": k.label} for k in KINDS]


@router.get("/templates/{template_id}/access-check")
async def template_access_check(template_id: str,
                                user: dict = Depends(get_current_user)):
    """Decide whether the caller can open this template right now.

    Response shape:
        {
          "ok": bool,
          "mode": "no_gate" | "admin_bypass" | "gated",
          "template_id": str,
          "worker_id": str | None,
          "required": [
            {"slug", "label",
             "status": "valid"|"expiring_soon"|"no_expiry"|"expired"|"missing",
             "expiry_date": str | null}
          ]
        }

    - `no_gate`  — template has no cert requirements → `ok=true`, empty list.
    - `admin_bypass` — caller role in GATE_BYPASS_ROLES → `ok=true`.
      Requirements are still enumerated (with the admin's OWN cert
      status where a worker profile exists) so the web-admin preview
      panel can render the same list the worker will see.
    - `gated` — caller must have a satisfying cert for every slug in
      `required_certifications`. `ok=false` when any slug is missing
      or expired.
    """
    tpl = await db.form_templates.find_one(
        {"id": template_id, "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0, "id": 1, "required_certifications": 1, "name": 1},
    )
    if not tpl:
        raise HTTPException(404, "Template not found")

    from cert_kinds import KIND_LABELS, SATISFYING_STATUSES, summarise_worker_certs

    required = list(tpl.get("required_certifications") or [])
    if not required:
        return {
            "ok": True, "mode": "no_gate",
            "template_id": template_id,
            "worker_id": None,
            "required": [],
        }

    # Resolve the caller's linked worker row + their active certs.
    # v160.3.0 — Mirror the resolution used by `/api/me/worker-profile`
    # (workers.py:382) so a worker with only a `user_id` link (no
    # email) still resolves properly.
    email = (user.get("email") or "").lower()
    query = {
        "org_id": user["org_id"], "deleted_at": None,
        "$or": [{"user_id": user["id"]}] + ([{"email": email}] if email else []),
    }
    worker = await db.workers.find_one(query, {"_id": 0, "id": 1})
    worker_id = worker.get("id") if worker else None
    certs: list[dict] = []
    if worker_id:
        certs = await db.worker_certifications.find(
            {"org_id": user["org_id"], "worker_id": worker_id, "deleted_at": None},
            {"_id": 0, "name": 1, "expiry_date": 1},
        ).to_list(500)
    have = summarise_worker_certs(certs)

    detail = []
    all_satisfied = True
    for slug in required:
        info = have.get(slug)
        if info is None:
            detail.append({
                "slug": slug,
                "label": KIND_LABELS.get(slug, slug),
                "status": "missing",
                "expiry_date": None,
            })
            all_satisfied = False
        else:
            status = info["status"]
            detail.append({
                "slug": slug,
                "label": KIND_LABELS.get(slug, slug),
                "status": status,
                "expiry_date": info.get("expiry_date"),
            })
            if status not in SATISFYING_STATUSES:
                all_satisfied = False

    role = (user.get("role") or "").lower()
    if role in GATE_BYPASS_ROLES:
        return {
            "ok": True, "mode": "admin_bypass",
            "template_id": template_id,
            "worker_id": worker_id,
            "required": detail,
        }
    return {
        "ok": all_satisfied, "mode": "gated",
        "template_id": template_id,
        "worker_id": worker_id,
        "required": detail,
    }


@router.post("/templates", status_code=201)
async def create_template(body: TemplateIn, user: dict = Depends(get_current_user)):
    _require_write(user, action="create")
    doc = {
        "id": new_id(), "org_id": user["org_id"],
        "name": body.name.strip(),
        "category": _norm_category(body.category),
        "description": (body.description or "").strip(),
        "fields": [_clean_field(f) for f in (body.fields or [])],
        # v160.3.0 — Only accept slugs we know. Silently drops unknown
        # entries so a hand-crafted request can't poison the gate.
        "required_certifications": _clean_cert_slugs(body.required_certifications),
        # v58.12.13 — Simpro-position gating. Whitespace-strip + drop
        # blank entries (matches the FE `.filter(Boolean)` derivation).
        "assigned_positions": [p.strip() for p in (body.assigned_positions or []) if p and p.strip()],
        "source": "manual", "imported_at": None,
        "created_by": user["id"],
        "created_at": now_iso(), "updated_at": now_iso(), "deleted_at": None,
    }
    await db.form_templates.insert_one(doc)
    return _serialise(doc)


@router.patch("/templates/{template_id}")
async def update_template(template_id: str, body: TemplatePatch,
                          user: dict = Depends(get_current_user)):
    _require_write(user)
    payload = {k: v for k, v in body.model_dump(exclude_unset=True).items()}
    if not payload:
        raise HTTPException(400, "No fields supplied")
    if "category" in payload:
        payload["category"] = _norm_category(payload["category"])
    if "fields" in payload and payload["fields"] is not None:
        payload["fields"] = [_clean_field(f) for f in payload["fields"]]
    if "required_certifications" in payload and payload["required_certifications"] is not None:
        # v160.3.0 — Same slug allowlist enforced on PATCH.
        payload["required_certifications"] = _clean_cert_slugs(payload["required_certifications"])
    payload["updated_at"] = now_iso()
    row = await db.form_templates.find_one_and_update(
        {"id": template_id, "org_id": user["org_id"], "deleted_at": None},
        {"$set": payload},
        projection={"_id": 0},
        return_document=ReturnDocument.AFTER,
    )
    if not row:
        raise HTTPException(404, "Template not found")
    return _serialise(row)


@router.delete("/templates/{template_id}", status_code=204)
async def delete_template(template_id: str, user: dict = Depends(get_current_user)):
    _require_write(user, action="delete")
    ts = now_iso()
    r = await db.form_templates.update_one(
        {"id": template_id, "org_id": user["org_id"], "deleted_at": None},
        {"$set": {"deleted_at": ts, "updated_at": ts}},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Template not found")
    return None


@router.post("/templates/import")
async def import_templates(body: ImportPayload, user: dict = Depends(get_current_user)):
    _require_write(user, action="import")
    created: list[dict] = []
    skipped: list[dict] = []
    ts = now_iso()
    existing = await db.form_templates.find(
        {"org_id": user["org_id"], "deleted_at": None}, {"_id": 0, "name": 1},
    ).to_list(5000)
    seen = {(r["name"] or "").strip().lower() for r in existing}

    for t in body.templates or []:
        name = str(t.get("name") or "").strip()
        if not name:
            skipped.append({"name": "(unnamed)", "reason": "missing name"})
            continue
        key = name.lower()
        if key in seen:
            skipped.append({"name": name, "reason": "already exists"})
            continue
        seen.add(key)
        doc = {
            "id": new_id(), "org_id": user["org_id"],
            "name": name,
            "category": _norm_category(t.get("category") or "general"),
            "description": str(t.get("description") or "").strip(),
            "fields": [_clean_field(f) for f in (t.get("fields") or [])],
            "source": "imported",
            "imported_at": ts,
            "created_by": user["id"],
            "created_at": ts, "updated_at": ts, "deleted_at": None,
        }
        await db.form_templates.insert_one(doc)
        created.append({"id": doc["id"], "name": name})
    return {"ok": True, "created": len(created), "created_items": created,
            "skipped": skipped}


# ──────────────── AI template generation ────────────────

class AiGenerateIn(BaseModel):
    prompt: str = Field(min_length=10, max_length=4000)
    category: Optional[str] = "general"


AI_FORM_SYSTEM = """You are an expert Australian WHS (Work Health & Safety) consultant for civil construction.

You design DIGITAL FORM TEMPLATES for safety, inspection, toolbox, near-miss and permit workflows.

Given a plain-English description, output STRICT JSON describing a fillable form template.

You MUST respond with ONLY a JSON object — no prose, no markdown fences, no explanations.

The JSON schema is exactly:
{
  "name": "<short clear template name, max 80 chars>",
  "description": "<one-sentence description, max 200 chars>",
  "category": "<one of: incident|inspection|toolbox|near_miss|general>",
  "fields": [
    {
      "id": "f1",
      "label": "<field label>",
      "type": "<one of: text|textarea|date|number|select|radio|photo|signature|gps>",
      "required": true|false,
      "options": ["<option1>", "<option2>"],
      "placeholder": "<optional hint, only for text/textarea/number>"
    }
  ]
}

Rules:
- Use sequential field ids: f1, f2, f3, ...
- "options" is REQUIRED for select/radio, omit otherwise (or use [])
- For radio fields use 2-4 short options (e.g. ["Yes","No"] or ["Yes","No","N/A"])
- Include 1-2 "photo" fields for visible-condition forms
- Include exactly 1 "signature" field as the last field for any sign-off form
- Include 1 "gps" field for site-specific forms
- Always include a "date" field as the first or second field
- 6 to 20 fields total
- Use Australian English (e.g. "tyres", "kerb", "Hi-Vis")
"""


@router.post("/templates/ai-generate", status_code=201)
async def ai_generate_template(body: AiGenerateIn, user: dict = Depends(get_current_user)):
    """Generate a draft form template from a natural-language prompt using Claude Sonnet 4.5.
    The generated template is persisted with source='ai' and returned for the
    user to refine."""
    _require_write(user, action="create")
    from ai import _claude_json  # reuse existing emergent-integrations helper
    requested_category = _norm_category(body.category or "general")
    user_text = (
        f"Build a form template for the following requirement.\n\n"
        f"Requirement: {body.prompt.strip()}\n\n"
        f"Suggested category (use unless clearly wrong): {requested_category}\n"
    )
    raw = await _claude_json(AI_FORM_SYSTEM, user_text)

    # Validate + sanitise the response into our model.
    name = str(raw.get("name") or "").strip()[:200]
    if not name:
        raise HTTPException(503, "AI did not return a usable template name")
    description = str(raw.get("description") or "").strip()[:2000]
    category = _norm_category(raw.get("category") or requested_category)
    raw_fields = raw.get("fields")
    if not isinstance(raw_fields, list) or not raw_fields:
        raise HTTPException(503, "AI did not return any fields")
    fields = [_clean_field(f) for f in raw_fields[:50]]

    # Dedupe name within org by appending a suffix.
    existing = await db.form_templates.find_one(
        {"org_id": user["org_id"], "deleted_at": None, "name": name}, {"_id": 1},
    )
    if existing:
        name = f"{name} (AI draft)"

    ts = now_iso()
    doc = {
        "id": new_id(), "org_id": user["org_id"],
        "name": name, "category": category, "description": description,
        "fields": fields,
        "source": "ai",
        "imported_at": None,
        "created_by": user["id"],
        "created_at": ts, "updated_at": ts, "deleted_at": None,
    }
    await db.form_templates.insert_one(doc)
    return {**_serialise(doc), "submission_count": 0}


# ──────────────── Submissions ────────────────

def _submission_status(template_fields: list, fields: list) -> str:
    """Complete if every required, non-binary field has a non-empty value.
    Photo/signature/GPS fields are considered complete when value is present.
    """
    by_id = {f.get("id"): f for f in fields}
    for tf in template_fields or []:
        if not tf.get("required"):
            continue
        sf = by_id.get(tf["id"]) or {}
        v = sf.get("value")
        if tf.get("type") in {"photo", "signature", "gps"}:
            if not v:
                return "draft"
            if isinstance(v, list) and len(v) == 0:
                return "draft"
        else:
            if v in (None, ""):
                return "draft"
            if isinstance(v, str) and not v.strip():
                return "draft"
    return "complete"


def _field_summary(fields: list) -> dict:
    out = {"photo_count": 0, "has_signature": False, "has_gps": False}
    for f in fields or []:
        t = f.get("type")
        v = f.get("value")
        if t == "photo" and isinstance(v, list):
            out["photo_count"] += len(v)
        if t == "signature" and v:
            out["has_signature"] = True
        if t == "gps" and v:
            out["has_gps"] = True
    return out


@router.get("/templates/{template_id}/submissions")
async def list_submissions(template_id: str, user: dict = Depends(get_current_user)):
    template = await db.form_templates.find_one(
        {"id": template_id, "org_id": user["org_id"], "deleted_at": None}, {"_id": 0},
    )
    if not template:
        raise HTTPException(404, "Template not found")
    # v160.0.8 — non-privileged callers (worker/contractor) only see their
    # own submissions. Supervisors get everything (team_view). Prevents
    # a worker from enumerating colleagues' completed forms via the
    # `?template_id=` query.
    q: dict = {"template_id": template_id, "org_id": user["org_id"], "deleted_at": None}
    role_key = (user.get("role") or "").lower()
    if role_key not in {"admin", "hseq_lead", "supervisor", "auditor"}:
        q["submitted_by"] = user["id"]
    rows = await db.form_submissions.find(q, {"_id": 0}).sort("submitted_at", -1).to_list(2000)
    out = []
    for r in rows:
        out.append({
            **_serialise(r),
            "status": _submission_status(template.get("fields") or [], r.get("fields") or []),
            **_field_summary(r.get("fields") or []),
        })
    return out


@router.post("/templates/{template_id}/submissions", status_code=201)
async def create_submission(template_id: str, body: SubmissionIn,
                            user: dict = Depends(get_current_user)):
    template = await db.form_templates.find_one(
        {"id": template_id, "org_id": user["org_id"], "deleted_at": None}, {"_id": 0},
    )
    if not template:
        raise HTTPException(404, "Template not found")
    # Snapshot the template fields by id so each answer keeps `{id, label,
    # type, value, config?}` even if the template is later edited. The client
    # may send the field metadata, but we always overwrite from the template
    # snapshot — this is the authoritative source for downstream PDF/exports.
    tpl_field_by_id = {f.get("id"): f for f in (template.get("fields") or []) if f.get("id")}
    cleaned: list[dict] = []
    for f in body.fields or []:
        fid = str(f.get("id") or "")
        tpl_field = tpl_field_by_id.get(fid) or {}
        # Prefer template-snapshot label/type/config; fall back to whatever the
        # client supplied (handles ad-hoc fields submitted before the template
        # caught up).
        label = str(tpl_field.get("label") or f.get("label") or "")
        type_raw = tpl_field.get("type") or f.get("type") or "text"
        t = type_raw if type_raw in ALLOWED_FIELD_TYPES else "text"
        cfg = tpl_field.get("config") or f.get("config") or {}
        if not isinstance(cfg, dict):
            cfg = {}
        v: Any = f.get("value")
        # v58.12.0 — reference_matrix is template-embedded read-only
        # guidance. It never contributes a value to the submission; we
        # drop any client-sent value and record an empty payload.
        if t == "reference_matrix":
            v = None
        # v58.12.0 — attachment arrays start empty; files land via
        # POST /submissions/{id}/attachments (same pattern as photos).
        elif t == "attachment":
            if v is None:
                v = []
            elif not isinstance(v, list):
                v = []
        # v58.12.0 — actions: repeatable follow-up rows. Server stamps
        # `id` (act_<uuid4>) on new rows, freezes `actionee_name` from
        # the workers directory (v58.11.2), enforces the Closed→date
        # invariant, and records updated_by/updated_at.
        elif t == "actions":
            v = await _normalise_actions_value(v, user)
        # Photo arrays may be empty at submit-time; they get filled by the
        # subsequent /photos endpoint. Signature is base64 PNG. GPS is a dict.
        elif t == "photo":
            if v is None:
                v = []
            elif not isinstance(v, list):
                v = []
        entry: dict[str, Any] = {
            "id": fid,
            "label": label,
            "type": t,
            "value": v,
        }
        if cfg:
            entry["config"] = cfg
        cleaned.append(entry)
    doc = {
        "id": new_id(), "org_id": user["org_id"],
        "template_id": template_id,
        "template_name_snapshot": template["name"],
        # v58.13.132dz — Route category via `form_routing_rules` first,
        # then fall back to the template's declared `category`. This
        # lets admins re-target a template (e.g. SSRA → Risk
        # Assessments) without editing the template row itself.
        "template_category_snapshot": await resolve_template_category(template),
        "fields": cleaned,
        "submitted_by": user["id"],
        "submitted_by_name": user.get("name") or user.get("email"),
        "submitted_at": now_iso(),
        "deleted_at": None,
    }
    # Phase 3.8 — attach scan provenance when present. We trust the client's
    # token because the actual asset access check happens at scan-time
    # (`/api/scan/{token}/forms`) and at quick-action time. The token is just
    # an attribution marker on the resulting record.
    if body.launched_via:
        doc["launched_via"] = body.launched_via
    if body.source_scan_token:
        doc["source_scan_token"] = body.source_scan_token
    if body.source_asset_id:
        doc["source_asset_id"] = body.source_asset_id
    await db.form_submissions.insert_one(doc)
    return _serialise(doc)


@router.get("/submissions/{submission_id}")
async def get_submission(submission_id: str, user: dict = Depends(get_current_user)):
    row = await db.form_submissions.find_one(
        {"id": submission_id, "org_id": user["org_id"], "deleted_at": None}, {"_id": 0},
    )
    if not row:
        raise HTTPException(404, "Submission not found")
    template = await db.form_templates.find_one(
        {"id": row["template_id"], "org_id": user["org_id"]}, {"_id": 0},
    )
    return {
        **_serialise(row),
        "template": _serialise(template) if template else None,
        "status": _submission_status((template or {}).get("fields") or [], row.get("fields") or []),
        **_field_summary(row.get("fields") or []),
    }


@router.delete("/submissions/{submission_id}", status_code=204)
async def delete_submission(submission_id: str, user: dict = Depends(get_current_user)):
    # Allow the original submitter OR admin/hseq_lead to delete.
    row = await db.form_submissions.find_one(
        {"id": submission_id, "org_id": user["org_id"], "deleted_at": None}, {"_id": 0},
    )
    if not row:
        raise HTTPException(404, "Submission not found")
    if user.get("role") not in WRITE_ROLES and row.get("submitted_by") != user["id"]:
        raise HTTPException(403, "Permission denied: forms.delete")
    ts = now_iso()
    await db.form_submissions.update_one(
        {"id": submission_id, "org_id": user["org_id"]},
        {"$set": {"deleted_at": ts}},
    )
    return None


# v58.12.0 — Actions field: normalise a submitted `value` list of
# rows. Server-stamps id (act_<uuid4>) on rows without one, freezes
# actionee_name from the workers directory, enforces the Closed→
# date_closed invariant, and records updated_by/updated_at. Rejects
# with 422 on any invalid row so a bad submission never lands.
_ACTION_STATUS_ENUM = {"Open", "In Progress", "Closed", "On Hold"}


async def _normalise_actions_value(v: Any, user: dict) -> list:
    if v is None:
        return []
    if not isinstance(v, list):
        raise HTTPException(422, "actions.value must be a list of rows")
    workers_by_id: dict = {}
    if v:
        # Resolve actionee names in one pass to freeze on-write.
        ids = [str(r.get("actionee_id") or "") for r in v if isinstance(r, dict) and r.get("actionee_id")]
        if ids:
            cursor = db.workers.find(
                {"org_id": user["org_id"], "id": {"$in": list(set(ids))}, "deleted_at": None},
                {"_id": 0, "id": 1, "first_name": 1, "last_name": 1},
            )
            async for w in cursor:
                nm = f"{w.get('first_name') or ''} {w.get('last_name') or ''}".strip()
                workers_by_id[w["id"]] = nm
    now = now_iso()
    out: list = []
    for i, r in enumerate(v):
        if not isinstance(r, dict):
            raise HTTPException(422, f"actions[{i}] must be an object")
        status = str(r.get("status") or "Open")
        if status not in _ACTION_STATUS_ENUM:
            raise HTTPException(422, f"actions[{i}].status must be one of {sorted(_ACTION_STATUS_ENUM)}")
        date_closed = r.get("date_closed") or None
        if status == "Closed" and not date_closed:
            raise HTTPException(422, f"actions[{i}] status=Closed requires date_closed")
        row_id = str(r.get("id") or "")
        if not row_id.startswith("act_"):
            row_id = f"act_{uuid.uuid4()}"
        actionee_id = str(r.get("actionee_id") or "") or None
        actionee_name = workers_by_id.get(actionee_id) if actionee_id else None
        # Fall back to any client-supplied name (contractor / off-roster)
        # if the id didn't resolve.
        if actionee_id and not actionee_name:
            actionee_name = str(r.get("actionee_name") or "").strip() or None
        elif not actionee_id:
            actionee_name = str(r.get("actionee_name") or "").strip() or None
        out.append({
            "id": row_id,
            "first_name": str(r.get("first_name") or "").strip()[:100],
            "last_name": str(r.get("last_name") or "").strip()[:100],
            "actionee_id": actionee_id,
            "actionee_name": actionee_name,
            "due_date": r.get("due_date") or None,
            "date_closed": date_closed,
            "description": str(r.get("description") or "")[:2000],
            "status": status,
            "last_comment": str(r.get("last_comment") or "")[:2000],
            "created_at": r.get("created_at") or now,
            "updated_at": now,
            "updated_by": user.get("id"),
        })
    return out


# v58.12.0 — Multi-file attachment upload for BYDA + other forms that
# need document evidence (not just photos). Mirrors the photo upload
# pattern: multipart, disk-backed, org-gated, appended to the target
# field's value array atomically. Storage layout:
#   uploads/form_attachments/{submission_id}/{stored_uuid}
# Stored filename is a UUID so a malicious `original.pdf/../../etc`
# can't traverse. Original name is preserved on the record only for
# display.
@router.post("/submissions/{submission_id}/attachments", status_code=201)
async def upload_submission_attachments(
    submission_id: str,
    field_id: str = Form(...),
    files: list[UploadFile] = File(...),
    names: list[str] = Form(default=[]),
    descriptions: list[str] = Form(default=[]),
    user: dict = Depends(get_current_user),
):
    sub = await db.form_submissions.find_one(
        {"id": submission_id, "org_id": user["org_id"], "deleted_at": None}, {"_id": 0},
    )
    if not sub:
        raise HTTPException(404, "Submission not found")
    target = next((f for f in (sub.get("fields") or []) if f.get("id") == field_id), None)
    if not target:
        raise HTTPException(404, "Field not found on submission")
    if target.get("type") != "attachment":
        raise HTTPException(400, "Field is not an attachment field")
    saved: list = []
    dest_dir = ATTACHMENT_ROOT / submission_id
    dest_dir.mkdir(parents=True, exist_ok=True)
    now = now_iso()
    for i, upload in enumerate(files):
        mime = (upload.content_type or "").lower()
        if mime not in ATTACHMENT_ALLOWED_MIMES:
            raise HTTPException(415, f"MIME '{mime}' not allowed")
        data = await upload.read()
        if len(data) > MAX_ATTACHMENT_BYTES:
            raise HTTPException(413, f"File exceeds {MAX_ATTACHMENT_BYTES} bytes")
        stored_name = f"{uuid.uuid4()}"
        dest = dest_dir / stored_name
        dest.write_bytes(data)
        display_name = (names[i] if i < len(names) else "") or upload.filename or stored_name
        description = descriptions[i] if i < len(descriptions) else ""
        rec = {
            "file_id": stored_name,
            "stored_name": stored_name,
            "name": str(display_name)[:255],
            "description": str(description)[:2000],
            "mime": mime,
            "size": len(data),
            "url": f"/api/forms/submissions/{submission_id}/attachments/{stored_name}",
            "uploaded_by": user.get("id"),
            "uploaded_at": now,
            "deleted_at": None,
        }
        saved.append(rec)
    await db.form_submissions.update_one(
        {"id": submission_id, "fields.id": field_id},
        {"$push": {"fields.$.value": {"$each": saved}}, "$set": {"updated_at": now}},
    )
    return {"attachments": saved}


@router.get("/submissions/{submission_id}/attachments/{stored_name}")
async def serve_submission_attachment(submission_id: str, stored_name: str,
                                       # v58.13.51 — Default to INLINE. See
                                       # note on `serve_schedule_attachment`.
                                       download: int = Query(0, ge=0, le=1),
                                       user: dict = Depends(get_current_user)):
    sub = await db.form_submissions.find_one(
        {"id": submission_id, "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0, "fields": 1},
    )
    if not sub:
        raise HTTPException(404, "Submission not found")
    # Find the attachment record so we can serve the right MIME + name.
    rec = None
    for f in sub.get("fields") or []:
        if f.get("type") != "attachment":
            continue
        for a in (f.get("value") or []):
            if a.get("stored_name") == stored_name and not a.get("deleted_at"):
                rec = a; break
        if rec:
            break
    if not rec:
        raise HTTPException(404, "Attachment not found")
    path = ATTACHMENT_ROOT / submission_id / stored_name
    if not path.exists():
        raise missing_file_response()
    return FileResponse(str(path), media_type=rec.get("mime") or "application/octet-stream",
                        filename=rec.get("name") or stored_name,
                        content_disposition_type="attachment" if download else "inline")


# ──────────────── Submission photos ────────────────

def _safe_ext(filename: Optional[str]) -> str:
    ext = (Path(filename or "").suffix or "").lower()
    if ext in {".png", ".jpg", ".jpeg", ".webp", ".heic", ".heif"}:
        return ext
    return ""


@router.post("/submissions/{submission_id}/photos", status_code=201)
async def upload_submission_photos(
    submission_id: str,
    field_id: str = Form(...),
    files: List[UploadFile] = File(...),
    user: dict = Depends(get_current_user),
):
    sub = await db.form_submissions.find_one(
        {"id": submission_id, "org_id": user["org_id"], "deleted_at": None}, {"_id": 0},
    )
    if not sub:
        raise HTTPException(404, "Submission not found")
    # Validate the target field exists on this submission and is a photo field.
    target = None
    for f in sub.get("fields") or []:
        if f.get("id") == field_id:
            target = f
            break
    if not target:
        raise HTTPException(400, "Unknown field_id on this submission")
    if target.get("type") != "photo":
        raise HTTPException(400, "Field is not a photo field")

    sub_dir = UPLOAD_ROOT / submission_id
    sub_dir.mkdir(parents=True, exist_ok=True)

    saved: list[dict] = []
    rejected: list[dict] = []
    for upload in files:
        ext = _safe_ext(upload.filename)
        mime = (upload.content_type or "").lower()
        if not ext or (mime and mime not in PHOTO_ALLOWED_MIMES):
            rejected.append({"filename": upload.filename, "reason": "Unsupported image type"})
            continue
        stored_name = f"{uuid.uuid4().hex}{ext}"
        target_path = sub_dir / stored_name
        size = 0
        oversize = False
        with target_path.open("wb") as out:
            while True:
                chunk = await upload.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_PHOTO_BYTES:
                    oversize = True
                    break
                out.write(chunk)
        if oversize:
            target_path.unlink(missing_ok=True)
            rejected.append({"filename": upload.filename, "reason": "Exceeds 15MB limit"})
            continue
        file_url = f"/api/files/form_photos/{submission_id}/{stored_name}"
        photo = {
            "id": new_id(),
            "filename": upload.filename or stored_name,
            "stored_name": stored_name,
            "mime": upload.content_type or "image/jpeg",
            "size": size,
            "file_url": file_url,
            "uploaded_by": user["id"],
            "uploaded_by_name": user.get("name") or user.get("email"),
            "uploaded_at": now_iso(),
        }
        saved.append(photo)

    if saved:
        # Append to the photo field's value array atomically.
        new_value = list(target.get("value") or []) + saved
        await db.form_submissions.update_one(
            {"id": submission_id, "org_id": user["org_id"], "fields.id": field_id},
            {"$set": {"fields.$.value": new_value}},
        )

    return {"saved": saved, "rejected": rejected}


@router.get("/submissions/{submission_id}/photos/{stored_name}")
async def serve_submission_photo(submission_id: str, stored_name: str,
                                 user: dict = Depends(get_current_user)):
    """Authenticated direct fetch. Frontend tends to prefer this anyway via
    axios so the token header is sent. Public file route is also exposed via
    dashboard.py for image tags in PDFs."""
    if "/" in stored_name or "\\" in stored_name or ".." in stored_name:
        raise HTTPException(400, "Invalid filename")
    sub = await db.form_submissions.find_one(
        {"id": submission_id, "org_id": user["org_id"], "deleted_at": None}, {"_id": 1},
    )
    if not sub:
        raise HTTPException(404, "Submission not found")
    path = UPLOAD_ROOT / submission_id / stored_name
    if not path.exists():
        raise HTTPException(404, "Photo not found")
    from fastapi.responses import FileResponse
    return FileResponse(str(path), media_type="image/jpeg")


# ──────────────── PDF generation ────────────────

def _resolve_user_for_pdf(request: Request, token: Optional[str],
                          submission_id: str) -> Any:
    """Return an awaitable that resolves to the authenticated user dict. Supports
    Bearer auth OR a signed pdf-token bound to this submission."""
    if token:
        import jwt
        from auth import JWT_ALGORITHM, _secret
        try:
            payload = jwt.decode(token, _secret(), algorithms=[JWT_ALGORITHM])
        except jwt.ExpiredSignatureError:
            raise HTTPException(401, "PDF token expired",
                                headers={"X-Auth-Reason": "pdf-token-expired"})
        except jwt.InvalidTokenError:
            raise HTTPException(401, "Invalid PDF token",
                                headers={"X-Auth-Reason": "pdf-token-invalid"})
        if payload.get("type") != "pdf-token":
            raise HTTPException(401, "Wrong token type",
                                headers={"X-Auth-Reason": "pdf-token-invalid"})
        if payload.get("resource") != "form_submission" or payload.get("record_id") != submission_id:
            raise HTTPException(403, "Token does not match this submission",
                                headers={"X-Auth-Reason": "pdf-token-mismatch"})

        async def _resolve():
            u = await db.users.find_one({"id": payload["sub"]},
                                         {"_id": 0, "password_hash": 0})
            if not u or u.get("status") == "disabled":
                raise HTTPException(401, "User not found",
                                    headers={"X-Auth-Reason": "pdf-token-invalid"})
            return u
        return _resolve()
    return get_current_user(request, creds=None)


@router.get("/submissions/{submission_id}/pdf")
async def render_submission_pdf(
    submission_id: str, request: Request,
    download: int = Query(0),
    token: Optional[str] = Query(None),
):
    user = await _resolve_user_for_pdf(request, token, submission_id)
    sub = await db.form_submissions.find_one(
        {"id": submission_id, "org_id": user["org_id"], "deleted_at": None}, {"_id": 0},
    )
    if not sub:
        raise HTTPException(404, "Submission not found")
    template = await db.form_templates.find_one(
        {"id": sub["template_id"], "org_id": user["org_id"]}, {"_id": 0},
    )
    from forms_pdf import render_form_submission_pdf
    pdf_bytes = render_form_submission_pdf(sub, template or {})
    name = re.sub(r"[^A-Za-z0-9]+", "-", (sub.get("template_name_snapshot") or "form")).strip("-").lower()
    fname = f"{name}-{(sub.get('submitted_at') or '')[:10]}.pdf"
    disp = "attachment" if download else "inline"
    return Response(
        content=pdf_bytes, media_type="application/pdf",
        headers={"Content-Disposition": f'{disp}; filename="{fname}"'},
    )


# ---- Mint a pdf-token for a form_submission (so PdfActions popup works) ----

class FormPdfTokenIn(BaseModel):
    submission_id: str
    action: str = Field(default="view", pattern="^(view|download)$")


@router.post("/submissions/pdf-token")
async def mint_form_pdf_token(body: FormPdfTokenIn, request: Request,
                              user: dict = Depends(get_current_user)):
    sub = await db.form_submissions.find_one(
        {"id": body.submission_id, "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0, "id": 1},
    )
    if not sub:
        raise HTTPException(404, "Submission not found")
    import jwt
    from datetime import datetime, timezone, timedelta
    from auth import JWT_ALGORITHM, _secret
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user["id"], "org_id": user["org_id"],
        "resource": "form_submission", "record_id": body.submission_id,
        "action": body.action,
        "exp": now + timedelta(seconds=90), "iat": now, "type": "pdf-token",
    }
    token = jwt.encode(payload, _secret(), algorithm=JWT_ALGORITHM)
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    host = (request.headers.get("x-forwarded-host") or request.headers.get("host")
            or request.url.netloc)
    path = f"/api/forms/submissions/{body.submission_id}/pdf?token={token}"
    if body.action == "download":
        path += "&download=1"
    return {"token": token, "url": f"{proto}://{host}{path}", "path": path,
            "expires_in": 90}

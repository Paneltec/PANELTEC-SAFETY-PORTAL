"""Phase 3 — Service & Maintenance for Plant & Vehicles.

Schedule rules (hours / km / calendar) per asset, completed service-record
ledger, defect → hazard auto-link (workspace-configurable), and a reminder
scanner that fans out via the existing M365 + TextMagic plumbing.
"""
from __future__ import annotations
import logging
import shutil
import uuid
import bleach  # v58.13.0-a — server-side rich-text sanitiser (already in requirements)
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from auth import get_current_user
from db import db
from models import new_id, now_iso

# v58.13.14 — Schedule attachment storage.
# Filesystem-backed, mirroring the `form_submissions` pattern
# established at `forms.py:113` (`uploads/form_attachments/…`). GridFS
# is used elsewhere in the repo (workers.py, backup_service.py) but
# `form_submissions` — the pattern explicitly named in the ship brief
# as "REUSE the exact same helper/utility" — writes to local disk
# under `backend/uploads/form_attachments/{submission_id}/{stored_uuid}`.
# We follow suit under `schedule_attachments/{sid}/{stored_uuid}`, so
# ops muscle-memory (backup routes, disk-usage dashboards, path
# invariants) applies identically.
#
# MIME / size caps duplicated from forms.py rather than imported to
# avoid a cyclic-import risk if forms.py ever needs to reference
# asset_service. Same values as v58.11.0 forms.py.
SCHEDULE_ATTACHMENT_ROOT = (
    Path(__file__).parent / "uploads" / "schedule_attachments"
)
SCHEDULE_ATTACHMENT_ROOT.mkdir(parents=True, exist_ok=True)
SCHEDULE_ATTACHMENT_ALLOWED_MIMES = {
    "application/pdf", "image/png", "image/jpeg", "image/webp",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/csv", "text/plain",
}
MAX_SCHEDULE_ATTACHMENT_BYTES = 25 * 1024 * 1024

log = logging.getLogger("paneltec.assets.service")

router = APIRouter(prefix="/assets", tags=["asset-service"])
scan_router = APIRouter(prefix="/scan", tags=["asset-scan-action"])

IntervalKind = Literal["hours", "km", "calendar"]
CalendarUnit = Literal["days", "weeks", "months", "years"]
RecordType = Literal["service", "defect", "meter_update"]
DefectSeverity = Literal["minor", "major", "critical"]
# v58.13.0-a — Periodic Task Template rollout. Enums for the new fields
# on ScheduleIn (see below). Kept module-level so tests + FE can consume
# via the openapi spec.
Priority = Literal["Low", "Medium", "High", "Urgent"]
TaskType = Literal["Installation", "Repair", "Maintenance", "Inspection", "Service", "Other"]

# v58.13.0-a — Rich-text sanitiser allowlist. Conservative: block tags
# (p/br/h1-h6/lists/formatting) + one attribute (href on <a>). Any
# `<script>`, `<iframe>`, event handlers, or unknown tags are stripped
# with `strip=True`. Matches the bleach usage pattern in email_outbox.
_HTML_ALLOWED_TAGS = ["p", "br", "b", "strong", "i", "em", "u",
                       "ul", "ol", "li", "a", "h1", "h2", "h3", "h4"]
_HTML_ALLOWED_ATTRS = {"a": ["href", "title", "rel"]}


def _sanitize_description_html(v: Optional[str]) -> Optional[str]:
    """v58.13.0-a — bleach.clean wrapper. `None` → `None` (PATCH-omit
    friendly). Empty string → empty string (explicit clear)."""
    if v is None:
        return None
    return bleach.clean(v, tags=_HTML_ALLOWED_TAGS,
                        attributes=_HTML_ALLOWED_ATTRS, strip=True)


# ────────────────── helpers ──────────────────

def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _parse_iso(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


def _add_calendar(when: datetime, value: int, unit: str) -> datetime:
    if unit == "days":   return when + timedelta(days=value)
    if unit == "weeks":  return when + timedelta(weeks=value)
    if unit == "months": return when + timedelta(days=value * 30)
    if unit == "years":  return when + timedelta(days=value * 365)
    return when + timedelta(days=value)


async def _get_asset(asset_id: str, org_id: str) -> dict:
    doc = await db.assets.find_one({"org_id": org_id, "id": asset_id, "deleted_at": None})
    if not doc:
        raise HTTPException(404, "Asset not found")
    return doc


def _worst_status(a: str, b: str) -> str:
    rank = {"overdue": 2, "due_soon": 1, "ok": 0}
    return a if rank.get(a, 0) >= rank.get(b, 0) else b


def _compute_axis_due(asset: dict, *, kind: str, interval: float,
                      last_v: Optional[float], last_at: Optional[Any],
                      calendar_unit: Optional[str],
                      lead_days: int, lead_hours: float, lead_km: float) -> dict:
    """v58.12.6 — Project one axis (hours / km / calendar) → next-due.
    Returns {next_value, next_at, status}. Either next_value or next_at
    may be None depending on the axis kind (hours/km yield a numeric,
    calendar yields a datetime)."""
    out = {"next_value": None, "next_at": None, "status": "ok"}
    if kind == "hours":
        base = float(last_v) if last_v is not None else 0.0
        next_v = base + interval
        cur = float(asset.get("hours_meter") or 0)
        out["next_value"] = next_v
        if cur >= next_v:
            out["status"] = "overdue"
        elif cur >= next_v - lead_hours:
            out["status"] = "due_soon"
    elif kind == "km":
        base = float(last_v) if last_v is not None else 0.0
        next_v = base + interval
        cur = float(asset.get("odo_km") or 0)
        out["next_value"] = next_v
        if cur >= next_v:
            out["status"] = "overdue"
        elif cur >= next_v - lead_km:
            out["status"] = "due_soon"
    elif kind == "calendar":
        unit = calendar_unit or "days"
        anchor = last_at or _utcnow()
        nxt = _add_calendar(anchor, int(interval), unit)
        out["next_at"] = nxt.isoformat()
        now = _utcnow()
        if now >= nxt:
            out["status"] = "overdue"
        elif now >= nxt - timedelta(days=lead_days):
            out["status"] = "due_soon"
    return out


def _compute_next_due(sched: dict, asset: dict) -> dict:
    """Return {next_due_value, next_due_at, next_due_at_primary,
    next_due_at_secondary, next_due_value_secondary, status}.

    v58.12.6 — dual-track (D-2): if `sched.secondary_interval` is present,
    the secondary axis is projected too and `next_due_at` becomes
    min(primary.next_at, secondary.next_at) (None-safe). `next_due_value`
    always reflects the PRIMARY axis's numeric next (unchanged pre-v58.12.6
    UI meaning); the secondary axis's numeric next lives on
    `next_due_value_secondary`. Reminder cron continues to query
    `next_due_at` unchanged."""
    kind = sched["interval_kind"]
    interval = float(sched.get("interval_value") or 0)
    last_v = sched.get("last_done_value")
    last_at = _parse_iso(sched.get("last_done_at")) if isinstance(sched.get("last_done_at"), str) else sched.get("last_done_at")
    lead_days = int(sched.get("reminder_lead_days") or 7)
    lead_hours = float(sched.get("reminder_lead_hours") or max(interval * 0.05, 5))
    lead_km = float(sched.get("reminder_lead_km") or max(interval * 0.05, 100))

    primary = _compute_axis_due(
        asset, kind=kind, interval=interval, last_v=last_v, last_at=last_at,
        calendar_unit=sched.get("calendar_unit"),
        lead_days=lead_days, lead_hours=lead_hours, lead_km=lead_km,
    )

    sec_cfg = sched.get("secondary_interval")
    secondary = None
    if sec_cfg:
        sec_interval = float(sec_cfg.get("value") or 0)
        sec_last_v = sec_cfg.get("last_done_value")
        sec_last_at = _parse_iso(sec_cfg.get("last_done_at")) if isinstance(sec_cfg.get("last_done_at"), str) else sec_cfg.get("last_done_at")
        sec_lead = sec_cfg.get("reminder_lead")
        secondary = _compute_axis_due(
            asset, kind=sec_cfg.get("kind"), interval=sec_interval,
            last_v=sec_last_v, last_at=sec_last_at,
            calendar_unit=sec_cfg.get("calendar_unit"),
            # Route the single `reminder_lead` field to the axis it matches;
            # falls back to primary's lead for the other two axes (irrelevant).
            lead_days=int(sec_lead) if sec_cfg.get("kind") == "calendar" and sec_lead is not None else lead_days,
            lead_hours=float(sec_lead) if sec_cfg.get("kind") == "hours" and sec_lead is not None else lead_hours,
            lead_km=float(sec_lead) if sec_cfg.get("kind") == "km" and sec_lead is not None else lead_km,
        )

    # Merge — None-safe min for next_due_at across the two axes.
    p_at, s_at = primary.get("next_at"), (secondary or {}).get("next_at")
    merged_at = p_at if s_at is None else (s_at if p_at is None else min(p_at, s_at))
    status = primary["status"] if secondary is None else _worst_status(primary["status"], secondary["status"])
    return {
        "next_due_value": primary["next_value"],
        "next_due_at": merged_at,
        "next_due_at_primary": primary["next_at"],
        "next_due_at_secondary": (secondary or {}).get("next_at"),
        "next_due_value_secondary": (secondary or {}).get("next_value"),
        "status": status,
    }


async def _recompute_and_save(sched: dict, asset: dict) -> dict:
    nd = _compute_next_due(sched, asset)
    await db.asset_service_schedules.update_one(
        {"id": sched["id"]},
        {"$set": {
            "next_due_value": nd["next_due_value"],
            "next_due_at": nd["next_due_at"],
            # v58.12.6 — dual-track materialisation.
            "next_due_at_primary": nd["next_due_at_primary"],
            "next_due_at_secondary": nd["next_due_at_secondary"],
            "next_due_value_secondary": nd["next_due_value_secondary"],
            "status_cached": nd["status"],
            "updated_at": now_iso(),
        }},
    )
    return {**sched, **nd, "status_cached": nd["status"]}


# ────────────────── models ──────────────────

class SecondaryInterval(BaseModel):
    """v58.12.6 — Optional second axis on a schedule. Same shape as the
    primary interval fields but scoped so we can materialise the second
    projection independently. `reminder_lead` is a single per-axis value
    — days for calendar, hours for hours, km for km."""
    kind: IntervalKind
    value: int = Field(ge=1, le=1_000_000)
    calendar_unit: Optional[CalendarUnit] = None
    last_done_at: Optional[str] = None
    last_done_value: Optional[float] = None
    reminder_lead: Optional[float] = None


def _validate_secondary(interval_kind: str, secondary: Optional[SecondaryInterval], asset: dict) -> None:
    """v58.12.6 — Cross-field validation for the D-2 dual-track model.
    Same-kind rejection guarantees the two axes track DIFFERENT
    dimensions; asset-reading rejection guarantees the projection can
    actually be computed."""
    if secondary is None:
        return
    if secondary.kind == interval_kind:
        raise HTTPException(422, "Primary and secondary intervals must track different dimensions.")
    if secondary.kind == "calendar" and not secondary.calendar_unit:
        raise HTTPException(422, "calendar_unit is required when secondary_interval.kind is 'calendar'.")
    if secondary.kind == "hours" and asset.get("hours_meter") is None:
        raise HTTPException(422, "Asset has no hours_meter reading (not linked to Navixy).")
    if secondary.kind == "km" and asset.get("odo_km") is None:
        raise HTTPException(422, "Asset has no odo_km reading (not linked to Navixy).")


class ScheduleIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    interval_kind: IntervalKind
    interval_value: int = Field(ge=1, le=1_000_000)
    calendar_unit: Optional[CalendarUnit] = None
    last_done_at: Optional[str] = None
    last_done_value: Optional[float] = None
    reminder_lead_days: int = Field(default=7, ge=0, le=365)
    reminder_lead_hours: Optional[float] = None
    reminder_lead_km: Optional[float] = None
    status: Literal["active", "paused", "archived"] = "active"
    # v58.12.6 — dual-track (D-2). Optional; absent → schedule behaves
    # exactly as pre-v58.12.6. Existing docs parse cleanly (no field →
    # None default). See `_validate_secondary` for cross-field rules.
    secondary_interval: Optional[SecondaryInterval] = None
    # v58.13.0-a — Periodic Task Template rollout. Five user-facing
    # fields (all optional; legacy schedules parse identically). Two
    # auto-stamped fields (entered_by_user_id / entered_by_name) are
    # NOT on this model — they're set by the create_schedule handler
    # from `current_user` and preserved verbatim on update.
    priority: Optional[Priority] = None
    task_type: Optional[TaskType] = None
    task_identification: Optional[str] = Field(default=None, max_length=200)
    description_html: Optional[str] = Field(default=None, max_length=100_000)
    assigned_to_position: Optional[str] = Field(default=None, max_length=120)
    # v58.13.0-b (shipped v58.13.11) — Periodic Task Template Phase B.
    # Six user-facing fields added alongside Phase A. All optional;
    # legacy schedules parse identically. Server-side handlers need
    # zero change — `**payload` splat in create_schedule /
    # update_schedule already pipes every Pydantic field through.
    #
    # `assigned_to_worker_*` captures the resolved worker (id + name)
    # from the FE dropdown that filters `/workers/directory` by the
    # Phase A `assigned_to_position`. Denormalised name follows the
    # same pattern as `entered_by_name` / `technician_name` —
    # snapshot-at-write so display doesn't need a per-row lookup and
    # audit shows the worker as they were at scheduling time.
    #
    # `attachments` accepts BydaFields-shape metadata rows
    # (`{name, description, mime, size, ...}`). No server-side
    # binary upload endpoint exists yet for schedules — the FE
    # therefore renders NO drag-and-drop control in v58.13.11.
    # This field is defined here so a follow-up ticket
    # (`v58.13.11-b`) can add `POST /assets/{id}/schedules/{sid}
    # /attachments` + wire the existing `AttachmentField` without
    # any schema migration.
    phone: Optional[str] = Field(default=None, max_length=64)
    reported_by_contact: Optional[str] = Field(default=None, max_length=200)
    project_id: Optional[str] = Field(default=None, max_length=200)
    assigned_to_worker_id: Optional[str] = Field(default=None, max_length=64)
    assigned_to_worker_name: Optional[str] = Field(default=None, max_length=200)
    notes: Optional[str] = Field(default=None, max_length=10_000)
    attachments: Optional[list[dict[str, Any]]] = None
    # v58.13.23 — Contract dates. All optional ISO date strings from
    # the FE `<input type="date">` (YYYY-MM-DD). Legacy schedules
    # parse identically (no field → None default). No validator
    # beyond `max_length=32` — matches the `last_done_at` pattern.
    # These are informational only: no cron / reminder / status
    # logic reads them yet. Preview badge on the FE tile shows
    # traffic-light status derived from `contract_expiry`.
    contract_cust_on: Optional[str] = Field(default=None, max_length=32)
    contract_review:  Optional[str] = Field(default=None, max_length=32)
    contract_start:   Optional[str] = Field(default=None, max_length=32)
    contract_expiry:  Optional[str] = Field(default=None, max_length=32)


class RecordIn(BaseModel):
    type: RecordType
    title: str = Field(min_length=1, max_length=160)
    description: Optional[str] = Field(default=None, max_length=4000)
    schedule_id: Optional[str] = None
    performed_at: Optional[str] = None
    hours_at: Optional[float] = None
    km_at: Optional[float] = None
    cost: Optional[float] = None
    currency: str = "AUD"
    technician_name: Optional[str] = None
    technician_id: Optional[str] = None
    # v58.12.8 (shipped v58.12.10) — technician's Simpro position captured
    # alongside their name/id so the service log persists what role the
    # technician held at the time of the service. Free-text at the schema
    # boundary (the FE picker constrains to Simpro's distinct-position list
    # with a "type manually" override for contractors / off-roster techs).
    technician_position: Optional[str] = None
    technician_signature_file_id: Optional[str] = None
    invoice_file_id: Optional[str] = None
    photo_file_ids: list[str] = Field(default_factory=list)
    defect_severity: Optional[DefectSeverity] = None


class RecordPatch(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=160)
    description: Optional[str] = Field(default=None, max_length=4000)
    performed_at: Optional[str] = None
    hours_at: Optional[float] = None
    km_at: Optional[float] = None
    cost: Optional[float] = None
    technician_name: Optional[str] = None
    technician_id: Optional[str] = None
    # v58.12.8 (shipped v58.12.10) — see RecordIn.technician_position.
    # PATCH-clearable via explicit None thanks to the "keep if None"
    # whitelist in `update_record` below.
    technician_position: Optional[str] = None
    defect_severity: Optional[DefectSeverity] = None
    photo_file_ids: Optional[list[str]] = None
    notes: Optional[str] = Field(default=None, max_length=4000)


class MeterUpdateIn(BaseModel):
    hours: Optional[float] = Field(default=None, ge=0)
    km: Optional[float] = Field(default=None, ge=0)


class QuickActionIn(BaseModel):
    scan_token: str = Field(min_length=4, max_length=64)
    action: Literal["log_service", "report_defect", "update_meter", "open_form"]
    payload: dict[str, Any] = Field(default_factory=dict)


# ────────────────── Phase 3.8 — Scan form launcher ──────────────────

# Heavy / truck-style vehicle asset types that should see the Heavy Vehicle
# Daily Check on top of the standard Vehicle Pre-Use Inspection.
_HEAVY_VEHICLE_TYPES = {
    "vacuum_truck", "tipper", "dump_truck", "semi_trailer",
    "crane_truck", "service_truck",
}

# Curated recommendation per asset kind (ordered, first item is the
# headline Recommended tile).
_FORMS_FOR_KIND: dict[str, list[dict]] = {
    "vehicle": [
        {"match": "Vehicle Pre-Use Inspection",  "category": "pre_use",     "icon": "ClipboardCheck"},
        {"match": "Heavy Vehicle Daily Check",   "category": "daily_check", "icon": "Truck"},
        {"match": "Incident Report",             "category": "incident",    "icon": "AlertOctagon"},
        {"match": "Near Miss Report",            "category": "near_miss",   "icon": "AlertTriangle"},
    ],
    "plant": [
        {"match": "Plant Pre-Start Checklist (Heavy Equipment)",
                                                 "category": "plant_pre_start", "icon": "Wrench"},
        {"match": "Plant Pre-Start Checklist",   "category": "plant_pre_start", "icon": "Wrench"},
        {"match": "Incident Report",             "category": "incident",    "icon": "AlertOctagon"},
        {"match": "Near Miss Report",            "category": "near_miss",   "icon": "AlertTriangle"},
    ],
}


async def _resolve_asset_for_user(user: dict, scan_token: str) -> dict:
    """Workspace-scoped asset lookup matching `scan_quick_action`. Raises
    404 for unknown and 410 for retired."""
    ws_ids = user.get("workspace_ids") or []
    q: dict = {
        "org_id": user["org_id"],
        "scan_token": scan_token,
        "deleted_at": None,
    }
    if user.get("role") not in {"admin", "manager", "hseq_lead"}:
        q["$or"] = [{"workspace_id": None}, {"workspace_id": {"$in": ws_ids}}]
    asset = await db.assets.find_one(q)
    if not asset:
        raise HTTPException(404, "Unknown scan token")
    if asset.get("status") == "retired":
        raise HTTPException(410, "Asset retired")
    return asset


@scan_router.get("/{scan_token}/forms")
async def scan_forms(scan_token: str, user: dict = Depends(get_current_user)):
    """Return the curated list of form templates a worker can launch for the
    scanned asset.

    Phase 3.9c — selection now combines asset-type rules with the worker's
    direct/role/company assignments via `resolve_forms_for_worker`. The
    `recommended` badge is computed locally from the asset kind so daily
    pre-starts still float to the top for pre-use checks.
    """
    asset = await _resolve_asset_for_user(user, scan_token)
    kind = (asset.get("kind") or "").lower()

    # Pull the calling user's worker record (if any) by matching email — same
    # lookup the form auto-prefill uses in Forms.jsx.
    worker = None
    if user.get("email"):
        worker = await db.workers.find_one(
            {"org_id": user["org_id"], "email": user["email"], "deleted_at": None},
            {"_id": 0, "id": 1, "role": 1, "simpro_company_id": 1},
        )

    from form_assignment_notifier import resolve_forms_for_worker
    resolved = await resolve_forms_for_worker(
        org_id=user["org_id"], worker=worker, asset=asset,
    )

    forms: list[dict] = []
    for r in resolved:
        cat = r["category"]
        recommended = (
            (kind == "vehicle" and cat in {"pre_use", "daily_check", "vehicle"})
            or (kind == "plant" and cat in {"plant_pre_start", "plant"})
        )
        forms.append({
            "template_id": r["template_id"],
            "name": r["name"],
            "description": r["description"],
            "category": cat,
            "icon": _icon_for_category(cat),
            "field_count": r["field_count"],
            "recommended": bool(recommended),
            "match_reasons": r["match_reasons"],
        })
    forms.sort(key=lambda f: (not f["recommended"], f["name"].lower()))

    return {
        "asset": {
            "id": asset["id"],
            "name": asset.get("name"),
            "kind": asset.get("kind"),
            "asset_type": asset.get("asset_type"),
            "rego_serial": asset.get("rego_serial"),
            "scan_token": asset.get("scan_token"),
            "last_known_lat": asset.get("last_known_lat"),
            "last_known_lng": asset.get("last_known_lng"),
        },
        "forms": forms,
    }


def _icon_for_category(cat: str) -> str:
    return {
        "pre_use":         "ClipboardCheck",
        "daily_check":     "Truck",
        "plant_pre_start": "Wrench",
        "incident":        "AlertOctagon",
        "near_miss":       "AlertTriangle",
    }.get(cat, "ClipboardCheck")


# ────────────────── Phase 3.9b — Form-to-Asset-Type Assignments ──────────────────

_ASSIGN_READ_ROLES = {"admin", "manager", "hseq_lead"}
_ASSIGN_WRITE_ROLES = {"admin", "manager"}


def _require_assignments_role(user: dict, write: bool = False) -> None:
    role = user.get("role")
    allowed = _ASSIGN_WRITE_ROLES if write else _ASSIGN_READ_ROLES
    if role not in allowed:
        raise HTTPException(403, "Admin or manager role required")


class TargetWorker(BaseModel):
    worker_id: str
    expires_at: Optional[str] = None
    assigned_at: Optional[str] = None
    assigned_by_user_id: Optional[str] = None


class TargetRole(BaseModel):
    role: str
    expires_at: Optional[str] = None
    assigned_at: Optional[str] = None
    assigned_by_user_id: Optional[str] = None


class TargetCompany(BaseModel):
    simpro_company_id: str
    expires_at: Optional[str] = None
    assigned_at: Optional[str] = None
    assigned_by_user_id: Optional[str] = None


class AppliesToIn(BaseModel):
    kinds: list[str] = Field(default_factory=list)
    asset_types: list[str] = Field(default_factory=list)
    worker_ids: list[TargetWorker] = Field(default_factory=list)
    roles: list[TargetRole] = Field(default_factory=list)
    companies: list[TargetCompany] = Field(default_factory=list)
    # v58.12.13 — Simpro-position gate. Sits as a top-level field on
    # form_templates (NOT nested inside applies_to). Carried through
    # this PUT payload for atomic saves alongside the other targets.
    assigned_positions: list[str] = Field(default_factory=list)
    # When true, mute the email/SMS dispatcher for this save (admin opt-out).
    skip_notifications: bool = False


class BulkAssignmentEntry(BaseModel):
    template_id: str
    kinds: list[str] = Field(default_factory=list)
    asset_types: list[str] = Field(default_factory=list)
    worker_ids: list[TargetWorker] = Field(default_factory=list)
    roles: list[TargetRole] = Field(default_factory=list)
    companies: list[TargetCompany] = Field(default_factory=list)
    # v58.12.13 — Bulk-save companion for the position gate.
    assigned_positions: list[str] = Field(default_factory=list)


class BulkAssignmentsIn(BaseModel):
    assignments: list[BulkAssignmentEntry]
    skip_notifications: bool = False


assignments_router = APIRouter(prefix="/form-templates", tags=["form-assignments"])


@assignments_router.get("/assignments")
async def list_assignments(user: dict = Depends(get_current_user)):
    _require_assignments_role(user, write=False)
    rows = []
    async for t in db.form_templates.find(
        {"org_id": user["org_id"], "deleted_at": None},
        {"_id": 0, "id": 1, "name": 1, "description": 1, "category": 1,
         "applies_to": 1, "assigned_positions": 1},
    ):
        rows.append({
            "id": t["id"], "name": t["name"],
            "description": t.get("description") or "",
            "category": t.get("category") or "general",
            "applies_to": t.get("applies_to") or {
                "kinds": [], "asset_types": [],
                "worker_ids": [], "roles": [], "companies": [],
            },
            # v58.12.13 — Top-level position gate. Legacy templates
            # without the field return [] so the FE toggler treats them
            # as ungated (matches the OR-gate semantic in list_templates).
            "assigned_positions": t.get("assigned_positions") or [],
        })
    rows.sort(key=lambda r: (r["category"], r["name"].lower()))

    # Distinct asset_types currently in the org's asset register, grouped by kind.
    pipeline = [
        {"$match": {"org_id": user["org_id"], "deleted_at": None,
                    "asset_type": {"$ne": None}}},
        {"$group": {"_id": {"kind": "$kind", "asset_type": "$asset_type"}}},
    ]
    type_index: dict[str, set] = {}
    async for doc in db.assets.aggregate(pipeline):
        k = (doc["_id"]["kind"] or "other")
        type_index.setdefault(k, set()).add(doc["_id"]["asset_type"])
    columns = {k: sorted(v) for k, v in type_index.items()}

    # Phase 3.9c — distinct roles + companies currently active on workers.
    roles = sorted({(r or "").lower() for r in await db.workers.distinct(
        "role", {"org_id": user["org_id"], "deleted_at": None}) if r})
    companies: list[dict] = []
    seen_ids: set[str] = set()
    async for w in db.workers.find(
        {"org_id": user["org_id"], "deleted_at": None,
         "simpro_company_id": {"$ne": None}},
        {"_id": 0, "simpro_company_id": 1, "company_label": 1},
    ):
        cid = str(w["simpro_company_id"])
        if cid in seen_ids:
            continue
        seen_ids.add(cid)
        companies.append({
            "simpro_company_id": cid,
            "company_label": w.get("company_label") or f"Company #{cid}",
        })
    companies.sort(key=lambda c: c["company_label"].lower())

    # v58.12.13 — Distinct Simpro positions currently active on workers.
    # Same source of truth as the widened `/workers/directory` v58.12.10
    # response. Blank strings are dropped (`.filter(Boolean)` on the FE
    # already does this too, but belt-and-braces at the API edge).
    positions = sorted({(p or "").strip() for p in await db.workers.distinct(
        "position", {"org_id": user["org_id"], "source": "simpro",
                     "deleted_at": None}) if p and p.strip()})

    return {
        "templates": rows,
        "asset_type_columns": columns,
        "roles": roles or ["admin", "manager", "hseq_lead", "foreman",
                           "operator", "driver", "worker"],
        "companies": companies,
        "positions": positions,
    }


async def _validate_targets(org_id: str, body) -> None:
    """422 if any referenced worker_id doesn't exist in our register."""
    wids = [w.worker_id for w in (body.worker_ids or [])]
    if not wids:
        return
    count = await db.workers.count_documents({
        "org_id": org_id, "id": {"$in": wids}, "deleted_at": None,
    })
    if count != len(wids):
        raise HTTPException(422, "One or more worker_ids do not exist")


def _serialise_applies_to(body, user: dict) -> dict:
    """Convert pydantic model → dict suitable for $set, stamping
    assigned_at/by where the caller didn't supply them."""
    now = datetime.now(timezone.utc).isoformat()
    return {
        "kinds": [k.lower() for k in (body.kinds or [])],
        "asset_types": [t.lower() for t in (body.asset_types or [])],
        "worker_ids": [{
            "worker_id": w.worker_id,
            "expires_at": w.expires_at,
            "assigned_at": w.assigned_at or now,
            "assigned_by_user_id": w.assigned_by_user_id or user["id"],
        } for w in (body.worker_ids or [])],
        "roles": [{
            "role": r.role.lower(),
            "expires_at": r.expires_at,
            "assigned_at": r.assigned_at or now,
            "assigned_by_user_id": r.assigned_by_user_id or user["id"],
        } for r in (body.roles or [])],
        "companies": [{
            "simpro_company_id": str(c.simpro_company_id),
            "expires_at": c.expires_at,
            "assigned_at": c.assigned_at or now,
            "assigned_by_user_id": c.assigned_by_user_id or user["id"],
        } for c in (body.companies or [])],
    }


@assignments_router.put("/{template_id}/applies-to")
async def update_applies_to(template_id: str, body: AppliesToIn,
                            user: dict = Depends(get_current_user)):
    _require_assignments_role(user, write=True)
    await _validate_targets(user["org_id"], body)

    prior = await db.form_templates.find_one(
        {"id": template_id, "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0, "applies_to": 1},
    )
    if prior is None:
        raise HTTPException(404, "Template not found")

    next_applies = _serialise_applies_to(body, user)
    # v58.12.13 — Whitespace-strip + dedupe + drop blanks. Same
    # normalisation as `create_template` in forms.py.
    next_positions = sorted({p.strip() for p in (body.assigned_positions or [])
                             if p and p.strip()})
    await db.form_templates.update_one(
        {"id": template_id, "org_id": user["org_id"], "deleted_at": None},
        {"$set": {"applies_to": next_applies,
                  "assigned_positions": next_positions}},
    )

    # Phase 3.9c — fire email + SMS for newly-exposed workers.
    from form_assignment_notifier import dispatch_diff
    notify = await dispatch_diff(
        org_id=user["org_id"], template_id=template_id,
        prior_applies_to=prior.get("applies_to") or {},
        next_applies_to=next_applies,
        skip=body.skip_notifications,
    )

    return {"ok": True, "template_id": template_id,
            "applies_to": next_applies, "notify": notify}


@assignments_router.post("/assignments/bulk")
async def bulk_save_assignments(body: BulkAssignmentsIn,
                                user: dict = Depends(get_current_user)):
    _require_assignments_role(user, write=True)
    saved, missing = 0, []
    # v58.13.86 — Path B refactor. The bulk save no longer fires
    # notifications as a side effect. Instead we return per-template
    # `newly_added` worker IDs so the admin UI can open a
    # "Notify newly-assigned workers?" modal after the save and, if
    # the admin clicks Notify, POST to `/form-templates/{id}/
    # notify-added-workers` per template. `skip_notifications` in the
    # request body is accepted for API back-compat but ignored — no
    # send happens automatically either way.
    notify_totals = {"sent": 0, "queued_templates": 0, "newly_added_total": 0,
                     "per_template": []}
    from form_assignment_notifier import dispatch_diff

    for entry in body.assignments:
        # Per-template validation so a bad worker_id only fails that row.
        try:
            await _validate_targets(user["org_id"], entry)
        except HTTPException:
            missing.append(entry.template_id)
            continue

        prior = await db.form_templates.find_one(
            {"id": entry.template_id, "org_id": user["org_id"], "deleted_at": None},
            {"_id": 0, "applies_to": 1},
        )
        if not prior:
            missing.append(entry.template_id)
            continue

        next_applies = _serialise_applies_to(entry, user)
        # v58.12.13 — Same normalisation as the single-template PUT.
        next_positions = sorted({p.strip() for p in (entry.assigned_positions or [])
                                 if p and p.strip()})
        await db.form_templates.update_one(
            {"id": entry.template_id, "org_id": user["org_id"], "deleted_at": None},
            {"$set": {"applies_to": next_applies,
                      "assigned_positions": next_positions}},
        )
        saved += 1
        diff = await dispatch_diff(
            org_id=user["org_id"], template_id=entry.template_id,
            prior_applies_to=prior.get("applies_to") or {},
            next_applies_to=next_applies,
            skip=body.skip_notifications,
        )
        if diff["newly_added_count"] > 0:
            notify_totals["newly_added_total"] += diff["newly_added_count"]
            notify_totals["per_template"].append({
                "template_id": entry.template_id,
                "newly_added": diff["newly_added"],
                "newly_added_count": diff["newly_added_count"],
            })

    return {"ok": True, "saved": saved, "missing": missing, "notify": notify_totals}


@assignments_router.post("/{template_id}/preview-recipients")
async def preview_recipients(template_id: str, body: AppliesToIn,
                             user: dict = Depends(get_current_user)):
    """Compute who WOULD be newly notified if this `applies_to` payload were
    saved (without persisting anything). Used by the front-end confirm toast."""
    _require_assignments_role(user, write=False)
    prior = await db.form_templates.find_one(
        {"id": template_id, "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0, "applies_to": 1},
    )
    if not prior:
        raise HTTPException(404, "Template not found")
    from form_assignment_notifier import _resolve_audience
    next_applies = _serialise_applies_to(body, user)
    prior_audience = await _resolve_audience(user["org_id"], prior.get("applies_to") or {})
    next_audience = await _resolve_audience(user["org_id"], next_applies)
    newly = next_audience - prior_audience
    # Resolve to {id, name, email, role} for the dialog preview.
    sample = []
    if newly:
        async for w in db.workers.find(
            {"id": {"$in": list(newly)}, "org_id": user["org_id"], "deleted_at": None},
            {"_id": 0, "id": 1, "first_name": 1, "last_name": 1, "name": 1,
             "email": 1, "role": 1, "position": 1, "phone": 1},
        ).limit(10):
            sample.append({
                "id": w["id"],
                "name": w.get("name") or " ".join(filter(None, [w.get("first_name"), w.get("last_name")])).strip(),
                "email": w.get("email"),
                "role": w.get("role") or w.get("position"),
                "phone": w.get("phone"),
            })
    return {
        "prior_count": len(prior_audience),
        "next_count": len(next_audience),
        "newly_added_count": len(newly),
        "newly_added_sample": sample,
    }


# v58.13.86 — Manual "Notify newly-assigned workers" endpoint. Fires
# the notification code that USED to run as a side effect of saving
# assignments (Path B in the pre-.86 comms audit). Only reachable by
# explicit user click on the post-save modal.
class NotifyAddedWorkersIn(BaseModel):
    worker_ids: list[str]


@assignments_router.post("/{template_id}/notify-added-workers")
async def notify_added_workers(
    template_id: str,
    body: NotifyAddedWorkersIn,
    user: dict = Depends(get_current_user),
):
    _require_assignments_role(user, write=True)
    # Template ownership check — reject cross-org attempts.
    tpl = await db.form_templates.find_one(
        {"id": template_id, "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0, "id": 1},
    )
    if not tpl:
        raise HTTPException(404, "Template not found")
    from form_assignment_notifier import notify_worker_ids
    res = await notify_worker_ids(
        org_id=user["org_id"],
        template_id=template_id,
        worker_ids=list(body.worker_ids or []),
        actor_user_id=user["id"],
    )
    return {"ok": True, **res}


# ────────────────── Schedules ──────────────────

@router.get("/{asset_id}/schedules")
async def list_schedules(asset_id: str, user: dict = Depends(get_current_user)):
    asset = await _get_asset(asset_id, user["org_id"])
    rows = []
    async for s in db.asset_service_schedules.find(
        {"asset_id": asset_id, "deleted_at": None}, {"_id": 0},
    ).sort("name", 1):
        rows.append(_compute_next_due(s, asset) | s)
    return {"schedules": rows}


@router.post("/{asset_id}/schedules", status_code=201)
async def create_schedule(asset_id: str, body: ScheduleIn, user: dict = Depends(get_current_user)):
    asset = await _get_asset(asset_id, user["org_id"])
    if body.interval_kind == "calendar" and not body.calendar_unit:
        raise HTTPException(400, "calendar_unit is required for calendar schedules")
    _validate_secondary(body.interval_kind, body.secondary_interval, asset)
    ts = now_iso()
    # v58.13.0-a — Bleach-sanitise description_html + auto-stamp
    # entered_by_* from current_user. Both stamps are set only on
    # CREATE — update_schedule preserves the originals below.
    payload = body.dict()
    payload["description_html"] = _sanitize_description_html(payload.get("description_html"))
    doc = {
        "id": new_id(), "asset_id": asset_id, "org_id": user["org_id"],
        "workspace_id": asset.get("workspace_id"),
        **payload,
        "entered_by_user_id": user["id"],
        "entered_by_name": user.get("name") or user.get("email") or user["id"],
        "created_at": ts, "updated_at": ts, "created_by": user["id"],
        "deleted_at": None,
    }
    nd = _compute_next_due(doc, asset)
    doc.update({
        "next_due_value": nd["next_due_value"],
        "next_due_at": nd["next_due_at"],
        "next_due_at_primary": nd["next_due_at_primary"],
        "next_due_at_secondary": nd["next_due_at_secondary"],
        "next_due_value_secondary": nd["next_due_value_secondary"],
        "status_cached": nd["status"],
    })
    await db.asset_service_schedules.insert_one(doc)
    out = dict(doc); out.pop("_id", None); return out


@router.put("/{asset_id}/schedules/{sid}")
async def update_schedule(asset_id: str, sid: str, body: ScheduleIn, user: dict = Depends(get_current_user)):
    asset = await _get_asset(asset_id, user["org_id"])
    existing = await db.asset_service_schedules.find_one({"id": sid, "asset_id": asset_id, "org_id": user["org_id"], "deleted_at": None})
    if not existing:
        raise HTTPException(404, "Schedule not found")
    _validate_secondary(body.interval_kind, body.secondary_interval, asset)
    # v58.13.0-a — Sanitise description_html on update. entered_by_*
    # from the original doc are preserved verbatim (audit trail).
    payload = body.dict()
    payload["description_html"] = _sanitize_description_html(payload.get("description_html"))
    merged = {**existing, **payload, "updated_at": now_iso()}
    merged["entered_by_user_id"] = existing.get("entered_by_user_id")
    merged["entered_by_name"] = existing.get("entered_by_name")
    nd = _compute_next_due(merged, asset)
    merged.update({
        "next_due_value": nd["next_due_value"],
        "next_due_at": nd["next_due_at"],
        "next_due_at_primary": nd["next_due_at_primary"],
        "next_due_at_secondary": nd["next_due_at_secondary"],
        "next_due_value_secondary": nd["next_due_value_secondary"],
        "status_cached": nd["status"],
    })
    await db.asset_service_schedules.replace_one({"id": sid}, merged)
    merged.pop("_id", None); return merged


@router.get("/{asset_id}/schedules/{sid}")
async def get_schedule(asset_id: str, sid: str, user: dict = Depends(get_current_user)):
    asset = await _get_asset(asset_id, user["org_id"])
    doc = await db.asset_service_schedules.find_one(
        {"id": sid, "asset_id": asset_id, "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0},
    )
    if not doc:
        raise HTTPException(404, "Schedule not found")
    nd = _compute_next_due(doc, asset)
    return {**doc, **nd, "status_cached": nd["status"]}


class MeterResetIn(BaseModel):
    hours: Optional[float] = Field(default=None, ge=0)
    km: Optional[float] = Field(default=None, ge=0)
    reason: str = Field(min_length=1, max_length=500)


@router.post("/{asset_id}/meter/reset")
async def meter_reset(asset_id: str, body: MeterResetIn, user: dict = Depends(get_current_user)):
    """Admin-only meter rewind. Writes a meter_update record with the
    reason as `notes` (free-form description). Bypasses the monotonic guard."""
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    asset = await _get_asset(asset_id, user["org_id"])
    if body.hours is None and body.km is None:
        raise HTTPException(400, "Provide hours or km")
    ts = now_iso()
    patch: dict[str, Any] = {}
    if body.hours is not None:
        patch["hours_meter"] = body.hours
        patch["hours_meter_updated_at"] = ts
    if body.km is not None:
        patch["odo_km"] = body.km
        patch["odo_km_updated_at"] = ts
    await db.assets.update_one({"id": asset_id}, {"$set": patch})
    asset.update(patch)
    rec = {
        "id": new_id(), "asset_id": asset_id, "org_id": user["org_id"],
        "workspace_id": asset.get("workspace_id"),
        "type": "meter_update", "title": "Meter reset", "description": body.reason,
        "performed_at": ts, "performed_by": user["id"],
        "performed_by_name": user.get("name") or user.get("email"),
        "hours_at": body.hours, "km_at": body.km,
        "linked_hazard_id": None, "created_at": ts, "deleted_at": None,
    }
    await db.asset_service_records.insert_one(rec)
    # Recompute every active schedule on this asset so the cached status
    # reflects the rewound meter.
    async for s in db.asset_service_schedules.find(
        {"asset_id": asset_id, "deleted_at": None, "status": "active"},
    ):
        await _recompute_and_save(s, asset)
    rec.pop("_id", None)
    return rec


@router.delete("/{asset_id}/schedules/{sid}", status_code=204)
async def delete_schedule(asset_id: str, sid: str, user: dict = Depends(get_current_user)):
    res = await db.asset_service_schedules.update_one(
        {"id": sid, "asset_id": asset_id, "org_id": user["org_id"], "deleted_at": None},
        {"$set": {"deleted_at": now_iso()}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Schedule not found")
    # v58.13.16 — Cascade hard-delete the attachment blob directory.
    # Soft-deleting the schedule doc is fine for recoverability, but
    # attachment blobs on disk have no recovery path (there's no
    # "restore trashed schedule" UI), so leaving them accumulates
    # orphaned files indefinitely. Idempotent: `ignore_errors=True`
    # covers the case where the dir was never created (no
    # attachments uploaded) or already removed by a previous call.
    sid_dir = SCHEDULE_ATTACHMENT_ROOT / sid
    if sid_dir.exists():
        try:
            shutil.rmtree(sid_dir, ignore_errors=True)
        except OSError as e:
            # rmtree with ignore_errors=True doesn't raise, but a
            # subprocess / permissions edge could theoretically slip
            # through. Surface loudly rather than silently orphaning.
            log.exception(
                "v58.13.16 cascade delete: sid_dir rmtree failed sid=%s "
                "err=%s", sid, e,
            )
    return None


# ─── Schedule attachments (v58.13.14 — v58.13.11-b endpoint) ─────
# Filesystem-backed, mirroring `forms.py` (`upload_submission_attachments`
# at line 1086). Divergence: this DELETE endpoint HARD-deletes the
# disk file so schedule attachments do NOT leak orphaned blobs on the
# volume (the exact issue flagged in the earlier "Areas that need
# refactoring" list). forms.py uses soft-delete-only — we intentionally
# do not adopt that here because schedule attachments have a
# short-lived, per-task relevance and the operator explicitly asked
# for hard delete.
#
# Storage: `backend/uploads/schedule_attachments/{sid}/{stored_uuid}`.
# Stored filename is a UUID so a malicious `original.pdf/../../etc`
# cannot traverse. Original display name is preserved on the record
# only for the UI.

async def _get_schedule(asset_id: str, sid: str, org_id: str) -> dict:
    doc = await db.asset_service_schedules.find_one(
        {"id": sid, "asset_id": asset_id, "org_id": org_id, "deleted_at": None},
        {"_id": 0},
    )
    if not doc:
        raise HTTPException(404, "Schedule not found")
    return doc


@router.post("/{asset_id}/schedules/{sid}/attachments", status_code=201)
async def upload_schedule_attachments(
    asset_id: str, sid: str,
    files: list[UploadFile] = File(...),
    names: list[str] = Form(default=[]),
    descriptions: list[str] = Form(default=[]),
    user: dict = Depends(get_current_user),
):
    # Existence + org-tenancy check via the shared helper — same RBAC
    # gate the schedule create/update endpoints use (no new
    # permission).
    await _get_schedule(asset_id, sid, user["org_id"])
    dest_dir = SCHEDULE_ATTACHMENT_ROOT / sid
    dest_dir.mkdir(parents=True, exist_ok=True)
    now = now_iso()
    saved: list[dict[str, Any]] = []
    for i, upload in enumerate(files):
        mime = (upload.content_type or "").lower()
        if mime not in SCHEDULE_ATTACHMENT_ALLOWED_MIMES:
            raise HTTPException(415, f"MIME '{mime}' not allowed")
        data = await upload.read()
        if len(data) > MAX_SCHEDULE_ATTACHMENT_BYTES:
            raise HTTPException(
                413, f"File exceeds {MAX_SCHEDULE_ATTACHMENT_BYTES} bytes",
            )
        stored_name = str(uuid.uuid4())
        (dest_dir / stored_name).write_bytes(data)
        display_name = (
            (names[i] if i < len(names) else "")
            or upload.filename or stored_name
        )
        description = descriptions[i] if i < len(descriptions) else ""
        rec = {
            "file_id": stored_name,
            "stored_name": stored_name,
            "name": str(display_name)[:255],
            "description": str(description)[:2000],
            "mime": mime,
            "size": len(data),
            "url": f"/api/assets/{asset_id}/schedules/{sid}"
                   f"/attachments/{stored_name}",
            "uploaded_by": user.get("id"),
            "uploaded_at": now,
        }
        saved.append(rec)
    # Defensive: schedules created before v58.13.14 land in Mongo with
    # `attachments: null` (Pydantic serialises `Optional[...] = None`
    # to null). `$push` on a null-valued field raises WriteError code
    # 2. Coerce to an empty array first — idempotent for docs where
    # it's already an array.
    await db.asset_service_schedules.update_one(
        {"id": sid, "asset_id": asset_id, "org_id": user["org_id"],
         "attachments": None},
        {"$set": {"attachments": []}},
    )
    await db.asset_service_schedules.update_one(
        {"id": sid, "asset_id": asset_id, "org_id": user["org_id"]},
        {"$push": {"attachments": {"$each": saved}},
         "$set": {"updated_at": now}},
    )
    return {"attachments": saved}


@router.get("/{asset_id}/schedules/{sid}/attachments/{stored_name}")
async def serve_schedule_attachment(
    asset_id: str, sid: str, stored_name: str,
    # v58.13.51 — Default to INLINE so the browser opens the PDF in a tab
    # instead of triggering a "Save As". Callers who explicitly want a
    # download (e.g. bulk-export flows) pass `?download=1`.
    download: int = Query(0, ge=0, le=1),
    user: dict = Depends(get_current_user),
):
    doc = await _get_schedule(asset_id, sid, user["org_id"])
    rec = next(
        (a for a in (doc.get("attachments") or [])
         if a.get("stored_name") == stored_name),
        None,
    )
    if not rec:
        raise HTTPException(404, "Attachment not found")
    path = SCHEDULE_ATTACHMENT_ROOT / sid / stored_name
    if not path.exists():
        raise HTTPException(404, "File missing on disk")
    return FileResponse(
        str(path),
        media_type=rec.get("mime") or "application/octet-stream",
        filename=rec.get("name") or stored_name,
        content_disposition_type="attachment" if download else "inline",
    )


@router.delete(
    "/{asset_id}/schedules/{sid}/attachments/{stored_name}",
    status_code=204,
)
async def delete_schedule_attachment(
    asset_id: str, sid: str, stored_name: str,
    user: dict = Depends(get_current_user),
):
    # Pull the record from the array first so a concurrent request
    # for the same file can't race the disk delete.
    res = await db.asset_service_schedules.update_one(
        {"id": sid, "asset_id": asset_id, "org_id": user["org_id"],
         "deleted_at": None},
        {"$pull": {"attachments": {"stored_name": stored_name}},
         "$set": {"updated_at": now_iso()}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Schedule not found")
    # HARD delete of the disk blob — the leak fix. Missing file is
    # not an error (idempotency: repeated DELETE returns 204).
    path = SCHEDULE_ATTACHMENT_ROOT / sid / stored_name
    try:
        if path.exists():
            path.unlink()
    except OSError as e:
        # File exists but we can't remove it (permissions / race).
        # Surface the failure loudly rather than silently orphaning.
        log.exception(
            "schedule-attachment delete: blob unlink failed sid=%s "
            "stored_name=%s err=%s", sid, stored_name, e,
        )
        raise HTTPException(500, "Attachment blob delete failed")
    return None


# ────────────────── Records ──────────────────

@router.get("/{asset_id}/records")
async def list_records(asset_id: str, type: Optional[str] = Query(None),
                       limit: int = Query(100, ge=1, le=500),
                       user: dict = Depends(get_current_user)):
    await _get_asset(asset_id, user["org_id"])
    q: dict = {"asset_id": asset_id, "org_id": user["org_id"], "deleted_at": None}
    if type and type != "all":
        q["type"] = type
    rows = []
    async for r in db.asset_service_records.find(q, {"_id": 0}).sort("performed_at", -1).limit(limit):
        rows.append(r)
    return {"records": rows}


async def _maybe_raise_hazard(asset: dict, record: dict, user: dict) -> Optional[str]:
    """When a major/critical defect is reported and the workspace toggle is on,
    auto-create a hazard row. Returns the new hazard id (or None)."""
    if record.get("type") != "defect":
        return None
    sev = (record.get("defect_severity") or "").lower()
    if sev not in {"major", "critical"}:
        return None
    ws = await db.workspaces.find_one({"id": asset.get("workspace_id")}, {"_id": 0}) if asset.get("workspace_id") else None
    settings = (ws or {}).get("settings") or {}
    if settings.get("defectAutoCreatesHazard") is False:
        return None
    haz_id = new_id()
    haz_severity = "high" if sev == "critical" else "medium"
    await db.hazards.insert_one({
        "id": haz_id,
        "org_id": user["org_id"],
        "workspace_id": asset.get("workspace_id") or (user.get("workspace_ids") or [None])[0],
        "title": f"Plant defect: {asset.get('name')}",
        "description": (record.get("description") or "")[:4000],
        "severity": haz_severity,
        "status": "open",
        "controls": [],
        "photo_url": None,
        "location": asset.get("name"),
        "source": "asset_defect",
        "linked_asset_id": asset["id"],
        "linked_service_record_id": record["id"],
        "created_by": user["id"],
        "created_at": now_iso(),
        "deleted_at": None,
    })
    return haz_id


@router.post("/{asset_id}/records", status_code=201)
async def create_record(asset_id: str, body: RecordIn, user: dict = Depends(get_current_user)):
    asset = await _get_asset(asset_id, user["org_id"])
    ts = now_iso()
    performed_at = body.performed_at or ts
    rec = {
        "id": new_id(), "asset_id": asset_id, "org_id": user["org_id"],
        "workspace_id": asset.get("workspace_id"),
        **body.dict(),
        "performed_at": performed_at,
        "performed_by": user["id"],
        "performed_by_name": user.get("name") or user.get("email"),
        "linked_hazard_id": None,
        "created_at": ts, "deleted_at": None,
    }
    # Meter capture: a service or meter_update with hours_at/km_at also updates
    # the asset's current meter reading.
    meter_patch: dict[str, Any] = {}
    # Phase 3.5: meter values for Navixy-linked assets are synced from the
    # tracker every 15 min — reject manual updates that disagree with the
    # current Navixy reading so on-site overrides can't silently drift.
    if asset.get("navixy_device_id"):
        if body.type == "meter_update":
            cur_h = asset.get("hours_meter")
            cur_k = asset.get("odo_km")
            disagrees = (
                (body.hours_at is not None and cur_h is not None and abs(float(body.hours_at) - float(cur_h)) > 0.01)
                or (body.km_at is not None and cur_k is not None and abs(float(body.km_at) - float(cur_k)) > 0.01)
            )
            if disagrees:
                raise HTTPException(
                    422,
                    "Asset meters are synced from Navixy. Update the device in Navixy or use the override (POST /api/assets/{id}/meter/reset).",
                )
    # Meter is monotonic — reject decreases so an operator typo doesn't wipe
    # service history. Use POST /meter/reset (admin) for legitimate rewinds.
    if body.type == "meter_update":
        if body.hours_at is not None and asset.get("hours_meter") is not None and body.hours_at < asset["hours_meter"]:
            raise HTTPException(422, "Meter cannot decrease — use POST /api/assets/{id}/meter/reset (admin)")
        if body.km_at is not None and asset.get("odo_km") is not None and body.km_at < asset["odo_km"]:
            raise HTTPException(422, "Meter cannot decrease — use POST /api/assets/{id}/meter/reset (admin)")
    if body.hours_at is not None and (asset.get("hours_meter") is None or body.hours_at >= asset.get("hours_meter")):
        meter_patch["hours_meter"] = body.hours_at
        meter_patch["hours_meter_updated_at"] = ts
    if body.km_at is not None and (asset.get("odo_km") is None or body.km_at >= asset.get("odo_km")):
        meter_patch["odo_km"] = body.km_at
        meter_patch["odo_km_updated_at"] = ts
    if meter_patch:
        await db.assets.update_one({"id": asset_id}, {"$set": meter_patch})
        asset.update(meter_patch)

    # Auto-raise hazard for major/critical defects.
    haz_id = await _maybe_raise_hazard(asset, rec, user)
    if haz_id:
        rec["linked_hazard_id"] = haz_id

    await db.asset_service_records.insert_one(rec)

    # Recompute schedule on `type=service` with schedule_id.
    if body.type == "service" and body.schedule_id:
        sched = await db.asset_service_schedules.find_one({"id": body.schedule_id, "asset_id": asset_id, "deleted_at": None})
        if sched:
            patch = {"last_done_at": performed_at, "updated_at": ts}
            if sched["interval_kind"] == "hours" and body.hours_at is not None:
                patch["last_done_value"] = body.hours_at
            elif sched["interval_kind"] == "km" and body.km_at is not None:
                patch["last_done_value"] = body.km_at
            sched.update(patch)
            nd = _compute_next_due(sched, asset)
            patch.update({"next_due_value": nd["next_due_value"], "next_due_at": nd["next_due_at"], "status_cached": nd["status"]})
            await db.asset_service_schedules.update_one({"id": sched["id"]}, {"$set": patch})
    else:
        # Even for meter updates with no schedule, recompute *all* schedules so
        # their `due/overdue` cache reflects the new meter reading.
        async for s in db.asset_service_schedules.find({"asset_id": asset_id, "deleted_at": None, "status": "active"}):
            await _recompute_and_save(s, asset)

    out = dict(rec); out.pop("_id", None); return out


@router.get("/{asset_id}/records/{rid}")
async def get_record(asset_id: str, rid: str, user: dict = Depends(get_current_user)):
    doc = await db.asset_service_records.find_one(
        {"id": rid, "asset_id": asset_id, "org_id": user["org_id"], "deleted_at": None}, {"_id": 0},
    )
    if not doc:
        raise HTTPException(404, "Record not found")
    return doc


@router.delete("/{asset_id}/records/{rid}", status_code=204)
async def delete_record(asset_id: str, rid: str, user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    existing = await db.asset_service_records.find_one(
        {"id": rid, "asset_id": asset_id, "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0},
    )
    if not existing:
        raise HTTPException(404, "Record not found")
    ts = now_iso()
    await db.asset_service_records.update_one(
        {"id": rid, "asset_id": asset_id, "org_id": user["org_id"], "deleted_at": None},
        {"$set": {"deleted_at": ts}},
    )
    # Linked hazard: leave intact, add an audit note so the trail is preserved.
    haz_id = existing.get("linked_hazard_id")
    if haz_id:
        note = (f"Defect record {rid} deleted by "
                f"{user.get('name') or user.get('email') or user.get('id')} on {ts}")
        await db.hazards.update_one(
            {"id": haz_id, "org_id": user["org_id"]},
            {"$push": {"audit_notes": note}, "$set": {"updated_at": ts}},
        )
    # Meter-impacting record: recompute every schedule on the asset.
    if existing.get("type") in {"meter_update", "service"} and (
            existing.get("hours_at") is not None or existing.get("km_at") is not None):
        asset = await db.assets.find_one({"id": asset_id, "org_id": user["org_id"]})
        if asset:
            async for s in db.asset_service_schedules.find(
                {"asset_id": asset_id, "deleted_at": None, "status": "active"}):
                await _recompute_and_save(s, asset)
    return None


@router.put("/{asset_id}/records/{rid}")
async def update_record(asset_id: str, rid: str, body: RecordPatch,
                        user: dict = Depends(get_current_user)):
    if user.get("role") not in {"admin", "manager", "hseq_lead"}:
        raise HTTPException(403, "Admin or manager only")
    existing = await db.asset_service_records.find_one(
        {"id": rid, "asset_id": asset_id, "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0},
    )
    if not existing:
        raise HTTPException(404, "Record not found")
    payload = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None or k in {"description", "technician_name", "technician_id", "technician_position", "cost", "hours_at", "km_at", "notes"}}
    # `type` is immutable post-creation.
    payload.pop("type", None)

    asset = await _get_asset(asset_id, user["org_id"])

    # Severity dial-down note when a previously raised hazard now becomes minor.
    if (existing.get("type") == "defect" and existing.get("linked_hazard_id")
            and "defect_severity" in payload
            and payload["defect_severity"] not in {"major", "critical"}
            and (existing.get("defect_severity") or "").lower() in {"major", "critical"}):
        note = (f"Linked defect {rid} severity dialled down to "
                f"{payload['defect_severity']} by "
                f"{user.get('name') or user.get('email')} on {now_iso()}")
        await db.hazards.update_one(
            {"id": existing["linked_hazard_id"], "org_id": user["org_id"]},
            {"$push": {"audit_notes": note}, "$set": {"updated_at": now_iso()}},
        )

    payload["updated_at"] = now_iso()
    payload["updated_by"] = user["id"]
    await db.asset_service_records.update_one(
        {"id": rid, "asset_id": asset_id, "org_id": user["org_id"]},
        {"$set": payload},
    )
    new_doc = await db.asset_service_records.find_one(
        {"id": rid, "asset_id": asset_id, "org_id": user["org_id"]}, {"_id": 0},
    )

    # Recompute schedule status_cached on meter-impacting edits.
    if existing.get("type") in {"meter_update", "service"} and (
            "hours_at" in payload or "km_at" in payload):
        async for s in db.asset_service_schedules.find(
            {"asset_id": asset_id, "deleted_at": None, "status": "active"}):
            await _recompute_and_save(s, asset)

    return new_doc


@router.post("/{asset_id}/meter")
async def update_meter(asset_id: str, body: MeterUpdateIn, user: dict = Depends(get_current_user)):
    """Quick-action endpoint — same as creating a `meter_update` record."""
    if body.hours is None and body.km is None:
        raise HTTPException(400, "Provide hours or km")
    payload = RecordIn(
        type="meter_update",
        title="Meter update",
        hours_at=body.hours, km_at=body.km,
    )
    return await create_record.__wrapped__(asset_id, payload, user) if hasattr(create_record, "__wrapped__") else await create_record(asset_id, payload, user)


# ────────────────── Reminder scan ──────────────────

@router.post("/service/scan-reminders")
async def scan_reminders(user: dict = Depends(get_current_user)):
    if user.get("role") not in {"admin", "manager", "hseq_lead"}:
        raise HTTPException(403, "Admin/Manager only")
    org_id = user["org_id"]
    scanned = 0; due_soon = 0; overdue = 0; emails_sent = 0; sms_sent = 0
    cutoff = (_utcnow() - timedelta(hours=24)).isoformat()

    async for sched in db.asset_service_schedules.find(
        {"org_id": org_id, "status": "active", "deleted_at": None},
    ):
        scanned += 1
        asset = await db.assets.find_one({"id": sched["asset_id"]})
        if not asset:
            continue
        nd = _compute_next_due(sched, asset)
        st = nd["status"]
        if st == "ok":
            continue
        if st == "due_soon": due_soon += 1
        if st == "overdue":  overdue += 1
        # Dedupe per (schedule, status) within 24h.
        dup = await db.asset_reminders_sent.find_one({
            "schedule_id": sched["id"], "status": st, "sent_at": {"$gte": cutoff},
        })
        if dup:
            continue
        # Send email via existing outbox + SMS via TextMagic (best-effort).
        try:
            from email_outbox import queue_email_doc
            ws = await db.workspaces.find_one({"id": asset.get("workspace_id")}) if asset.get("workspace_id") else None
            recipients = []
            if ws and ws.get("safety_lead_email"):
                recipients.append(ws["safety_lead_email"])
            async for u in db.users.find({"org_id": org_id, "role": {"$in": ["admin", "manager", "hseq_lead"]}}):
                if u.get("email"): recipients.append(u["email"])
            recipients = list(set(recipients))
            subject = f"[{st.upper()}] Service due: {asset.get('name')} ({sched['name']})"
            body_html = (
                f"<p>{sched['name']} on <b>{asset.get('name')}</b> ({asset.get('rego_serial') or '—'}) is <b>{st.replace('_', ' ')}</b>.</p>"
                f"<p>Open the asset register to log service: <a href='https://app.paneltec.com.au/app/vehicles'>Plant &amp; Vehicles</a></p>"
            )
            for to in recipients:
                await queue_email_doc(
                    org_id=org_id, to=[to], subject=subject, body_html=body_html,
                    resource_kind="assets", related_record_type="asset_service_schedule",
                    related_record_id=sched["id"], created_by=user["id"],
                )
                emails_sent += 1
        except Exception as e:
            log.warning("asset reminder email failed for schedule=%s: %s", sched.get("id"), e)

    # SMS
    try:
        # v58.13.85 — Route through safe_send_sms so Comms Safe Mode
        # is honoured (was previously a direct httpx call bypassing
        # the kill switch — the exact bug fixed in this ship).
        mobiles = []
        async for u in db.users.find({"org_id": org_id, "role": {"$in": ["admin", "manager"]}}):
            if u.get("mobile"): mobiles.append(u["mobile"])
        if mobiles:
            text = f"{st.upper()}: {sched['name']} on {asset.get('name')} {asset.get('rego_serial') or ''}"
            from integrations_textmagic import safe_send_sms
            res = await safe_send_sms(
                org_id, mobiles=mobiles, text=text[:160],
                triggered_by_endpoint="asset_service.scan_reminders",
            )
            if res.get("ok") and not res.get("blocked"):
                sms_sent += 1
    except Exception as e:
        log.warning("asset reminder SMS failed for schedule=%s: %s", sched.get("id"), e)

    await db.asset_reminders_sent.insert_one({
        "id": new_id(), "schedule_id": sched["id"], "asset_id": sched["asset_id"],
        "status": st, "sent_at": now_iso(), "org_id": org_id,
    })

    return {"scanned": scanned, "due_soon": due_soon, "overdue": overdue,
            "emails_sent": emails_sent, "sms_sent": sms_sent}


# ────────────────── Dashboard summary ──────────────────

# v58.13.18 — Due & Generated inbox. Org-wide, single round-trip.
# Combined read for the "Service Inbox" tab in PlantVehicles.jsx.
# `due`      — active schedules whose `_compute_next_due` status is
#              overdue or due_soon (no cached-status shortcut — meters
#              tick between reminder-cron runs, so recompute per call).
# `generated`— asset_service_records inserted by the v58.13.17 cron
#              (generated_by == "asset_service_generate", performed_at
#              is null, deleted_at is null) i.e. cron-created but not
#              yet acted on. Zero rows until ASSET_SERVICE_GENERATE_CRON
#              is switched on in env.
# Asset name/rego/kind is joined server-side so tiles don't need a
# per-row lookup. Response cap defaults to 200, hard-max 500.
@router.get("/service/inbox")
async def service_inbox(
    limit: int = Query(200, ge=1, le=500),
    user: dict = Depends(get_current_user),
):
    org_id = user["org_id"]
    # Small per-request asset cache so the DUE loop doesn't refetch
    # the same asset for multiple schedules on the same vehicle.
    asset_cache: dict[str, dict] = {}

    async def _asset(aid: str) -> Optional[dict]:
        if aid in asset_cache:
            return asset_cache[aid]
        a = await db.assets.find_one(
            {"id": aid, "org_id": org_id, "deleted_at": None},
            {"_id": 0, "id": 1, "name": 1, "rego_serial": 1, "kind": 1,
             "hours_meter": 1, "odo_km": 1},
        )
        asset_cache[aid] = a
        return a

    due: list[dict] = []
    async for s in db.asset_service_schedules.find(
        {"org_id": org_id, "status": "active", "deleted_at": None},
        {"_id": 0},
    ):
        a = await _asset(s["asset_id"])
        if not a:
            continue
        nd = _compute_next_due(s, a)
        if nd["status"] not in {"overdue", "due_soon"}:
            continue
        due.append({
            "schedule_id": s["id"],
            "asset_id": s["asset_id"],
            "workspace_id": s.get("workspace_id"),
            "name": s.get("name"),
            "task_identification": s.get("task_identification"),
            "task_type": s.get("task_type"),
            "priority": s.get("priority"),
            "interval_kind": s.get("interval_kind"),
            "calendar_unit": s.get("calendar_unit"),
            "next_due_value": nd["next_due_value"],
            "next_due_at": nd["next_due_at"],
            "next_due_at_primary": nd["next_due_at_primary"],
            "next_due_at_secondary": nd["next_due_at_secondary"],
            "next_due_value_secondary": nd["next_due_value_secondary"],
            "status": nd["status"],
            "asset": {"id": a["id"], "name": a.get("name"),
                      "rego_serial": a.get("rego_serial"),
                      "kind": a.get("kind"),
                      "hours_meter": a.get("hours_meter"),
                      "odo_km": a.get("odo_km")},
        })
        if len(due) >= limit:
            break
    # Overdue first, then due_soon; within a bucket, earliest next_due_at.
    due.sort(key=lambda r: (
        0 if r["status"] == "overdue" else 1,
        r.get("next_due_at") or "9999",
    ))

    generated: list[dict] = []
    async for r in db.asset_service_records.find(
        {"org_id": org_id, "deleted_at": None, "performed_at": None,
         "generated_by": "asset_service_generate"},
        {"_id": 0},
    ).sort("created_at", -1).limit(limit):
        a = await _asset(r["asset_id"])
        if not a:
            continue
        generated.append({
            "record_id": r["id"],
            "asset_id": r["asset_id"],
            "workspace_id": r.get("workspace_id"),
            "schedule_id": r.get("schedule_id"),
            "type": r.get("type"),
            "title": r.get("title"),
            "description": r.get("description"),
            "created_at": r.get("created_at"),
            "generated_by_run_id": r.get("generated_by_run_id"),
            "hours_at": r.get("hours_at"),
            "km_at": r.get("km_at"),
            "asset": {"id": a["id"], "name": a.get("name"),
                      "rego_serial": a.get("rego_serial"),
                      "kind": a.get("kind"),
                      "hours_meter": a.get("hours_meter"),
                      "odo_km": a.get("odo_km")},
        })

    counts = {
        "overdue":   sum(1 for r in due if r["status"] == "overdue"),
        "due_soon":  sum(1 for r in due if r["status"] == "due_soon"),
        "generated": len(generated),
    }
    return {"due": due, "generated": generated, "counts": counts}


@router.get("/service/summary")
async def service_summary(user: dict = Depends(get_current_user)):
    org_id = user["org_id"]
    rows = []
    async for s in db.asset_service_schedules.find({"org_id": org_id, "status": "active", "deleted_at": None}, {"_id": 0}):
        asset = await db.assets.find_one(
            {"id": s["asset_id"]},
            {"_id": 0, "name": 1, "rego_serial": 1, "kind": 1,
             "hours_meter": 1, "odo_km": 1, "created_at": 1},
        )
        if not asset:
            continue
        nd = _compute_next_due(s, asset)
        if nd["status"] == "ok":
            continue
        rows.append({**s, **nd, "asset": asset})
    rows.sort(key=lambda r: 0 if r["status"] == "overdue" else 1)
    return {
        "overdue": sum(1 for r in rows if r["status"] == "overdue"),
        "due_soon": sum(1 for r in rows if r["status"] == "due_soon"),
        "items": rows[:5],
    }


# ────────────────── Public scan quick-action ──────────────────

@scan_router.post("/quick-action")
async def scan_quick_action(body: QuickActionIn, user: dict = Depends(get_current_user)):
    # Workers can resolve a scan token to any asset they're allowed to see —
    # i.e. workspace-scoped: workspace_id IS NULL (org-wide Navixy) OR in
    # user.workspace_ids. Admins still see everything in their org.
    asset = await _resolve_asset_for_user(user, body.scan_token)
    p = body.payload or {}

    # Phase 3.8 — open_form: lightweight access check before the client
    # navigates to the Fill-out modal. Returns the template id + asset id so
    # the caller can stamp the resulting submission.
    if body.action == "open_form":
        tpl_id = (p.get("template_id") or "").strip()
        if not tpl_id:
            raise HTTPException(422, "template_id is required for open_form")
        tpl = await db.form_templates.find_one(
            {"id": tpl_id, "org_id": user["org_id"], "deleted_at": None},
            {"_id": 0, "id": 1, "name": 1},
        )
        if not tpl:
            raise HTTPException(404, "Template not found")
        return {
            "ok": True,
            "asset_id": asset["id"],
            "scan_token": asset["scan_token"],
            "template_id": tpl["id"],
            "template_name": tpl["name"],
        }

    if body.action == "log_service":
        rec = RecordIn(
            type="service",
            title=p.get("title") or "Service log",
            description=p.get("description"),
            schedule_id=p.get("schedule_id"),
            hours_at=p.get("hours_at"), km_at=p.get("km_at"),
            cost=p.get("cost"),
            technician_name=p.get("technician_name"),
            photo_file_ids=p.get("photo_file_ids") or [],
        )
    elif body.action == "report_defect":
        rec = RecordIn(
            type="defect",
            title=p.get("title") or "Defect reported",
            description=p.get("description"),
            defect_severity=p.get("defect_severity") or "minor",
            photo_file_ids=p.get("photo_file_ids") or [],
        )
    else:  # update_meter
        rec = RecordIn(
            type="meter_update",
            title="Meter update",
            hours_at=p.get("hours"), km_at=p.get("km"),
        )
    return await create_record(asset["id"], rec, user)

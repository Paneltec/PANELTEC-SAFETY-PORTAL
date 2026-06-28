"""Phase 3 — Service & Maintenance for Plant & Vehicles.

Schedule rules (hours / km / calendar) per asset, completed service-record
ledger, defect → hazard auto-link (workspace-configurable), and a reminder
scanner that fans out via the existing M365 + TextMagic plumbing.
"""
from __future__ import annotations
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from auth import get_current_user
from db import db
from models import new_id, now_iso

log = logging.getLogger("paneltec.assets.service")

router = APIRouter(prefix="/assets", tags=["asset-service"])
scan_router = APIRouter(prefix="/scan", tags=["asset-scan-action"])

IntervalKind = Literal["hours", "km", "calendar"]
CalendarUnit = Literal["days", "weeks", "months", "years"]
RecordType = Literal["service", "defect", "meter_update"]
DefectSeverity = Literal["minor", "major", "critical"]


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


def _compute_next_due(sched: dict, asset: dict) -> dict:
    """Return {next_due_value, next_due_at, status, lead_window} for a schedule."""
    kind = sched["interval_kind"]
    interval = float(sched.get("interval_value") or 0)
    last_v = sched.get("last_done_value")
    last_at = _parse_iso(sched.get("last_done_at")) if isinstance(sched.get("last_done_at"), str) else sched.get("last_done_at")
    lead_days = int(sched.get("reminder_lead_days") or 7)
    lead_hours = float(sched.get("reminder_lead_hours") or max(interval * 0.05, 5))
    lead_km = float(sched.get("reminder_lead_km") or max(interval * 0.05, 100))
    out: dict[str, Any] = {"next_due_value": None, "next_due_at": None, "status": "ok"}

    if kind == "hours":
        base = float(last_v) if last_v is not None else 0.0
        next_v = base + interval
        cur = float(asset.get("hours_meter") or 0)
        out["next_due_value"] = next_v
        if cur >= next_v:
            out["status"] = "overdue"
        elif cur >= next_v - lead_hours:
            out["status"] = "due_soon"
    elif kind == "km":
        base = float(last_v) if last_v is not None else 0.0
        next_v = base + interval
        cur = float(asset.get("odo_km") or 0)
        out["next_due_value"] = next_v
        if cur >= next_v:
            out["status"] = "overdue"
        elif cur >= next_v - lead_km:
            out["status"] = "due_soon"
    elif kind == "calendar":
        unit = sched.get("calendar_unit") or "days"
        anchor = last_at or _parse_iso(sched.get("created_at")) or _utcnow()
        nxt = _add_calendar(anchor, int(interval), unit)
        out["next_due_at"] = nxt.isoformat()
        now = _utcnow()
        if now >= nxt:
            out["status"] = "overdue"
        elif now >= nxt - timedelta(days=lead_days):
            out["status"] = "due_soon"
    return out


async def _recompute_and_save(sched: dict, asset: dict) -> dict:
    nd = _compute_next_due(sched, asset)
    await db.asset_service_schedules.update_one(
        {"id": sched["id"]},
        {"$set": {
            "next_due_value": nd["next_due_value"],
            "next_due_at": nd["next_due_at"],
            "status_cached": nd["status"],
            "updated_at": now_iso(),
        }},
    )
    return {**sched, **nd, "status_cached": nd["status"]}


# ────────────────── models ──────────────────

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
    status: Literal["active", "paused"] = "active"


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
    technician_signature_file_id: Optional[str] = None
    invoice_file_id: Optional[str] = None
    photo_file_ids: list[str] = Field(default_factory=list)
    defect_severity: Optional[DefectSeverity] = None


class MeterUpdateIn(BaseModel):
    hours: Optional[float] = Field(default=None, ge=0)
    km: Optional[float] = Field(default=None, ge=0)


class QuickActionIn(BaseModel):
    scan_token: str = Field(min_length=4, max_length=64)
    action: Literal["log_service", "report_defect", "update_meter"]
    payload: dict[str, Any] = Field(default_factory=dict)


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
    ts = now_iso()
    doc = {
        "id": new_id(), "asset_id": asset_id, "org_id": user["org_id"],
        "workspace_id": asset.get("workspace_id"),
        **body.dict(),
        "created_at": ts, "updated_at": ts, "created_by": user["id"],
        "deleted_at": None,
    }
    nd = _compute_next_due(doc, asset)
    doc.update({"next_due_value": nd["next_due_value"], "next_due_at": nd["next_due_at"], "status_cached": nd["status"]})
    await db.asset_service_schedules.insert_one(doc)
    out = dict(doc); out.pop("_id", None); return out


@router.put("/{asset_id}/schedules/{sid}")
async def update_schedule(asset_id: str, sid: str, body: ScheduleIn, user: dict = Depends(get_current_user)):
    asset = await _get_asset(asset_id, user["org_id"])
    existing = await db.asset_service_schedules.find_one({"id": sid, "asset_id": asset_id, "org_id": user["org_id"], "deleted_at": None})
    if not existing:
        raise HTTPException(404, "Schedule not found")
    merged = {**existing, **body.dict(), "updated_at": now_iso()}
    nd = _compute_next_due(merged, asset)
    merged.update({"next_due_value": nd["next_due_value"], "next_due_at": nd["next_due_at"], "status_cached": nd["status"]})
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
    res = await db.asset_service_records.update_one(
        {"id": rid, "asset_id": asset_id, "org_id": user["org_id"], "deleted_at": None},
        {"$set": {"deleted_at": now_iso()}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Record not found")
    return None


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
            tm = await db.integration_configs.find_one({"org_id": org_id, "kind": "textmagic"})
            tm_cfg = (tm or {}).get("config") or {}
            if tm_cfg.get("username") and tm_cfg.get("api_key"):
                import httpx
                mobiles = []
                async for u in db.users.find({"org_id": org_id, "role": {"$in": ["admin", "manager"]}}):
                    if u.get("mobile"): mobiles.append(u["mobile"])
                if mobiles:
                    text = f"{st.upper()}: {sched['name']} on {asset.get('name')} {asset.get('rego_serial') or ''}"
                    async with httpx.AsyncClient(timeout=10) as c:
                        await c.post("https://rest.textmagic.com/api/v2/messages",
                                     headers={"X-TM-Username": tm_cfg["username"], "X-TM-Key": tm_cfg["api_key"]},
                                     data={"text": text, "phones": ",".join(mobiles)})
                    sms_sent += len(mobiles)
        except Exception as e:
            log.warning("asset reminder SMS failed for schedule=%s: %s", sched.get("id"), e)

        await db.asset_reminders_sent.insert_one({
            "id": new_id(), "schedule_id": sched["id"], "asset_id": sched["asset_id"],
            "status": st, "sent_at": now_iso(), "org_id": org_id,
        })

    return {"scanned": scanned, "due_soon": due_soon, "overdue": overdue,
            "emails_sent": emails_sent, "sms_sent": sms_sent}


# ────────────────── Dashboard summary ──────────────────

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
    ws_ids = user.get("workspace_ids") or []
    q: dict = {
        "org_id": user["org_id"],
        "scan_token": body.scan_token,
        "deleted_at": None,
    }
    if user.get("role") not in {"admin", "manager", "hseq_lead"}:
        q["$or"] = [{"workspace_id": None}, {"workspace_id": {"$in": ws_ids}}]
    asset = await db.assets.find_one(q)
    if not asset:
        raise HTTPException(404, "Unknown scan token")
    if asset.get("status") == "retired":
        raise HTTPException(410, "Asset retired")
    p = body.payload or {}
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

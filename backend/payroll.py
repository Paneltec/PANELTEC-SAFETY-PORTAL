"""Paneltec Pay — timesheets, pay periods, approvals and export.

Phase 1 (vendor-independent). The app captures hours, breaks and
allowances per worker per day (pre-filled from site sign-ons), a
supervisor approves them, and each pay period is summarised and
exported as CSV for whichever payroll provider does the compliance
side (tax, super, STP, payslips). A provider connector plugs in later.

Overtime figures here are ESTIMATES for planning and checking only —
the payroll provider's award interpretation is the source of truth.

Collections
  pay_settings       one per org
  pay_profiles       one per worker (employment type, ordinary hours…)
  timesheet_entries  one per worker per day (see TimesheetEntry)
  pay_periods        one per period once anything touches it

Routes
  /payroll/...        pay officer / admin  (permission: payroll.view / payroll.edit)
  /me/payroll/...     the signed-in worker's own timesheets
"""
from __future__ import annotations

import csv
import io
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from auth import get_current_user
from db import db
from models import new_id, now_iso
from permissions import require_permission

log = logging.getLogger("paneltec.payroll")

router = APIRouter(prefix="/payroll", tags=["payroll"])
from payroll_workbench import router as workbench_router
router.include_router(workbench_router)
from payroll_banking import router as banking_router
router.include_router(banking_router)
from payroll_employee_records import router as employee_records_router
router.include_router(employee_records_router)
me_router = APIRouter(prefix="/me/payroll", tags=["payroll-me"])

WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
STATUSES = ("draft", "submitted", "approved", "rejected", "locked")
DEFAULT_ALLOWANCES = [
    {"code": "travel", "label": "Travel allowance", "unit": "day"},
    {"code": "meal", "label": "Meal allowance", "unit": "each"},
    {"code": "site", "label": "Site allowance", "unit": "day"},
    {"code": "first_aid", "label": "First aid allowance", "unit": "day"},
]


# ── Settings ─────────────────────────────────────────────────────────

class OvertimeRules(BaseModel):
    """Estimate only. Daily threshold then 1.5x for the first N hours, 2x after."""
    daily_ordinary_hours: float = Field(7.6, ge=0, le=24)
    first_tier_hours: float = Field(2.0, ge=0, le=24)
    first_tier_rate: float = Field(1.5, ge=1, le=5)
    second_tier_rate: float = Field(2.0, ge=1, le=5)
    saturday_rate: float = Field(1.5, ge=1, le=5)
    sunday_rate: float = Field(2.0, ge=1, le=5)


class AllowanceType(BaseModel):
    code: str = Field(min_length=1, max_length=40)
    label: str = Field(min_length=1, max_length=80)
    unit: str = Field("day", pattern=r"^(day|hour|each)$")


class PaySettings(BaseModel):
    period_type: str = Field("weekly", pattern=r"^(weekly|fortnightly)$")
    week_starts: str = Field("friday", pattern=r"^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$")
    # For fortnightly: a date that starts one of the periods, so we know which week is which.
    period_anchor: Optional[str] = None
    ordinary_hours_per_week: float = Field(38, ge=0, le=80)
    default_break_minutes: int = Field(30, ge=0, le=240)
    default_start: str = Field("07:00", pattern=r"^\d{2}:\d{2}$")
    default_finish: str = Field("15:36", pattern=r"^\d{2}:\d{2}$")
    rdo_enabled: bool = True
    rdo_accrual_hours_per_day: float = Field(0.4, ge=0, le=8)
    overtime: OvertimeRules = OvertimeRules()
    allowance_types: List[AllowanceType] = Field(default_factory=lambda: [AllowanceType(**a) for a in DEFAULT_ALLOWANCES])
    submit_reminder: bool = True


async def get_settings(org_id: str) -> Dict[str, Any]:
    doc = await db.pay_settings.find_one({"org_id": org_id}, {"_id": 0})
    if not doc:
        return {"org_id": org_id, **PaySettings().model_dump()}
    merged = {**PaySettings().model_dump(), **doc}
    return merged


@router.get("/settings")
async def read_settings(user: dict = Depends(require_permission("payroll", "view"))):
    return await get_settings(user["org_id"])


@router.put("/settings")
async def write_settings(body: PaySettings, user: dict = Depends(require_permission("payroll", "edit"))):
    doc = {**body.model_dump(), "org_id": user["org_id"], "updated_at": now_iso(), "updated_by": user["id"]}
    await db.pay_settings.update_one({"org_id": user["org_id"]}, {"$set": doc}, upsert=True)
    return await get_settings(user["org_id"])


# ── Pay periods (pure functions, tested) ─────────────────────────────

def _parse_date(s: str) -> date:
    try:
        return date.fromisoformat(s[:10])
    except Exception:  # noqa: BLE001
        raise HTTPException(400, f"Bad date: {s!r} (use YYYY-MM-DD)")


def period_for(day: date, settings: Dict[str, Any]) -> Dict[str, Any]:
    """The pay period containing `day`: {id, start, end} with ISO dates.
    Weekly periods start on `week_starts`. Fortnightly ones also honour
    `period_anchor` so the right week is the first of the pair."""
    ws = WEEKDAYS.index(settings.get("week_starts", "friday"))
    delta = (day.weekday() - ws) % 7
    start = day - timedelta(days=delta)
    length = 7
    if settings.get("period_type") == "fortnightly":
        length = 14
        anchor_s = settings.get("period_anchor")
        anchor = _parse_date(anchor_s) if anchor_s else date(2024, 1, 1)
        anchor -= timedelta(days=(anchor.weekday() - ws) % 7)
        weeks_since = (start - anchor).days // 7
        if weeks_since % 2:
            start -= timedelta(days=7)
    end = start + timedelta(days=length - 1)
    return {"id": start.isoformat(), "start": start.isoformat(), "end": end.isoformat()}


def periods_between(first: date, last: date, settings: Dict[str, Any]) -> List[Dict[str, Any]]:
    out = []
    p = period_for(first, settings)
    while _parse_date(p["start"]) <= last:
        out.append(p)
        p = period_for(_parse_date(p["end"]) + timedelta(days=1), settings)
    return out


def hours_between(start: Optional[str], finish: Optional[str], break_minutes: int) -> float:
    """Worked hours from HH:MM strings (finish after midnight allowed)."""
    if not start or not finish:
        return 0.0
    try:
        sh, sm = [int(x) for x in start.split(":")]
        fh, fm = [int(x) for x in finish.split(":")]
    except ValueError:
        raise HTTPException(400, "Times must be HH:MM")
    if not (0 <= sh <= 23 and 0 <= fh <= 23 and 0 <= sm <= 59 and 0 <= fm <= 59):
        raise HTTPException(422, "Enter real times between 00:00 and 23:59")
    mins = (fh * 60 + fm) - (sh * 60 + sm)
    if mins < 0:
        mins += 24 * 60
    if int(break_minutes or 0) > mins:raise HTTPException(422, "Break cannot exceed the shift duration")
    mins -= max(0, int(break_minutes or 0))
    return round(max(0, mins) / 60, 2)


def split_overtime(hours: float, day: date, rules: Dict[str, Any]) -> Dict[str, float]:
    """ESTIMATE: split a day's hours into ordinary / ot_1 / ot_2 buckets.
    Weekends: all hours at the weekend rate (reported as ot_1 for
    Saturday, ot_2 for Sunday) — a simplification, clearly labelled."""
    hours = max(0.0, float(hours or 0))
    if day.weekday() == 5:
        return {"ordinary": 0.0, "ot_1": round(hours, 2), "ot_2": 0.0}
    if day.weekday() == 6:
        return {"ordinary": 0.0, "ot_1": 0.0, "ot_2": round(hours, 2)}
    ordinary = min(hours, float(rules.get("daily_ordinary_hours", 7.6)))
    rest = hours - ordinary
    ot1 = min(rest, float(rules.get("first_tier_hours", 2.0)))
    ot2 = rest - ot1
    return {"ordinary": round(ordinary, 2), "ot_1": round(ot1, 2), "ot_2": round(ot2, 2)}


@router.get("/periods")
async def list_periods(months_back: int = Query(3, ge=0, le=24),
                       user: dict = Depends(require_permission("payroll", "view"))):
    """Recent periods (newest first) with their status and entry counts."""
    settings = await get_settings(user["org_id"])
    today = date.today()
    ps = periods_between(today - timedelta(days=30 * months_back), today, settings)
    ids = [p["id"] for p in ps]
    stored = {d["id"]: d async for d in db.pay_periods.find(
        {"org_id": user["org_id"], "id": {"$in": ids}}, {"_id": 0})}
    counts: Dict[str, Dict[str, int]] = {}
    async for row in db.timesheet_entries.aggregate([
        {"$match": {"org_id": user["org_id"], "period_id": {"$in": ids}}},
        {"$group": {"_id": {"p": "$period_id", "s": "$status"}, "n": {"$sum": 1}, "h": {"$sum": "$hours"}}},
    ]):
        c = counts.setdefault(row["_id"]["p"], {})
        c[row["_id"]["s"]] = row["n"]
        c["hours"] = round(c.get("hours", 0) + (row.get("h") or 0), 2)
    out = []
    for p in reversed(ps):
        st = stored.get(p["id"], {})
        out.append({**p, "status": st.get("status", "open"), "closed_at": st.get("closed_at"),
                    "exported_at": st.get("exported_at"), "counts": counts.get(p["id"], {}),
                    "current": p["start"] <= today.isoformat() <= p["end"]})
    return {"periods": out, "settings": settings}


@router.post("/periods/{period_id}/close")
async def close_period(period_id: str, user: dict = Depends(require_permission("payroll", "edit"))):
    """Lock every approved entry in the period. Unapproved ones stay as they are."""
    settings = await get_settings(user["org_id"])
    p = period_for(_parse_date(period_id), settings)
    if p["id"] != period_id:
        raise HTTPException(400, "Not a period start date")
    pending = await db.timesheet_entries.count_documents(
        {"org_id": user["org_id"], "period_id": period_id, "status": {"$in": ["submitted"]}})
    if pending:
        raise HTTPException(409, f"{pending} timesheet(s) still waiting for approval.")
    await db.timesheet_entries.update_many(
        {"org_id": user["org_id"], "period_id": period_id, "status": "approved"},
        {"$set": {"status": "locked", "updated_at": now_iso()}})
    await db.pay_periods.update_one(
        {"org_id": user["org_id"], "id": period_id},
        {"$set": {**p, "org_id": user["org_id"], "status": "closed", "closed_at": now_iso(), "closed_by": user["id"]}},
        upsert=True)
    return {"ok": True}


@router.post("/periods/{period_id}/reopen")
async def reopen_period(period_id: str, user: dict = Depends(require_permission("payroll", "edit"))):
    await db.timesheet_entries.update_many(
        {"org_id": user["org_id"], "period_id": period_id, "status": "locked"},
        {"$set": {"status": "approved", "updated_at": now_iso()}})
    await db.pay_periods.update_one(
        {"org_id": user["org_id"], "id": period_id},
        {"$set": {"status": "open", "reopened_at": now_iso(), "reopened_by": user["id"]}})
    return {"ok": True}


# ── Pay profiles ─────────────────────────────────────────────────────

class PayProfileIn(BaseModel):
    employment_type: str = Field("full_time", pattern=r"^(full_time|part_time|casual|contractor)$")
    classification: Optional[str] = Field(None, max_length=120)
    ordinary_hours_per_week: Optional[float] = Field(None, ge=0, le=80)
    rdo_enabled: Optional[bool] = None
    payroll_employee_id: Optional[str] = Field(None, max_length=80)
    default_site_id: Optional[str] = None
    notes: Optional[str] = Field(None, max_length=1000)


async def _workers(org_id: str) -> List[Dict[str, Any]]:
    from payroll_roster import roster
    return await roster(org_id)


@router.get("/profiles")
async def list_profiles(user: dict = Depends(require_permission("payroll", "view"))):
    workers = await _workers(user["org_id"])
    profiles = {p["worker_id"]: p async for p in db.pay_profiles.find({"org_id": user["org_id"]}, {"_id": 0})}
    settings = await get_settings(user["org_id"])
    out = []
    for w in workers:
        p = profiles.get(w["id"], {})
        out.append({
            "worker_id": w["id"], "name": w["name"], "position": w.get("position") or "",
            "active": w.get("active", True), "email": w.get("email") or "",
            "employment_type": p.get("employment_type", "full_time"),
            "classification": p.get("classification") or "",
            "ordinary_hours_per_week": p.get("ordinary_hours_per_week") or settings["ordinary_hours_per_week"],
            "rdo_enabled": p.get("rdo_enabled", settings["rdo_enabled"]),
            "payroll_employee_id": p.get("payroll_employee_id") or "",
            "default_site_id": p.get("default_site_id"),
            "notes": p.get("notes") or "",
        })
    return {"profiles": out}


@router.put("/profiles/{worker_id}")
async def put_profile(worker_id: str, body: PayProfileIn,
                      user: dict = Depends(require_permission("payroll", "edit"))):
    allowed = {w["id"] for w in await _workers(user["org_id"])}
    if worker_id not in allowed:
        raise HTTPException(404, "Worker not found")
    doc = {k: v for k, v in body.model_dump().items() if v is not None}
    doc.update({"org_id": user["org_id"], "worker_id": worker_id, "updated_at": now_iso(), "updated_by": user["id"]})
    await db.pay_profiles.update_one({"org_id": user["org_id"], "worker_id": worker_id},
                                     {"$set": doc, "$setOnInsert": {"id": new_id(), "created_at": now_iso()}},
                                     upsert=True)
    return {"ok": True}


# ── Timesheet entries ────────────────────────────────────────────────

class Allowance(BaseModel):
    code: str = Field(min_length=1, max_length=40)
    qty: float = Field(1, ge=0, le=100)


class TimesheetEntryIn(BaseModel):
    worker_id: str
    date: str
    start: Optional[str] = Field(None, pattern=r"^\d{2}:\d{2}$")
    finish: Optional[str] = Field(None, pattern=r"^\d{2}:\d{2}$")
    break_minutes: int = Field(30, ge=0, le=600)
    hours: Optional[float] = Field(None, ge=0, le=24)   # explicit hours when no times (e.g. RDO taken)
    kind: str = Field("work", pattern=r"^(work|rdo|leave|public_holiday|no_work)$")
    site_id: Optional[str] = None
    site_name: Optional[str] = Field(None, max_length=160)
    job_ref: Optional[str] = Field(None, max_length=120)
    allowances: List[Allowance] = Field(default_factory=list)
    notes: Optional[str] = Field(None, max_length=1000)


class TimesheetEntryPatch(BaseModel):
    start: Optional[str] = Field(None, pattern=r"^\d{2}:\d{2}$")
    finish: Optional[str] = Field(None, pattern=r"^\d{2}:\d{2}$")
    break_minutes: Optional[int] = Field(None, ge=0, le=600)
    hours: Optional[float] = Field(None, ge=0, le=24)
    kind: Optional[str] = Field(None, pattern=r"^(work|rdo|leave|public_holiday|no_work)$")
    site_id: Optional[str] = None
    site_name: Optional[str] = Field(None, max_length=160)
    job_ref: Optional[str] = Field(None, max_length=120)
    allowances: Optional[List[Allowance]] = None
    notes: Optional[str] = Field(None, max_length=1000)
    status: Optional[str] = Field(None, pattern=r"^(draft|submitted)$")


def _compute(entry: Dict[str, Any], settings: Dict[str, Any]) -> Dict[str, Any]:
    """Fill hours/period/overtime estimate on an entry dict (in place)."""
    d = _parse_date(entry["date"])
    entry["period_id"] = period_for(d, settings)["id"]
    if entry.get("kind", "work") == "work":
        if "segments" in entry:
            from payroll_segments import aggregate
            entry.update(aggregate(entry["segments"]))
        elif entry.get("start") and entry.get("finish"):
            entry["hours"] = hours_between(entry["start"], entry["finish"], entry.get("break_minutes", 0))
        else:
            entry["hours"] = float(entry.get("hours") or 0)
        entry["estimate"] = split_overtime(entry["hours"], d, settings.get("overtime", {}))
    else:
        entry["hours"] = float(entry.get("hours") or 0)
        entry["estimate"] = {"ordinary": entry["hours"], "ot_1": 0.0, "ot_2": 0.0}
    return entry


def _out(e: Dict[str, Any]) -> Dict[str, Any]:
    e.pop("_id", None)
    return e


async def _entry_or_404(org_id: str, entry_id: str) -> Dict[str, Any]:
    e = await db.timesheet_entries.find_one({"id": entry_id, "org_id": org_id})
    if not e:
        raise HTTPException(404, "Timesheet entry not found")
    return e


@router.get("/timesheets")
async def list_timesheets(period_id: Optional[str] = None, start: Optional[str] = None, end: Optional[str] = None,
                          worker_id: Optional[str] = None,
                          user: dict = Depends(require_permission("payroll", "view"))):
    """Entries for a period (or a date range), plus the worker list and
    the period's dates so the grid can be drawn."""
    settings = await get_settings(user["org_id"])
    if period_id:
        p = period_for(_parse_date(period_id), settings)
    elif start and end:
        p = {"id": None, "start": start, "end": end}
    else:
        p = period_for(date.today(), settings)
    q: Dict[str, Any] = {"org_id": user["org_id"], "date": {"$gte": p["start"], "$lte": p["end"]}}
    if worker_id:
        q["worker_id"] = worker_id
    entries = [_out(e) async for e in db.timesheet_entries.find(q).sort([("date", 1)])]
    workers = await _workers(user["org_id"])
    profiles = {pr["worker_id"]: pr async for pr in db.pay_profiles.find({"org_id": user["org_id"]}, {"_id": 0})}
    for w in workers:
        w["employment_type"] = profiles.get(w["id"], {}).get("employment_type", "full_time")
    stored = await db.pay_periods.find_one({"org_id": user["org_id"], "id": p["id"]}, {"_id": 0}) if p["id"] else None
    return {"period": {**p, "status": (stored or {}).get("status", "open")},
            "days": [(_parse_date(p["start"]) + timedelta(days=i)).isoformat()
                     for i in range((_parse_date(p["end"]) - _parse_date(p["start"])).days + 1)],
            "workers": [w for w in workers if w.get("active", True) or any(e["worker_id"] == w["id"] for e in entries)],
            "entries": entries, "settings": settings}


@router.post("/timesheets")
async def create_timesheet(body: TimesheetEntryIn, user: dict = Depends(require_permission("payroll", "edit"))):
    if body.worker_id not in {w["id"] for w in await _workers(user["org_id"])}:raise HTTPException(422,"Choose a current Simpro employee")
    settings = await get_settings(user["org_id"])
    _parse_date(body.date)
    dup = await db.timesheet_entries.find_one(
        {"org_id": user["org_id"], "worker_id": body.worker_id, "date": body.date}, {"_id": 0, "id": 1})
    if dup:
        raise HTTPException(409, "There is already an entry for that worker on that day — edit it instead.")
    e = {**body.model_dump(), "id": new_id(), "org_id": user["org_id"], "status": "draft",
         "source": "manual", "created_by": user["id"], "created_at": now_iso(), "updated_at": now_iso()}
    _compute(e, settings)
    await db.timesheet_entries.insert_one(dict(e))
    return _out(e)


@router.patch("/timesheets/{entry_id}")
async def patch_timesheet(entry_id: str, body: TimesheetEntryPatch,
                          user: dict = Depends(require_permission("payroll", "edit"))):
    settings = await get_settings(user["org_id"])
    e = await _entry_or_404(user["org_id"], entry_id)
    if e.get("status") == "locked":
        raise HTTPException(409, "This period is closed. Reopen it to make changes.")
    from payroll_segments import unlocked
    await unlocked(user['org_id'], e['date'])
    if 'segments' in e: raise HTTPException(409, 'Send this day back to the worker to edit its client time entries.')
    changes = {k: v for k, v in body.model_dump().items() if v is not None}
    e.update(changes)
    if e.get("status") == "rejected" and "status" not in changes:
        e["status"] = "draft"
    e["updated_at"] = now_iso()
    e["updated_by"] = user["id"]
    _compute(e, settings)
    await db.timesheet_entries.replace_one({"id": entry_id}, {k: v for k, v in e.items() if k != "_id"})
    return _out(e)


@router.delete("/timesheets/{entry_id}")
async def delete_timesheet(entry_id: str, user: dict = Depends(require_permission("payroll", "edit"))):
    e = await _entry_or_404(user["org_id"], entry_id)
    if e.get("status") == "locked":
        raise HTTPException(409, "This period is closed. Reopen it to make changes.")
    from payroll_segments import unlocked
    await unlocked(user['org_id'], e['date'])
    if 'segments' in e: raise HTTPException(409, 'Send this day back to the worker to remove time entries.')
    await db.timesheet_entries.delete_one({'org_id':user['org_id'], "id": entry_id})
    return {"ok": True}


class IdsIn(BaseModel):
    ids: List[str] = Field(default_factory=list)
    reason: Optional[str] = Field(None, max_length=500)


@router.post("/timesheets/approve")
async def approve_timesheets(body: IdsIn, user: dict = Depends(require_permission("payroll", "edit"))):
    from payroll_segments import unlocked
    for entry_id in body.ids:
        entry = await _entry_or_404(user['org_id'], entry_id)
        await unlocked(user['org_id'], entry['date'])
    r = await db.timesheet_entries.update_many(
        {"org_id": user["org_id"], "id": {"$in": body.ids}, "status": {"$in": ["draft", "submitted", "rejected"]}},
        {"$set": {"status": "approved", "approved_by": user["id"], "approved_by_name": user.get("name") or user.get("email"),
                  "approved_at": now_iso(), "updated_at": now_iso(), "rejected_reason": None}})
    return {"ok": True, "approved": r.modified_count}


@router.post("/timesheets/reject")
async def reject_timesheets(body: IdsIn, user: dict = Depends(require_permission("payroll", "edit"))):
    from payroll_segments import unlocked
    for entry_id in body.ids:
        entry = await _entry_or_404(user['org_id'], entry_id)
        await unlocked(user['org_id'], entry['date'])
    r = await db.timesheet_entries.update_many(
        {"org_id": user["org_id"], "id": {"$in": body.ids}, "status": {"$in": ["draft", "submitted", "approved"]}},
        {"$set": {"status": "rejected", "rejected_by": user["id"], "rejected_at": now_iso(),
                  "rejected_reason": body.reason or "", "updated_at": now_iso()}})
    return {"ok": True, "rejected": r.modified_count}


@router.post("/timesheets/prefill")
async def prefill_from_signons(period_id: Optional[str] = None,
                               user: dict = Depends(require_permission("payroll", "edit"))):
    """Create draft entries from site sign-ons for every worker/day in the
    period that has no entry yet. First sign-on = start, last sign-off =
    finish. Days with a sign-on but no sign-off get the default finish
    and a note, so someone checks them."""
    settings = await get_settings(user["org_id"])
    p = period_for(_parse_date(period_id) if period_id else date.today(), settings)
    existing = set()
    async for e in db.timesheet_entries.find(
            {"org_id": user["org_id"], "period_id": p["id"]}, {"_id": 0, "worker_id": 1, "date": 1}):
        existing.add((e["worker_id"], e["date"]))
    by_day: Dict[tuple, Dict[str, Any]] = {}
    q = {"org_id": user["org_id"], "signed_at": {"$gte": p["start"], "$lt": (_parse_date(p["end"]) + timedelta(days=1)).isoformat()}}
    async for s in db.site_signons.find(q, {"_id": 0}):
        wid = s.get("worker_id")
        if not wid:
            continue
        signed = _local(s.get("signed_at"))
        if not signed:
            continue
        key = (wid, signed.date().isoformat())
        if key in existing:
            continue
        cur = by_day.setdefault(key, {"first": signed, "last": None, "site_id": s.get("site_id"),
                                      "site_name": s.get("site_name"), "open": False})
        if signed < cur["first"]:
            cur["first"] = signed
            cur["site_id"], cur["site_name"] = s.get("site_id"), s.get("site_name")
        off = _local(s.get("signoff_at"))
        if off and (cur["last"] is None or off > cur["last"]):
            cur["last"] = off
        if not off:
            cur["open"] = True
    created = 0
    for (wid, day), v in by_day.items():
        e = {
            "id": new_id(), "org_id": user["org_id"], "worker_id": wid, "date": day, "kind": "work",
            "start": v["first"].strftime("%H:%M"),
            "finish": v["last"].strftime("%H:%M") if v["last"] else settings["default_finish"],
            "break_minutes": settings["default_break_minutes"],
            "site_id": v["site_id"], "site_name": v["site_name"], "job_ref": None, "allowances": [],
            "notes": None if v["last"] else "No sign-off recorded — finish time is the default, please check.",
            "status": "draft", "source": "signon", "created_by": user["id"],
            "created_at": now_iso(), "updated_at": now_iso(),
        }
        _compute(e, settings)
        await db.timesheet_entries.insert_one(dict(e))
        created += 1
    return {"ok": True, "created": created, "period": p}


def _local(iso: Optional[str]) -> Optional[datetime]:
    """Sign-on timestamps are UTC ISO strings; show them in Hobart time."""
    if not iso:
        return None
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    try:
        from zoneinfo import ZoneInfo
        return dt.astimezone(ZoneInfo("Australia/Hobart"))
    except Exception:  # noqa: BLE001
        return dt.astimezone(timezone(timedelta(hours=10)))


# ── Summary + export ─────────────────────────────────────────────────

async def _summary(org_id: str, period_id: str) -> Dict[str, Any]:
    settings = await get_settings(org_id)
    p = period_for(_parse_date(period_id), settings)
    workers = {w["id"]: w for w in await _workers(org_id)}
    profiles = {pr["worker_id"]: pr async for pr in db.pay_profiles.find({"org_id": org_id}, {"_id": 0})}
    rows: Dict[str, Dict[str, Any]] = {}

    def row(wid: str) -> Dict[str, Any]:
        if wid not in rows:
            w = workers.get(wid, {})
            pr = profiles.get(wid, {})
            rows[wid] = {"worker_id": wid, "name": w.get("name") or "(unknown)",
                         "payroll_employee_id": pr.get("payroll_employee_id") or "",
                         "employment_type": pr.get("employment_type", "full_time"),
                         "days": 0, "hours": 0.0, "ordinary": 0.0, "ot_1": 0.0, "ot_2": 0.0,
                         "rdo_taken": 0.0, "rdo_accrued": 0.0, "leave_hours": 0.0, "public_holiday": 0.0,
                         "allowances": {}, "status": {"draft": 0, "submitted": 0, "approved": 0, "rejected": 0, "locked": 0}}
        return rows[wid]

    async for e in db.timesheet_entries.find({"org_id": org_id, "period_id": p["id"]}):
        r = row(e["worker_id"])
        r["status"][e.get("status", "draft")] = r["status"].get(e.get("status", "draft"), 0) + 1
        kind = e.get("kind", "work")
        h = float(e.get("hours") or 0)
        if kind == "work":
            r["days"] += 1
            r["hours"] = round(r["hours"] + h, 2)
            est = e.get("estimate") or {}
            for k in ("ordinary", "ot_1", "ot_2"):
                r[k] = round(r[k] + float(est.get(k) or 0), 2)
            if profiles.get(e["worker_id"], {}).get("rdo_enabled", settings["rdo_enabled"]) and h > 0:
                r["rdo_accrued"] = round(r["rdo_accrued"] + settings["rdo_accrual_hours_per_day"], 2)
            for a in e.get("allowances") or []:
                r["allowances"][a["code"]] = round(r["allowances"].get(a["code"], 0) + float(a.get("qty") or 0), 2)
        elif kind == "rdo":
            r["rdo_taken"] = round(r["rdo_taken"] + h, 2)
        elif kind == "leave":
            r["leave_hours"] = round(r["leave_hours"] + h, 2)
        elif kind == "public_holiday":
            r["public_holiday"] = round(r["public_holiday"] + h, 2)

    # Approved leave requests that fall in the period (from the Leave feature).
    async for lr in db.leave_requests.find(
            {"org_id": org_id, "status": "approved", "start_date": {"$lte": p["end"]}, "end_date": {"$gte": p["start"]}},
            {"_id": 0, "worker_id": 1, "employee_name": 1, "hours": 1, "leave_type": 1, "start_date": 1, "end_date": 1}):
        wid = lr.get("worker_id")
        if not wid:
            continue
        r = row(wid)
        r.setdefault("approved_leave", []).append(
            {"type": lr.get("leave_type"), "start": lr.get("start_date"), "end": lr.get("end_date"), "hours": lr.get("hours")})

    out = sorted(rows.values(), key=lambda r: r["name"].lower())
    totals = {"workers": len(out), "hours": round(sum(r["hours"] for r in out), 2),
              "ordinary": round(sum(r["ordinary"] for r in out), 2),
              "ot_1": round(sum(r["ot_1"] for r in out), 2), "ot_2": round(sum(r["ot_2"] for r in out), 2),
              "unapproved": sum(r["status"]["draft"] + r["status"]["submitted"] + r["status"]["rejected"] for r in out)}
    return {"period": p, "rows": out, "totals": totals, "settings": settings}


@router.get("/summary")
async def summary(period_id: Optional[str] = None, user: dict = Depends(require_permission("payroll", "view"))):
    settings = await get_settings(user["org_id"])
    pid = period_id or period_for(date.today(), settings)["id"]
    return await _summary(user["org_id"], pid)


@router.get("/export")
async def export_csv(period_id: str, fmt: str = Query("summary", pattern=r"^(summary|daily)$"),
                     user: dict = Depends(require_permission("payroll", "view"))):
    """CSV for the payroll provider. `summary` = one row per worker;
    `daily` = one row per worker per day (what most timesheet imports want)."""
    s = await _summary(user["org_id"], period_id)
    buf = io.StringIO()
    w = csv.writer(buf)
    codes = [a["code"] for a in s["settings"].get("allowance_types", [])]
    if fmt == "summary":
        w.writerow(["Payroll ID", "Worker", "Employment", "Period start", "Period end", "Days", "Total hours",
                    "Ordinary (est)", "OT 1.5x (est)", "OT 2x (est)", "RDO taken", "RDO accrued", "Leave hours",
                    "Public holiday", *[f"Allowance: {c}" for c in codes], "Unapproved entries"])
        for r in s["rows"]:
            w.writerow([r["payroll_employee_id"], r["name"], r["employment_type"], s["period"]["start"], s["period"]["end"],
                        r["days"], r["hours"], r["ordinary"], r["ot_1"], r["ot_2"], r["rdo_taken"], r["rdo_accrued"],
                        r["leave_hours"], r["public_holiday"], *[r["allowances"].get(c, 0) for c in codes],
                        r["status"]["draft"] + r["status"]["submitted"] + r["status"]["rejected"]])
    else:
        w.writerow(["Payroll ID", "Worker", "Date", "Kind", "Start", "Finish", "Break (min)", "Hours", "Site", "Job",
                    *[f"Allowance: {c}" for c in codes], "Notes", "Status"])
        workers = {r["worker_id"]: r for r in s["rows"]}
        async for e in db.timesheet_entries.find({"org_id": user["org_id"], "period_id": s["period"]["id"]}).sort(
                [("worker_id", 1), ("date", 1)]):
            r = workers.get(e["worker_id"], {})
            al = {a["code"]: a.get("qty", 0) for a in e.get("allowances") or []}
            w.writerow([r.get("payroll_employee_id", ""), r.get("name", ""), e.get("date"), e.get("kind", "work"),
                        e.get("start") or "", e.get("finish") or "", e.get("break_minutes", 0), e.get("hours", 0),
                        e.get("site_name") or "", e.get("job_ref") or "", *[al.get(c, 0) for c in codes],
                        e.get("notes") or "", e.get("status")])
    await db.pay_periods.update_one({"org_id": user["org_id"], "id": s["period"]["id"]},
                                    {"$set": {**s["period"], "org_id": user["org_id"], "exported_at": now_iso(), "exported_by": user["id"]},
                                     "$setOnInsert": {"status": "open"}}, upsert=True)
    buf.seek(0)
    name = f"paneltec-pay-{fmt}-{s['period']['start']}_to_{s['period']['end']}.csv"
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="{name}"'})


# ── Worker-side (phone / My Work) ────────────────────────────────────

async def _my_worker_id(user: dict) -> str:
    from payroll_roster import my_worker
    return await my_worker(user)


@me_router.get("/timesheets")
async def my_timesheets(period_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    settings = await get_settings(user["org_id"])
    wid = await _my_worker_id(user)
    p = period_for(_parse_date(period_id) if period_id else date.today(), settings)
    entries = [_out(e) async for e in db.timesheet_entries.find(
        {"org_id": user["org_id"], "worker_id": wid, "date": {"$gte": p["start"], "$lte": p["end"]}}).sort([("date", 1)])]
    return {"period": p, "entries": entries, "worker_id": wid,
            "days": [(_parse_date(p["start"]) + timedelta(days=i)).isoformat()
                     for i in range((_parse_date(p["end"]) - _parse_date(p["start"])).days + 1)],
            "allowance_types": settings.get("allowance_types", []),
            "defaults": {"start": settings["default_start"], "finish": settings["default_finish"],
                         "break_minutes": settings["default_break_minutes"]}}


class MyEntryIn(BaseModel):
    date: str
    start: Optional[str] = Field(None, pattern=r"^\d{2}:\d{2}$")
    finish: Optional[str] = Field(None, pattern=r"^\d{2}:\d{2}$")
    break_minutes: int = Field(30, ge=0, le=600)
    kind: str = Field("work", pattern=r"^(work|rdo|no_work)$")
    hours: Optional[float] = Field(None, ge=0, le=24)
    site_name: Optional[str] = Field(None, max_length=160)
    job_ref: Optional[str] = Field(None, max_length=120)
    allowances: List[Allowance] = Field(default_factory=list)
    notes: Optional[str] = Field(None, max_length=1000)


@me_router.put("/timesheets/{day}")
async def my_upsert(day: str, body: MyEntryIn, user: dict = Depends(get_current_user)):
    """A worker writes their own day (draft). Approved/locked days can't be changed."""
    settings = await get_settings(user["org_id"])
    wid = await _my_worker_id(user)
    _parse_date(day)
    from payroll_segments import unlocked
    await unlocked(user['org_id'], day)
    if body.date != day:
        raise HTTPException(400, "Date mismatch")
    existing = await db.timesheet_entries.find_one({"org_id": user["org_id"], "worker_id": wid, "date": day})
    if existing and (existing.get("status") in ("submitted", "approved", "locked") or "segments" in existing):
        raise HTTPException(409, "This day is sent or uses client entries. Refresh your app; ask the office to send back a submitted day.")
    e = {**(existing or {}), **body.model_dump(), "worker_id": wid, "org_id": user["org_id"],
         "status": "draft", "updated_at": now_iso(), "updated_by": user["id"]}
    if not existing:
        e.update({"id": new_id(), "source": "worker", "created_by": user["id"], "created_at": now_iso()})
    _compute(e, settings)
    e.pop("_id", None)
    await db.timesheet_entries.replace_one({"org_id": user["org_id"], "worker_id": wid, "date": day}, e, upsert=True)
    return _out(e)


@me_router.post("/submit")
async def my_submit(period_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    settings = await get_settings(user["org_id"])
    wid = await _my_worker_id(user)
    p = period_for(_parse_date(period_id) if period_id else date.today(), settings)
    async for run in db.pay_review_sheets.find({'org_id':user['org_id'],'state':'finalized'}):
        run_end=(_parse_date(run['week'])+timedelta(days=6)).isoformat()
        if run['week']<=p['end'] and run_end>=p['start']:raise HTTPException(409,'Payroll for this week is locked. Ask the pay officer to open a correction.')
    r = await db.timesheet_entries.update_many(
        {"org_id": user["org_id"], "worker_id": wid, "date": {"$gte": p["start"], "$lte": p["end"]}, "hours": {"$gt": 0}, "status": {"$in": ["draft", "rejected"]}},
        {"$set": {"status": "submitted", "submitted_at": now_iso(), "updated_at": now_iso()}})
    return {"ok": True, "submitted": r.modified_count, "period": p}


async def ensure_payroll_indexes() -> None:
    await db.timesheet_entries.create_index([("org_id", 1), ("worker_id", 1), ("date", 1)], unique=True)
    await db.timesheet_entries.create_index([("org_id", 1), ("period_id", 1), ("status", 1)])
    await db.pay_profiles.create_index([("org_id", 1), ("worker_id", 1)], unique=True)
    await db.pay_periods.create_index([("org_id", 1), ("id", 1)], unique=True)

from payroll_segments import phone as segments_phone, office as segments_office
me_router.include_router(segments_phone)
router.include_router(segments_office)

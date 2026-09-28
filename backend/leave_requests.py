"""Leave Requests — read payroll leave emails, approve/reject, flag OH&S risks.

The payroll system has no API, but it emails a notification for every leave
request ("Leave Request Updated", "…Approved", etc.). This module:

  1. Reads those emails — either pulled from a Microsoft 365 mailbox
     (Graph, app-only, needs the `Mail.Read` + `Mail.ReadWrite` application
     permission on the existing M365 app registration) or pasted in by hand.
  2. Parses name / leave type / hours / dates / note / balance / request id.
  3. Matches the employee to a `workers` record.
  4. Lets a manager Approve / Reject / Ask-for-info in the portal — the
     decision is emailed to the Pay Officer (through the normal outbox, so
     Comms Safe Mode is respected). The Pay Officer actions it in payroll.
  5. Raises OH&S flags: repeated sick leave (wellbeing check-in), long
     absences (return-to-work form) and large untaken balances (fatigue).

Collection: `leave_requests` (upsert key = org_id + payroll_request_id).
Settings live in `org_settings.leave` (pay officer email, inbox mailbox).
Permissions reuse `workers.view` / `workers.edit` — no schema migration.
"""
from __future__ import annotations

import html as _html
import logging
import re
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, EmailStr, Field

from db import db
from permissions import require_permission

log = logging.getLogger("paneltec.leave")
router = APIRouter(prefix="/leave", tags=["leave-requests"])

GRAPH_BASE = "https://graph.microsoft.com/v1.0"

# OH&S thresholds (tweak here)
SICK_OCCURRENCES_90D = 3        # ≥3 separate sick requests in 90 days → check-in
LONG_ABSENCE_HOURS = 38 * 1     # ≥1 working week off sick → return-to-work form
FATIGUE_BALANCE_HOURS = 304     # ≥8 weeks annual leave banked → encourage a break


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Parser ────────────────────────────────────────────────────────────

_EVENT_WORDS = {
    "approved": "approved", "rejected": "rejected", "declined": "rejected",
    "cancelled": "cancelled", "canceled": "cancelled", "deleted": "cancelled",
    "updated": "updated", "submitted": "submitted", "new": "submitted",
}

_RE_APPLIED = re.compile(
    r"leave request for (?P<name>.+?) has been (?P<event>\w+)\.?\s*"
    r"They have applied for (?P<hours>[\d.,]+) hours? of (?P<type>.+?) "
    r"from (?P<start>\d{1,2}/\d{1,2}/\d{4}) to (?P<end>\d{1,2}/\d{1,2}/\d{4})",
    re.I | re.S,
)
_RE_BALANCE = re.compile(
    r"estimated to have (?P<bal>[-\d.,]+) hours? of (?P<type>.+?) available on "
    r"(?P<on>\d{1,2}/\d{1,2}/\d{4})", re.I)
_RE_REQ_ID = re.compile(r"Request\s*Id\s*[:\-]?\s*([A-Za-z0-9+/=_\-]{12,})", re.I)


def html_to_text(raw: str) -> str:
    """Crude but dependable HTML → text for payroll notification emails."""
    if "<" not in (raw or ""):
        return raw or ""
    t = re.sub(r"(?is)<(script|style).*?</\1>", " ", raw)
    t = re.sub(r"(?i)<br\s*/?>|</(p|div|tr|li|h\d|td)>", "\n", t)
    t = re.sub(r"<[^>]+>", " ", t)
    return _html.unescape(t)


def _au_date(s: str) -> str:
    d, m, y = (int(x) for x in s.split("/"))
    return date(y, m, d).isoformat()


def parse_leave_email(subject: str, body: str) -> Optional[dict]:
    """Return parsed fields, or None if this isn't a leave notification."""
    text = re.sub(r"[ \t\r\f\v]+", " ", html_to_text(body or ""))
    flat = re.sub(r"\s*\n\s*", "\n", text).strip()
    oneline = flat.replace("\n", " ")
    m = _RE_APPLIED.search(oneline)
    if not m:
        return None

    event_word = (m.group("event") or "").lower()
    subj = (subject or "").lower()
    event = "updated"
    for w, ev in _EVENT_WORDS.items():
        if w in subj:
            event = ev
            break
    else:
        event = _EVENT_WORDS.get(event_word, "updated")

    # Employee's note = the lines between the "applied for" sentence and the
    # "estimated to have" / "To approve" sentence.
    note = None
    try:
        tail = oneline[m.end():]
        stop = re.search(r"They are estimated|To approve|Regards,", tail, re.I)
        chunk = tail[: stop.start()] if stop else ""
        chunk = chunk.strip(" .\n")
        note = chunk or None
    except Exception:  # pragma: no cover
        pass

    bal = _RE_BALANCE.search(flat.replace("\n", " "))
    rid = _RE_REQ_ID.search(flat)

    leave_type = m.group("type").strip()
    return {
        "employee_name": re.sub(r"\s+", " ", m.group("name")).strip(),
        "event": event,
        "hours": float(m.group("hours").replace(",", "")),
        "leave_type": leave_type,
        "category": _category(leave_type),
        "start_date": _au_date(m.group("start")),
        "end_date": _au_date(m.group("end")),
        "employee_note": note,
        "balance_hours": float(bal.group("bal").replace(",", "")) if bal else None,
        "balance_on": _au_date(bal.group("on")) if bal else None,
        "payroll_request_id": rid.group(1) if rid else None,
    }


def _category(leave_type: str) -> str:
    t = leave_type.lower()
    if "sick" in t or "personal" in t or "carer" in t:
        return "sick"
    if "annual" in t or "holiday" in t:
        return "annual"
    if "long service" in t:
        return "long_service"
    if "unpaid" in t or "leave without" in t:
        return "unpaid"
    return "other"


# ── Matching + OH&S flags ─────────────────────────────────────────────

async def _match_worker(org_id: str, full_name: str) -> Optional[dict]:
    parts = full_name.split()
    if len(parts) < 2:
        return None
    first, last = parts[0], parts[-1]
    q = {
        "org_id": org_id,
        "first_name": {"$regex": f"^{re.escape(first)}$", "$options": "i"},
        "last_name": {"$regex": f"^{re.escape(last)}$", "$options": "i"},
    }
    return await db.workers.find_one(q, {"_id": 0, "id": 1, "first_name": 1, "last_name": 1})


async def _compute_flags(org_id: str, doc: dict) -> list[dict]:
    flags: list[dict] = []
    if doc.get("category") == "sick":
        since = (date.today() - timedelta(days=90)).isoformat()
        key = {"worker_id": doc["worker_id"]} if doc.get("worker_id") else {"employee_name": doc["employee_name"]}
        n = await db.leave_requests.count_documents({
            "org_id": org_id, **key, "category": "sick",
            "start_date": {"$gte": since}, "status": {"$ne": "cancelled"},
        })
        if n >= SICK_OCCURRENCES_90D:
            flags.append({"code": "sick_pattern", "label": f"{n} sick leave requests in 90 days — wellbeing check-in"})
        if (doc.get("hours") or 0) >= LONG_ABSENCE_HOURS:
            flags.append({"code": "return_to_work", "label": "Long sick absence — return-to-work form on return"})
    if doc.get("category") == "annual" and (doc.get("balance_hours") or 0) >= FATIGUE_BALANCE_HOURS:
        flags.append({"code": "fatigue", "label": f"{doc['balance_hours']:.0f} h annual leave banked — fatigue risk"})
    return flags


async def ingest_parsed(org_id: str, parsed: dict, *, source: str,
                        raw_subject: str = "", raw_body: str = "",
                        message_id: Optional[str] = None) -> dict:
    """Create or update a leave_requests row from a parsed email."""
    worker = await _match_worker(org_id, parsed["employee_name"])
    key = {"org_id": org_id}
    if parsed.get("payroll_request_id"):
        key["payroll_request_id"] = parsed["payroll_request_id"]
    else:  # no id → fall back to name + dates
        key.update({"employee_name": parsed["employee_name"],
                    "start_date": parsed["start_date"], "leave_type": parsed["leave_type"]})

    existing = await db.leave_requests.find_one(key, {"_id": 0})
    status_from_event = {"approved": "approved", "rejected": "rejected",
                         "cancelled": "cancelled"}.get(parsed["event"])

    fields = {k: parsed[k] for k in (
        "employee_name", "hours", "leave_type", "category", "start_date", "end_date",
        "employee_note", "balance_hours", "balance_on", "payroll_request_id")}
    fields.update({
        "worker_id": (worker or {}).get("id"),
        "last_event": parsed["event"],
        "updated_at": _now(),
    })
    history_entry = {"at": _now(), "event": parsed["event"], "source": source,
                     "hours": parsed["hours"], "start_date": parsed["start_date"],
                     "end_date": parsed["end_date"]}

    if existing:
        if status_from_event:
            fields["status"] = status_from_event
        elif existing.get("status") in ("approved", "rejected"):
            # payroll says it changed after we decided → needs another look
            fields["status"] = "pending"
        doc = {**existing, **fields}
        doc["flags"] = await _compute_flags(org_id, doc)
        await db.leave_requests.update_one(
            key, {"$set": {**fields, "flags": doc["flags"]},
                  "$push": {"history": history_entry}})
        return {**doc, "created": False}

    doc = {
        "id": str(uuid.uuid4()), "org_id": org_id, **fields,
        "status": status_from_event or "pending",
        "created_at": _now(), "source": source,
        "source_message_id": message_id,
        "raw_subject": (raw_subject or "")[:300],
        "raw_body": (raw_body or "")[:20000],
        "decision": None, "history": [history_entry],
    }
    await db.leave_requests.insert_one(dict(doc))
    doc.pop("_id", None)
    doc["flags"] = await _compute_flags(org_id, doc)   # after insert so it counts itself
    await db.leave_requests.update_one({"id": doc["id"]}, {"$set": {"flags": doc["flags"]}})
    return {**doc, "created": True}


# ── Settings ──────────────────────────────────────────────────────────

class LeaveSettings(BaseModel):
    pay_officer_email: Optional[EmailStr] = None
    inbox_mailbox: Optional[EmailStr] = None      # e.g. leave@paneltec.com.au
    auto_poll_enabled: bool = False
    subject_filter: str = "Leave Request"


async def _settings(org_id: str) -> dict:
    doc = await db.org_settings.find_one({"org_id": org_id}, {"_id": 0, "leave": 1}) or {}
    return {**LeaveSettings().model_dump(), **(doc.get("leave") or {})}


@router.get("/settings")
async def get_settings(user: dict = Depends(require_permission("workers", "view"))):
    return await _settings(user["org_id"])


@router.put("/settings")
async def put_settings(body: LeaveSettings, user: dict = Depends(require_permission("workers", "edit"))):
    await db.org_settings.update_one(
        {"org_id": user["org_id"]},
        {"$set": {"leave": body.model_dump(mode="json")}}, upsert=True)
    return await _settings(user["org_id"])


# ── List / summary / calendar ─────────────────────────────────────────

def _strip(d: dict) -> dict:
    d.pop("_id", None)
    d.pop("raw_body", None)
    return d


@router.get("")
async def list_leave(
    status: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None, alias="from"),
    date_to: Optional[str] = Query(None, alias="to"),
    q: Optional[str] = Query(None),
    user: dict = Depends(require_permission("workers", "view")),
):
    f: dict = {"org_id": user["org_id"]}
    if status:
        f["status"] = {"$in": status.split(",")}
    if category:
        f["category"] = category
    if date_from:
        f["end_date"] = {"$gte": date_from}
    if date_to:
        f["start_date"] = {"$lte": date_to}
    if q:
        f["employee_name"] = {"$regex": re.escape(q), "$options": "i"}
    rows = await db.leave_requests.find(f, {"_id": 0, "raw_body": 0}) \
        .sort([("start_date", 1)]).to_list(1000)
    return rows


@router.get("/summary")
async def summary(user: dict = Depends(require_permission("workers", "view"))):
    org = user["org_id"]
    today = date.today()
    wk_end = (today + timedelta(days=7)).isoformat()
    t = today.isoformat()
    live = {"org_id": org, "status": {"$in": ["approved", "pending"]}}
    return {
        "pending": await db.leave_requests.count_documents({"org_id": org, "status": "pending"}),
        "off_today": await db.leave_requests.count_documents(
            {**live, "status": "approved", "start_date": {"$lte": t}, "end_date": {"$gte": t}}),
        "off_next_7_days": await db.leave_requests.count_documents(
            {**live, "start_date": {"$lte": wk_end}, "end_date": {"$gte": t}}),
        "flagged": await db.leave_requests.count_documents(
            {"org_id": org, "flags.0": {"$exists": True}, "status": {"$ne": "cancelled"},
             "end_date": {"$gte": (today - timedelta(days=30)).isoformat()}}),
    }


async def workers_on_leave(org_id: str, day: str) -> list[dict]:
    """Helper for job allocation: who is off on `day` (YYYY-MM-DD)."""
    return await db.leave_requests.find(
        {"org_id": org_id, "status": {"$in": ["approved", "pending"]},
         "start_date": {"$lte": day}, "end_date": {"$gte": day}},
        {"_id": 0, "worker_id": 1, "employee_name": 1, "status": 1, "leave_type": 1},
    ).to_list(500)


@router.get("/on-date")
async def on_date(day: str = Query(..., alias="date"),
                  user: dict = Depends(require_permission("workers", "view"))):
    return await workers_on_leave(user["org_id"], day)


@router.get("/{leave_id}")
async def get_one(leave_id: str, user: dict = Depends(require_permission("workers", "view"))):
    d = await db.leave_requests.find_one({"org_id": user["org_id"], "id": leave_id}, {"_id": 0})
    if not d:
        raise HTTPException(404, "Leave request not found")
    return d


# ── Import (paste) + inbox poll ───────────────────────────────────────

class ImportEmailIn(BaseModel):
    subject: str = ""
    body: str = Field(..., min_length=20, max_length=200_000)


@router.post("/import-email")
async def import_email(body: ImportEmailIn, user: dict = Depends(require_permission("workers", "edit"))):
    parsed = parse_leave_email(body.subject, body.body)
    if not parsed:
        raise HTTPException(422, "Couldn't find a leave request in that email text.")
    doc = await ingest_parsed(user["org_id"], parsed, source="paste",
                              raw_subject=body.subject, raw_body=body.body)
    return _strip(doc)


async def poll_inbox(org_id: str) -> dict:
    """Read unread leave emails from the configured M365 mailbox."""
    from integrations_m365 import get_app_only_access_token
    s = await _settings(org_id)
    mailbox = s.get("inbox_mailbox")
    if not mailbox:
        raise HTTPException(400, "Set the leave inbox mailbox in Leave settings first.")
    token = await get_app_only_access_token(org_id)
    hdr = {"Authorization": f"Bearer {token}"}
    url = (f"{GRAPH_BASE}/users/{mailbox}/mailFolders/inbox/messages"
           f"?$filter=isRead eq false&$top=50&$select=id,subject,body,receivedDateTime")
    created = updated = skipped = 0
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(url, headers=hdr)
        if r.status_code >= 400:
            raise HTTPException(502, f"Mailbox read failed ({r.status_code}). "
                                     "Check the M365 app has Mail.ReadWrite permission.")
        for msg in r.json().get("value", []):
            subj = msg.get("subject") or ""
            if s.get("subject_filter") and s["subject_filter"].lower() not in subj.lower():
                skipped += 1
                continue
            parsed = parse_leave_email(subj, (msg.get("body") or {}).get("content", ""))
            if not parsed:
                skipped += 1
                continue
            doc = await ingest_parsed(org_id, parsed, source="inbox", raw_subject=subj,
                                      raw_body=(msg.get("body") or {}).get("content", ""),
                                      message_id=msg.get("id"))
            created += doc["created"]
            updated += (not doc["created"])
            await c.patch(f"{GRAPH_BASE}/users/{mailbox}/messages/{msg['id']}",
                          headers=hdr, json={"isRead": True})
    await db.org_settings.update_one({"org_id": org_id},
                                     {"$set": {"leave.last_polled_at": _now()}})
    return {"created": created, "updated": updated, "skipped": skipped}


@router.post("/poll-inbox")
async def poll_inbox_now(user: dict = Depends(require_permission("workers", "edit"))):
    return await poll_inbox(user["org_id"])


async def poll_all_orgs() -> None:
    """Scheduler entrypoint (every 10 min). Never raises."""
    async for cfg in db.org_settings.find({"leave.auto_poll_enabled": True},
                                          {"_id": 0, "org_id": 1}):
        try:
            res = await poll_inbox(cfg["org_id"])
            log.info("leave.poll org=%s %s", cfg["org_id"], res)
        except Exception as e:  # noqa: BLE001
            log.warning("leave.poll failed org=%s: %s", cfg.get("org_id"), e)


# ── Decision → email Pay Officer ──────────────────────────────────────

class DecisionIn(BaseModel):
    decision: str = Field(..., pattern="^(approve|reject|more_info)$")
    comment: Optional[str] = Field(None, max_length=2000)


def _fmt(d: str) -> str:
    return datetime.fromisoformat(d).strftime("%a %d/%m/%Y")


@router.post("/{leave_id}/decision")
async def decide(leave_id: str, body: DecisionIn,
                 user: dict = Depends(require_permission("workers", "edit"))):
    org = user["org_id"]
    lr = await db.leave_requests.find_one({"org_id": org, "id": leave_id}, {"_id": 0})
    if not lr:
        raise HTTPException(404, "Leave request not found")
    s = await _settings(org)
    pay_officer = s.get("pay_officer_email")
    if not pay_officer:
        raise HTTPException(400, "Set the Pay Officer email in Leave settings first.")

    new_status = {"approve": "approved", "reject": "rejected", "more_info": "info_requested"}[body.decision]
    verb = {"approve": "APPROVED", "reject": "NOT APPROVED", "more_info": "MORE INFO NEEDED"}[body.decision]
    who = user.get("name") or user.get("email") or "Manager"
    flags_html = "".join(f"<li>{_html.escape(f['label'])}</li>" for f in lr.get("flags") or [])
    body_html = f"""
      <p>Hi,</p>
      <p>The following leave request has been <b>{verb}</b> by {_html.escape(who)} in the Paneltec Safety Portal.
      Please action it in payroll.</p>
      <table cellpadding="4" style="border-collapse:collapse">
        <tr><td><b>Employee</b></td><td>{_html.escape(lr['employee_name'])}</td></tr>
        <tr><td><b>Leave type</b></td><td>{_html.escape(lr['leave_type'])}</td></tr>
        <tr><td><b>Dates</b></td><td>{_fmt(lr['start_date'])} – {_fmt(lr['end_date'])}</td></tr>
        <tr><td><b>Hours</b></td><td>{lr['hours']:g}</td></tr>
        <tr><td><b>Payroll request id</b></td><td style="font-size:11px">{_html.escape(lr.get('payroll_request_id') or '—')}</td></tr>
      </table>
      {f'<p><b>Manager comment:</b> {_html.escape(body.comment)}</p>' if body.comment else ''}
      {f'<p><b>OH&amp;S notes:</b></p><ul>{flags_html}</ul>' if flags_html else ''}
      <p>Regards,<br>Paneltec Safety Portal</p>"""

    from email_outbox import queue_email_doc
    email = await queue_email_doc(
        org_id=org, to=[pay_officer],
        subject=f"Leave {verb.title()}: {lr['employee_name']} {_fmt(lr['start_date'])}",
        body_html=body_html, created_by=user["id"], resource_kind="leave_request",
        related_record_type="leave_request", related_record_id=leave_id,
    )
    decision = {"decision": body.decision, "comment": body.comment, "by_user_id": user["id"],
                "by_name": who, "at": _now(), "email_id": (email or {}).get("id"),
                "email_status": (email or {}).get("status")}
    await db.leave_requests.update_one(
        {"org_id": org, "id": leave_id},
        {"$set": {"status": new_status, "decision": decision, "updated_at": _now()},
         "$push": {"history": {"at": _now(), "event": f"decision:{body.decision}",
                               "source": "portal", "by": who}}})
    return {**lr, "status": new_status, "decision": decision}


async def ensure_leave_indexes() -> None:
    await db.leave_requests.create_index([("org_id", 1), ("payroll_request_id", 1)])
    await db.leave_requests.create_index([("org_id", 1), ("start_date", 1), ("end_date", 1)])
    await db.leave_requests.create_index([("org_id", 1), ("status", 1)])


# ══════════════════════════════════════════════════════════════════════
# Phone side — workers request leave from the field app (.132p3b)
# ══════════════════════════════════════════════════════════════════════
from pathlib import Path  # noqa: E402

from fastapi import File, UploadFile  # noqa: E402
from fastapi.responses import FileResponse  # noqa: E402

from auth import get_current_user  # noqa: E402

me_router = APIRouter(prefix="/me/leave", tags=["leave-requests-me"])

HOURS_PER_DAY = 7.6
CERT_DIR = Path(__file__).parent / "uploads" / "leave_certs"
CERT_MAX_BYTES = 8 * 1024 * 1024
LEAVE_TYPES = {
    "annual": "Annual Leave",
    "sick": "Personal/Carer's Leave",
    "long_service": "Long Service Leave",
    "unpaid": "Leave Without Pay",
    "other": "Other Leave",
}
WORKER_STATUS = {
    "pending": "Waiting for approval",
    "info_requested": "Office needs more info",
    "approved": "Approved",
    "rejected": "Not approved",
    "cancelled": "Cancelled",
}


async def _my_worker(user: dict) -> dict:
    email = (user.get("email") or "").lower()
    w = await db.workers.find_one(
        {"org_id": user["org_id"], "deleted_at": None,
         "$or": [{"user_id": user["id"]}] + ([{"email": email}] if email else [])},
        {"_id": 0, "id": 1, "first_name": 1, "last_name": 1})
    if not w:
        raise HTTPException(404, "Your phone isn't linked to a worker record yet — ask the office.")
    return w


def _working_days(start: date, end: date) -> int:
    n, d = 0, start
    while d <= end:
        if d.weekday() < 5:
            n += 1
        d += timedelta(days=1)
    return n


def _for_worker(d: dict) -> dict:
    return {
        "id": d["id"], "leave_type": d["leave_type"], "category": d["category"],
        "start_date": d["start_date"], "end_date": d["end_date"], "hours": d["hours"],
        "reason": d.get("employee_note"), "status": d["status"],
        "status_label": WORKER_STATUS.get(d["status"], d["status"]),
        "has_certificate": bool(d.get("certificate_file")),
        "created_at": d.get("created_at"), "source": d.get("source"),
        "decided_at": (d.get("decision") or {}).get("at"),
        "in_payroll": bool(d.get("payroll_request_id")),
        "can_cancel": d["status"] in ("pending", "info_requested", "approved")
                      and d["start_date"] > date.today().isoformat(),
    }


class MyLeaveIn(BaseModel):
    category: str = Field(..., pattern="^(annual|sick|long_service|unpaid|other)$")
    start_date: date
    end_date: date
    hours: Optional[float] = Field(None, gt=0, le=1000)
    reason: Optional[str] = Field(None, max_length=500)


@me_router.get("")
async def my_leave(user: dict = Depends(get_current_user)):
    w = await _my_worker(user)
    rows = await db.leave_requests.find(
        {"org_id": user["org_id"], "worker_id": w["id"]}, {"_id": 0, "raw_body": 0}
    ).sort([("start_date", -1)]).to_list(200)
    balances: dict = {}
    for r in sorted(rows, key=lambda r: r.get("updated_at") or ""):
        if r.get("balance_hours") is not None:
            balances[r["category"]] = {"hours": r["balance_hours"], "as_at": r.get("balance_on")}
    return {"requests": [_for_worker(r) for r in rows], "balances": balances,
            "hours_per_day": HOURS_PER_DAY}


@me_router.post("")
async def create_my_leave(body: MyLeaveIn, user: dict = Depends(get_current_user)):
    if body.end_date < body.start_date:
        raise HTTPException(422, "The last day can't be before the first day.")
    if body.start_date < date.today() - timedelta(days=14):
        raise HTTPException(422, "That's more than two weeks ago — talk to the office.")
    days = _working_days(body.start_date, body.end_date)
    if days == 0 and not body.hours:
        raise HTTPException(422, "Those dates are a weekend — enter the hours you need.")
    hours = round(body.hours or days * HOURS_PER_DAY, 2)
    w = await _my_worker(user)
    org = user["org_id"]
    name = f"{w.get('first_name', '')} {w.get('last_name', '')}".strip()

    clash = await db.leave_requests.find_one({
        "org_id": org, "worker_id": w["id"], "status": {"$in": ["pending", "approved", "info_requested"]},
        "start_date": {"$lte": body.end_date.isoformat()}, "end_date": {"$gte": body.start_date.isoformat()},
    }, {"_id": 0, "start_date": 1})
    if clash:
        raise HTTPException(409, "You already have leave booked over some of those days.")

    doc = {
        "id": str(uuid.uuid4()), "org_id": org, "worker_id": w["id"], "employee_name": name,
        "leave_type": LEAVE_TYPES[body.category], "category": body.category,
        "start_date": body.start_date.isoformat(), "end_date": body.end_date.isoformat(),
        "hours": hours, "employee_note": (body.reason or "").strip() or None,
        "balance_hours": None, "balance_on": None, "payroll_request_id": None,
        "status": "pending", "last_event": "submitted", "source": "app",
        "requested_by_user_id": user["id"], "created_at": _now(), "updated_at": _now(),
        "decision": None, "certificate_file": None,
        "history": [{"at": _now(), "event": "submitted", "source": "app", "by": name}],
    }
    await db.leave_requests.insert_one(dict(doc))
    doc["flags"] = await _compute_flags(org, doc)
    await db.leave_requests.update_one({"id": doc["id"]}, {"$set": {"flags": doc["flags"]}})
    return _for_worker(doc)


@me_router.post("/{leave_id}/cancel")
async def cancel_my_leave(leave_id: str, user: dict = Depends(get_current_user)):
    w = await _my_worker(user)
    org = user["org_id"]
    d = await db.leave_requests.find_one({"org_id": org, "id": leave_id, "worker_id": w["id"]}, {"_id": 0})
    if not d:
        raise HTTPException(404, "Leave request not found")
    if not _for_worker(d)["can_cancel"]:
        raise HTTPException(409, "This request can't be cancelled from the phone — talk to the office.")
    await db.leave_requests.update_one(
        {"id": leave_id},
        {"$set": {"status": "cancelled", "updated_at": _now()},
         "$push": {"history": {"at": _now(), "event": "cancelled", "source": "app", "by": d["employee_name"]}}})
    return _for_worker({**d, "status": "cancelled"})


@me_router.post("/{leave_id}/certificate")
async def upload_certificate(leave_id: str, file: UploadFile = File(...),
                             user: dict = Depends(get_current_user)):
    w = await _my_worker(user)
    d = await db.leave_requests.find_one(
        {"org_id": user["org_id"], "id": leave_id, "worker_id": w["id"]}, {"_id": 0, "id": 1})
    if not d:
        raise HTTPException(404, "Leave request not found")
    data = await file.read()
    if len(data) > CERT_MAX_BYTES:
        raise HTTPException(413, "That photo is too big (8 MB max).")
    ext = {"image/png": ".png", "application/pdf": ".pdf"}.get(file.content_type or "", ".jpg")
    CERT_DIR.mkdir(parents=True, exist_ok=True)
    name = f"{leave_id}{ext}"
    (CERT_DIR / name).write_bytes(data)
    await db.leave_requests.update_one(
        {"id": leave_id},
        {"$set": {"certificate_file": name, "updated_at": _now()},
         "$push": {"history": {"at": _now(), "event": "certificate_added", "source": "app"}}})
    return {"ok": True}


@router.get("/{leave_id}/certificate")
async def get_certificate(leave_id: str, user: dict = Depends(require_permission("workers", "edit"))):
    d = await db.leave_requests.find_one({"org_id": user["org_id"], "id": leave_id},
                                         {"_id": 0, "certificate_file": 1})
    if not d or not d.get("certificate_file"):
        raise HTTPException(404, "No certificate on this request")
    return FileResponse(str(CERT_DIR / d["certificate_file"]))

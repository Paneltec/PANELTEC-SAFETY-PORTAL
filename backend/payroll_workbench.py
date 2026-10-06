"""Saved payroll review worksheets; does not send payments, STP or post leave."""
import csv
import io
import hashlib
import json
from datetime import date, timedelta
from typing import Annotated, Literal
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field, ConfigDict
from pymongo.errors import DuplicateKeyError
from db import db
from models import now_iso
from permissions import require_permission
from payroll_engine import calculate_line, next_payday, RULE_VERSION, SOURCES, rounded

router = APIRouter(prefix="/workbench", tags=["payroll-review"])
from payroll_branding import router as branding_router
router.include_router(branding_router)
Number = Annotated[float, Field(ge=0, le=10000000, allow_inf_nan=False)]
Hours = Annotated[float, Field(ge=0, le=168, allow_inf_nan=False)]

class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")

class Rules(Strict):
    ot1_multiplier: float = Field(1.5, ge=1, le=5, allow_inf_nan=False)
    ot2_multiplier: float = Field(2, ge=1, le=5, allow_inf_nan=False)
    super_percent: float = Field(12, ge=12, le=100, allow_inf_nan=False)

class Profile(Strict):
    super_fund_name: str = Field('', max_length=160)
    super_fund_usi: str = Field('', max_length=32)
    employment_type: Literal["unconfirmed", "full_time", "part_time", "casual", "contractor"] = "unconfirmed"
    hourly_rate: Number = 0
    ordinary_weekly_hours: Hours = 38
    classification: str = Field("", max_length=200)
    conditions_reviewed: bool = False
    tax_mode: Literal["unconfirmed", "resident_threshold", "resident_no_threshold", "manual"] = "unconfirmed"
    tax_declaration_reviewed: bool = False
    annual_weeks: float = Field(4, ge=4, le=12, allow_inf_nan=False)
    personal_weeks: float = Field(2, ge=2, le=12, allow_inf_nan=False)
    leave_loading_percent: float = Field(0, ge=0, le=100, allow_inf_nan=False)

class Entry(Strict):
    deduction_details: str = Field('', max_length=1000)
    allowance_details: str = Field('', max_length=1000)
    ordinary: Hours = 0
    ot1: Hours = 0
    ot2: Hours = 0
    annual: Hours = 0
    personal: Hours = 0
    public_holiday: Hours = 0
    taxable_allowances: Number = 0
    post_tax_deductions: Number = 0
    reimbursements: Number = 0
    extra_withholding: Number = 0
    manual_payg: Number | None = None
    payg_reference: str = Field("", max_length=300)
    qualifying_earnings: Number | None = None
    super_reviewed: bool = False
    hours_reviewed: bool = False
    opening_annual: Number | None = None
    opening_personal: Number | None = None

class LeaveAllocation(Strict):
    leave_id: str = Field(min_length=1, max_length=100)
    fingerprint: str = Field(pattern=r'^[a-f0-9]{64}$')
    category: Literal['annual', 'personal']
    hours: float = Field(gt=0, le=168, allow_inf_nan=False)

class Row(Strict):
    adjustment_reason: str = Field("", max_length=1000)
    worker_id: str = Field(min_length=1, max_length=100)
    timesheet_fingerprint: str = Field("", pattern=r"^(|[a-f0-9]{64})$")
    profile: Profile = Field(default_factory=Profile)
    entry: Entry = Field(default_factory=Entry)
    leave_sources: list[LeaveAllocation] = Field(default_factory=list, max_length=30)

class Worksheet(Strict):
    revision: int = Field(0, ge=0)
    payday: date
    rules: Rules = Field(default_factory=Rules)
    rows: list[Row] = Field(default_factory=list, max_length=500)
    reviewed: bool = False

class Connections(Strict):
    super_provider: str = Field('', max_length=160)
    stp_provider: str = Field('', max_length=160)
    notes: str = Field('', max_length=1000)

class ArchiveRequest(Strict):
    revision: int = Field(gt=0)
    correction_reason: str = Field('', max_length=1000)

@router.get('/{week}/archive')
async def archived_runs(week: str, user=Depends(require_permission('payroll','view'))):
    period(week)
    records=[{k:v for k,v in item.items() if k!='_id'} async for item in db.pay_run_archive.find({'org_id':user['org_id'],'week':week})]
    return {'records':sorted(records,key=lambda item:item['revision'],reverse=True)}

@router.post('/{week}/archive')
async def archive_run(week: str, body: ArchiveRequest, user=Depends(require_permission('payroll','edit'))):
    period(week)
    key=f"{user['org_id']}:{week}:{body.revision}"
    existing=await db.pay_run_archive.find_one({'_id':key})
    if existing:return {'revision':existing['revision'],'already_archived':True}
    saved=await db.pay_review_sheets.find_one({'_id':f"{user['org_id']}:{week}"})
    if not saved or saved['worksheet']['revision']!=body.revision:
        raise HTTPException(409,'Reload the current saved revision before archiving')
    worksheet=Worksheet(**saved['worksheet'])
    if not worksheet.reviewed:raise HTTPException(422,'Mark the worksheet reviewed before archiving')
    calculated=await check_leave_sources(worksheet,user['org_id'],week,report(worksheet,{r['worker_id']:r['name'] for r in saved['report']['rows']}))
    if not calculated['ready']:raise HTTPException(422,'Resolve changed leave or payroll review items before archiving')
    previous=await db.pay_run_archive.find_one({'org_id':user['org_id'],'week':week},sort=[('revision',-1)])
    if previous and not body.correction_reason.strip():raise HTTPException(422,'Explain the correction to the previous archived version')
    snapshot=next((item for item in saved.get('history',[]) if item['revision']==body.revision),None)
    if not snapshot:raise HTTPException(409,'Save a new reviewed revision to capture an archive snapshot')
    record={'_id':key,'org_id':user['org_id'],'week':week,'revision':body.revision,
            'archived_at':now_iso(),'archived_by':user['id'],'snapshot':snapshot,
            'previous_revision':previous['revision'] if previous else None,
            'correction_reason':body.correction_reason.strip(),'status':'reviewed_not_paid'}
    try:await db.pay_run_archive.insert_one(record)
    except DuplicateKeyError:return {'revision':body.revision,'already_archived':True}
    return {'revision':body.revision,'already_archived':False}

@router.get('/connections/settings')
async def connections(user=Depends(require_permission('payroll','view'))):
    saved=await db.pay_connection_settings.find_one({'_id':user['org_id']},{'_id':0})
    return {**(saved or Connections().model_dump()),'super_status':'not_connected','stp_status':'not_connected'}

@router.put('/connections/settings')
async def save_connections(body:Connections,user=Depends(require_permission('payroll','edit'))):
    await db.pay_connection_settings.update_one({'_id':user['org_id']},{'$set':{**body.model_dump(),'updated_at':now_iso(),'updated_by':user['id']}},upsert=True)
    return {'ok':True,'super_status':'not_connected','stp_status':'not_connected'}

def period(value):
    try:
        d = date.fromisoformat(value)
        return d
    except ValueError:
        raise HTTPException(422, "Choose a valid ISO week starting date")

async def validate_new_week(org, week):
    start = period(week)
    if await db.pay_review_sheets.find_one({'_id': f'{org}:{week}'}): return
    settings = await db.pay_settings.find_one({'org_id': org}) or {}
    day = settings.get('week_starts', 'friday')
    weekdays = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']
    if start.weekday() != weekdays.index(day):
        raise HTTPException(422, f'New pay runs must start on {day.title()}. Open older runs from Saved pay runs.')

async def workers(org):
    from payroll_roster import roster
    return {w['id']: w['name'] for w in await roster(org)}


def report(body, names):
    ids = [r.worker_id for r in body.rows]
    if len(ids) != len(set(ids)) or any(i not in names for i in ids):
        raise HTTPException(422, "Each worker must belong to this organisation and appear only once")
    rows = []
    for r in body.rows:
        try:
            result = calculate_line(r.profile.model_dump(), r.entry.model_dump(), body.rules.model_dump(), body.payday)
        except ValueError as exc:
            raise HTTPException(422, str(exc))
        if not r.profile.classification.strip():
            result["issues"].append("Record award/classification or confirmed award-free basis")
            result["review_ready"] = False
        if r.entry.post_tax_deductions and not r.entry.deduction_details.strip():
            result['issues'].append('Record each deduction amount, recipient and authorisation reference')
            result['review_ready']=False
        if r.entry.taxable_allowances and not r.entry.allowance_details.strip():
            result['issues'].append('Record each allowance description and amount')
            result['review_ready']=False
        rows.append({**r.model_dump(), "name": names[r.worker_id], "result": result})
    totals = {}
    for key in ("gross", "payg", "net", "super", "annual_base_value"):
        values = [r["result"][key] for r in rows]
        totals[key] = None if any(v is None for v in values) else float(rounded(sum(rounded(v) for v in values)))
    return {"rows": rows, "totals": totals, "ready": bool(rows) and all(r["result"]["review_ready"] for r in rows)}

def leave_fingerprint(item):
    return hashlib.sha256(json.dumps({k:item.get(k) for k in
        ('id','worker_id','status','category','hours','start_date','end_date')},sort_keys=True).encode()).hexdigest()

async def approved_leave(org, week):
    start=period(week);end=start+timedelta(days=6)
    result=[]
    async for item in db.leave_requests.find({'org_id':org,'status':'approved',
            'start_date':{'$lte':end.isoformat()},'end_date':{'$gte':week}},
            {'_id':0,'id':1,'worker_id':1,'status':1,'category':1,'leave_type':1,'hours':1,'start_date':1,'end_date':1}):
        item['fingerprint']=leave_fingerprint(item)
        item['pay_category']={'annual':'annual','sick':'personal'}.get(item.get('category'))
        item['entirely_in_week']=item['start_date']>=week and item['end_date']<=end.isoformat()
        result.append(item)
    return result

async def check_leave_sources(body, org, week, calculated):
    available={r['id']:r for r in await approved_leave(org,week)}
    ids=[a.leave_id for r in body.rows for a in r.leave_sources]
    if len(ids)!=len(set(ids)):
        raise HTTPException(422,'A leave request can be allocated only once within a pay week')
    elsewhere={}
    async for other in db.pay_review_sheets.find({'org_id':org,'week':{'$ne':week}}, {'worksheet.rows.leave_sources':1}):
        for row in other.get('worksheet',{}).get('rows',[]):
            for a in row.get('leave_sources',[]):
                elsewhere[a['leave_id']]=elsewhere.get(a['leave_id'],0)+a['hours']
    for row,output in zip(body.rows,calculated['rows']):
        issues=output['result']['issues']
        sums={'annual':0,'personal':0}
        for a in row.leave_sources:
            request=available.get(a.leave_id)
            if not request or request['fingerprint']!=a.fingerprint or request.get('worker_id')!=row.worker_id or request['pay_category']!=a.category:
                issues.append('Linked leave request changed, was cancelled or is no longer approved. Remove and review its hours.')
                continue
            if a.hours+elsewhere.get(a.leave_id,0)>float(request.get('hours') or 0)+.000001:
                issues.append('Allocated leave exceeds the approved request across saved pay weeks')
            sums[a.category]+=a.hours
        for kind,amount in sums.items():
            if amount>getattr(row.entry,kind)+.000001:
                issues.append(f'{kind.title()} hours are less than the linked approved leave allocations')
        output['result']['review_ready']=not issues
    calculated['ready']=bool(calculated['rows']) and all(r['result']['review_ready'] for r in calculated['rows'])
    from payroll_submissions import check_submissions
    return await check_submissions(body, org, week, calculated)

@router.get('/{week}/approved-leave')
async def leave_feed(week:str,user=Depends(require_permission('payroll','view'))):
    return {'requests':await approved_leave(user['org_id'],week)}

@router.get('/{week}/history')
async def history(week: str, user=Depends(require_permission('payroll','view'))):
    period(week)
    saved=await db.pay_review_sheets.find_one({'_id':f"{user['org_id']}:{week}"})
    return {'revisions':list(reversed((saved or {}).get('history',[]))),
            'notice':'Recent worksheet revisions only; not an issued payslip or payment ledger.'}

async def roster_public(org):
    from payroll_roster import roster, public_roster
    return public_roster(await roster(org))

@router.get('/runs/list')
async def runs(user=Depends(require_permission('payroll','view'))):
    records=[]
    async for doc in db.pay_review_sheets.find({'org_id':user['org_id']}):
        sheet=doc['worksheet']
        records.append({'week':doc['week'],'payday':sheet['payday'],'employees':len(sheet['rows']),
            'revision':sheet['revision'],'state':doc.get('state','open'),'saved_at':doc.get('saved_at'),
            'closed':bool(doc.get(f"completion_{sheet['revision']}",{}).get('closed_at')),'issued':bool(doc.get(f"issued_{sheet['revision']}"))})
    return {'runs':sorted(records,key=lambda r:r['week'],reverse=True)}

@router.get('/{week}/submissions')
async def submitted_hours(week:str,user=Depends(require_permission('payroll','view'))):
    period(week)
    from payroll_submissions import submissions
    allowed=await workers(user['org_id'])
    return {'workers':{k:v for k,v in (await submissions(user['org_id'],week)).items() if k in allowed}}

@router.get("/{week}")
async def load(week: str, user=Depends(require_permission("payroll", "view"))):
    period(week)
    await validate_new_week(user["org_id"], week)
    names = await workers(user["org_id"])
    saved = await db.pay_review_sheets.find_one({"_id": f"{user['org_id']}:{week}"}, {"_id": 0})
    body = Worksheet(**saved["worksheet"]) if saved else Worksheet(payday=next_payday(week))
    template_week = None
    if not saved:
        previous = await db.pay_review_sheets.find_one({"org_id": user["org_id"], "week": {"$lt": week}}, sort=[("week", -1)])
        if previous:
            template_week = previous["week"]
            body.rules = Rules(**previous["worksheet"]["rules"])
        previous_profiles = {r['worker_id']: r['profile'] for r in (previous or {}).get('worksheet', {}).get('rows', [])}
        from payroll_submissions import submissions
        from payroll_banking import decrypt
        submitted = await submissions(user['org_id'], week)
        body.rows = []
        for worker_id in names:
            defaults = await db.pay_employee_records.find_one({'_id': f"{user['org_id']}:{worker_id}"})
            profile = decrypt(defaults)['profile'] if defaults else previous_profiles.get(worker_id, {})
            source = submitted.get(worker_id, {})
            body.rows.append(Row(worker_id=worker_id, profile=Profile(**profile), entry=Entry(**source.get('totals', {})), timesheet_fingerprint=source.get('fingerprint', '')))
    calculated=report(body,{**{r['worker_id']:r['name'] for r in (saved or {}).get('report',{}).get('rows',[])},**names})
    await check_leave_sources(body,user['org_id'],week,calculated)
    sealed=next((v for v in (saved or {}).get('finalizations',[]) if v['revision']==body.revision),None) if (saved or {}).get('state')=='finalized' else None
    if sealed:calculated=sealed['report']
    return {"state":(saved or {}).get("state","open"),"finalized_branding":sealed.get('branding') if sealed else None,"worksheet": body.model_dump(mode="json"), "workers": await roster_public(user["org_id"]),
            "report": calculated,
            "saved_at": saved.get("saved_at") if saved else None, "template_week": template_week,
            "sources": SOURCES, "rule_version": RULE_VERSION}

@router.post("/{week}/preview")
async def preview(week: str, body: Worksheet, user=Depends(require_permission("payroll", "view"))):
    await validate_new_week(user["org_id"], week)
    start = period(week)
    if body.payday < start or body.payday > start + timedelta(days=35):
        raise HTTPException(422, "Payday must fall between the week starting date and 35 days later")
    return await check_leave_sources(body,user['org_id'],week,report(body, await workers(user["org_id"])))

@router.put("/{week}")
async def save(week: str, body: Worksheet, user=Depends(require_permission("payroll", "edit"))):
    calculated = await preview(week, body, user)
    if body.reviewed and not calculated["ready"]:
        raise HTTPException(422, "Resolve every worker's review items before marking this worksheet reviewed")
    key = f"{user['org_id']}:{week}"
    from payroll_branding import resolved_branding
    branding=await resolved_branding(user['org_id'])
    old_revision = body.revision
    body.revision += 1
    record = {"worksheet": body.model_dump(mode="json"), "report": calculated, "saved_at": now_iso(),
              "saved_by": user["id"], "rule_version": RULE_VERSION, "org_id": user["org_id"], "week": week}
    # Atomic revision comparison prevents two payroll officers overwriting one another.
    try:
        result = await db.pay_review_sheets.update_one({"_id": key, "worksheet.revision": old_revision, "state": {"$ne":"finalized"}},
            {"$set": record, "$push": {"history": {"$each": [{"revision": body.revision, "at": record["saved_at"],
                "by": user["id"], "worksheet": record["worksheet"], "report": calculated,
                "branding":branding,"rule_version":RULE_VERSION}], "$slice": -10}}}, upsert=old_revision == 0)
    except DuplicateKeyError:
        raise HTTPException(409, "This worksheet changed in another window. Reload before saving")
    if not result.matched_count and not result.upserted_id:
        raise HTTPException(409, "This worksheet changed in another window. Reload before saving")
    return {"revision": body.revision, "report": calculated, "saved_at": record["saved_at"]}

@router.get("/{week}/report/{kind}")
async def export(week: str, kind: Literal["pay", "payg", "super", "leave"], user=Depends(require_permission("payroll", "view"))):
    period(week)
    saved = await db.pay_review_sheets.find_one({"_id": f"{user['org_id']}:{week}"})
    if not saved:
        raise HTTPException(404, "Save this worksheet before exporting")
    body = Worksheet(**saved["worksheet"])
    names = {r["worker_id"]: r["name"] for r in saved["report"]["rows"]}
    calculated = await check_leave_sources(body, user["org_id"], week, report(body, names))
    if saved.get('state')=='finalized':
        sealed=next((v for v in saved.get('finalizations',[]) if v['revision']==body.revision),None)
        if sealed:calculated=sealed['report']
    fields = {"pay": ["gross", "payg", "deductions", "reimbursements", "net", "super"],
              "payg": ["gross", "payg"], "super": ["super"],
              "leave": ["annual_accrued", "annual_closing", "annual_base_value", "personal_accrued", "personal_closing"]}[kind]
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["Worksheet status", "Week starting", "Payday", "Worker ID", "Name", *fields, "Review items", "Rule version"])
    def safe(v):
        return "'" + v if isinstance(v, str) and v.startswith(("=", "+", "-", "@", "\t", "\r")) else v
    for r in calculated["rows"]:
        writer.writerow([safe(v) for v in ["REVIEWED WORKSHEET - NOT PAID" if saved["worksheet"]["reviewed"] and calculated["ready"] else "DRAFT - NOT PAID",
            week, saved["worksheet"]["payday"], r["worker_id"], r["name"],
            *[r["result"].get(k) for k in fields], "; ".join(r["result"]["issues"]), saved["rule_version"]]])
    return Response("\ufeff" + out.getvalue(), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="paneltec-{kind}-{week}.csv"'})

from payroll_lifecycle import router as lifecycle_router
router.include_router(lifecycle_router)

from payroll_payslips import router as payslips_router
router.include_router(payslips_router)

from payroll_delivery import router as delivery_router
router.include_router(delivery_router)

from payroll_completion import router as completion_router
router.include_router(completion_router)

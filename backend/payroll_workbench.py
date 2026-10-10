"""Saved payroll review worksheets; does not send payments, STP or post leave."""
import csv
import io
import hashlib
import json
from datetime import date, timedelta
from typing import Annotated, Literal
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field, ConfigDict, model_validator
from pymongo.errors import DuplicateKeyError
from db import db
from models import now_iso
from permissions import require_permission
from payroll_engine import calculate_line, next_payday, RULE_VERSION, SOURCES, rounded

router = APIRouter(prefix="/workbench", tags=["payroll-review"])
from payroll_branding import router as branding_router
router.include_router(branding_router)
from payroll_run_register import router as register_router
router.include_router(register_router)
Number = Annotated[float, Field(ge=0, le=10000000, allow_inf_nan=False)]
Hours = Annotated[float, Field(ge=0, le=168, allow_inf_nan=False)]

class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")

class EarningRule(Strict):
    code: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,40}$")
    name: str = Field(min_length=1,max_length=100)
    basis: Literal["fixed_rate","base_rate"] = "fixed_rate"
    rate: Number = 0
    multiplier: float = Field(1,ge=0,le=100,allow_inf_nan=False)
    taxable: bool | None = None
    superable: bool | None = None

class Rules(Strict):
    earning_rules: list[EarningRule] = Field(default_factory=list,max_length=100)

    @model_validator(mode="after")
    def unique_earning_codes(self):
        codes=[r.code for r in self.earning_rules]
        if len(codes)!=len(set(codes)):raise ValueError("Earning rule codes must be unique")
        return self

    daily_ordinary_hours: float = Field(7.6,ge=0,le=24,allow_inf_nan=False)
    meal_allowance: Number | None = None
    meal_tax_treatment: Literal["unconfirmed","taxable","exempt"] = "unconfirmed"
    night_multiplier: float = Field(2,ge=2,le=5,allow_inf_nan=False)
    holiday_work_multiplier: float = Field(2.5,ge=2.5,le=5,allow_inf_nan=False)
    ot1_multiplier: float = Field(1.5, ge=1, le=5, allow_inf_nan=False)
    ot2_multiplier: float = Field(2, ge=1, le=5, allow_inf_nan=False)
    super_percent: float = Field(12, ge=12, le=100, allow_inf_nan=False)

class Shift(Strict):
    date: date
    start: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    finish: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    next_day: bool = False
    break_minutes: int = Field(0,ge=0,le=600)
    break_start: str | None = Field(None,pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    public_holiday: bool = False
    replacement_day_shift: bool = False

class CasualRates(Strict):
    base_rate: Number = 0
    loading_percent: float = Field(25,ge=0,le=100,allow_inf_nan=False)
    ot1: Number | None = None
    ot2: Number | None = None
    night: Number | None = None
    holiday_work: Number | None = None

class AllowanceRate(Strict):
    code: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,40}$")
    name: str = Field(min_length=1,max_length=100)
    rate: Number

class Profile(Strict):
    casual_rates: CasualRates | None = None
    allowance_rates: list[AllowanceRate] = Field(default_factory=list,max_length=20)
    super_fund_name: str = Field('', max_length=160)
    super_fund_usi: str = Field('', max_length=32)
    employment_type: Literal["unconfirmed", "full_time", "part_time", "casual", "contractor"] = "unconfirmed"
    pay_basis: Literal["hourly", "annual_salary"] = "hourly"
    annual_salary: Number = 0
    hourly_rate: Number = 0
    ordinary_weekly_hours: Hours = 38
    classification: str = Field("", max_length=200)
    conditions_reviewed: bool = False
    tax_mode: Literal["unconfirmed", "resident_threshold", "resident_no_threshold", "manual"] = "unconfirmed"
    tax_declaration_reviewed: bool = False
    annual_weeks: float = Field(4, ge=4, le=12, allow_inf_nan=False)
    personal_weeks: float = Field(2, ge=2, le=12, allow_inf_nan=False)
    leave_loading_percent: float = Field(0, ge=0, le=100, allow_inf_nan=False)

    @model_validator(mode="after")
    def salary_rate(self):
        codes=[a.code for a in self.allowance_rates]
        if len(codes)!=len(set(codes)):raise ValueError("Allowance codes must be unique")
        if self.employment_type == "casual" and self.casual_rates is not None:
            if self.pay_basis != "hourly":raise ValueError("Casual rate table requires hourly pay basis")
            self.hourly_rate=self.casual_rates.base_rate*(1+self.casual_rates.loading_percent/100)
        if self.pay_basis == "annual_salary":
            if self.annual_salary <= 0 or self.ordinary_weekly_hours <= 0:
                raise ValueError("Annual salary and ordinary weekly hours must be positive")
            self.hourly_rate = self.annual_salary / 52 / self.ordinary_weekly_hours
        return self

class Entry(Strict):
    earning_units: dict[str, Number] = Field(default_factory=dict,max_length=100)
    allowance_units: dict[str, Number] = Field(default_factory=dict,max_length=20)
    deduction_details: str = Field('', max_length=1000)
    allowance_details: str = Field('', max_length=1000)
    night: Hours = 0
    holiday_work: Hours = 0
    penalty_ordinary: Hours = 0
    meal_count: int = Field(0,ge=0,le=14)
    ordinary: Hours = 0
    ot1: Hours = 0
    ot2: Hours = 0
    saturday: Hours = 0
    sunday: Hours = 0
    annual: Hours = 0
    personal: Hours = 0
    public_holiday: Hours = 0
    lafha: Number = 0
    lafha_taxable: bool | None = None
    lafha_superable: bool | None = None
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

class DayHours(Strict):
    ordinary: Hours = 0
    ot1: Hours = 0
    ot2: Hours = 0
    saturday: Hours = 0
    sunday: Hours = 0
    night: Hours = 0
    holiday_work: Hours = 0
    penalty_ordinary: Hours = 0
    meal_count: int = Field(0,ge=0,le=14)

    @model_validator(mode="after")
    def valid_day(self):
        if sum(getattr(self,k) for k in ('ordinary','ot1','ot2','saturday','sunday','night','holiday_work'))>24:
            raise ValueError("Daily hours cannot exceed 24")
        if self.penalty_ordinary>self.night+self.holiday_work:
            raise ValueError("Ordinary penalty hours exceed penalty hours")
        return self

class Row(Strict):
    daily_hours: dict[date, DayHours] | None = Field(None,max_length=7)
    worked_hours_override: bool = False
    shifts: list[Shift] | None = Field(None,max_length=40)
    adjustment_reason: str = Field("", max_length=1000)
    worker_id: str = Field(min_length=1, max_length=100)
    timesheet_fingerprint: str = Field("", pattern=r"^(|[a-f0-9]{64})$")
    profile: Profile = Field(default_factory=Profile)
    entry: Entry = Field(default_factory=Entry)
    leave_sources: list[LeaveAllocation] = Field(default_factory=list, max_length=30)

class Worksheet(Strict):
    out_of_cycle: bool = False
    run_reason: str = Field('',max_length=500)
    payslip_message: str = Field('',max_length=500)
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

class CalculationSettings(Strict):
    revision: int = Field(0, ge=0)
    rules: Rules = Field(default_factory=Rules)

@router.get('/calculation/settings')
async def calculation_settings(user=Depends(require_permission('payroll','view'))):
    saved=await db.pay_calculation_settings.find_one({'_id':user['org_id']})
    result = {'revision':saved['revision'],'rules':Rules(**saved['rules']).model_dump()} if saved else CalculationSettings().model_dump()
    calendar = await db.pay_settings.find_one({'org_id':user['org_id']}) or {}
    result['rules']['daily_ordinary_hours'] = (calendar.get('overtime') or {}).get('daily_ordinary_hours',7.6)
    return result

@router.put('/calculation/settings')
async def save_calculation_settings(body:CalculationSettings,user=Depends(require_permission('payroll','edit'))):
    record={'revision':body.revision+1,'rules':body.rules.model_dump(),'updated_at':now_iso(),'updated_by':user['id']}
    try:
        result=await db.pay_calculation_settings.update_one({'_id':user['org_id'],'revision':body.revision},{'$set':record},upsert=body.revision==0)
    except DuplicateKeyError:
        raise HTTPException(409,'Calculation settings changed; reload first')
    if not result.matched_count and not result.upserted_id:raise HTTPException(409,'Calculation settings changed; reload first')
    return {'revision':record['revision'],'rules':record['rules']}

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
        import re
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}(~[0-9a-f]{32})?',value):raise ValueError()
        d = date.fromisoformat(value[:10])
        return d
    except ValueError:
        raise HTTPException(422, "Choose a valid ISO week starting date")

async def validate_new_week(org, week):
    start = period(week)
    if await db.pay_review_sheets.find_one({'_id': f'{org}:{week}'}): return
    if '~' in week:raise HTTPException(404,'Out-of-cycle pay run not found')
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
        if body.out_of_cycle:
            if r.daily_hours or r.shifts or r.leave_sources or r.timesheet_fingerprint or r.entry.annual or r.entry.personal:raise HTTPException(422,'Out-of-cycle runs use extra amounts only; do not import timesheets or leave already allocated to the weekly run')
            if r.profile.tax_mode!='manual':raise HTTPException(422,'Out-of-cycle payments require reviewed manual PAYG for the additional payment')
        shift_issue=None
        daily_totals={}
        if r.shifts is not None or r.daily_hours is not None:
            from payroll_shift_rules import calculate_shifts
            try:
                shifts=[v.model_dump(mode="json") for v in (r.shifts or [])]
                # Validate the full source set, including cross-date overlaps.
                calculate_shifts(shifts,body.rules.model_dump())
                for day in sorted({v['date'] for v in shifts}):
                    daily_totals[day]=calculate_shifts([v for v in shifts if v['date']==day],body.rules.model_dump())
                if r.daily_hours is not None:
                    daily_totals={str(k):v.model_dump() for k,v in r.daily_hours.items()}
                if not r.worked_hours_override:
                    totals={k:sum(v.get(k,0) for v in daily_totals.values()) for k in DayHours.model_fields}
                    r.entry=Entry(**{**r.entry.model_dump(),**totals})
            except ValueError as exc:shift_issue=str(exc)
        try:
            result = calculate_line(r.profile.model_dump(), r.entry.model_dump(), body.rules.model_dump(), body.payday)
        except ValueError as exc:
            raise HTTPException(422, str(exc))
        if shift_issue:
            result["issues"].append(shift_issue)
            result["review_ready"]=False
        if not r.profile.classification.strip():
            result["issues"].append("Record award/classification or confirmed award-free basis")
            result["review_ready"] = False
        if r.entry.post_tax_deductions and not r.entry.deduction_details.strip():
            result['issues'].append('Record each deduction amount, recipient and authorisation reference')
            result['review_ready']=False
        if r.entry.taxable_allowances and not r.entry.allowance_details.strip():
            result['issues'].append('Record each allowance description and amount')
            result['review_ready']=False
        rows.append({**r.model_dump(mode="json"), "name": names[r.worker_id], "daily_totals":daily_totals, "result": result})
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
    if body.out_of_cycle:return calculated
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

class ExtraRun(Strict):
    week: date
    payday: date
    workers: list[str] = Field(min_length=1,max_length=500)
    reason: str = Field(min_length=1,max_length=500)
    payslip_message: str = Field('',max_length=500)

@router.post('/out-of-cycle/create')
async def create_extra_run(body:ExtraRun,user=Depends(require_permission('payroll','edit'))):
    from uuid import uuid4
    from payroll_banking import decrypt
    from payroll_opening_balances import leave_at
    names=await workers(user['org_id'])
    if len(set(body.workers))!=len(body.workers) or any(w not in names for w in body.workers):raise HTTPException(422,'Select current Simpro employees once only')
    await validate_new_week(user['org_id'],body.week.isoformat())
    if not body.reason.strip() or body.payday<body.week or body.payday>body.week+timedelta(days=3650):raise HTTPException(422,'Enter a payment reason and a valid payment date')
    key=body.week.isoformat()+'~'+uuid4().hex
    settings=await db.pay_calculation_settings.find_one({'_id':user['org_id']}) or {}
    sheet=Worksheet(payday=body.payday,out_of_cycle=True,run_reason=body.reason.strip(),payslip_message=body.payslip_message,rules=Rules(**settings.get('rules',{})))
    for wid in body.workers:
        record=await db.pay_employee_records.find_one({'_id':f"{user['org_id']}:{wid}"})
        profile=Profile(**(decrypt(record)['profile'] if record else {}));profile.tax_mode='manual'
        opening=await leave_at(user['org_id'],wid,body.week.isoformat())
        entry=Entry(opening_annual=opening.get('opening_annual'),opening_personal=opening.get('opening_personal'))
        sheet.rows.append(Row(worker_id=wid,profile=profile,entry=entry))
    sheet.revision=1
    await db.pay_review_sheets.insert_one({'_id':f"{user['org_id']}:{key}",'org_id':user['org_id'],'week':key,'state':'open','worksheet':sheet.model_dump(mode='json'),'report':report(sheet,names),'saved_at':now_iso(),'saved_by':user['id'],'rule_version':RULE_VERSION})
    return {'run_id':key}

@router.get('/employees/list')
async def employee_list(user=Depends(require_permission('payroll','view'))):
    return {'workers': await roster_public(user['org_id'])}

@router.get('/runs/list')
async def runs(user=Depends(require_permission('payroll','view'))):
    records=[]
    async for doc in db.pay_review_sheets.find({'org_id':user['org_id']}):
        sheet=doc['worksheet']
        records.append({'week':doc['week'],'payday':sheet['payday'],'employees':len(sheet['rows']),
            'out_of_cycle':sheet.get('out_of_cycle',False),'revision':sheet['revision'],'state':doc.get('state','open'),'saved_at':doc.get('saved_at'),
            'closed':bool(doc.get(f"completion_{sheet['revision']}",{}).get('closed_at')),'issued':bool(doc.get(f"issued_{sheet['revision']}"))})
    return {'runs':sorted(records,key=lambda r:r['week'],reverse=True)}

@router.get('/{week}/submissions')
async def submitted_hours(week:str,user=Depends(require_permission('payroll','view'))):
    period(week)
    if '~' in week:return {'workers':{}}
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
    if not saved or (not body.rows and not body.out_of_cycle and saved.get('state','open')=='open'):
        previous = await db.pay_review_sheets.find_one({"org_id": user["org_id"], "week": {"$lt": week}, "worksheet.out_of_cycle":{"$ne":True}}, sort=[("week", -1)])
        if not saved:
            if previous:
                template_week = previous["week"]
                body.rules = Rules(**previous["worksheet"]["rules"])
            defaults_rules=await db.pay_calculation_settings.find_one({'_id':user['org_id']})
            if defaults_rules:body.rules=Rules(**defaults_rules['rules'])
            calendar = await db.pay_settings.find_one({'org_id':user['org_id']}) or {}
            body.rules.daily_ordinary_hours = (calendar.get('overtime') or {}).get('daily_ordinary_hours',7.6)
        previous_profiles = {r['worker_id']: r['profile'] for r in (previous or {}).get('worksheet', {}).get('rows', [])}
        from payroll_submissions import submissions
        from payroll_banking import decrypt
        submitted = await submissions(user['org_id'], week)
        body.rows = []
        for worker_id in names:
            defaults = await db.pay_employee_records.find_one({'_id': f"{user['org_id']}:{worker_id}"})
            profile = decrypt(defaults)['profile'] if defaults else previous_profiles.get(worker_id, {})
            source = submitted.get(worker_id, {})
            shift_rows=[];complete_times=True
            for day in source.get('days',[]):
                if day.get('kind')!='work':continue
                for segment in day.get('segments') or [day]:
                    if segment.get('start') and segment.get('finish'):
                        shift_rows.append(Shift(date=day['date'],start=segment['start'],finish=segment['finish'],break_minutes=segment.get('break_minutes') or 0,break_start=segment.get('break_start')))
                    else:complete_times=False
            from payroll_opening_balances import leave_at
            opening = await leave_at(user['org_id'],worker_id,week)
            if opening['available']:
                source['totals']={**source.get('totals',{}),'opening_annual':opening['opening_annual'],'opening_personal':opening['opening_personal']}
            body.rows.append(Row(shifts=(shift_rows or None) if complete_times else None,worker_id=worker_id, profile=Profile(**profile), entry=Entry(**source.get('totals', {})), timesheet_fingerprint=source.get('fingerprint', '')))
    # Recover drafts created before employee rates were imported. Do not change
    # positive snapshot rates, reviewed worksheets, or any finalized payroll.
    rates_loaded=[]
    if saved and saved.get('state','open')=='open' and not body.reviewed:
        from payroll_banking import decrypt
        for row in body.rows:
            p=row.profile
            has_rate=(p.annual_salary>0 if p.pay_basis=='annual_salary' else
                      (p.casual_rates.base_rate>0 if p.employment_type=='casual' and p.casual_rates else p.hourly_rate>0))
            if has_rate or p.conditions_reviewed or row.worker_id not in names:continue
            record=await db.pay_employee_records.find_one({'_id':f"{user['org_id']}:{row.worker_id}"})
            if not record:continue
            defaults=Profile(**decrypt(record)['profile'])
            valid=(defaults.annual_salary>0 if defaults.pay_basis=='annual_salary' else
                   (defaults.casual_rates.base_rate>0 if defaults.employment_type=='casual' and defaults.casual_rates else defaults.hourly_rate>0))
            if not valid:continue
            if p.employment_type not in ('unconfirmed',defaults.employment_type):continue
            for key in ('pay_basis','hourly_rate','annual_salary','casual_rates'):
                setattr(p,key,getattr(defaults,key))
            if p.employment_type=='unconfirmed':p.employment_type=defaults.employment_type
            if p.pay_basis=='annual_salary':p.ordinary_weekly_hours=defaults.ordinary_weekly_hours
            row.entry.hours_reviewed=False
            row.entry.super_reviewed=False
            row.adjustment_reason=row.adjustment_reason or 'Loaded missing rate from saved employee settings'
            rates_loaded.append(row.worker_id)
    calculated=report(body,{**{r['worker_id']:r['name'] for r in (saved or {}).get('report',{}).get('rows',[])},**names})
    await check_leave_sources(body,user['org_id'],week,calculated)
    sealed=next((v for v in (saved or {}).get('finalizations',[]) if v['revision']==body.revision),None) if (saved or {}).get('state')=='finalized' else None
    if sealed:calculated=sealed['report']
    return {"state":(saved or {}).get("state","open"),"finalized_branding":sealed.get('branding') if sealed else None,"worksheet": body.model_dump(mode="json"), "workers": await roster_public(user["org_id"]),
            "report": calculated, "rates_loaded":rates_loaded,
            "saved_at": saved.get("saved_at") if saved else None, "template_week": template_week,
            "sources": SOURCES, "rule_version": RULE_VERSION}

@router.post("/{week}/preview")
async def preview(week: str, body: Worksheet, user=Depends(require_permission("payroll", "view"))):
    await validate_new_week(user["org_id"], week)
    start = period(week)
    if body.out_of_cycle != ('~' in week):raise HTTPException(422,'Pay run type cannot be changed')
    if body.out_of_cycle and not body.run_reason.strip():raise HTTPException(422,'Enter the reason for the extra payment')
    for row in body.rows:
        if row.daily_hours is not None and any(not start<=d<=start+timedelta(days=6) for d in row.daily_hours):
            raise HTTPException(422,"Daily entries must be within this pay week")
        if row.shifts is not None and any(not start<=s.date<=start+timedelta(days=6) for s in row.shifts):
            raise HTTPException(422,"Shift dates must be within this pay week")
    if body.payday < start or body.payday > start + timedelta(days=3650 if body.out_of_cycle else 35):
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

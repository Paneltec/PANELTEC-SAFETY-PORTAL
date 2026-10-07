"""Encrypted employee payroll defaults, separate from simPRO worker records."""
import json
from datetime import date
from fastapi import APIRouter,Depends,HTTPException
from pydantic import Field
from pymongo.errors import DuplicateKeyError
from db import db
from models import now_iso
from permissions import require_permission
from payroll_workbench import Strict,Profile
from payroll_banking import cipher,decrypt
router=APIRouter(prefix='/employee-records',tags=['payroll-employee-records'])
class OpeningBalances(Strict):
    as_at: date
    annual_hours: float = Field(ge=0,le=100000,allow_inf_nan=False)
    personal_hours: float = Field(ge=0,le=100000,allow_inf_nan=False)
    ytd_gross: float | None = Field(None,ge=0,le=100000000,allow_inf_nan=False)
    ytd_payg: float | None = Field(None,ge=0,le=100000000,allow_inf_nan=False)
    ytd_super: float | None = Field(None,ge=0,le=100000000,allow_inf_nan=False)
    source: str = Field('',max_length=200)
    reason: str = Field(min_length=1,max_length=300)

class EmployeeRecord(Strict):
    opening_balances: OpeningBalances | None = None
    revision:int=Field(0,ge=0)
    profile:Profile
    super_member_number:str|None=Field(None,max_length=64)
    # None retains the encrypted member number, blank explicitly clears it.

async def employee(user,worker_id):
    from payroll_workbench import workers
    if worker_id not in await workers(user['org_id']):raise HTTPException(404,'Current Simpro worker not found')


def public(doc):
    if not doc:return {'configured':False,'revision':0,'profile':Profile().model_dump(),'member_number_masked':'','opening_balances':None}
    data=decrypt(doc);number=data.get('super_member_number','')
    return {'configured':True,'revision':doc['revision'],'profile':data['profile'],
        'opening_balances':data.get('opening_balances'), 'member_number_masked':('••••'+number[-4:]) if number else '', 'updated_at':doc['updated_at']}

class FundCheck(Strict):
    usi:str=Field(min_length=1,max_length=32)
    fund_name:str=Field('',max_length=160)

@router.post('/fund/check')
async def check_fund(body:FundCheck,user=Depends(require_permission('payroll','view'))):
    from payroll_fund_lookup import lookup
    return await lookup(body.usi,body.fund_name)

@router.get('/{worker_id}')
async def load(worker_id:str,user=Depends(require_permission('payroll','view'))):
    await employee(user,worker_id)
    return public(await db.pay_employee_records.find_one({'_id':f"{user['org_id']}:{worker_id}"}))

@router.put('/{worker_id}')
async def save(worker_id:str,body:EmployeeRecord,user=Depends(require_permission('payroll','edit'))):
    await employee(user,worker_id);key=f"{user['org_id']}:{worker_id}"
    old=await db.pay_employee_records.find_one({'_id':key})
    if (old or {}).get('revision',0)!=body.revision:raise HTTPException(409,'Employee payroll settings changed; reload first')
    previous=decrypt(old) if old else {}
    member=body.super_member_number if body.super_member_number is not None else previous.get('super_member_number','')
    if body.super_member_number is None and previous and (previous['profile'].get('super_fund_usi','')!=body.profile.super_fund_usi or previous['profile'].get('super_fund_name','')!=body.profile.super_fund_name):
        raise HTTPException(422,'When changing funds, replace or explicitly clear the member number')
    opening=body.opening_balances.model_dump(mode='json') if body.opening_balances is not None else previous.get('opening_balances')
    if opening and not opening['reason'].strip():raise HTTPException(422,'Provide an opening balance source or correction reason')
    data={'profile':body.profile.model_dump(),'super_member_number':member.strip(),'opening_balances':opening}
    record={'org_id':user['org_id'],'worker_id':worker_id,'revision':body.revision+1,'updated_at':now_iso(),
            'encrypted':cipher().encrypt(json.dumps(data).encode()).decode()}
    try:
        result=await db.pay_employee_records.update_one({'_id':key,'revision':body.revision},
            {'$set':record,'$push':{'audit':{'at':record['updated_at'],'by':user['id'],'revision':record['revision'],'previous_encrypted':old.get('encrypted') if old and opening!=previous.get('opening_balances') else None}}},upsert=body.revision==0)
    except DuplicateKeyError:raise HTTPException(409,'Employee payroll settings changed; reload first')
    if not result.matched_count and not result.upserted_id:raise HTTPException(409,'Employee payroll settings changed; reload first')
    return public(record)

@router.get('/{worker_id}/opening-balances/{week}')
async def opening_at(worker_id:str,week:str,user=Depends(require_permission('payroll','view'))):
    from payroll_workbench import period
    from payroll_opening_balances import leave_at
    period(week)
    await employee(user,worker_id)
    return await leave_at(user['org_id'],worker_id,week)

@router.get('/{worker_id}/pay-context/{week}')
async def pay_context(worker_id:str,week:str,payday:date,user=Depends(require_permission('payroll','view'))):
    from payroll_workbench import period
    from payroll_banking import masked
    from payroll_branding import resolved_branding
    from decimal import Decimal
    period(week)
    await employee(user,worker_id)
    org=user['org_id']
    record=await db.pay_employee_records.find_one({'_id':f'{org}:{worker_id}'})
    details=public(record)
    opening=details.get('opening_balances') or {}
    fy=date(payday.year if payday.month>=7 else payday.year-1,7,1).isoformat()
    valid=fy<=opening.get('as_at','')<=payday.isoformat()
    totals={k:Decimal(str(opening['ytd_'+k])) if valid and opening.get('ytd_'+k) is not None else None for k in ('gross','payg','super')}
    start=opening['as_at'] if valid else fy
    async for run in db.pay_review_sheets.find({'org_id':org}):
        sheet=run.get('worksheet',{})
        if run.get('week')==week or run.get('state')!='finalized' or not run.get(f"issued_{sheet.get('revision')}"):continue
        if not start<=sheet.get('payday','')<=payday.isoformat():continue
        result=next((r['result'] for r in run.get('report',{}).get('rows',[]) if r['worker_id']==worker_id),None)
        if result:
            for k in totals:
                if totals[k] is not None:
                    totals[k]=None if result.get(k) is None else totals[k]+Decimal(str(result[k]))
    return {'employer':await resolved_branding(org),'bank':masked(await db.pay_bank_details.find_one({'_id':f'{org}:worker:{worker_id}'})),
            'member_number_masked':details['member_number_masked'],'prior_ytd':{k:float(v) if v is not None else None for k,v in totals.items()},
            'ytd_note':'YTD includes dated opening totals and issued runs through this payday, excluding this run. Component-level opening figures are not available.'}

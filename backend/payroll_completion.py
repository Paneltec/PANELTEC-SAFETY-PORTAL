"""Evidence-backed run completion. Records external results; never sends payments."""
from datetime import date
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, ConfigDict
from db import db
from models import now_iso
from permissions import require_permission

router=APIRouter()
class Evidence(BaseModel):
    model_config=ConfigDict(extra='forbid')
    revision:int=Field(gt=0)
    reference:str=Field(min_length=1,max_length=300)
    completed_date:date
    confirmed:bool=False
class Close(BaseModel):
    model_config=ConfigDict(extra='forbid')
    revision:int=Field(gt=0)
    confirmed:bool=False

async def document(week,user):
    from payroll_workbench import period
    period(week)
    return await db.pay_review_sheets.find_one({'_id':f"{user['org_id']}:{week}"}) or {}

@router.get('/{week}/completion')
async def status(week:str,user=Depends(require_permission('payroll','view'))):
    doc=await document(week,user);revision=doc.get('worksheet',{}).get('revision',0)
    record=doc.get(f'completion_{revision}',{})
    issued=doc.get(f'issued_{revision}')
    key=f"{user['org_id']}:{week}:{revision}"
    batch=await db.pay_payslip_batches.find_one({'_id':key}) or {}
    recipients=batch.get('recipients',[]);accepted=0
    for person in recipients:
        sent=await db.pay_payslip_delivery.find_one({'_id':f"{key}:{person['worker_id']}"}) or {}
        accepted+=sent.get('status')=='accepted'
    blockers=[]
    if doc.get('state')!='finalized':blockers.append('Approve and lock the reviewed run')
    if not record.get('bank') and not issued:blockers.append('Record confirmed wage payment')
    if not issued or not recipients or accepted!=len(recipients):blockers.append('Issue payslips and resolve email batch items')
    for key,label in [('stp','Record the external STP acceptance receipt'),('super','Record verified super fund receipt'),('leave','Reconcile leave balances in the current leave system')]:
        if not record.get(key):blockers.append(label)
    return {'revision':revision,'record':record,'issued':issued,'emails':{'accepted':accepted,'total':len(recipients)},'blockers':blockers,'can_close':not blockers,'closed':bool(record.get('closed_at'))}

@router.post('/{week}/completion/{kind}')
async def record(week:str,kind:Literal['bank','stp','super','leave','journal'],body:Evidence,user=Depends(require_permission('payroll','edit'))):
    from payroll_payslips import today
    from payroll_workbench import period
    doc=await document(week,user);field=f'completion_{body.revision}'
    if doc.get('state')!='finalized' or doc.get('worksheet',{}).get('revision')!=body.revision:raise HTTPException(409,'Reload and lock the current revision before recording external results')
    if not body.confirmed or not body.reference.strip():raise HTTPException(422,'Confirm the external result and provide its receipt or reconciliation reference')
    if not period(week)<=body.completed_date<=today():raise HTTPException(422,'Completion date must be within this period or later, and not in the future')
    existing=doc.get(field,{})
    if existing.get('closed_at'):raise HTTPException(409,'This completion record is closed; open a correction to retain the previous evidence')
    if kind in existing:raise HTTPException(409,'Evidence already recorded; retain it and open a correction if it is wrong')
    evidence={**body.model_dump(mode='json'),'reference':body.reference.strip(),'recorded_by':user['id'],'recorded_at':now_iso(),'source':'manually_verified_external_result'}
    result=await db.pay_review_sheets.update_one({'_id':doc['_id'],'worksheet.revision':body.revision,'state':'finalized',f'{field}.{kind}':None,f'{field}.closed_at':None},{'$set':{f'{field}.{kind}':evidence}})
    if not result.matched_count:raise HTTPException(409,'Run changed; reload completion status')
    return await status(week,user)

@router.post('/{week}/close-run')
async def close(week:str,body:Close,user=Depends(require_permission('payroll','edit'))):
    current=await status(week,user)
    if current['revision']!=body.revision:raise HTTPException(409,'Reload the current revision')
    if current['closed']:return current
    if not body.confirmed or not current['can_close']:raise HTTPException(422,'Resolve every completion item and confirm reconciliation before closing')
    field=f'completion_{body.revision}'
    result=await db.pay_review_sheets.update_one({'_id':f"{user['org_id']}:{week}",'worksheet.revision':body.revision,'state':'finalized',f'{field}.closed_at':None},{'$set':{f'{field}.closed_at':now_iso(),f'{field}.closed_by':user['id']}})
    if not result.matched_count:raise HTTPException(409,'Run changed; reload completion status')
    return await status(week,user)

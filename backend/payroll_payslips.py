"""Issue-record and printable payslip workflow, disabled until deployment validation."""
import os
from html import escape
from datetime import date,datetime,timedelta
from zoneinfo import ZoneInfo
from fastapi import APIRouter,Depends,HTTPException
from fastapi.responses import Response
from pydantic import Field
from db import db
from models import now_iso
from permissions import require_permission
from payroll_workbench import Strict,period
router=APIRouter()
def today():return datetime.now(ZoneInfo('Australia/Hobart')).date()
class Issue(Strict):
    revision:int=Field(gt=0)
    paid_date:date
    payment_reference:str=Field(min_length=1,max_length=160)
    particulars_verified:bool=False

@router.get('/{week}/payslips/status')
async def status(week:str,user=Depends(require_permission('payroll','view'))):
    period(week)
    doc=await db.pay_review_sheets.find_one({'_id':f"{user['org_id']}:{week}"}) or {}
    from payroll_delivery import issuing_enabled
    return {'enabled':await issuing_enabled(user['org_id']),
            'issues':[v for k,v in doc.items() if k.startswith('issued_')]}

@router.post('/{week}/payslips/issue')
async def issue(week:str,body:Issue,user=Depends(require_permission('payroll','edit'))):
    from payroll_delivery import issuing_enabled
    if not await issuing_enabled(user['org_id']):raise HTTPException(503,'Payslip issuing is disabled until payroll deployment and parallel-run validation are complete')
    start=period(week)
    if not body.particulars_verified or not body.payment_reference.strip():raise HTTPException(422,'Confirm actual payment and verify payslip particulars first')
    if body.paid_date<start or body.paid_date>today():raise HTTPException(422,'Actual payment date must be within this pay period or later, and cannot be in the future')
    key=f"{user['org_id']}:{week}";field=f'issued_{body.revision}'
    doc=await db.pay_review_sheets.find_one({'_id':key})
    if not doc:raise HTTPException(404,'Pay run not found')
    record={**body.model_dump(mode='json'),'issued_at':now_iso(),'issued_by':user['id'],'delivery_status':'not_sent'}
    if doc.get(field):
        if any(doc[field][k]!=record[k] for k in ('paid_date','payment_reference')):raise HTTPException(409,'An issue record already exists with different payment details; retain it and use a correction')
        return doc[field]
    if doc.get('state')!='finalized' or doc['worksheet']['revision']!=body.revision:raise HTTPException(409,'Finalise the current reviewed revision before issuing')
    snapshot=next((s for s in doc.get('finalizations',[]) if s['revision']==body.revision),None)
    if not snapshot:raise HTTPException(409,'Finalised snapshot unavailable')
    if body.paid_date.isoformat()!=snapshot['worksheet']['payday']:raise HTTPException(422,'Actual payment date differs from the finalised payday; open a correction and review the correct date first')
    if any(r['result'].get('net') is None for r in snapshot['report']['rows']):raise HTTPException(422,'Unresolved net wages')
    from payroll_banking import decrypt
    particulars={}
    for row in snapshot['report']['rows']:
        wid=row['worker_id'];item={}
        bank=await db.pay_bank_details.find_one({'_id':f"{user['org_id']}:worker:{wid}"})
        if bank:
            value=decrypt(bank);item.update(account_name=value.get('account_name',''),account_masked='****'+value.get('account_number','')[-4:])
        employee=await db.pay_employee_records.find_one({'_id':f"{user['org_id']}:{wid}"})
        if employee:
            value=decrypt(employee);member=value.get('super_member_number','');item['member_masked']='****'+member[-4:] if member else ''
        particulars[wid]=item
    record['particulars']=particulars
    result=await db.pay_review_sheets.update_one({'_id':key,'worksheet.revision':body.revision,'state':'finalized',field:None},{'$set':{field:record}})
    if not result.matched_count:raise HTTPException(409,'Run changed; reload before issuing')
    return record

def render(snapshot,worker,week,issued):
    from payroll_payslip_document import render_html
    return render_html(snapshot,worker,week,issued)

@router.get('/{week}/payslips/{revision}/{worker_id}')
async def download(week:str,revision:int,worker_id:str,user=Depends(require_permission('payroll','view'))):
    period(week)
    doc=await db.pay_review_sheets.find_one({'_id':f"{user['org_id']}:{week}"}) or {}
    issued=doc.get(f'issued_{revision}')
    snapshot=next((s for s in doc.get('finalizations',[]) if s['revision']==revision),None)
    if not issued or not snapshot:raise HTTPException(404,'Issued payslip not found')
    return Response(render(snapshot,worker_id,week,issued),media_type='text/html',headers={'Content-Disposition':f'attachment; filename="payslip-{week}-r{revision}.html"','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; img-src data:; style-src 'unsafe-inline'"})

@router.get('/{week}/payslips/{revision}/{worker_id}/pdf')
async def download_pdf(week:str,revision:int,worker_id:str,user=Depends(require_permission('payroll','view'))):
    from payroll_payslip_document import render_pdf
    period(week)
    doc=await db.pay_review_sheets.find_one({'_id':f"{user['org_id']}:{week}"}) or {}
    issued=doc.get(f'issued_{revision}');snapshot=next((s for s in doc.get('finalizations',[]) if s['revision']==revision),None)
    if not issued or not snapshot:raise HTTPException(404,'Issued payslip not found')
    return Response(render_pdf(snapshot,worker_id,week,issued),media_type='application/pdf',headers={'Content-Disposition':f'attachment; filename="payslip-{week}-r{revision}.pdf"','Cache-Control':'no-store'})

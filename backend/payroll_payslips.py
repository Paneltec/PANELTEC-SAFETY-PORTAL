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
    result=await db.pay_review_sheets.update_one({'_id':key,'worksheet.revision':body.revision,'state':'finalized',field:None},{'$set':{field:record}})
    if not result.matched_count:raise HTTPException(409,'Run changed; reload before issuing')
    return record

def render(snapshot,worker,week,issued):
    row=next((r for r in snapshot['report']['rows'] if r['worker_id']==worker),None)
    if not row:raise HTTPException(404,'Employee not found in this finalised run')
    b=snapshot['branding'];p=row['profile'];e=row['entry'];r=row['result'];rules=snapshot['worksheet']['rules']
    division=b.get(b.get('assignments',{}).get(worker,''),{})
    h=lambda v:escape(str(v or ''))
    money=lambda v:f'${float(v):,.2f}' if v is not None else 'Not available'
    lines=[('Ordinary hours',e['ordinary'],p['hourly_rate'],r['ordinary_pay']),('Overtime tier 1',e['ot1'],p['hourly_rate']*rules['ot1_multiplier'],r['ot1_pay']),('Overtime tier 2',e['ot2'],p['hourly_rate']*rules['ot2_multiplier'],r['ot2_pay']),('Annual leave',e['annual'],p['hourly_rate'],r['annual_pay']),('Personal/carer’s leave',e['personal'],p['hourly_rate'],r['personal_pay']),('Public holiday',e['public_holiday'],p['hourly_rate'],r['public_holiday_pay']),('Leave loading',None,None,r['leave_loading']),('Taxable allowances',None,None,r['taxable_allowances'])]
    earnings=''.join(f'<tr><td>{h(label)}</td><td>{qty if qty is not None else "—"}</td><td>{money(rate) if rate is not None else "—"}</td><td>{money(amount)}</td></tr>' for label,qty,rate,amount in lines if qty or amount or label=='Ordinary hours')
    totals=''.join(f'<tr><th>{label}</th><td>{money(r[key])}</td></tr>' for label,key in [('Gross earnings','gross'),('PAYG withheld','payg'),('Other deductions','deductions'),('Reimbursements','reimbursements'),('Net wages','net'),('Employer super contribution required','super')])
    # Only validated PNG/JPEG data URLs are used; no remote assets or scripts.
    logo=division.get('logo','');image=f'<img alt="Division logo" src="{h(logo)}">' if logo.startswith(('data:image/png;base64,','data:image/jpeg;base64,')) else ''
    return f'''<!doctype html><html lang="en"><meta charset="utf-8"><title>Payslip</title><style>body{{font:14px Arial;max-width:800px;margin:30px auto;color:#172033}}img{{max-height:70px;max-width:240px}}table{{width:100%;border-collapse:collapse;margin:20px 0}}td,th{{padding:8px;border-bottom:1px solid #ddd;text-align:left}}pre{{white-space:pre-wrap;font:inherit}}@page{{size:A4;margin:15mm}}</style><body>{image}<h1>{h(division.get('name') or b['employer_name'])}</h1><p>Employer: {h(b['employer_name'])} · ABN {h(b['employer_abn'])}</p><h2>Payslip — {h(row['name'])}</h2><p>Employee reference: {h(worker)}</p><p>Period: {h(week)} to {(date.fromisoformat(week)+timedelta(days=6)).isoformat()}<br>Payment date: {h(issued['paid_date'])}<br>Revision: {snapshot['revision']}</p><table><tr><th>Earnings</th><th>Hours</th><th>Rate</th><th>Amount</th></tr>{earnings}</table><table>{totals}</table><p>Super fund: {h(p.get('super_fund_name'))} · USI {h(p.get('super_fund_usi'))}</p><p>Allowance particulars:</p><pre>{h(e.get('allowance_details') or 'None')}</pre><p>Deduction particulars:</p><pre>{h(e.get('deduction_details') or 'None')}</pre><p>Recorded as issued: {h(issued['issued_at'])}. Keep this payslip for your records.</p></body></html>'''

@router.get('/{week}/payslips/{revision}/{worker_id}')
async def download(week:str,revision:int,worker_id:str,user=Depends(require_permission('payroll','view'))):
    period(week)
    doc=await db.pay_review_sheets.find_one({'_id':f"{user['org_id']}:{week}"}) or {}
    issued=doc.get(f'issued_{revision}')
    snapshot=next((s for s in doc.get('finalizations',[]) if s['revision']==revision),None)
    if not issued or not snapshot:raise HTTPException(404,'Issued payslip not found')
    return Response(render(snapshot,worker_id,week,issued),media_type='text/html',headers={'Content-Disposition':f'attachment; filename="payslip-{week}-r{revision}.html"','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; img-src data:; style-src 'unsafe-inline'"})

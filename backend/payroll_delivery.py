"""Private, resumable payslip batches. One authenticated request per recipient."""
import os
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, TypeAdapter
from pymongo.errors import DuplicateKeyError
from db import db
from models import now_iso
from permissions import require_permission
from payroll_payslips import Issue

router = APIRouter()

async def issuing_enabled(org):
    override = os.environ.get('PAYROLL_ISSUING_ENABLED')
    if override is not None:
        return override == 'true'
    settings = await db.pay_delivery_settings.find_one({'_id': org}) or {}
    return settings.get('enabled') is True

class Enable(BaseModel):
    enabled: bool
    validation_completed: bool = False

@router.get('/delivery/settings')
async def settings(user=Depends(require_permission('payroll','view'))):
    from payroll_access import is_payroll_owner
    return {'enabled': await issuing_enabled(user['org_id']), 'can_configure': is_payroll_owner(user),
            'deployment_override': os.environ.get('PAYROLL_ISSUING_ENABLED') is not None}

@router.put('/delivery/settings')
async def configure(body: Enable, user=Depends(require_permission('payroll','edit'))):
    from payroll_access import is_payroll_owner
    if not is_payroll_owner(user): raise HTTPException(403, 'Only the payroll owner can enable payslip issuing')
    if os.environ.get('PAYROLL_ISSUING_ENABLED') is not None: raise HTTPException(409, 'Deployment configuration controls issuing')
    if body.enabled and not body.validation_completed: raise HTTPException(422, 'Confirm payroll validation before enabling live payslip emails')
    await db.pay_delivery_settings.update_one({'_id':user['org_id']}, {'$set':{
        'enabled':body.enabled,'verified_by':user['id'],'at':now_iso()}}, upsert=True)
    return await settings(user)

async def recipients(org, snapshot):
    from payroll_roster import roster
    workers = {w['id']:w for w in await roster(org)}
    result = []; seen = set()
    for row in snapshot['report']['rows']:
        worker = workers.get(row['worker_id'])
        if not worker: raise HTTPException(422, f"{row['name']} is no longer a current Simpro employee; review before issuing")
        try: email = str(TypeAdapter(EmailStr).validate_python(worker.get('email') or '')).lower()
        except Exception: raise HTTPException(422, f"Correct the email address in the employee record for {row['name']} before completing this run")
        if email in seen: raise HTTPException(422, 'Employees share an email address. Confirm individual employee addresses before emailing payslips')
        seen.add(email)
        result.append({'worker_id':row['worker_id'], 'name':row['name'], 'email':email})
    if not result: raise HTTPException(422, 'This run has no employees')
    return result

@router.post('/{week}/complete')
async def complete(week: str, body: Issue, user=Depends(require_permission('payroll','edit'))):
    from payroll_payslips import issue
    from payroll_workbench import period
    period(week)
    key=f"{user['org_id']}:{week}:{body.revision}"
    existing=await db.pay_payslip_batches.find_one({'_id':key})
    if existing:
        if existing['paid_date']!=body.paid_date.isoformat() or existing['payment_reference']!=body.payment_reference:
            raise HTTPException(409, 'Payment details differ from the existing completed run')
        return {'revision':body.revision,'prepared':True}
    doc=await db.pay_review_sheets.find_one({'_id':f"{user['org_id']}:{week}"}) or {}
    snapshot=next((s for s in doc.get('finalizations',[]) if s['revision']==body.revision), None)
    if not snapshot: raise HTTPException(409, 'Lock the reviewed run before completing it')
    targets=await recipients(user['org_id'], snapshot)
    cfg=await db.integration_configs.find_one({'org_id':user['org_id'],'kind':'microsoft365'}) or {}
    if cfg.get('status')!='connected': raise HTTPException(409, 'Connect Microsoft 365 email in Integrations before completing the run')
    issued=await issue(week, body, user)
    record={'_id':key,'org_id':user['org_id'],'week':week,'revision':body.revision,
            'paid_date':issued['paid_date'],'payment_reference':issued['payment_reference'],
            'created_at':now_iso(),'created_by':user['id'],'recipients':targets}
    try: await db.pay_payslip_batches.insert_one(record)
    except DuplicateKeyError: pass
    return {'revision':body.revision,'prepared':True}

@router.get('/{week}/delivery/{revision}')
async def batch_status(week: str, revision: int, user=Depends(require_permission('payroll','view'))):
    key=f"{user['org_id']}:{week}:{revision}"
    batch=await db.pay_payslip_batches.find_one({'_id':key})
    if not batch: return {'recipients':[], 'prepared':False}
    rows=[]
    for person in batch['recipients']:
        send=await db.pay_payslip_delivery.find_one({'_id':f"{key}:{person['worker_id']}"}) or {}
        rows.append({**person,'status':send.get('status','pending'),'at':send.get('at')})
    return {'recipients':rows,'prepared':True}

@router.post('/{week}/delivery/{revision}/{worker_id}')
async def dispatch(week: str, revision: int, worker_id: str, user=Depends(require_permission('payroll','edit'))):
    if not await issuing_enabled(user['org_id']): raise HTTPException(503, 'Payslip issuing is disabled')
    key=f"{user['org_id']}:{week}:{revision}"
    batch=await db.pay_payslip_batches.find_one({'_id':key}) or {}
    person=next((p for p in batch.get('recipients',[]) if p['worker_id']==worker_id),None)
    if not person: raise HTTPException(404, 'Payslip recipient not in this batch')
    doc=await db.pay_review_sheets.find_one({'_id':f"{user['org_id']}:{week}"}) or {}
    if doc.get('state')!='finalized' or doc['worksheet']['revision']!=revision:
        raise HTTPException(409, 'A correction has been opened; review it before sending any further payslips')
    snapshot=next((s for s in doc.get('finalizations',[]) if s['revision']==revision),None)
    issued=doc.get(f'issued_{revision}')
    if not snapshot or not issued: raise HTTPException(409, 'Issued snapshot unavailable')
    # Check Safe Mode before claiming a send so a blocked attempt remains resumable.
    from comms_safe_mode import is_blocked
    if await is_blocked(user['org_id']): raise HTTPException(409, 'Email Safe Mode is on. No payslips have been sent by this request')
    sendkey=f'{key}:{worker_id}'
    # Unique _id is the send reservation. Never automatically resend a claimed
    # record, including a timeout/crash where the provider may have accepted it.
    try:
        await db.pay_payslip_delivery.insert_one({'_id':sendkey,'org_id':user['org_id'],
            'status':'sending_or_unknown','at':now_iso(),'by':user['id']})
    except DuplicateKeyError:
        old=await db.pay_payslip_delivery.find_one({'_id':sendkey})
        return {'status':old['status']}
    from payroll_payslip_document import render_pdf
    from integrations_m365 import graph_send_mail
    try:
        response=await graph_send_mail(user['org_id'],to=[person['email']],cc=[],
            subject=f'Your payslip — week commencing {week}',
            body_html='<p>Your individual payslip is attached. Please contact your pay officer if you have any questions.</p>',
            attachments=[{'filename':f'payslip-{week}-r{revision}.pdf','content_type':'application/pdf',
                'content_bytes':render_pdf(snapshot,worker_id,week,issued)}])
        status='accepted' if response.get('ok') and not response.get('blocked') and not response.get('skipped') else 'needs_check'
    except Exception:
        status='needs_check'
    await db.pay_payslip_delivery.update_one({'_id':sendkey},{'$set':{'status':status,'at':now_iso()}})
    return {'status':status}

# Imported after the module declarations to keep the workbench router dependency acyclic.
from payroll_payslips import Issue

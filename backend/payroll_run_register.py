"""Pay-run register and provider integration requirements. No outbound submissions."""
from datetime import date, timedelta
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, ConfigDict
from db import db
from models import now_iso
from permissions import require_permission
from payroll_access import is_payroll_owner

router = APIRouter()
PORTALS = {'bank': 'Bank', 'payslips': 'Payslips', 'stp': 'ATO / STP', 'super': 'Super', 'journal': 'Xero'}

def register_row(doc):
    sheet = doc['worksheet']; revision = sheet['revision']
    completion = doc.get(f'completion_{revision}', {})
    receipts = doc.get(f'portal_receipts_{revision}', {})
    statuses = {}
    for key, label in PORTALS.items():
        receipt = receipts.get(key)
        manual = completion.get(key)
        statuses[key] = {'label': label, 'status': 'not_recorded', 'source': None}
        if manual:
            statuses[key].update(status='verified_manually', source='Office verification', evidence=manual)
        if receipt:
            statuses[key].update(status=receipt['status'], source='Recorded provider response', evidence=receipt)
    # Issuing a PDF is not evidence that an email reached its recipient.
    if doc.get(f'issued_{revision}') and statuses['payslips']['status'] == 'not_recorded':
        statuses['payslips'].update(status='issued', source='Payslips issued; delivery not confirmed')
    hours = sum(float(row.get('entry', {}).get(k) or 0) for row in sheet.get('rows', [])
                for k in ('ordinary','ot1','ot2','night','holiday_work','annual','personal','public_holiday'))
    return {'week': doc['week'], 'schedule': 'Out of cycle' if '~' in doc['week'] else 'Weekly', 'end': (date.fromisoformat(doc['week'][:10])+timedelta(days=6)).isoformat(),
            'payday': sheet['payday'], 'revision': revision, 'employees': len(sheet.get('rows', [])),
            'hours': round(hours, 2), 'totals': doc.get('report', {}).get('totals', {}),
            'state': 'closed' if completion.get('closed_at') else doc.get('state','open'), 'portals': statuses}

@router.get('/register/list')
async def register(user=Depends(require_permission('payroll','view'))):
    rows = [register_row(doc) async for doc in db.pay_review_sheets.find({'org_id': user['org_id']})]
    return {'runs': sorted(rows, key=lambda row: row['week'], reverse=True)}

class Requirements(BaseModel):
    model_config = ConfigDict(extra='forbid')
    provider: str = Field('', max_length=160)
    requirements: str = Field('', max_length=4000)
    receipt_method: Literal['not_connected','webhook_planned','polling_planned','manual'] = 'not_connected'
    accepted_status: str = Field('', max_length=200)

@router.get('/portals/requirements')
async def requirements(user=Depends(require_permission('payroll','view'))):
    doc = await db.pay_connection_settings.find_one({'_id': user['org_id']}) or {}
    return {'portals': doc.get('portal_requirements', {}), 'labels': PORTALS}

@router.put('/portals/requirements/{kind}')
async def save_requirements(kind: str, body: Requirements, user=Depends(require_permission('payroll','edit'))):
    if kind not in PORTALS: raise HTTPException(404,'Unknown portal')
    await db.pay_connection_settings.update_one({'_id':user['org_id']}, {'$set': {
        f'portal_requirements.{kind}': {**body.model_dump(), 'updated_by':user['id'], 'updated_at':now_iso()}}}, upsert=True)
    return {'saved':True, 'connected':False}

class Receipt(BaseModel):
    model_config = ConfigDict(extra='forbid')
    revision: int = Field(gt=0)
    event_id: str = Field(min_length=1,max_length=100,pattern=r'^[A-Za-z0-9_-]+$')
    status: Literal['submitted','received','accepted','rejected']
    reference: str = Field(min_length=1,max_length=300)
    message: str = Field('',max_length=1000)

@router.post('/{week}/portal-receipts/{kind}')
async def receipt(week: str, kind: str, body: Receipt, user=Depends(require_permission('payroll','edit'))):
    """Authenticated adapter seam; vendor-specific signature validation belongs in its adapter.

    This is not a public webhook. No completion/payment flags are changed here.
    """
    if kind not in PORTALS: raise HTTPException(404,'Unknown portal')
    if not body.reference.strip(): raise HTTPException(422,'Receipt reference is required')
    key=f"{user['org_id']}:{week}"
    doc=await db.pay_review_sheets.find_one({'_id':key}) or {}
    if doc.get('state')!='finalized' or doc.get('worksheet',{}).get('revision')!=body.revision:
        raise HTTPException(409,'Receipt must identify the current locked revision')
    field=f'portal_receipts_{body.revision}.{kind}'
    current=doc.get(f'portal_receipts_{body.revision}',{}).get(kind, {})
    event={**body.model_dump(), 'recorded_by':user['id'], 'recorded_at':now_iso()}
    seen=doc.get(f'portal_events_{body.revision}',{}).get(kind,{})
    if body.event_id in seen:
        previous=seen[body.event_id]
        if any(previous.get(k)!=v for k,v in body.model_dump().items()): raise HTTPException(409,'Event ID already used with different content')
        return {'duplicate':True}
    # Optimistic comparison avoids silently losing concurrent callbacks.
    result=await db.pay_review_sheets.update_one({'_id':key,'worksheet.revision':body.revision,'state':'finalized',
        f'{field}.event_id':current.get('event_id')}, {'$set':{field:event, f'portal_events_{body.revision}.{kind}.{body.event_id}':event}})
    if not result.matched_count: raise HTTPException(409,'Receipt changed; reload and retry')
    return {'recorded':True}

@router.get('/access/list')
async def access_list(user=Depends(require_permission('payroll','view'))):
    if not is_payroll_owner(user): raise HTTPException(403,'Only the payroll owner can manage access')
    result=[]
    async for person in db.users.find({'org_id':user['org_id'],'role':'admin'}):
        grant=await db.payroll_access.find_one({'_id':f"{user['org_id']}:{person['id']}"}) or {}
        owner=is_payroll_owner(person)
        result.append({'id':person['id'],'name':person.get('name') or ' '.join(filter(None,[person.get('first_name'),person.get('last_name')])),
                       'status':person.get('status','active'),'last_invite_sent':person.get('last_invite_sent'),'email':person.get('email',''),'owner':owner,'level':'owner' if owner else grant.get('level','none'),
                       'updated_at':grant.get('updated_at')})
    return {'users':result}


class AccountantInvitation(BaseModel):
    company: str = Field(min_length=1,max_length=160)
    name: str = Field(min_length=1,max_length=160)
    email: str = Field(min_length=3,max_length=254)
    reason: str = Field(min_length=1,max_length=1000)

@router.post('/access/{user_id}/invite')
async def invite_access(user_id:str,request:Request,body:AccountantInvitation|None=None,user=Depends(require_permission('payroll','view'))):
    if not is_payroll_owner(user):raise HTTPException(403,'Only the payroll owner can invite payroll users')
    person=await db.users.find_one({'id':user_id,'org_id':user['org_id'],'role':'admin'})
    if not person or person.get('status') not in ('invited','pending_invite','invited_pending_send'):
        raise HTTPException(400,'Select an approved administrator awaiting an invitation')
    grant=await db.payroll_access.find_one({'_id':f"{user['org_id']}:{user_id}"}) or {}
    if grant.get('level') not in ('view','edit'):raise HTTPException(400,'Authorise payroll access before inviting')
    if body:
        if body.email.strip().casefold()!=person.get('email','').strip().casefold():raise HTTPException(422,'Email must match the approved user record')
        if not all(v.strip() for v in body.model_dump().values()):raise HTTPException(422,'Complete all invitation fields')
        await db.users.update_one({'id':user_id,'org_id':user['org_id']},{'$set':{'payroll_invite_context':{**body.model_dump(),'invited_by':user['id'],'at':now_iso()}}})
    from auth_invite import send_invite,InviteIn
    return await send_invite(user_id,InviteIn(channel='email'),request,caller=user)

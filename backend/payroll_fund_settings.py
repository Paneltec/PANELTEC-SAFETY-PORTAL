"""Shared fund directory. Member numbers remain in encrypted employee records."""
from fastapi import APIRouter,Depends,HTTPException
from pydantic import BaseModel,Field,ConfigDict
from pymongo.errors import DuplicateKeyError
from permissions import require_permission
from models import now_iso
from db import db
router=APIRouter(prefix='/configuration/super-funds',tags=['payroll-configuration'])
def check_key(org,usi,name):
    from hashlib import sha256
    identity=f'{usi.strip().upper()}:{name.strip().casefold()}'
    return f'{org}:super-fund-check:{sha256(identity.encode()).hexdigest()}'
async def with_checks(org,data):
    checks={}
    for fund in data['items']:
        record=await db.pay_configuration.find_one({'_id':check_key(org,fund['usi'],fund['name'])})
        if record:checks[fund['usi']]=record['result']
    return {**data,'checks':checks}
class Fund(BaseModel):
    model_config=ConfigDict(extra='forbid')
    name:str=Field(min_length=1,max_length=160)
    usi:str=Field(min_length=1,max_length=32)
    active:bool=True
class Funds(BaseModel):
    model_config=ConfigDict(extra='forbid')
    revision:int=Field(0,ge=0)
    items:list[Fund]=Field(max_length=200)
async def directory(org):
    doc=await db.pay_configuration.find_one({'_id':f'{org}:super-funds'})
    if doc:return {'revision':doc['revision'],'items':doc['items']}
    # Bring already-recorded fund names into the first shared list, without membership data.
    from payroll_banking import decrypt
    items={}
    async for row in db.pay_employee_records.find({'org_id':org}):
        profile=decrypt(row).get('profile',{})
        usi=str(profile.get('super_fund_usi') or '').strip().upper();name=str(profile.get('super_fund_name') or '').strip()
        if usi and name:items.setdefault(usi,{'usi':usi,'name':name,'active':True})
    return {'revision':0,'items':sorted(items.values(),key=lambda f:f['name'].casefold())}
@router.get('')
async def read(user=Depends(require_permission('payroll','view'))):return await with_checks(user['org_id'],await directory(user['org_id']))
@router.post('/check')
async def check(body:Fund,user=Depends(require_permission('payroll','view'))):
    from payroll_fund_lookup import lookup
    result=await lookup(body.usi,body.name)
    await db.pay_configuration.update_one({'_id':check_key(user['org_id'],body.usi,body.name)},
        {'$set':{'org_id':user['org_id'],'result':result,'checked_by':user['id']}},upsert=True)
    return result
@router.put('')
async def save(body:Funds,user=Depends(require_permission('payroll','edit'))):
    items=[{'name':f.name.strip(),'usi':f.usi.strip().upper(),'active':f.active} for f in body.items]
    if any(not f['name'] or not f['usi'] for f in items) or len({f['usi'] for f in items})!=len(items):raise HTTPException(422,'Each fund needs a name and a unique USI')
    key=f"{user['org_id']}:super-funds";old=await directory(user['org_id'])
    if old['revision']!=body.revision:raise HTTPException(409,'Fund settings changed; reload before saving')
    doc={'org_id':user['org_id'],'revision':body.revision+1,'items':items,'updated_at':now_iso(),'updated_by':user['id']}
    try:
        result=await db.pay_configuration.update_one({'_id':key,'revision':body.revision},{'$set':doc,'$push':{'history':{**old,'by':user['id'],'at':now_iso()}}},upsert=body.revision==0)
    except DuplicateKeyError:raise HTTPException(409,'Fund settings changed; reload before saving')
    if not result.matched_count and not result.upserted_id:raise HTTPException(409,'Fund settings changed; reload before saving')
    return await with_checks(user['org_id'],{'revision':doc['revision'],'items':items})

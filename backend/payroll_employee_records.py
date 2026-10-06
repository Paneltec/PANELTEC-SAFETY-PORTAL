"""Encrypted employee payroll defaults, separate from simPRO worker records."""
import json
from fastapi import APIRouter,Depends,HTTPException
from pydantic import Field
from pymongo.errors import DuplicateKeyError
from db import db
from models import now_iso
from permissions import require_permission
from payroll_workbench import Strict,Profile
from payroll_banking import cipher,decrypt
router=APIRouter(prefix='/employee-records',tags=['payroll-employee-records'])
class EmployeeRecord(Strict):
    revision:int=Field(0,ge=0)
    profile:Profile
    super_member_number:str|None=Field(None,max_length=64)
    # None retains the encrypted member number, blank explicitly clears it.

async def employee(user,worker_id):
    from payroll_workbench import workers
    if worker_id not in await workers(user['org_id']):raise HTTPException(404,'Current Simpro worker not found')


def public(doc):
    if not doc:return {'configured':False,'revision':0,'profile':Profile().model_dump(),'member_number_masked':''}
    data=decrypt(doc);number=data.get('super_member_number','')
    return {'configured':True,'revision':doc['revision'],'profile':data['profile'],
        'member_number_masked':('••••'+number[-4:]) if number else '', 'updated_at':doc['updated_at']}

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
    data={'profile':body.profile.model_dump(),'super_member_number':member.strip()}
    record={'org_id':user['org_id'],'worker_id':worker_id,'revision':body.revision+1,'updated_at':now_iso(),
            'encrypted':cipher().encrypt(json.dumps(data).encode()).decode()}
    try:
        result=await db.pay_employee_records.update_one({'_id':key,'revision':body.revision},
            {'$set':record,'$push':{'audit':{'at':record['updated_at'],'by':user['id'],'revision':record['revision']}}},upsert=body.revision==0)
    except DuplicateKeyError:raise HTTPException(409,'Employee payroll settings changed; reload first')
    if not result.matched_count and not result.upserted_id:raise HTTPException(409,'Employee payroll settings changed; reload first')
    return public(record)

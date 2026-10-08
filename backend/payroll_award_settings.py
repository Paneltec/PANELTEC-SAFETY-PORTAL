"""Company award labels for employee selection; rates remain separately configured."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, ConfigDict
from pymongo.errors import DuplicateKeyError
from permissions import require_permission
from models import now_iso
from db import db
router=APIRouter(prefix='/configuration/awards',tags=['payroll-configuration'])
DEFAULT_AWARD='Building and Construction General On-site Award (MA000020)'
class Award(BaseModel):
    model_config=ConfigDict(extra='forbid')
    name:str=Field(min_length=1,max_length=200)
    active:bool=True
class Awards(BaseModel):
    model_config=ConfigDict(extra='forbid')
    revision:int=Field(0,ge=0)
    items:list[Award]=Field(max_length=200)
async def directory(org):
    doc=await db.pay_configuration.find_one({'_id':f'{org}:awards'})
    return {'revision':doc['revision'],'items':doc['items']} if doc else {'revision':0,'items':[{'name':DEFAULT_AWARD,'active':True}]}
@router.get('')
async def read(user=Depends(require_permission('payroll','view'))):
    return await directory(user['org_id'])
@router.put('')
async def save(body:Awards,user=Depends(require_permission('payroll','edit'))):
    items=[{'name':a.name.strip(),'active':a.active} for a in body.items]
    if any(not a['name'] for a in items) or len({a['name'].casefold() for a in items})!=len(items):
        raise HTTPException(422,'Enter a unique name for each award')
    old=await directory(user['org_id'])
    if old['revision']!=body.revision:raise HTTPException(409,'Award settings changed; reload before saving')
    doc={'org_id':user['org_id'],'revision':body.revision+1,'items':items,'updated_at':now_iso(),'updated_by':user['id']}
    try:
        result=await db.pay_configuration.update_one({'_id':f"{user['org_id']}:awards",'revision':body.revision},{'$set':doc,'$push':{'history':{**old,'by':user['id'],'at':now_iso()}}},upsert=body.revision==0)
    except DuplicateKeyError:raise HTTPException(409,'Award settings changed; reload before saving')
    if not result.matched_count and not result.upserted_id:raise HTTPException(409,'Award settings changed; reload before saving')
    return {'revision':doc['revision'],'items':items}

"""Organisation work types shared by mobile entries and office review."""
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, ConfigDict
from pymongo.errors import DuplicateKeyError
from permissions import require_permission
from models import now_iso
from db import db

router=APIRouter(prefix='/configuration/work-types',tags=['payroll-configuration'])
class WorkType(BaseModel):
    model_config=ConfigDict(extra='forbid')
    id:str=Field(min_length=1,max_length=80,pattern=r'^[a-zA-Z0-9_-]+$')
    name:str=Field(min_length=1,max_length=100)
    action:Literal['primary','annual','personal','unpaid']='primary'
    active:bool=True
class WorkTypes(BaseModel):
    model_config=ConfigDict(extra='forbid')
    revision:int=Field(0,ge=0)
    items:list[WorkType]=Field(max_length=150)
NAMES=['Call Out','Fatigue Break','Living Away From Home','No Meal Break','On Call Standby','On Call Standby Tas Gas','On Call Standby Taswater','Traffic Control']
DEFAULTS=[{'id':n.lower().replace(' ','-'),'name':n,'action':'primary','active':True} for n in NAMES]+[
    {'id':'annual-leave','name':'Leave - Annual Leave Taken','action':'annual','active':True},
    {'id':'unpaid-leave','name':'Leave - Leave Without Pay Taken','action':'unpaid','active':True},
    {'id':'sick-leave','name':'Leave - Sick Leave Taken','action':'personal','active':True}]
async def settings(org):
    doc=await db.pay_configuration.find_one({'_id':f'{org}:work-types'}) or {}
    return {'revision':doc.get('revision',0),'items':doc.get('items',DEFAULTS)}
async def choices(org):
    return [i for i in (await settings(org))['items'] if i['active'] and i['action']=='primary']
@router.get('')
async def read(user=Depends(require_permission('payroll','view'))):return await settings(user['org_id'])
@router.put('')
async def save(body:WorkTypes,user=Depends(require_permission('payroll','edit'))):
    items=[i.model_dump() for i in body.items]
    for i in items:i['name']=i['name'].strip()
    if any(not i['name'] for i in items) or len({i['id'] for i in items})!=len(items) or len({i['name'].casefold() for i in items})!=len(items):
        raise HTTPException(422,'Work types need unique IDs and names')
    key=f"{user['org_id']}:work-types";old=await settings(user['org_id'])
    if old['revision']!=body.revision:raise HTTPException(409,'Work types changed; reload before saving')
    value={'org_id':user['org_id'],'revision':body.revision+1,'items':items,'updated_at':now_iso(),'updated_by':user['id']}
    try:
        result=await db.pay_configuration.update_one({'_id':key,'revision':body.revision},{'$set':value,'$push':{'history':{**old,'by':user['id'],'at':now_iso()}}},upsert=body.revision==0)
    except DuplicateKeyError:raise HTTPException(409,'Work types changed; reload before saving')
    if not result.matched_count and not result.upserted_id:raise HTTPException(409,'Work types changed; reload before saving')
    return {'revision':value['revision'],'items':items}
async def resolve_type(org,identity,prior):
    if not identity:return ''
    if prior.get('work_type_id')==identity and prior.get('work_type_name'):return prior['work_type_name']
    item=next((i for i in (await settings(org))['items'] if i['id']==identity and i['active']),None)
    if not item:raise HTTPException(422,'Work type is no longer available; choose an active work type')
    if item['action']!='primary':raise HTTPException(422,'Record leave through Leave Requests so it can be approved and allocated to payroll')
    return item['name']

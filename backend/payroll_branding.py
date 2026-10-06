"""One legal employer, worker-ID keyed division presentation settings."""
import base64
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, ConfigDict, field_validator
from db import db
from models import now_iso
from permissions import require_permission
router=APIRouter(prefix='/branding',tags=['payroll-branding'])
class Division(BaseModel):
    model_config=ConfigDict(extra='forbid')
    name:str=Field(min_length=1,max_length=100)
    logo:str=Field('',max_length=280000)
    @field_validator('logo')
    @classmethod
    def image(cls,value):
        if not value:return value
        try:
            prefix,data=value.split(',',1)
            raw=base64.b64decode(data,validate=True)
            valid=(prefix=='data:image/png;base64' and raw.startswith(b'\x89PNG\r\n\x1a\n')) or (prefix=='data:image/jpeg;base64' and raw.startswith(b'\xff\xd8\xff'))
            if not valid or len(raw)>200000:raise ValueError()
        except Exception:raise ValueError('Use a PNG or JPEG logo up to 200 KB')
        return value
class Branding(BaseModel):
    model_config=ConfigDict(extra='forbid')
    employer_name:str=Field('',max_length=160)
    employer_abn:str=Field('',pattern=r'^(|[0-9]{11})$')
    paneltec:Division=Field(default_factory=lambda:Division(name='Paneltec Civil'))
    viatec:Division=Field(default_factory=lambda:Division(name='Viatec'))
    assignments:dict[str,Literal['paneltec','viatec']]=Field(default_factory=dict,max_length=1000)

@router.get('')
async def load(user=Depends(require_permission('payroll','view'))):
    doc=await db.pay_branding.find_one({'_id':user['org_id']},{'_id':0})
    setting=Branding(**{k:v for k,v in (doc or {}).items() if k in Branding.model_fields})
    workers=[{'id':w['id'],'name':(' '.join([w.get('first_name',''),w.get('last_name','')])).strip() or w['id']} async for w in db.workers.find({'org_id':user['org_id'],'deleted_at':None})]
    return {'settings':setting.model_dump(),'workers':sorted(workers,key=lambda w:w['name'])}

@router.put('')
async def save(body:Branding,user=Depends(require_permission('payroll','edit'))):
    allowed={w['id'] async for w in db.workers.find({'org_id':user['org_id']})}
    if set(body.assignments)-allowed:raise HTTPException(422,'Division assignments must use workers from this organisation')
    await db.pay_branding.update_one({'_id':user['org_id']},{'$set':{**body.model_dump(),'updated_by':user['id'],'updated_at':now_iso()}},upsert=True)
    return {'settings':body.model_dump()}

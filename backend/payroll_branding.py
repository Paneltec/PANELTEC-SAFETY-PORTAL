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
    overseas_entity: bool = False
    address_line1: str = Field('',max_length=200)
    address_line2: str = Field('',max_length=200)
    suburb: str = Field('',max_length=100)
    state: str = Field('',max_length=80)
    postcode: str = Field('',max_length=20)
    country: str = Field('Australia',max_length=80)
    contact_name: str = Field('',max_length=160)
    contact_email: str = Field('',max_length=254)
    contact_phone: str = Field('',max_length=40)
    contact_fax: str = Field('',max_length=40)
    external_id: str = Field('',max_length=100)
    sms_requested: bool = False
    automatic_super_updates_requested: bool = False
    paneltec:Division=Field(default_factory=lambda:Division(name='Paneltec Civil'))
    viatec:Division=Field(default_factory=lambda:Division(name='Viatec'))
    assignments:dict[str,Literal['paneltec','viatec']]=Field(default_factory=dict,max_length=1000)

async def resolved_branding(org):
    from payroll_roster import roster
    doc=await db.pay_branding.find_one({'_id':org}) or {}
    setting=Branding(**{k:v for k,v in doc.items() if k in Branding.model_fields})
    setting.assignments={w['id']:w['division'] for w in await roster(org)}
    return setting.model_dump()

@router.get('')
async def load(user=Depends(require_permission('payroll','view'))):
    from payroll_roster import roster,public_roster
    return {'settings':await resolved_branding(user['org_id']),'workers':public_roster(await roster(user['org_id']))}

@router.put('')
async def save(body:Branding,user=Depends(require_permission('payroll','edit'))):
    from payroll_roster import roster
    body.assignments={w['id']:w['division'] for w in await roster(user['org_id'])}
    await db.pay_branding.update_one({'_id':user['org_id']},{'$set':{**body.model_dump(),'updated_by':user['id'],'updated_at':now_iso()}},upsert=True)
    return {'settings':body.model_dump()}

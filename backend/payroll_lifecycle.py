"""Atomic worksheet locking and correction history. No payment or lodgment."""
from fastapi import APIRouter,Depends,HTTPException
from pydantic import BaseModel,Field,ConfigDict
from bson import BSON
from db import db
from models import now_iso
from permissions import require_permission

router=APIRouter()
class Transition(BaseModel):
    model_config=ConfigDict(extra='forbid')
    revision:int=Field(gt=0)
    reason:str=Field('',max_length=1000)

def valid_abn(value):
    s=str(value or '')
    return len(s)==11 and s.isascii() and s.isdigit() and sum((int(n)-(i==0))*w for i,(n,w) in enumerate(zip(s,[10,1,3,5,7,9,11,13,15,17,19])))%89==0

@router.get('/{week}/lifecycle')
async def state(week:str,user=Depends(require_permission('payroll','view'))):
    from payroll_workbench import period
    period(week)
    doc=await db.pay_review_sheets.find_one({'_id':f"{user['org_id']}:{week}"}) or {}
    return {'status':doc.get('state','open'),'revision':doc.get('worksheet',{}).get('revision',0),
            'events':doc.get('lifecycle_events',[]),'finalizations':doc.get('finalizations',[])}

@router.post('/{week}/finalize')
async def finalize(week:str,body:Transition,user=Depends(require_permission('payroll','edit'))):
    from payroll_workbench import period,Worksheet,report,check_leave_sources
    from payroll_branding import Branding
    period(week);key=f"{user['org_id']}:{week}"
    doc=await db.pay_review_sheets.find_one({'_id':key})
    if not doc or doc['worksheet']['revision']!=body.revision:raise HTTPException(409,'Reload the saved worksheet before finalising')
    if doc.get('state')=='finalized':return {'status':'finalized','revision':body.revision}
    worksheet=Worksheet(**doc['worksheet'])
    calculated=await check_leave_sources(worksheet,user['org_id'],week,report(worksheet,{r['worker_id']:r['name'] for r in doc['report']['rows']}))
    if not worksheet.reviewed or not calculated['ready']:raise HTTPException(422,'Save a reviewed worksheet and resolve changed leave before finalising')
    source=await db.pay_branding.find_one({'_id':user['org_id']}) or {}
    branding=Branding(**{k:v for k,v in source.items() if k in Branding.model_fields}).model_dump()
    if not branding['employer_name'].strip() or not valid_abn(branding['employer_abn']):raise HTTPException(422,'Configure the legal employer name and valid ABN first')
    for row in calculated['rows']:
        if not row['profile'].get('super_fund_name','').strip() or not row['profile'].get('super_fund_usi','').strip():
            raise HTTPException(422,f"Record selected fund name and USI for {row['name']}; SMSF processing is not supported yet")
    event={'action':'finalized','revision':body.revision,'at':now_iso(),'by':user['id']}
    snapshot={**event,'worksheet':doc['worksheet'],'report':calculated,'branding':branding,'rule_version':doc['rule_version']}
    # Reserve room below MongoDB's document limit; never discard an older finalisation.
    candidate={**doc,'finalizations':doc.get('finalizations',[])+[snapshot]}
    if len(BSON.encode(candidate))>12_000_000:raise HTTPException(409,'This run requires archive migration before another finalisation; existing records are preserved')
    result=await db.pay_review_sheets.update_one({'_id':key,'worksheet.revision':body.revision,'state':{'$ne':'finalized'}},
        {'$set':{'state':'finalized'},'$push':{'finalizations':snapshot,'lifecycle_events':event}})
    if not result.matched_count:raise HTTPException(409,'The run changed in another window; reload')
    return {'status':'finalized','revision':body.revision}

@router.post('/{week}/reopen')
async def reopen(week:str,body:Transition,user=Depends(require_permission('payroll','edit'))):
    from payroll_workbench import period
    period(week)
    if not body.reason.strip():raise HTTPException(422,'A correction reason is required')
    key=f"{user['org_id']}:{week}"
    doc=await db.pay_review_sheets.find_one({'_id':key})
    if not doc or doc.get('state')!='finalized' or doc['worksheet']['revision']!=body.revision:raise HTTPException(409,'Reload the finalised worksheet before opening a correction')
    worksheet={**doc['worksheet'],'revision':body.revision+1,'reviewed':False}
    event={'action':'correction_opened','revision':worksheet['revision'],'reason':body.reason.strip(),'at':now_iso(),'by':user['id']}
    result=await db.pay_review_sheets.update_one({'_id':key,'worksheet.revision':body.revision,'state':'finalized'},
        {'$set':{'worksheet':worksheet,'state':'open'},'$push':{'lifecycle_events':event}})
    if not result.matched_count:raise HTTPException(409,'The run changed in another window; reload')
    return {'status':'open','revision':worksheet['revision']}

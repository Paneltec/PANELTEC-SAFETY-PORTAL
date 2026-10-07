"""Editable migration definitions. Importing never posts payroll or ledger entries."""
from typing import Literal
from fastapi import APIRouter,Depends,HTTPException,UploadFile,File
from pydantic import BaseModel,Field,ConfigDict
from pymongo.errors import DuplicateKeyError
from db import db
from models import now_iso
from permissions import require_permission
from payroll_rate_import import workbook

router=APIRouter(prefix='/configuration/catalog',tags=['payroll-configuration'])
Kind=Literal['pay-categories','deduction-categories','chart-of-accounts']
HEADERS={
 'pay-categories':{'Export':['Id','PayCategoryName','RateUnit','AccruesLeave','DefaultSuperRate','IsTaxExempt','LinkedPayCategory','PenaltyLoadingMultiplier','RateLoadingMultiplier','IsPayrollTaxExempt','ExternalId','PaymentSummaryClassification','AllowanceDescription','Award','GeneralLedgerMappingCode','SuperLiabilityMappingCode','SuperExpenseMappingCode','IsIncludedInQualifyingEarnings','ExcludeFromQualifyingEarnings']},
 'deduction-categories':{'Export':['Id','Name','ExternalId','TaxExempt','IsResc','Source','SGCCalculationImpact','PaymentSummaryClassification','ExpenseGeneralLedgerMappingCode','LiabilityGeneralLedgerMappingCode']},
 'chart-of-accounts':{
  'Default Accounts':['Location','Account Type','Account Code','Account Name','Split by location'],
  'Pay Categories':['Location','Pay Category','Expense Account Code','Expense Account Name','Split by location'],
  'Deduction Categories':['Location','Deduction Category','Liability Account Code','Liability Account Name','Expense Account Code','Expense Account Name','Split by location'],
  'Expense Categories':['Location','Expense Category','Expense Account Code','Expense Account Name','Split by location'],
  'Employer Liability Categories':['Location','Liability Category','Liability Account Code','Liability Account Name','Expense Account Code','Expense Account Name','Split by location'],
  'Leave Provisions':['Location','Leave Category','Liability Account Code','Liability Account Name','Expense Account Code','Expense Account Name','Accrue from Contingent Period','Split by location']}
}
class Catalog(BaseModel):
 model_config=ConfigDict(extra='forbid',allow_inf_nan=False)
 revision:int=Field(0,ge=0)
 tables:dict[str,list[dict[str,str|int|float|bool|None]]]
 source:str=Field('',max_length=200)

def validate(kind,tables):
 if len(tables)>10:raise HTTPException(422,'Too many tables')
 for title,rows in tables.items():
  if title not in HEADERS[kind] or len(rows)>1000:raise HTTPException(422,'Unsupported table or too many rows')
  seen=set()
  for row in rows:
   if len(row)>30 or any(len(str(v or ''))>500 for v in row.values()):raise HTTPException(422,'Category fields are too large')
   if any(not isinstance(k,str) or len(k)>100 for k in row):raise HTTPException(422,'Invalid field name')
   if kind!='chart-of-accounts':
    name=row.get('PayCategoryName') if kind=='pay-categories' else row.get('Name')
    if not str(name or '').strip():raise HTTPException(422,'Every category needs a name')
    identity=str(row.get('Id') or name).strip().casefold()
    if identity in seen:raise HTTPException(422,'Duplicate category IDs')
    seen.add(identity)

@router.get('/{kind}')
async def read(kind:Kind,user=Depends(require_permission('payroll','view'))):
 doc=await db.pay_configuration.find_one({'_id':f"{user['org_id']}:{kind}"}) or {}
 return {'revision':doc.get('revision',0),'tables':doc.get('tables',{}),'source':doc.get('source',''),'headers':HEADERS[kind]}

@router.post('/{kind}/preview')
async def preview(kind:Kind,file:UploadFile=File(...),user=Depends(require_permission('payroll','edit'))):
 book=await workbook(file);tables={}
 for title,rows in book.items():
  if title not in HEADERS[kind]:raise HTTPException(422,'This workbook is not the selected extract type')
  if not rows:continue
  headers=[str(h or '') for h in rows[0]]
  required={'Id','PayCategoryName','RateUnit'} if kind=='pay-categories' else {'Id','Name','TaxExempt'} if kind=='deduction-categories' else {'Location'}
  if not required.issubset(headers):raise HTTPException(422,'Workbook headings do not match this extract type')
  tables[title]=[dict(zip(headers,row)) for row in rows[1:] if any(v is not None for v in row)]
 if not tables:raise HTTPException(422,'No recognised tables')
 validate(kind,tables)
 return {'tables':tables,'source':(file.filename or '')[:200]}

@router.put('/{kind}')
async def save(kind:Kind,body:Catalog,user=Depends(require_permission('payroll','edit'))):
 validate(kind,body.tables);key=f"{user['org_id']}:{kind}"
 old=await db.pay_configuration.find_one({'_id':key})
 if (old or {}).get('revision',0)!=body.revision:raise HTTPException(409,'Settings changed; reload before saving')
 doc={**body.model_dump(),'revision':body.revision+1,'updated_at':now_iso(),'updated_by':user['id'],'org_id':user['org_id']}
 try:
  result=await db.pay_configuration.update_one({'_id':key,'revision':body.revision},{'$set':doc,'$push':{'history':{'revision':body.revision,'tables':(old or {}).get('tables',{}),'by':user['id'],'at':now_iso()}}},upsert=body.revision==0)
 except DuplicateKeyError:raise HTTPException(409,'Settings changed; reload before saving')
 if not result.matched_count and not result.upserted_id:raise HTTPException(409,'Settings changed; reload before saving')
 return {'revision':doc['revision'],'tables':body.tables,'source':body.source}


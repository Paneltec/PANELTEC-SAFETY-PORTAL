"""Encrypted bank instructions, masked reads, reviewed Westpac ABA downloads."""
import base64
import hashlib
import json
import os
from datetime import date, timedelta
from zoneinfo import ZoneInfo
from datetime import datetime
from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import Field, model_validator
from pymongo.errors import DuplicateKeyError
from db import db
from models import now_iso
from permissions import require_permission
from payroll_workbench import Strict, period, workers, Worksheet, check_leave_sources
from payroll_aba import make_aba, bsb, account, text_field

router=APIRouter(prefix='/banking', tags=['payroll-banking'])

def cipher():
    explicit=os.environ.get('PAYROLL_BANK_ENC_KEY')
    try:
        if explicit:
            return Fernet(explicit.encode())
        master=os.environ.get('INTEGRATIONS_ENC_KEY')
        if not master:
            raise ValueError()
        material=base64.urlsafe_b64decode(master)
        if len(material)!=32:
            raise ValueError()
        derived=HKDF(algorithm=hashes.SHA256(), length=32, salt=b'Paneltec payroll bank v1', info=b'bank-details-at-rest').derive(material)
        return Fernet(base64.urlsafe_b64encode(derived))
    except (ValueError, TypeError):
        raise HTTPException(503,'Bank-detail storage needs a valid payroll encryption key. No bank details have been stored.')

def decrypt(doc):
    try:
        return json.loads(cipher().decrypt(doc['encrypted'].encode()))
    except InvalidToken:
        raise HTTPException(503,'Bank details cannot be decrypted. Restore the original encryption key before proceeding.')

class BankDetails(Strict):
    revision: int=Field(0,ge=0)
    account_name: str=Field(min_length=1,max_length=32)
    bsb: str=Field(pattern=r'^[0-9]{3}-?[0-9]{3}$')
    account_number: str=Field(pattern=r'^[0-9]{1,9}$')
    verified: bool=False
    @model_validator(mode='after')
    def valid_bank(self):
        bsb(self.bsb);account(self.account_number);text_field(self.account_name,32,'Account name')
        return self

class EmployerBank(BankDetails):
    user_name: str=Field(min_length=1,max_length=26)
    remitter: str=Field(min_length=1,max_length=16)
    direct_entry_id: str=Field('000000',pattern=r'^[0-9]{6}$')
    description: str=Field('PAYROLL',min_length=1,max_length=12)
    reference: str=Field('PANELTEC WAGES',min_length=1,max_length=18)
    balancing_entry: bool=False
    @model_validator(mode='after')
    def valid_fields(self):
        for key,n in [('user_name',26),('remitter',16),('description',12),('reference',18)]:
            text_field(getattr(self,key),n,key)
        return self

def masked(doc):
    if not doc:return {'configured':False,'revision':0}
    value=decrypt(doc)
    return {'configured':True,'revision':doc['revision'],'account_name':value['account_name'],
        'bsb_masked':'***-'+value['bsb'].replace('-','')[-3:],
        'account_masked':'••••'+value['account_number'][-3:],'verified':value['verified'],'updated_at':doc['updated_at'],
        **{k:value[k] for k in ('user_name','remitter','direct_entry_id','description','reference','balancing_entry') if k in value}}

async def put_bank(key,body,user):
    value=body.model_dump(exclude={'revision'})
    encrypted=cipher().encrypt(json.dumps(value).encode()).decode()
    audit={'at':now_iso(),'by':user['id'],'revision':body.revision+1,'action':'bank-details-replaced'}
    try:
        r=await db.pay_bank_details.update_one({'_id':key,'revision':body.revision},
            {'$set':{'encrypted':encrypted,'revision':body.revision+1,'updated_at':audit['at'],'org_id':user['org_id']},
             '$push':{'audit':audit}},upsert=body.revision==0)
    except DuplicateKeyError:
        raise HTTPException(409,'Bank details changed in another window. Reload before saving.')
    if not r.matched_count and not r.upserted_id:
        raise HTTPException(409,'Bank details changed in another window. Reload before saving.')
    return {'ok':True,'revision':body.revision+1}

@router.get('/employer')
async def get_employer(user=Depends(require_permission('payroll','edit'))):
    cipher()
    return masked(await db.pay_bank_details.find_one({'_id':f"{user['org_id']}:employer"}))

@router.put('/employer')
async def set_employer(body:EmployerBank,user=Depends(require_permission('payroll','edit'))):
    return await put_bank(f"{user['org_id']}:employer",body,user)

@router.get('/workers/{worker_id}')
async def get_bank(worker_id:str,user=Depends(require_permission('payroll','edit'))):
    if worker_id not in await workers(user['org_id']):raise HTTPException(404,'Worker not found')
    cipher()
    return masked(await db.pay_bank_details.find_one({'_id':f"{user['org_id']}:worker:{worker_id}"}))

@router.put('/workers/{worker_id}')
async def set_bank(worker_id:str,body:BankDetails,user=Depends(require_permission('payroll','edit'))):
    if worker_id not in await workers(user['org_id']):raise HTTPException(404,'Worker not found')
    return await put_bank(f"{user['org_id']}:worker:{worker_id}",body,user)

async def batch(week,user):
    period(week)
    doc=await db.pay_review_sheets.find_one({'_id':f"{user['org_id']}:{week}"})
    if not doc or not doc['worksheet']['reviewed'] or not doc['report']['ready']:
        raise HTTPException(409,'Save a fully reviewed payroll worksheet before preparing a bank file.')
    current=await check_leave_sources(Worksheet(**doc['worksheet']),user['org_id'],week,doc['report'])
    if not current['ready']:
        raise HTTPException(409,'Linked leave has changed. Recheck and save the payroll worksheet before exporting.')
    payday=date.fromisoformat(doc['worksheet']['payday'])
    today=datetime.now(ZoneInfo('Australia/Hobart')).date()
    if payday<today or payday>today+timedelta(days=730):
        raise HTTPException(422,'Choose a current or future payday within 24 months; past-dated exports are blocked.')
    employer_doc=await db.pay_bank_details.find_one({'_id':f"{user['org_id']}:employer"})
    if not employer_doc:raise HTTPException(409,'Save the employer bank settings first.')
    config=decrypt(employer_doc)
    if not config['verified']:raise HTTPException(409,'Verify the employer bank settings first.')
    payments=[];summary=[];versions=[employer_doc['revision'],doc['worksheet']['revision']]
    for row in doc['report']['rows']:
        net=row['result']['net']
        if net==0:continue
        bankdoc=await db.pay_bank_details.find_one({'_id':f"{user['org_id']}:worker:{row['worker_id']}"})
        if not bankdoc:raise HTTPException(409,f"Bank details missing for {row['name']}")
        bank=decrypt(bankdoc)
        if not bank['verified']:raise HTTPException(409,f"Verify bank details for {row['name']}")
        versions.append(bankdoc['revision'])
        payments.append({**bank,'net':net,'worker_id':row['worker_id']})
        summary.append({'name':row['name'],'net':net,'account_name':bank['account_name'],
            'account_masked':masked(bankdoc)['account_masked'],'bsb_masked':masked(bankdoc)['bsb_masked']})
    try: content=make_aba(config,payments,payday)
    except ValueError as e:raise HTTPException(422,str(e))
    digest=hashlib.sha256(content+json.dumps(versions).encode()).hexdigest()
    return content,{'fingerprint':digest,'revision':doc['worksheet']['revision'],'payday':str(payday),'payments':summary,
        'total':doc['report']['totals']['net'],'count':len(payments),'payer':masked(employer_doc),
        'notice':'File preparation only. Review and authorise payment yourself in Westpac. Downloading is not payment confirmation.'}

@router.get('/batch/{week}')
async def preview_batch(week:str,user=Depends(require_permission('payroll','edit'))):
    _,summary=await batch(week,user)
    return summary

class ExportRequest(Strict):
    fingerprint:str=Field(pattern=r'^[a-f0-9]{64}$')
    checked:bool=False

@router.post('/batch/{week}/download')
async def download_batch(week:str,body:ExportRequest,user=Depends(require_permission('payroll','edit'))):
    content,summary=await batch(week,user)
    if not body.checked or body.fingerprint!=summary['fingerprint']:
        raise HTTPException(409,'Review the current bank batch again; its pay or bank details may have changed.')
    await db.pay_bank_exports.insert_one({'org_id':user['org_id'],'week':week,'revision':summary['revision'],
        'fingerprint':summary['fingerprint'],'count':summary['count'],'total':summary['total'],'by':user['id'],'at':now_iso()})
    return Response(content,media_type='application/octet-stream',headers={
        'Content-Disposition':f'attachment; filename="paneltec-wages-{week}-r{summary["revision"]}.aba"','Cache-Control':'no-store'})

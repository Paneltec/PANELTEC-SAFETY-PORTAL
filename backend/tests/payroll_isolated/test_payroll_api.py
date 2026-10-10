"""Isolated API integration tests, using synthetic workers and an in-memory DB."""
import sys, types, copy, os, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
from fastapi import FastAPI, Header, HTTPException
from fastapi.testclient import TestClient
from cryptography.fernet import Fernet
from pymongo.errors import DuplicateKeyError

def matches(row,q):
    for k,v in q.items():
        x=row
        for bit in k.split('.'): x=x.get(bit) if isinstance(x,dict) else None
        if isinstance(v,dict):
            for op,val in v.items():
                if op=='$in' and x not in val:return False
                if op=='$gt' and not (x is not None and x>val):return False
                if op=='$lt' and not (x is not None and x<val):return False
                if op=='$lte' and not (x is not None and x<=val):return False
                if op=='$gte' and not (x is not None and x>=val):return False
                if op=='$ne' and x==val:return False
        elif x!=v:return False
    return True
class Cursor:
    def __init__(self,rows):self.rows=copy.deepcopy(rows)
    def sort(self,keys):
        for key,direction in reversed(keys):self.rows.sort(key=lambda r:r.get(key,''),reverse=direction<0)
        return self
    def __aiter__(self):self.it=iter(self.rows);return self
    async def __anext__(self):
        try:return next(self.it)
        except StopIteration:raise StopAsyncIteration
class Collection:
    def __init__(self):self.rows=[]
    def find(self,q,projection=None):return Cursor([r for r in self.rows if matches(r,q)])
    async def find_one(self,q,projection=None,sort=None):
        rows=[r for r in self.rows if matches(r,q)]
        if sort:
            for key,direction in reversed(sort):rows.sort(key=lambda r:r.get(key,''),reverse=direction<0)
        return copy.deepcopy(rows[0]) if rows else None
    async def update_one(self,q,update,upsert=False):
        row=next((r for r in self.rows if matches(r,q)),None);found=row is not None
        if row is None:
            if not upsert:return types.SimpleNamespace(matched_count=0,upserted_id=None)
            if any(r['_id']==q['_id'] for r in self.rows):raise DuplicateKeyError('duplicate')
            row={'_id':q['_id']};self.rows.append(row)
        for k,v in copy.deepcopy(update.get('$set',{})).items():
            target=row;bits=k.split('.')
            for bit in bits[:-1]:target=target.setdefault(bit,{})
            target[bits[-1]]=v
        for k,v in update.get('$push',{}).items():
            if '$each' in v:row[k]=(row.get(k,[])+copy.deepcopy(v['$each']))[v['$slice']:]
            else:row.setdefault(k,[]).append(copy.deepcopy(v))
        return types.SimpleNamespace(matched_count=int(found),upserted_id=None if found else row['_id'])
    async def replace_one(self,q,doc,upsert=False):
        row=next((r for r in self.rows if matches(r,q)),None)
        if row is not None:row.clear();row.update(copy.deepcopy(doc))
        elif upsert:self.rows.append(copy.deepcopy(doc))
        return types.SimpleNamespace(matched_count=int(row is not None))
    async def update_many(self,q,update):
        rows=[r for r in self.rows if matches(r,q)]
        for row in rows:row.update(copy.deepcopy(update.get('$set',{})))
        return types.SimpleNamespace(modified_count=len(rows))
    async def insert_one(self,row):
        if '_id' in row and any(r.get('_id')==row['_id'] for r in self.rows):raise DuplicateKeyError('duplicate')
        self.rows.append(copy.deepcopy(row))
class DB:
    def __init__(self):
        for k in ('pay_configuration','pay_calculation_settings','workers','leave_requests','pay_review_sheets','pay_bank_details','pay_bank_exports','pay_branding','pay_employee_records','pay_run_archive','pay_connection_settings','timesheet_entries','pay_delivery_settings','pay_payslip_batches','pay_payslip_delivery','integration_configs','pay_settings','pay_profiles','pay_periods','simpro_jobs'):setattr(self,k,Collection())
db=DB()
def require_permission(resource,action):
    async def guard(x_role:str=Header('editor'),x_org:str=Header('org-a')):
        if x_role=='none' or (action=='edit' and x_role!='editor'):raise HTTPException(403,'Forbidden')
        return {'id':'test-admin','org_id':x_org}
    return guard
sys.modules['db']=types.SimpleNamespace(db=db)
sys.modules['permissions']=types.SimpleNamespace(require_permission=require_permission)
sys.modules['models']=types.SimpleNamespace(now_iso=lambda:'2026-10-06T10:00:00Z')
import payroll_workbench as workbench
import payroll_banking as banking
app=FastAPI();app.include_router(workbench.router,prefix='/payroll');app.include_router(banking.router,prefix='/payroll')
import payroll_employee_records as employee_records
app.include_router(employee_records.router,prefix="/payroll")
client=TestClient(app)

class PayrollAPITests(unittest.TestCase):
    def setUp(self):
        for col in db.__dict__.values():col.rows=[]
        db.pay_settings.rows=[{'org_id':'org-a','week_starts':'monday'}]
        os.environ['PAYROLL_BANK_ENC_KEY']=Fernet.generate_key().decode()
        db.workers.rows=[{'id':'w1','org_id':'org-a','first_name':'TEST','last_name':'WORKER','simpro_employee_id':'42'},
                         {'id':'w2','org_id':'org-b','first_name':'OTHER','last_name':'ORG','simpro_employee_id':'43'}]
        self.body={'revision':0,'payday':'2026-10-15','rows':[{'worker_id':'w1',
            'profile':{'employment_type':'full_time','hourly_rate':35,'classification':'TEST ONLY',
                'conditions_reviewed':True,'tax_mode':'resident_threshold','tax_declaration_reviewed':True},
            'entry':{'ordinary':38,'qualifying_earnings':1330,'super_reviewed':True,'hours_reviewed':True,'opening_annual':152,'opening_personal':76}}]}
    def save(self,reviewed=False):return client.put('/payroll/workbench/2026-10-05',json={**self.body,'reviewed':reviewed})
    def test_direct_pay_adjustments_survive_save_and_reload(self):
        row=self.body['rows'][0]
        row['shifts']=[{'date':'2026-10-05','start':'07:00','finish':'15:00','break_minutes':0}]
        row['worked_hours_override']=True
        row['entry'].update(ordinary=6,ot1=2,qualifying_earnings=None)
        response=self.save()
        self.assertEqual(response.status_code,200,response.text)
        from bson import BSON
        BSON.encode(db.pay_review_sheets.rows[0])
        calculated=response.json()['report']['rows'][0]
        self.assertEqual(calculated['entry']['ordinary'],6)
        self.assertEqual(calculated['result']['super'],25.2)
        loaded=client.get('/payroll/workbench/2026-10-05').json()
        saved=loaded['worksheet']['rows'][0]
        self.assertEqual(saved['shifts'][0]['start'],'07:00')
        self.assertTrue(saved['worked_hours_override'])
        self.assertEqual(loaded['report']['rows'][0]['result']['super'],25.2)
        self.body=loaded['worksheet']
        self.body['rows'][0]['worked_hours_override']=False
        response=self.save()
        self.assertEqual(response.status_code,200,response.text)
        self.assertNotEqual(response.json()['report']['rows'][0]['entry']['ordinary'],6)

    def test_daily_entries_aggregate_and_persist(self):
        row=self.body['rows'][0]
        row.update(daily_hours={'2026-10-05':{'ordinary':6},'2026-10-06':{'ordinary':8,'ot1':2}})
        row['entry']['qualifying_earnings']=None
        response=self.save()
        self.assertEqual(response.status_code,200,response.text)
        r=response.json()['report']['rows'][0]
        self.assertEqual(r['entry']['ordinary'],14)
        self.assertEqual(r['entry']['ot1'],2)
        self.assertEqual(r['result']['super'],58.8)
        from bson import BSON
        BSON.encode(db.pay_review_sheets.rows[0])
        loaded=client.get('/payroll/workbench/2026-10-05').json()
        self.assertEqual(loaded['worksheet']['rows'][0]['daily_hours']['2026-10-06']['ordinary'],8)
        self.body=loaded['worksheet']
        self.body['rows'][0]['daily_hours']['2026-10-06']['ordinary']=4
        self.assertEqual(self.save().json()['report']['rows'][0]['entry']['ordinary'],10)

    def test_weekend_and_allowance_entries_persist(self):
        row=self.body['rows'][0]
        row.update(daily_hours={'2026-10-10':{'saturday':4},'2026-10-11':{'sunday':3}})
        row['entry'].update(lafha=120,lafha_taxable=False,lafha_superable=False,qualifying_earnings=None)
        response=self.save()
        self.assertEqual(response.status_code,200,response.text)
        r=response.json()['report']['rows'][0]
        self.assertEqual(r['entry']['saturday'],4)
        self.assertEqual(r['entry']['sunday'],3)
        self.assertEqual(r['result']['saturday_pay'],210)
        self.assertEqual(r['result']['sunday_pay'],210)
        self.assertEqual(r['result']['lafha_pay'],120)
        self.assertEqual(r['result']['gross'],540)
        self.assertEqual(r['result']['super'],0)
        loaded=client.get('/payroll/workbench/2026-10-05').json()
        self.assertEqual(loaded['worksheet']['rows'][0]['entry']['lafha'],120)
        self.body=loaded['worksheet']
        self.body['rows'][0]['daily_hours']={'2026-10-10':{'ordinary':20,'saturday':5}}
        self.assertEqual(self.save().status_code,422)

    def test_daily_dates_and_hours_validate(self):
        self.body['rows'][0]['daily_hours']={'2026-10-20':{'ordinary':8}}
        self.assertEqual(self.save().status_code,422)
        self.body['rows'][0]['daily_hours']={'2026-10-05':{'ordinary':20,'ot1':5}}
        self.assertEqual(self.save().status_code,422)

    def test_rule_snapshot_survives_global_settings_change(self):
        self.body['rules']={'earning_rules':[dict(code='extra',name='Extra',basis='fixed_rate',rate=15,multiplier=1,taxable=True,superable=True)]}
        self.body['rows'][0]['entry'].update(earning_units={'extra':2},qualifying_earnings=None)
        self.assertEqual(self.save().json()['report']['rows'][0]['result']['other_earnings'],30)
        db.pay_calculation_settings.rows=[{'_id':'org-a','revision':1,'rules':{'earning_rules':[dict(code='extra',name='Extra',basis='fixed_rate',rate=99,multiplier=1,taxable=True,superable=True)]}}]
        loaded=client.get('/payroll/workbench/2026-10-05').json()
        self.assertEqual(loaded['report']['rows'][0]['result']['other_earnings'],30)

    def test_worker_import_preserves_payroll(self):
        self.assertEqual(self.save(True).status_code,200)
        db.workers.rows[0].update(first_name='RENAMED',source='simpro',simpro_employee_id='42')
        loaded=client.get('/payroll/workbench/2026-10-05').json()
        self.assertEqual(loaded['workers'][0]['name'],'RENAMED WORKER')
        self.assertEqual(loaded['worksheet']['rows'][0]['profile']['hourly_rate'],35)
        self.assertEqual(loaded['worksheet']['rows'][0]['worker_id'],'w1')
        db.workers.rows[0]['active']=False
        loaded=client.get('/payroll/workbench/2026-10-05').json()
        self.assertEqual(loaded['workers'],[])
        self.assertEqual(len(loaded['worksheet']['rows']),1)
        self.assertEqual(client.get('/payroll/workbench/2026-10-12').json()['worksheet']['rows'],[])

    def test_validation_and_org_scope(self):
        self.assertEqual(client.get('/payroll/workbench/2026-10-06').status_code,422)
        self.body['rows'][0]['entry']['ordinary']=-1;self.assertEqual(self.save().status_code,422)
        self.body['rows'][0]['entry']['ordinary']=38;self.body['rows'][0]['worker_id']='w2'
        self.assertEqual(self.save().status_code,422)
        self.assertEqual(client.get('/payroll/workbench/2026-10-05',headers={'x-role':'none'}).status_code,403)
    def test_save_reload_conflict_and_report(self):
        response=self.save(True);self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(response.json()['revision'],1)
        self.assertEqual(self.save().status_code,409)
        saved=client.get('/payroll/workbench/2026-10-05').json()['worksheet'];self.assertTrue(saved['reviewed'])
        csv=client.get('/payroll/workbench/2026-10-05/report/pay').text
        self.assertIn('REVIEWED WORKSHEET - NOT PAID',csv);self.assertIn('TEST WORKER',csv)
        self.assertEqual(client.get('/payroll/workbench/2026-10-05/report/pay',headers={'x-org':'org-b'}).status_code,404)
        template=client.get('/payroll/workbench/2026-10-12').json()['worksheet']['rows'][0]
        self.assertEqual(template['profile']['hourly_rate'],35);self.assertEqual(template['entry']['ordinary'],0)
        self.assertIsNone(template['entry']['opening_annual'])
    def test_review_blocked_and_viewer_cannot_save(self):
        self.body['rows'][0]['profile']['conditions_reviewed']=False
        self.assertEqual(self.save(True).status_code,422)
        self.assertEqual(client.put('/payroll/workbench/2026-10-05',json=self.body,headers={'x-role':'viewer'}).status_code,403)
    def test_phone_leave_and_cancellation(self):
        lr={'id':'l1','org_id':'org-a','worker_id':'w1','status':'approved','category':'annual','hours':7.6,'start_date':'2026-10-07','end_date':'2026-10-07','leave_type':'Annual leave'}
        db.leave_requests.rows=[lr,{**lr,'id':'pending','status':'pending'},{**lr,'id':'foreign','org_id':'org-b'}]
        feed=client.get('/payroll/workbench/2026-10-05/approved-leave').json()['requests'];self.assertEqual(len(feed),1)
        self.body['rows'][0]['leave_sources']=[{'leave_id':'l1','fingerprint':feed[0]['fingerprint'],'hours':7.6,'category':'annual'}]
        self.body['rows'][0]['entry'].update(ordinary=30.4,annual=7.6)
        self.assertEqual(self.save(True).status_code,200)
        db.leave_requests.rows[0]['status']='cancelled'
        self.assertFalse(client.get('/payroll/workbench/2026-10-05').json()['report']['ready'])
        exported=client.get('/payroll/workbench/2026-10-05/report/pay').text
        self.assertIn('DRAFT - NOT PAID',exported)
        self.assertNotIn('REVIEWED WORKSHEET',exported)
    def test_encryption_masking_and_bank_export(self):
        self.assertEqual(self.save(True).status_code,200)
        employee={'account_name':'TEST WORKER','bsb':'062000','account_number':'00001234','verified':True}
        employer={**employee,'account_name':'TEST COMPANY','bsb':'032000','account_number':'00123456','user_name':'TEST COMPANY','remitter':'TEST COMPANY'}
        self.assertEqual(client.put('/payroll/banking/workers/w1',json=employee).status_code,200)
        self.assertEqual(client.put('/payroll/banking/employer',json=employer).status_code,200)
        self.assertNotIn('00001234',str(db.pay_bank_details.rows))
        masked=client.get('/payroll/banking/workers/w1').json();self.assertNotIn('account_number',masked)
        self.assertEqual(client.get('/payroll/banking/workers/w1',headers={'x-role':'viewer'}).status_code,403)
        preview=client.get('/payroll/banking/batch/2026-10-05');self.assertEqual(preview.status_code,200,preview.text)
        fingerprint=preview.json()['fingerprint']
        download=client.post('/payroll/banking/batch/2026-10-05/download',json={'fingerprint':fingerprint,'checked':True})
        self.assertEqual(download.status_code,200,download.text);self.assertIn('00001234',download.text)
        self.assertEqual(download.headers['cache-control'],'no-store')
        client.put('/payroll/banking/workers/w1',json={**employee,'revision':1,'account_number':'00005678'})
        self.assertEqual(client.post('/payroll/banking/batch/2026-10-05/download',json={'fingerprint':fingerprint,'checked':True}).status_code,409)
    def test_missing_encryption_key_fails_closed(self):
        os.environ.pop('PAYROLL_BANK_ENC_KEY');os.environ.pop('INTEGRATIONS_ENC_KEY',None)
        self.assertEqual(client.get('/payroll/banking/employer').status_code,503)
        self.assertEqual(db.pay_bank_details.rows,[])

if __name__=='__main__':unittest.main()






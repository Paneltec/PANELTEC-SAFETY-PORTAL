"""Synthetic-only tests; no auth/database modules or external connections loaded."""
import sys,types,unittest,asyncio,copy,importlib.util
from pathlib import Path
from unittest.mock import AsyncMock
from fastapi import HTTPException
from pydantic import BaseModel
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
class Cursor:
 def __init__(self,rows):self.rows=iter(copy.deepcopy(rows))
 def __aiter__(self):return self
 async def __anext__(self):
  try:return next(self.rows)
  except StopIteration:raise StopAsyncIteration
class Col:
 def __init__(self,rows=None):self.rows=rows or [];self.deleted=0;self.change=False
 def find(self,q,*args):return Cursor([r for r in self.rows if r.get('org_id')==q['org_id'] and ('_id' not in q or r['_id'] in q['_id']['$in'])])
 async def count_documents(self,q):return len([r for r in self.rows if r.get('org_id')==q['org_id']])
 async def insert_one(self,d):self.rows.append(copy.deepcopy(d))
 async def update_one(self,q,u,**kw):return types.SimpleNamespace(modified_count=1)
 async def delete_one(self,q):
  if self.change:return types.SimpleNamespace(deleted_count=0)
  target=q['$expr']['$eq'][1]['$literal']
  match=next((r for r in self.rows if r==target and r['org_id']==q['org_id']),None)
  if match:self.rows.remove(match);self.deleted+=1
  return types.SimpleNamespace(deleted_count=int(match is not None))
class DB:
 def __init__(self):self.cols={}
 def __getitem__(self,k):return self.cols.setdefault(k,Col())
 def __getattr__(self,k):return self[k]
database=DB();stub=types.ModuleType('db');stub.db=database;sys.modules['db']=stub
pin=types.ModuleType('admin_console_pin')
def admin():pass
class UnlockIn(BaseModel):pin:str
pin._require_admin=admin;pin.UnlockIn=UnlockIn;pin.unlock=AsyncMock();sys.modules['admin_console_pin']=pin
import admin_test_activity_reset as reset
class Tests(unittest.IsolatedAsyncioTestCase):
 async def asyncSetUp(self):
  reset.db=DB();self.user={'id':'admin','org_id':'org-a','role':'admin'}
  self.app=types.SimpleNamespace(state=types.SimpleNamespace(create_paneltec_snapshot=AsyncMock(return_value={'ok':True,'snapshot_id':'synthetic-backup','sha256':'abc'})))
  reset.db['pre_starts'].rows=[{'_id':'a','org_id':'org-a','value':'synthetic'},{'_id':'b','org_id':'org-b'}]
  reset.db['users'].rows=[{'_id':'u','org_id':'org-a'}]
 async def test_scoped_reset_and_archive(self):
  await reset.run_reset(self.app,self.user,'job')
  self.assertEqual(reset.db['pre_starts'].rows,[{'_id':'b','org_id':'org-b'}]);self.assertEqual(len(reset.db.users.rows),1)
  self.assertEqual(reset.db.test_reset_archive.rows[0]['document']['_id'],'a')
  self.app.state.create_paneltec_snapshot.assert_awaited_once_with(preserve_existing=True)
 async def test_failed_backup_deletes_nothing(self):
  self.app.state.create_paneltec_snapshot.return_value={'ok':False}
  await reset.run_reset(self.app,self.user,'job')
  self.assertEqual(len(reset.db.pre_starts.rows),2);self.assertFalse(reset.db.test_reset_archive.rows)
 async def test_changed_record_is_retained(self):
  reset.db.pre_starts.change=True
  await reset.run_reset(self.app,self.user,'job')
  self.assertEqual(len(reset.db.pre_starts.rows),2)
 async def test_archive_failure_stops_before_delete(self):
  reset.db.test_reset_archive.insert_one=AsyncMock(side_effect=RuntimeError('synthetic failure'))
  await reset.run_reset(self.app,self.user,'job')
  self.assertEqual(len(reset.db.pre_starts.rows),2)
 async def test_preview_has_counts_not_records(self):
  result=await reset.preview(self.user)
  self.assertEqual(result['total'],1);self.assertNotIn('synthetic',str(result));self.assertNotIn('document',str(result))
 async def test_new_records_not_in_preview_survive(self):
  ids={name:[] for name in reset.TARGETS};ids['pre_starts']=['a']
  reset.db.pre_starts.rows.append({'_id':'new','org_id':'org-a'})
  await reset.run_reset(self.app,self.user,'job',ids)
  self.assertIn('new',[r['_id'] for r in reset.db.pre_starts.rows])
 async def test_missing_org_denied(self):
  with self.assertRaises(HTTPException):await reset.preview({'id':'admin'})
 async def test_wrong_confirmation_before_pin(self):
  with self.assertRaises(HTTPException):await reset.execute(reset.Execute(plan_id='x',pin='1234',confirmation='wrong'),None,None,self.user)
 async def test_bad_pin_denied_before_plan(self):
  reset.unlock=AsyncMock(side_effect=HTTPException(401,'Wrong PIN'))
  with self.assertRaises(HTTPException):await reset.execute(reset.Execute(plan_id='x',pin='1234',confirmation='RESET TEST ACTIVITY'),None,None,self.user)
  reset.unlock=pin.unlock
 def test_protected_collections_not_targets(self):
  for name in ['users','workers','pay_employee_records','pay_bank_details','pay_calculation_settings','audit_log','bk_snapshots','assets','sites','org_settings','swms']:
   self.assertNotIn(name,reset.TARGETS)
if __name__=='__main__':unittest.main()

import unittest,copy
import test_payroll_api as api
class LifecycleTests(unittest.TestCase):
 def setUp(self):
  self.f=api.PayrollAPITests();self.f.setUp()
  api.client.put('/payroll/workbench/branding',json={'employer_name':'TEST','employer_abn':'12128689412'})
  self.f.body['rows'][0]['profile'].update(super_fund_name='TEST FUND',super_fund_usi='TEST')
  self.f.save(True)
 def post(self,action,revision=1,reason=''):
  return api.client.post('/payroll/workbench/2026-10-05/'+action,json={'revision':revision,'reason':reason})
 def test_lock_correction_and_preserved_final_version(self):
  self.assertEqual(self.post('finalize').status_code,200)
  original=copy.deepcopy(api.db.pay_review_sheets.rows[0]['finalizations'][0])
  self.f.body['revision']=1
  self.assertEqual(self.f.save().status_code,409)
  self.assertEqual(self.post('reopen').status_code,422)
  self.assertEqual(self.post('reopen',reason='Correct approved hours').status_code,200)
  self.f.body['revision']=2
  self.f.body['rows'][0]['entry']['ot1']=2
  self.assertEqual(self.f.save(True).status_code,200)
  self.assertEqual(self.post('finalize',revision=3).status_code,200)
  self.assertEqual(api.db.pay_review_sheets.rows[0]['finalizations'][0],original)
  self.assertEqual(len(api.db.pay_review_sheets.rows[0]['finalizations']),2)
 def test_idempotency_and_stale_revision(self):
  self.assertEqual(self.post('finalize').status_code,200)
  self.assertEqual(self.post('finalize').status_code,200)
  self.assertEqual(len(api.db.pay_review_sheets.rows[0]['finalizations']),1)
  self.assertEqual(self.post('reopen',revision=9,reason='TEST').status_code,409)
 def test_locked_display_uses_frozen_worker_and_branding(self):
  self.post('finalize')
  api.db.workers.rows[0]['first_name']='CHANGED'
  api.db.pay_branding.rows[0]['employer_name']='CHANGED'
  loaded=api.client.get('/payroll/workbench/2026-10-05').json()
  self.assertEqual(loaded['report']['rows'][0]['name'],'TEST WORKER')
  self.assertEqual(loaded['finalized_branding']['employer_name'],'TEST')
 def test_employer_and_fund_required(self):
  api.db.pay_branding.rows[0]['employer_abn']='12128689413'
  self.assertEqual(self.post('finalize').status_code,422)
  api.db.pay_branding.rows[0]['employer_abn']='12128689412'
  api.db.pay_review_sheets.rows[0]['worksheet']['rows'][0]['profile']['super_fund_usi']=''
  self.assertEqual(self.post('finalize').status_code,422)
 def test_permissions_and_org(self):
  path='/payroll/workbench/2026-10-05/lifecycle'
  self.post('finalize')
  self.assertEqual(api.client.get(path,headers={'x-org':'org-b'}).json()['finalizations'],[])
  self.assertEqual(api.client.get(path,headers={'x-role':'none'}).status_code,403)
  self.assertEqual(api.client.post('/payroll/workbench/2026-10-05/finalize',json={'revision':1},headers={'x-role':'viewer'}).status_code,403)
if __name__=='__main__':unittest.main()

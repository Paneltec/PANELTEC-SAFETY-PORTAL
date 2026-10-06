import unittest,copy
import test_payroll_api as api
class ArchiveTests(unittest.TestCase):
 def setUp(self):self.f=api.PayrollAPITests();self.f.setUp()
 def archive(self,revision,reason=''):
  return api.client.post('/payroll/workbench/2026-10-05/archive',json={'revision':revision,'correction_reason':reason})
 def test_archive_survives_recent_history_rollover(self):
  self.f.save(True);self.assertEqual(self.archive(1).status_code,200)
  original=copy.deepcopy(api.db.pay_run_archive.rows[0])
  for revision in range(1,13):
   self.f.body['revision']=revision;self.f.save(True)
  self.assertEqual(api.db.pay_run_archive.rows[0],original)
  self.assertNotIn(1,[r['revision'] for r in api.client.get('/payroll/workbench/2026-10-05/history').json()['revisions']])
  self.assertEqual(self.archive(13).status_code,422)
  self.assertEqual(self.archive(13,'Corrected overtime after supervisor review').status_code,200)
  self.assertEqual(len(api.db.pay_run_archive.rows),2)
  self.assertTrue(self.archive(13).json()['already_archived'])
  self.assertEqual(len(api.db.pay_run_archive.rows),2)
 def test_draft_and_stale_revision_rejected(self):
  self.f.save();self.assertEqual(self.archive(1).status_code,422)
  self.assertEqual(self.archive(2).status_code,409)
 def test_access_and_org_scope(self):
  self.f.save(True);self.archive(1)
  path='/payroll/workbench/2026-10-05/archive'
  self.assertEqual(api.client.get(path,headers={'x-org':'org-b'}).json()['records'],[])
  self.assertEqual(api.client.get(path,headers={'x-role':'none'}).status_code,403)
  self.assertEqual(api.client.post(path,json={'revision':1},headers={'x-role':'viewer'}).status_code,403)
if __name__=='__main__':unittest.main()

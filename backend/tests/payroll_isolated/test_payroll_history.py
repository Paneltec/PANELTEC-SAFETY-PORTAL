import unittest,copy
import test_payroll_api as api

class HistoryTests(unittest.TestCase):
    def setUp(self):
        self.fixture=api.PayrollAPITests();self.fixture.setUp()
    def test_snapshot_survives_branding_worker_and_rate_changes(self):
        api.client.put('/payroll/workbench/branding',json={'employer_name':'TEST COMPANY','assignments':{'w1':'viatec'}})
        self.fixture.body['rows'][0]['profile'].update(super_fund_name='TEST FUND',super_fund_usi='TESTUSI')
        self.assertEqual(self.fixture.save().status_code,200)
        first=copy.deepcopy(api.client.get('/payroll/workbench/2026-10-05/history').json()['revisions'][0])
        api.db.workers.rows[0]['first_name']='RENAMED'
        api.client.put('/payroll/workbench/branding',json={'employer_name':'CHANGED','assignments':{'w1':'paneltec'}})
        self.fixture.body['revision']=1
        self.fixture.body['rows'][0]['profile']['hourly_rate']=40
        self.assertEqual(self.fixture.save().status_code,200)
        revisions=api.client.get('/payroll/workbench/2026-10-05/history').json()['revisions']
        self.assertEqual(len(revisions),2)
        self.assertEqual(revisions[1],first)
        self.assertEqual(first['branding']['assignments']['w1'],'viatec')
        self.assertEqual(first['report']['rows'][0]['profile']['super_fund_name'],'TEST FUND')
    def test_history_scope_and_permissions(self):
        self.fixture.save()
        self.assertEqual(api.client.get('/payroll/workbench/2026-10-05/history',headers={'x-role':'none'}).status_code,403)
        self.assertEqual(api.client.get('/payroll/workbench/2026-10-05/history',headers={'x-org':'org-b'}).json()['revisions'],[])
    def test_deductions_need_particulars(self):
        self.fixture.body['rows'][0]['entry']['post_tax_deductions']=10
        self.assertEqual(self.fixture.save(True).status_code,422)
        self.fixture.body['rows'][0]['entry']['deduction_details']='TEST recipient: $10; written approval TEST-1'
        self.assertEqual(self.fixture.save(True).status_code,200)
    def test_recent_history_is_bounded(self):
        for revision in range(12):
            self.fixture.body['revision']=revision
            self.assertEqual(self.fixture.save().status_code,200)
        revisions=api.client.get('/payroll/workbench/2026-10-05/history').json()['revisions']
        self.assertEqual([r['revision'] for r in revisions],list(range(12,2,-1)))

if __name__=='__main__':unittest.main()

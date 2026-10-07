import unittest
import test_payroll_api as api

class RuleSettingsTests(unittest.TestCase):
    def setUp(self):
        self.fixture=api.PayrollAPITests();self.fixture.setUp()
        self.url='/payroll/workbench/calculation/settings'
        self.body={'revision':0,'rules':{'ot1_multiplier':1.75,'ot2_multiplier':2.25,'super_percent':13}}

    def test_defaults_apply_only_to_new_runs(self):
        self.assertEqual(self.fixture.save().status_code,200)
        self.assertEqual(api.client.put(self.url,json=self.body).status_code,200)
        old=api.client.get('/payroll/workbench/2026-10-05').json()['worksheet']
        new=api.client.get('/payroll/workbench/2026-10-12').json()['worksheet']
        self.assertEqual(old['rules']['super_percent'],12)
        self.assertEqual(new['rules'],self.body['rules'])

    def test_revision_permissions_and_org_isolation(self):
        self.assertEqual(api.client.put(self.url,json=self.body,headers={'x-role':'viewer'}).status_code,403)
        self.assertEqual(api.client.put(self.url,json=self.body).status_code,200)
        self.assertEqual(api.client.put(self.url,json=self.body).status_code,409)
        self.assertEqual(api.client.get(self.url,headers={'x-org':'org-b'}).json()['revision'],0)
        bad={**self.body,'revision':1,'rules':{**self.body['rules'],'super_percent':-1}}
        self.assertEqual(api.client.put(self.url,json=bad).status_code,422)

    def test_roster_is_current_simpro_only_and_scoped(self):
        api.db.workers.rows.extend([{'id':'manual','org_id':'org-a'}, {'id':'old','org_id':'org-a','simpro_employee_id':'99','active':False}])
        result=api.client.get('/payroll/workbench/employees/list').json()['workers']
        self.assertEqual([w['id'] for w in result],['w1'])
        self.assertEqual(api.client.get('/payroll/workbench/employees/list',headers={'x-role':'none'}).status_code,403)

if __name__=='__main__':unittest.main()

import unittest
import test_payroll_api as f
from payroll_run_register import register_row

class RegisterTests(unittest.TestCase):
    def setUp(self):
        f.PayrollAPITests().setUp()
        self.doc={'_id':'org-a:2026-10-02','org_id':'org-a','week':'2026-10-02','state':'finalized',
          'worksheet':{'revision':1,'payday':'2026-10-08','rows':[{'entry':{'ordinary':7.6,'night':2,'penalty_ordinary':2}}]},
          'report':{'totals':{'gross':400,'net':300}},'completion_1':{'bank':{'reference':'MANUAL'}}}
        f.db.pay_review_sheets.rows=[self.doc]
        self.url='/payroll/workbench/2026-10-02/portal-receipts/stp'
        self.body={'revision':1,'event_id':'evt1','status':'accepted','reference':'receipt-1'}
    def test_hours_no_double_count_and_manual_not_portal(self):
        row=register_row(self.doc)
        self.assertEqual(row['hours'],9.6)
        self.assertEqual(row['portals']['bank']['status'],'verified_manually')
        self.assertEqual(row['portals']['stp']['status'],'not_recorded')
    def test_org_isolation(self):
        self.assertEqual(f.client.get('/payroll/workbench/register/list',headers={'x-org':'org-b'}).json()['runs'],[])
        self.assertEqual(f.client.post(self.url,json=self.body,headers={'x-org':'org-b'}).status_code,409)
    def test_receipt_replay_and_conflict(self):
        self.assertEqual(f.client.post(self.url,json=self.body).status_code,200)
        self.assertTrue(f.client.post(self.url,json=self.body).json()['duplicate'])
        self.assertEqual(f.client.post(self.url,json={**self.body,'status':'rejected'}).status_code,409)
        self.assertEqual(len(self.doc['portal_events_1']['stp']),1)
    def test_receipt_revision_lock_permission(self):
        self.assertEqual(f.client.post(self.url,json={**self.body,'revision':2}).status_code,409)
        self.assertEqual(f.client.post(self.url,json=self.body,headers={'x-role':'viewer'}).status_code,403)
        self.doc['state']='open'
        self.assertEqual(f.client.post(self.url,json=self.body).status_code,409)
    def test_event_path_injection(self):
        self.assertEqual(f.client.post(self.url,json={**self.body,'event_id':'bad.id'}).status_code,422)
    def test_old_revision_receipt_not_reused(self):
        f.client.post(self.url,json=self.body)
        self.doc['worksheet']['revision']=2
        self.assertEqual(register_row(self.doc)['portals']['stp']['status'],'not_recorded')
    def test_requirements_do_not_connect(self):
        response=f.client.put('/payroll/workbench/portals/requirements/stp',json={'provider':'TEST','receipt_method':'webhook_planned'})
        self.assertEqual(response.status_code,200)
        self.assertFalse(response.json()['connected'])
    def test_company_settings_roundtrip(self):
        payload={'employer_name':'TEST COMPANY','employer_abn':'12128689412','address_line1':'Test address','suburb':'Test town','contact_name':'Test contact','sms_requested':True}
        response=f.client.put('/payroll/workbench/branding',json=payload)
        self.assertEqual(response.status_code,200)
        loaded=f.client.get('/payroll/workbench/branding').json()['settings']
        self.assertEqual(loaded['address_line1'],'Test address')
        self.assertTrue(loaded['sms_requested'])
        self.assertEqual(f.client.put('/payroll/workbench/branding',json=payload,headers={'x-role':'viewer'}).status_code,403)
    def test_standard_hours_control_clock_split(self):
        from payroll_shift_rules import calculate_shifts
        result=calculate_shifts([{'date':'2026-10-06','start':'07:00','finish':'16:00'}],{'daily_ordinary_hours':8})
        self.assertEqual(result['ordinary'],8)
        self.assertEqual(result['ot1'],1)
    def test_nonowner_cannot_list_access(self):
        self.assertEqual(f.client.get('/payroll/workbench/access/list').status_code,403)

if __name__=='__main__':unittest.main()

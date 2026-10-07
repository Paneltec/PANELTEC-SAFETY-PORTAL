import unittest
import test_payroll_api as f

class OpeningTests(unittest.TestCase):
    def setUp(self):
        f.PayrollAPITests().setUp()
        self.url='/payroll/employee-records/w1'
        self.body={'revision':0,'profile':{},'opening_balances':{'as_at':'2026-10-02','annual_hours':100,'personal_hours':50,'reason':'Wojo closing report','ytd_gross':12000,'ytd_payg':2000,'ytd_super':1440}}
    def test_dated_encrypted_balances_and_ytd(self):
        response=f.client.put(self.url,json=self.body)
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json()['opening_balances']['ytd_gross'],12000)
        self.assertNotIn('opening_balances',f.db.pay_employee_records.rows[0])
        balance=f.client.get(self.url+'/opening-balances/2026-10-02').json()
        self.assertEqual(balance['opening_annual'],100)
        self.assertFalse(f.client.get(self.url+'/opening-balances/2026-09-25').json()['available'])
    def test_missing_run_not_assumed(self):
        f.client.put(self.url,json=self.body)
        self.assertFalse(f.client.get(self.url+'/opening-balances/2026-10-09').json()['available'])
    def test_only_issued_consecutive_runs_carry_leave(self):
        f.client.put(self.url,json=self.body)
        run={'_id':'org-a:2026-10-02','state':'finalized','worksheet':{'revision':1,'rows':[{'worker_id':'w1','entry':{'annual':7.6,'personal':0}}]},'report':{'rows':[{'worker_id':'w1','result':{'annual_accrued':2.923077,'personal_accrued':1.461538}}]}}
        f.db.pay_review_sheets.rows=[run]
        self.assertFalse(f.client.get(self.url+'/opening-balances/2026-10-09').json()['available'])
        run['issued_1']={'issued_at':'2026-10-08'}
        balance=f.client.get(self.url+'/opening-balances/2026-10-09').json()
        self.assertAlmostEqual(balance['opening_annual'],95.323077)
        self.assertAlmostEqual(balance['opening_personal'],51.461538)
    def test_profile_save_preserves_balances_and_stale_edit_blocked(self):
        f.client.put(self.url,json=self.body)
        result=f.client.put(self.url,json={'revision':1,'profile':{}})
        self.assertEqual(result.json()['opening_balances']['annual_hours'],100)
        self.assertEqual(f.client.put(self.url,json=self.body).status_code,409)
    def test_permissions_and_invalid_amount(self):
        self.assertEqual(f.client.put(self.url,json=self.body,headers={'x-role':'viewer'}).status_code,403)
        self.assertEqual(f.client.get(self.url+'/opening-balances/2026-10-02',headers={'x-org':'org-b'}).status_code,404)
        self.body['opening_balances']['annual_hours']=-1
        self.assertEqual(f.client.put(self.url,json=self.body).status_code,422)

if __name__=='__main__':unittest.main()

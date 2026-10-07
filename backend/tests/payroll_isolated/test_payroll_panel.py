import unittest
import test_payroll_api as f
from payroll_engine import calculate_line
from payroll_workbench import Profile,Rules
class PayPanelTests(unittest.TestCase):
 def setUp(self):
  f.PayrollAPITests().setUp()
 def test_salary_exact_week_not_rounded_hourly(self):
  p=Profile(pay_basis='annual_salary',annual_salary=125000).model_dump()
  r=calculate_line(p,{'ordinary':38},Rules().model_dump(),'2026-10-08')
  self.assertEqual(r['gross'],2403.85)
  self.assertAlmostEqual(p['hourly_rate'],125000/52/38)
 def test_invalid_salary_hours(self):
  with self.assertRaises(ValueError):Profile(pay_basis='annual_salary',annual_salary=125000,ordinary_weekly_hours=0)
 def test_ytd_only_issued_excludes_current_and_other_org(self):
  f.client.put('/payroll/employee-records/w1',json={'revision':0,'profile':{},'opening_balances':{'as_at':'2026-10-02','annual_hours':10,'personal_hours':5,'reason':'Wojo','ytd_gross':12000,'ytd_payg':2000,'ytd_super':1440}})
  def run(org,week,issued=True):return {'org_id':org,'week':week,'state':'finalized','issued_1':issued,'worksheet':{'revision':1,'payday':'2026-10-08'},'report':{'rows':[{'worker_id':'w1','result':{'gross':100,'payg':20,'super':12}}]}}
  f.db.pay_review_sheets.rows=[run('org-a','2026-10-02'),run('org-a','2026-10-09'),run('org-a','2026-10-16',False),run('org-b','2026-10-09')]
  response=f.client.get('/payroll/employee-records/w1/pay-context/2026-10-09?payday=2026-10-15')
  self.assertEqual(response.status_code,200,response.text)
  self.assertEqual(response.json()['prior_ytd']['gross'],12100)
  self.assertFalse(response.json()['bank']['configured'])
  self.assertEqual(f.client.get('/payroll/employee-records/w1/pay-context/2026-10-09?payday=2026-10-15',headers={'x-org':'org-b'}).status_code,404)
 def test_missing_opening_does_not_claim_full_ytd(self):
  response=f.client.get('/payroll/employee-records/w1/pay-context/2026-10-02?payday=2026-10-08')
  self.assertEqual(response.status_code,200,response.text)
  self.assertIsNone(response.json()['prior_ytd']['gross'])

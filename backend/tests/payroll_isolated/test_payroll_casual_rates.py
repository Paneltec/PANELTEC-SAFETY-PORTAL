import unittest
import test_payroll_api as f
from payroll_workbench import Profile,Entry,Rules
from payroll_engine import calculate_line
class CasualRatesTests(unittest.TestCase):
 def setUp(self): f.PayrollAPITests().setUp()
 def profile(self): return Profile(employment_type='casual',casual_rates={'base_rate':30.39,'loading_percent':25,'ot1':53.18,'ot2':68.38,'holiday_work':84.4},allowance_rates=[{'code':'away','name':'Living away','rate':103}]).model_dump()
 def test_final_rates_and_no_leave(self):
  r=calculate_line(self.profile(),{'ordinary':7.6,'ot1':2,'ot2':1,'holiday_work':1},Rules().model_dump(),'2026-10-08')
  self.assertEqual(r['ordinary_pay'],288.71)
  self.assertEqual(r['ot1_pay'],106.36)
  self.assertEqual(r['ot2_pay'],68.38)
  self.assertEqual(r['holiday_work_pay'],84.4)
  self.assertEqual(r['annual_accrued'],0)
  self.assertEqual(r['personal_accrued'],0)
 def test_legacy_and_noncasual(self):
  for p in [Profile(employment_type='casual',hourly_rate=40).model_dump(),{**self.profile(),'employment_type':'full_time','hourly_rate':40}]:
   self.assertEqual(calculate_line(p,{'ordinary':1},Rules().model_dump(),'2026-10-08')['gross'],40)
 def test_units_and_unknown(self):
  r=calculate_line(self.profile(),{'allowance_units':{'away':2}},Rules().model_dump(),'2026-10-08')
  self.assertEqual(r['gross'],206)
  self.assertEqual(r['allowance_lines'][0]['amount'],206)
  self.assertEqual(r['annual_accrued'],0)
  with self.assertRaises(ValueError):calculate_line(self.profile(),{'allowance_units':{'bad':1}},Rules().model_dump(),'2026-10-08')
 def test_api_persistence_validation(self):
  p=self.profile();response=f.client.put('/payroll/employee-records/w1',json={'revision':0,'profile':p})
  self.assertEqual(response.status_code,200,response.text)
  self.assertEqual(f.client.get('/payroll/employee-records/w1').json()['profile']['casual_rates']['ot1'],53.18)
  self.assertAlmostEqual(response.json()['profile']['hourly_rate'],37.9875)
  with self.assertRaises(ValueError):Profile(**{**p,'allowance_rates':p['allowance_rates']*2})
  with self.assertRaises(ValueError):Entry(allowance_units={'away':-1})
  with self.assertRaises(ValueError):Profile(employment_type='casual',casual_rates={'base_rate':-1})

 def test_empty_saved_draft_loads_current_roster(self):
  fixture=f.PayrollAPITests();fixture.setUp()
  body={**fixture.body,'rows':[],'revision':3}
  f.db.pay_review_sheets.rows=[{'_id':'org-a:2026-10-02','org_id':'org-a','week':'2026-10-02','worksheet':body,'state':'open','report':{'rows':[]}}]
  response=f.client.get('/payroll/workbench/2026-10-02')
  self.assertEqual(response.status_code,200,response.text)
  self.assertTrue(response.json()['worksheet']['rows'])
  self.assertEqual(response.json()['worksheet']['revision'],3)
  self.assertEqual(f.db.pay_review_sheets.rows[0]['worksheet']['rows'],[])

import unittest
import test_payroll_api as api

class DraftRateTests(unittest.TestCase):
 def setUp(self):
  self.f=api.PayrollAPITests();self.f.setUp()
  self.url='/payroll/workbench/2026-10-05'
  self.f.body['rows'][0]['profile'].update(hourly_rate=0,conditions_reviewed=False)
  self.f.body['rows'][0]['entry']['ordinary']=20
  self.assertEqual(self.f.save().status_code,200)
  self.defaults={**self.f.body['rows'][0]['profile'],'hourly_rate':38}
  self.assertEqual(api.client.put('/payroll/employee-records/w1',json={'revision':0,'profile':self.defaults}).status_code,200)
 def test_missing_rate_recovered_without_changing_saved_hours_or_tax(self):
  response=api.client.get(self.url);self.assertEqual(response.status_code,200,response.text)
  data=response.json();self.assertEqual(data['rates_loaded'],['w1'])
  self.assertEqual(data['worksheet']['rows'][0]['profile']['hourly_rate'],38)
  self.assertEqual(data['worksheet']['rows'][0]['entry']['ordinary'],20)
  self.assertEqual(data['report']['rows'][0]['result']['ordinary_pay'],760)
  self.assertEqual(api.db.pay_review_sheets.rows[0]['worksheet']['rows'][0]['profile']['hourly_rate'],0)
 def test_existing_rate_reviewed_and_finalized_are_untouched(self):
  saved=api.db.pay_review_sheets.rows[0]
  saved['worksheet']['rows'][0]['profile']['hourly_rate']=36
  self.assertEqual(api.client.get(self.url).json()['rates_loaded'],[])
  saved['worksheet']['rows'][0]['profile']['hourly_rate']=0
  saved['worksheet']['reviewed']=True
  self.assertEqual(api.client.get(self.url).json()['rates_loaded'],[])
  saved['worksheet']['reviewed']=False;saved['state']='finalized'
  self.assertEqual(api.client.get(self.url).json()['rates_loaded'],[])
 def test_salary_recovered(self):
  self.defaults.update(pay_basis='annual_salary',annual_salary=110000)
  api.client.put('/payroll/employee-records/w1',json={'revision':1,'profile':self.defaults})
  row=api.client.get(self.url).json()['worksheet']['rows'][0]
  self.assertEqual(row['profile']['annual_salary'],110000)
  self.assertEqual(row['profile']['pay_basis'],'annual_salary')

if __name__=='__main__':unittest.main()

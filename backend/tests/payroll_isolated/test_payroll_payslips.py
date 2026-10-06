import unittest,os
from unittest.mock import patch
from datetime import date
import test_payroll_api as api
import payroll_payslips
class PayslipTests(unittest.TestCase):
 def setUp(self):
  self.f=api.PayrollAPITests();self.f.setUp()
  api.client.put('/payroll/workbench/branding',json={'employer_name':'TEST <Company>','employer_abn':'12128689412'})
  self.f.body['rows'][0]['profile'].update(super_fund_name='TEST FUND',super_fund_usi='TEST')
  self.f.save(True)
  api.client.post('/payroll/workbench/2026-10-05/finalize',json={'revision':1})
  self.body={'revision':1,'paid_date':'2026-10-15','payment_reference':'TEST PAYMENT','particulars_verified':True}
 def issue(self):return api.client.post('/payroll/workbench/2026-10-05/payslips/issue',json=self.body)
 def test_disabled_by_default(self):
  with patch.dict(os.environ,{'PAYROLL_ISSUING_ENABLED':'false'}):self.assertEqual(self.issue().status_code,503)
 def test_issue_download_escape_and_immutability(self):
  with patch.dict(os.environ,{'PAYROLL_ISSUING_ENABLED':'true'}),patch.object(payroll_payslips,'today',return_value=date(2026,10,16)):
   self.assertEqual(self.issue().status_code,200)
   self.assertEqual(self.issue().status_code,200)
   response=api.client.get('/payroll/workbench/2026-10-05/payslips/1/w1')
   self.assertEqual(response.status_code,200)
   self.assertIn('TEST &lt;Company&gt;',response.text)
   self.assertIn('2026-10-15',response.text)
   self.assertEqual(response.headers['cache-control'],'no-store')
   self.body['payment_reference']='DIFFERENT'
   self.assertEqual(self.issue().status_code,409)
 def test_payment_attestation_and_scope(self):
  with patch.dict(os.environ,{'PAYROLL_ISSUING_ENABLED':'true'}),patch.object(payroll_payslips,'today',return_value=date(2026,10,6)):
   self.assertEqual(self.issue().status_code,422)
   self.body['paid_date']='2026-10-06';self.body['particulars_verified']=False
   self.assertEqual(self.issue().status_code,422)
  self.assertEqual(api.client.get('/payroll/workbench/2026-10-05/payslips/1/w1',headers={'x-org':'org-b'}).status_code,404)
if __name__=='__main__':unittest.main()

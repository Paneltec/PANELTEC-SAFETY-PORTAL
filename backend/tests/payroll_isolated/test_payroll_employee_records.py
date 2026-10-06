import unittest,json
import test_payroll_api as api
class EmployeeTests(unittest.TestCase):
 def setUp(self):
  self.f=api.PayrollAPITests();self.f.setUp()
  self.path='/payroll/employee-records/w1'
  self.body={'revision':0,'profile':self.f.body['rows'][0]['profile'],'super_member_number':'SYNTHETIC123456'}
 def test_encrypted_masked_and_import_separate(self):
  response=api.client.put(self.path,json=self.body)
  self.assertEqual(response.status_code,200)
  self.assertNotIn('SYNTHETIC123456',response.text)
  self.assertNotIn('SYNTHETIC123456',json.dumps(api.db.pay_employee_records.rows))
  self.assertEqual(response.json()['member_number_masked'],'••••3456')
  api.db.workers.rows[0]['first_name']='RENAMED BY SIMPRO'
  self.assertEqual(api.client.get(self.path).json()['profile']['hourly_rate'],35)
 def test_revision_and_permissions(self):
  api.client.put(self.path,json=self.body)
  self.assertEqual(api.client.put(self.path,json=self.body).status_code,409)
  self.assertEqual(api.client.get(self.path,headers={'x-org':'org-b'}).status_code,404)
  self.assertEqual(api.client.put(self.path,json=self.body,headers={'x-role':'viewer'}).status_code,403)
 def test_fund_change_requires_explicit_member_replacement(self):
  api.client.put(self.path,json=self.body)
  self.body.update(revision=1,super_member_number=None)
  self.body['profile']['super_fund_usi']='OTHER'
  self.assertEqual(api.client.put(self.path,json=self.body).status_code,422)
  self.body['super_member_number']=''
  self.assertEqual(api.client.put(self.path,json=self.body).json()['member_number_masked'],'')
if __name__=='__main__':unittest.main()

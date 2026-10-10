import unittest
from test_payroll_api import PayrollAPITests,client,db
class FundSettingsTests(unittest.TestCase):
    def setUp(self):
        self.fixture=PayrollAPITests();self.fixture.setUp()
        self.url='/payroll/employee-records/configuration/super-funds'
    def test_shared_directory_and_employee_membership_stay_separate(self):
        p=self.fixture.body['rows'][0]['profile'].copy();p.update(super_fund_name='TEST FUND',super_fund_usi='TESTUSI')
        response=client.put('/payroll/employee-records/w1',json={'profile':p,'super_member_number':'PRIVATE1234'})
        self.assertEqual(response.status_code,200,response.text)
        original=db.pay_employee_records.rows[0].copy()
        data=client.get(self.url).json()
        self.assertEqual(data['items'],[{'name':'TEST FUND','usi':'TESTUSI','active':True}])
        self.assertNotIn('PRIVATE1234',str(data))
        data['items'][0]['name']='RENAMED FUND'
        data={key:data[key] for key in ('revision','items')}
        self.assertEqual(client.put(self.url,json=data).status_code,200)
        self.assertEqual(db.pay_employee_records.rows[0],original)
        self.assertEqual(client.get(self.url,headers={'x-org':'org-b'}).json()['items'],[])
        self.assertEqual(client.put(self.url,json=data).status_code,409)
    def test_validation_and_access(self):
        data={'revision':0,'items':[{'name':'A','usi':'ABC'},{'name':'B','usi':' abc '}]}
        self.assertEqual(client.put(self.url,json=data).status_code,422)
        data['items'].pop()
        self.assertEqual(client.put(self.url,json=data,headers={'x-role':'viewer'}).status_code,403)
        self.assertEqual(client.get(self.url,headers={'x-role':'none'}).status_code,403)

import unittest
from payroll_aba import make_aba

class ABATests(unittest.TestCase):
    def setUp(self):
        self.config=dict(bsb='032000',account_number='00123456',account_name='TEST COMPANY',
            user_name='TEST COMPANY',remitter='TEST COMPANY',direct_entry_id='000000',
            description='PAYROLL',reference='TEST WAGES',balancing_entry=False)
        self.payments=[dict(worker_id='test-1',bsb='062000',account_number='00001234',account_name='TEST WORKER',net=1234.56)]
    def build(self):return make_aba(self.config,self.payments,'2026-10-15').decode('ascii').splitlines()
    def test_fixed_width_fields_and_totals(self):
        lines=self.build();self.assertEqual([len(l) for l in lines],[120]*3)
        self.assertEqual(lines[0][20:23],'WBC');self.assertEqual(lines[0][74:80],'151026')
        self.assertEqual(lines[1][8:17],' 00001234');self.assertEqual(lines[1][18:20],'53')
        self.assertEqual(lines[1][20:30],'0000123456');self.assertEqual(lines[1][112:120],'00000000')
        self.assertEqual(lines[-1][20:50],'000012345600001234560000000000')
        self.assertEqual(lines[-1][74:80],'000001')
    def test_balancing_debit(self):
        self.config['balancing_entry']=True;lines=self.build()
        self.assertEqual(lines[2][18:20],'13');self.assertEqual(lines[-1][20:30],'0000000000')
        self.assertEqual(lines[-1][40:50],'0000123456');self.assertEqual(lines[-1][74:80],'000002')
    def test_invalid_account_and_newline(self):
        self.payments[0]['account_number']='000000'
        with self.assertRaises(ValueError):self.build()
        self.payments[0]['account_number']='12345';self.payments[0]['account_name']='TEST\nWORKER'
        with self.assertRaises(ValueError):self.build()
    def test_duplicate_or_invalid_payments(self):
        self.payments*=2
        with self.assertRaises(ValueError):self.build()
        self.payments=self.payments[:1];self.payments[0]['net']=-1
        with self.assertRaises(ValueError):self.build()
        self.payments[0]['net']=1.001
        with self.assertRaises(ValueError):self.build()
    def test_seventy_workers(self):
        self.payments=[{**self.payments[0],'worker_id':f'test-{i}'} for i in range(70)]
        lines=self.build();self.assertEqual(len(lines),72)
        self.assertEqual(lines[-1][30:40],'0008641920');self.assertEqual(lines[-1][74:80],'000070')

if __name__=='__main__':unittest.main()

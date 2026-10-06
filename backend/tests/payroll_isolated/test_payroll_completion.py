import copy
import unittest
from test_payroll_simpro_flow import DeliveryTests, C, URL
from test_payroll_phone import PhoneFlowTests, phone_user
import test_payroll_api as api

class CompletionTests(unittest.TestCase):
    def setUp(self):
        self.fixture=DeliveryTests();self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.evidence={'revision':1,'reference':'SYNTHETIC RECEIPT','completed_date':'2026-10-06','confirmed':True}

    def test_close_requires_real_recorded_evidence_and_current_revision(self):
        self.assertEqual(C.post(URL+'/close-run',json={'revision':1,'confirmed':True}).status_code,422)
        for kind in ('bank','stp','super','leave'):
            self.assertEqual(C.post(URL+'/completion/'+kind,json={**self.evidence,'confirmed':False}).status_code,422)
            result=C.post(URL+'/completion/'+kind,json=self.evidence)
            self.assertEqual(result.status_code,200,result.text)
            self.assertEqual(C.post(URL+'/completion/'+kind,json=self.evidence).status_code,409)
        self.assertFalse(C.get(URL+'/completion').json()['can_close'])
        self.assertEqual(C.post(URL+'/complete',json=self.fixture.body).status_code,200)
        self.assertEqual(C.post(URL+'/delivery/1/w1').json()['status'],'accepted')
        self.assertTrue(C.get(URL+'/completion').json()['can_close'])
        for _ in range(2):self.assertTrue(C.post(URL+'/close-run',json={'revision':1,'confirmed':True}).json()['closed'])
        self.assertEqual(C.post(URL+'/completion/journal',json=self.evidence).status_code,409)

    def test_evidence_is_scoped_and_cannot_be_backfilled_into_draft(self):
        self.assertEqual(C.post(URL+'/completion/stp',json=self.evidence,headers={'x-role':'viewer'}).status_code,403)
        self.assertEqual(C.post(URL+'/completion/stp',json=self.evidence,headers={'x-org':'org-b'}).status_code,409)
        for body,status in [({**self.evidence,'revision':2},409),({**self.evidence,'reference':'  '},422),({**self.evidence,'completed_date':'2099-01-01'},422)]:
            self.assertEqual(C.post(URL+'/completion/stp',json=body).status_code,status)
        C.post(URL+'/reopen',json={'revision':1,'reason':'Synthetic correction'})
        self.assertEqual(C.post(URL+'/completion/stp',json=self.evidence).status_code,409)

    def test_phone_only_issued_own_worker_and_immutable_pdf(self):
        PhoneFlowTests.setUpClass();phone=PhoneFlowTests.client
        self.assertEqual(phone.get('/me/payroll/payslips').json()['payslips'],[])
        C.post(URL+'/complete',json=self.fixture.body)
        result=phone.get('/me/payroll/payslips');self.assertEqual(result.headers['cache-control'],'no-store')
        self.assertEqual(len(result.json()['payslips']),1)
        path='/me/payroll/payslips/2026-10-05/1'
        detail=phone.get(path).json();self.assertEqual(detail['worker_id'],'w1')
        pdf=phone.get(path+'/pdf');self.assertEqual(pdf.status_code,200);self.assertTrue(pdf.content.startswith(b'%PDF-'))
        self.assertEqual(phone.get('/me/payroll/payslips/2026-10-12/1').status_code,404)
        api.db.workers.rows[0]['first_name']='CHANGED'
        self.assertEqual(phone.get(path).json()['name'],'TEST WORKER')
        async def other():return {'id':'other','org_id':'org-b','worker_id':'w2'}
        phone.app.dependency_overrides[phone_user]=other
        try:
            self.assertEqual(phone.get('/me/payroll/payslips').json()['payslips'],[])
            self.assertEqual(phone.get(path).status_code,404)
        finally:phone.app.dependency_overrides.clear()

if __name__=='__main__':unittest.main()

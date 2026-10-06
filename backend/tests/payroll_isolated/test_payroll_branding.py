import unittest
from test_payroll_api import client, db
import test_payroll_api as api

class BrandingTests(unittest.TestCase):
    def setUp(self): api.PayrollAPITests().setUp()
    def test_saved_branding_stable_worker_id_and_org_scope(self):
        body={'employer_name':'TEST EMPLOYER','assignments':{'w1':'paneltec'}}
        self.assertEqual(client.put('/payroll/workbench/branding',json=body).status_code,200)
        db.workers.rows[0]['first_name']='RENAMED'
        settings=client.get('/payroll/workbench/branding').json()['settings']
        self.assertEqual(settings['assignments'],{'w1':'paneltec'})
        self.assertEqual(settings['employer_name'],'TEST EMPLOYER')
        self.assertEqual(client.get('/payroll/workbench/branding',headers={'x-org':'org-b'}).json()['settings']['assignments'],{'w2':'paneltec'})
    def test_permissions_and_foreign_worker(self):
        self.assertEqual(client.put('/payroll/workbench/branding',json={},headers={'x-role':'viewer'}).status_code,403)
        self.assertEqual(client.get('/payroll/workbench/branding',headers={'x-role':'none'}).status_code,403)
        self.assertEqual(client.put('/payroll/workbench/branding',json={'assignments':{'w2':'viatec'}}).json()['settings']['assignments'],{'w1':'paneltec'})
    def test_logo_validation(self):
        for logo in ['https://example.com/logo.png','data:image/svg+xml;base64,PHN2Zz4=','data:image/png;base64,YmFk']:
            self.assertEqual(client.put('/payroll/workbench/branding',json={'viatec':{'name':'Viatec','logo':logo}}).status_code,422)
        logo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
        self.assertEqual(client.put('/payroll/workbench/branding',json={'viatec':{'name':'Viatec','logo':logo}}).status_code,200)

if __name__=='__main__':unittest.main()

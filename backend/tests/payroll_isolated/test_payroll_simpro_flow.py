import asyncio
import copy
import os
import sys
import types
import unittest
from unittest.mock import AsyncMock, patch
import test_payroll_api as api
from payroll_roster import my_worker

C=api.client
URL='/payroll/workbench/2026-10-05'

class SimproFlowTests(unittest.TestCase):
    def setUp(self):
        self.f=api.PayrollAPITests();self.f.setUp()
        self.times={'id':'day1','org_id':'org-a','worker_id':'w1','date':'2026-10-05',
            'kind':'work','hours':8,'start':'07:00','finish':'15:30','break_minutes':30,
            'estimate':{'ordinary':7.6,'ot_1':.4,'ot_2':0},'status':'submitted','source':'worker'}

    def test_only_current_simpro_workers_and_department_branding(self):
        api.db.workers.rows.extend([{'id':'manual','org_id':'org-a'},
            {'id':'archived','org_id':'org-a','simpro_employee_id':'3','active':True,'simpro_sync_snapshot':{'archived':True}}])
        api.db.workers.rows[0].update(position='Traffic Control',active=False,simpro_sync_snapshot={'archived':False})
        data=C.get(URL).json()
        self.assertEqual([w['id'] for w in data['workers']],['w1'])
        self.assertEqual(data['workers'][0]['division'],'viatec')
        api.db.workers.rows[0]['department']='Administration'
        self.assertEqual(C.get(URL).json()['workers'][0]['division'],'paneltec')
        self.f.body['rows'][0]['worker_id']='manual'
        self.assertEqual(self.f.save().status_code,422)

    def test_displayed_worker_position_wins_over_old_snapshot(self):
        worker=api.db.workers.rows[0]
        worker.update(position='Traffic Controller',simpro_sync_snapshot={'position':'Construction Worker L2'})
        self.assertEqual(C.get(URL).json()['workers'][0]['division'],'viatec')
        worker.update(position='ADMINISTRATION',simpro_sync_snapshot={'position':'Traffic Controller'})
        data=C.get(URL).json()['workers'][0]
        self.assertEqual(data['department'],'ADMINISTRATION')
        self.assertEqual(data['division'],'paneltec')
        worker.update(position='Traffic Controller',department='Administration')
        self.assertEqual(C.get(URL).json()['workers'][0]['division'],'paneltec')

    def test_duplicate_simpro_identity_rejected_without_deleting_history(self):
        self.f.save()
        api.db.workers.rows.append({**api.db.workers.rows[0],'id':'duplicate'})
        self.assertEqual(C.get(URL).status_code,409)
        self.assertEqual(len(api.db.pay_review_sheets.rows),1)

    def test_phone_identity_is_org_scoped_and_unambiguous(self):
        api.db.workers.rows[0]['email']='employee@example.com'
        user={'id':'login','org_id':'org-a','email':'employee@example.com'}
        self.assertEqual(asyncio.run(my_worker(user)),'w1')
        for altered in [{**user,'worker_id':'w2'},{**user,'org_id':'org-b'},{**user,'email':None}]:
            with self.assertRaises(api.HTTPException):asyncio.run(my_worker(altered))
        api.db.workers.rows.append({**api.db.workers.rows[0],'id':'same-email','simpro_employee_id':'44'})
        with self.assertRaises(api.HTTPException):asyncio.run(my_worker(user))

    def test_new_run_imports_submitted_only_and_detects_changed_days(self):
        api.db.timesheet_entries.rows=[self.times,{**self.times,'id':'draft','date':'2026-10-06','status':'draft'},
            {**self.times,'id':'other-org','org_id':'org-b'}, {**self.times,'id':'outside','date':'2026-10-12'}]
        sheet=C.get(URL).json()['worksheet'];row=sheet['rows'][0]
        self.assertEqual(row['entry']['ordinary'],7.6);self.assertEqual(row['entry']['ot1'],.4)
        self.assertFalse(row['entry']['hours_reviewed']);self.assertTrue(row['timesheet_fingerprint'])
        self.f.body['rows'][0]['timesheet_fingerprint']=row['timesheet_fingerprint']
        self.assertEqual(self.f.save(True).status_code,200)
        self.f.body['revision']=1
        # Office override remains intact on reload, even after source hours change.
        api.db.timesheet_entries.rows[0]['notes']='Changed by worker'
        loaded=C.get(URL).json()
        self.assertEqual(loaded['worksheet']['rows'][0]['entry']['ordinary'],38)
        self.assertFalse(loaded['report']['ready'])
        self.assertEqual(self.f.save(True).status_code,422)

    def test_new_submission_requires_refresh_of_old_manual_run(self):
        self.f.save(True)
        api.db.timesheet_entries.rows=[self.times]
        self.assertFalse(C.get(URL).json()['report']['ready'])

    def test_payroll_viewer_cannot_complete_or_dispatch(self):
        self.assertEqual(C.post(URL+'/complete',json={'revision':1,'paid_date':'2026-10-06','payment_reference':'test'},headers={'x-role':'viewer'}).status_code,403)
        self.assertEqual(C.post(URL+'/delivery/1/w1',headers={'x-role':'viewer'}).status_code,403)

class DeliveryTests(unittest.TestCase):
    def setUp(self):
        self.f=api.PayrollAPITests();self.f.setUp()
        self.env=patch.dict(os.environ,{'PAYROLL_ISSUING_ENABLED':'true'});self.env.start();self.addCleanup(self.env.stop)
        api.db.workers.rows[0]['email']='employee@example.com'
        self.f.body['payday']='2026-10-06'
        self.f.body['rows'][0]['profile'].update(super_fund_name='TEST FUND',super_fund_usi='TEST-USI')
        C.put('/payroll/workbench/branding',json={'employer_name':'TEST EMPLOYER','employer_abn':'12128689412'})
        self.assertEqual(self.f.save(True).status_code,200)
        self.assertEqual(C.post(URL+'/finalize',json={'revision':1}).status_code,200)
        api.db.integration_configs.rows=[{'org_id':'org-a','kind':'microsoft365','status':'connected'}]
        self.body={'revision':1,'paid_date':'2026-10-06','payment_reference':'TEST-PAID','particulars_verified':True}
        self.provider=AsyncMock(return_value={'ok':True})
        self.safe=AsyncMock(return_value=False)
        self.modules=patch.dict(sys.modules,{'integrations_m365':types.SimpleNamespace(graph_send_mail=self.provider),
            'comms_safe_mode':types.SimpleNamespace(is_blocked=self.safe)})
        self.modules.start();self.addCleanup(self.modules.stop)

    def test_complete_preflights_email_and_creates_no_payment(self):
        api.db.workers.rows[0]['email']='bad-email'
        self.assertEqual(C.post(URL+'/complete',json=self.body).status_code,422)
        self.assertNotIn('issued_1',api.db.pay_review_sheets.rows[0])
        self.provider.assert_not_awaited()

    def test_individual_private_send_and_idempotent_retry(self):
        for _ in range(2):self.assertEqual(C.post(URL+'/complete',json=self.body).status_code,200)
        for _ in range(2):self.assertEqual(C.post(URL+'/delivery/1/w1').json()['status'],'accepted')
        self.provider.assert_awaited_once()
        kwargs=self.provider.call_args.kwargs
        self.assertEqual(kwargs['to'],['employee@example.com']);self.assertEqual(kwargs['cc'],[])
        self.assertTrue(kwargs['attachments'][0]['content_bytes'].startswith(b'%PDF-'))
        self.assertTrue(kwargs['attachments'][0]['filename'].endswith('.pdf'))
        self.assertNotIn('file_url',kwargs['attachments'][0])
        self.assertEqual(C.get(URL+'/delivery/1',headers={'x-org':'org-b'}).json()['recipients'],[])
        self.assertEqual(C.post(URL+'/delivery/1/w2').status_code,404)

    def test_safe_mode_and_unknown_delivery_never_report_success(self):
        C.post(URL+'/complete',json=self.body)
        self.safe.return_value=True
        self.assertEqual(C.post(URL+'/delivery/1/w1').status_code,409)
        self.provider.assert_not_awaited();self.assertEqual(api.db.pay_payslip_delivery.rows,[])
        self.safe.return_value=False;self.provider.side_effect=TimeoutError()
        self.assertEqual(C.post(URL+'/delivery/1/w1').json()['status'],'needs_check')
        C.post(URL+'/delivery/1/w1');self.provider.assert_awaited_once()

    def test_correction_stops_pending_email_and_preserves_snapshot(self):
        C.post(URL+'/complete',json=self.body)
        C.post(URL+'/reopen',json={'revision':1,'reason':'TEST correction'})
        self.assertEqual(C.post(URL+'/delivery/1/w1').status_code,409)
        self.provider.assert_not_awaited()
        self.assertEqual(len(api.db.pay_review_sheets.rows[0]['finalizations']),1)

    def test_owner_only_enable_requires_validation(self):
        os.environ.pop('PAYROLL_ISSUING_ENABLED',None)
        os.environ['PAYROLL_OWNER_USER_ID']='test-admin';os.environ['PAYROLL_OWNER_ORG_ID']='org-a'
        self.addCleanup(os.environ.pop,'PAYROLL_OWNER_USER_ID',None);self.addCleanup(os.environ.pop,'PAYROLL_OWNER_ORG_ID',None)
        # Test guard deliberately has no admin role: possessing payroll.edit alone is insufficient.
        self.assertEqual(C.put('/payroll/workbench/delivery/settings',json={'enabled':True,'validation_completed':True}).status_code,403)

if __name__=='__main__':unittest.main()

"""Actual phone endpoints -> shared timesheet storage -> pay-run import."""
import importlib
import sys
import types
import unittest
from unittest.mock import patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
import test_payroll_api as api

async def phone_user():return {'id':'phone-login','org_id':'org-a','worker_id':'w1'}

class PhoneFlowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        sys.modules['models'].new_id=lambda:'synthetic-phone-day'
        with patch.dict(sys.modules,{'auth':types.SimpleNamespace(get_current_user=phone_user)}):
            cls.payroll=importlib.import_module('payroll')
        app=FastAPI();app.include_router(cls.payroll.me_router)
        cls.client=TestClient(app)

    def setUp(self):api.PayrollAPITests().setUp()

    def test_save_submit_and_populate_only_signed_in_worker(self):
        body={'date':'2026-10-05','start':'07:00','finish':'15:30','break_minutes':30,'worker_id':'w2'}
        response=self.client.put('/me/payroll/timesheets/2026-10-05',json=body)
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(response.json()['worker_id'],'w1')
        self.assertEqual(response.json()['hours'],8)
        self.assertEqual(api.client.get('/payroll/workbench/2026-10-05').json()['worksheet']['rows'][0]['entry']['ordinary'],0)
        response=self.client.post('/me/payroll/submit?period_id=2026-10-05')
        self.assertEqual(response.status_code,200,response.text)
        row=api.client.get('/payroll/workbench/2026-10-05').json()['worksheet']['rows'][0]
        self.assertEqual(row['entry']['ordinary'],7.6);self.assertEqual(row['entry']['ot1'],.4)
        self.assertEqual(self.client.get('/me/payroll/timesheets?period_id=2026-10-05').json()['entries'][0]['status'],'submitted')

    def test_reject_bad_time_and_locked_run_and_non_simpro_worker(self):
        body={'date':'2026-10-05','start':'25:00','finish':'15:30','break_minutes':30}
        self.assertEqual(self.client.put('/me/payroll/timesheets/2026-10-05',json=body).status_code,422)
        body.update(start='07:00',break_minutes=600)
        self.assertEqual(self.client.put('/me/payroll/timesheets/2026-10-05',json=body).status_code,422)
        body['break_minutes']=30
        api.db.pay_review_sheets.rows=[{'_id':'org-a:2026-10-05','org_id':'org-a','week':'2026-10-05','state':'finalized'}]
        self.assertEqual(self.client.put('/me/payroll/timesheets/2026-10-05',json=body).status_code,409)
        self.assertEqual(self.client.post('/me/payroll/submit?period_id=2026-10-05').status_code,409)
        api.db.workers.rows[0].pop('simpro_employee_id')
        self.assertEqual(self.client.get('/me/payroll/timesheets').status_code,409)

if __name__=='__main__':unittest.main()

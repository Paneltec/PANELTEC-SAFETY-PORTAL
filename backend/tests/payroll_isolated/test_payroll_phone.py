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
            cls.segments=importlib.import_module('payroll_segments')
        sys.modules['payroll']=cls.payroll
        sys.modules['payroll_segments']=cls.segments
        app=FastAPI();app.include_router(cls.payroll.me_router);app.include_router(cls.payroll.router)
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

class SegmentFlowTests(PhoneFlowTests):
    def setUp(self):
        super().setUp()
        api.db.integration_configs.rows=[{'org_id':'org-a','kind':'simpro','customers_cache':[
            {'simpro_company_id':'1','simpro_customer_id':'100','name':'City','type':'Company','active':True},
            {'simpro_company_id':'1','simpro_customer_id':'200','name':'Water','type':'Company','active':True}]}]
        api.db.simpro_jobs.rows=[{'org_id':'org-a','company_id':'1','id':'j1','simpro_job_id':1184,'simpro_customer_id':'100','customer_name':'City','status_bucket':'active','name':'Road'},
            {'org_id':'org-b','company_id':'1','id':'secret','simpro_job_id':999,'customer_name':'City','status_bucket':'active'}]
        self.day='/me/payroll/timesheets/2026-10-07/segments'
        self.segment={'id':'s1','category':'client','client_key':'1:Company:100','client_name':'spoofed','job_id':'j1','start':'07:00','finish':'12:00','break_minutes':30,'notes':'Road work'}
    def put(self,segments,revision=0):return self.client.put(self.day,json={'revision':revision,'segments':segments})
    def test_split_day_gap_totals_and_weekly_approval_return(self):
        second={**self.segment,'id':'s2','category':'travel','job_id':'','start':'13:00','finish':'16:30','break_minutes':0}
        response=self.put([self.segment,second]);self.assertEqual(response.status_code,200,response.text)
        row=response.json();self.assertEqual(row['hours'],8);self.assertEqual(row['segments'][0]['client_name'],'City')
        self.assertEqual(row['estimate']['ordinary'],7.6);self.assertEqual(row['estimate']['ot_1'],.4)
        self.assertEqual(row['site_name'],'City, Travel');self.assertEqual(row['job_ref'],'1184')
        self.assertEqual(self.put([self.segment],0).status_code,409)
        self.client.post('/me/payroll/submit?period_id=2026-10-05')
        self.assertEqual(self.put([self.segment],1).status_code,409)
        self.assertEqual(self.client.put('/me/payroll/timesheets/2026-10-07',json={'date':'2026-10-07','hours':1}).status_code,409)
        feed=api.client.get('/payroll/workbench/2026-10-05/submissions').json()['workers']['w1']
        self.assertEqual(len(feed['days']),1);self.assertEqual(len(feed['days'][0]['segments']),2)
        for action in ['approve','reject']:
            r=self.client.post('/payroll/timesheets/'+action,json={'ids':[row['id']],'reason':'Check job'});self.assertEqual(r.status_code,200,r.text)
        self.assertEqual(self.put([self.segment],1).status_code,200)
    def test_invalid_times_overlap_and_wrong_client_job(self):
        for update in [{'finish':'06:00'},{'finish':'07:00'},{'break_minutes':300},{'client_key':'1:Company:200'},{'job_id':'secret'},{'start':'24:00'}]:
            with self.subTest(update=update):self.assertEqual(self.put([{**self.segment,**update}]).status_code,422)
        self.assertEqual(self.put([self.segment,{**self.segment,'id':'s2','start':'11:00','finish':'14:00'}]).status_code,422)
        self.assertEqual(self.put([self.segment,self.segment]).status_code,422)
        self.assertEqual(api.db.timesheet_entries.rows,[])
    def test_catalog_scope_recent_and_unmatched_office_match(self):
        catalog=self.client.get('/me/payroll/time-catalog').json()
        self.assertEqual(len(catalog['clients']),2);self.assertEqual(len(catalog['clients'][0]['jobs']),1)
        self.assertNotIn('secret',str(catalog))
        row=self.put([{**self.segment,'category':'unmatched','client_name':'New City'}]).json()
        self.assertTrue(row['segments'][0]['needs_matching'])
        self.client.post('/me/payroll/submit?period_id=2026-10-05')
        before=api.client.get('/payroll/workbench/2026-10-05/submissions').json()['workers']['w1']['fingerprint']
        url=f"/payroll/timesheets/{row['id']}/segments/s1/match"
        body={'revision':1,'client_key':'1:Company:100','job_id':'j1'}
        self.assertEqual(self.client.post(url,json=body,headers={'x-org':'org-b'}).status_code,404)
        self.assertEqual(self.client.post(url,json=body,headers={'x-role':'viewer'}).status_code,403)
        response=self.client.post(url,json=body);self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(response.json()['segments'][0]['original_client_name'],'New City')
        after=api.client.get('/payroll/workbench/2026-10-05/submissions').json()['workers']['w1']['fingerprint'];self.assertNotEqual(before,after)
        self.assertEqual(self.client.get('/me/payroll/time-catalog').json()['recent'],['1:Company:100'])
    def test_finalized_day_blocks_save_approval_return_and_matching(self):
        row=self.put([self.segment]).json()
        api.db.pay_review_sheets.rows=[{'_id':'org-a:2026-10-05','org_id':'org-a','week':'2026-10-05','state':'finalized'}]
        self.assertEqual(self.put([self.segment],1).status_code,409)
        for action in ['approve','reject']:
            self.assertEqual(self.client.post('/payroll/timesheets/'+action,json={'ids':[row['id']]}).status_code,409)
        self.assertEqual(api.db.timesheet_entries.rows[0]['status'],'draft')
    def test_empty_day_not_submitted_and_legacy_day_preserved(self):
        self.assertEqual(self.put([]).status_code,200)
        self.assertEqual(self.client.post('/me/payroll/submit?period_id=2026-10-05').json()['submitted'],0)
        api.db.timesheet_entries.rows=[]
        old=self.client.put('/me/payroll/timesheets/2026-10-07',json={'date':'2026-10-07','start':'07:00','finish':'12:00','break_minutes':30,'notes':'Keep this','allowances':[]})
        self.assertEqual(old.status_code,200,old.text)
        response=self.put([self.segment]);self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(response.json()['notes'],'Keep this')

    def test_friday_phone_and_pay_run_use_same_period(self):
        api.db.pay_settings.rows[0]['week_starts']='friday'
        self.assertEqual(self.put([self.segment]).status_code,200)
        period=self.client.get('/me/payroll/timesheets?period_id=2026-10-07').json()['period']
        self.assertEqual(period,{'id':'2026-10-02','start':'2026-10-02','end':'2026-10-08'})
        self.assertEqual(self.client.post('/me/payroll/submit?period_id=2026-10-02').json()['submitted'],1)
        run=api.client.get('/payroll/workbench/2026-10-02')
        self.assertEqual(run.status_code,200,run.text)
        self.assertEqual(run.json()['worksheet']['payday'],'2026-10-08')
        self.assertEqual(run.json()['worksheet']['rows'][0]['entry']['ordinary'],4.5)
        api.db.pay_review_sheets.rows=[{'_id':'org-a:2026-10-02','org_id':'org-a','week':'2026-10-02','state':'finalized'}]
        self.assertEqual(self.put([self.segment],1).status_code,409)
    def test_calendar_change_keeps_saved_monday_run(self):
        fixture=api.PayrollAPITests();fixture.setUp();self.assertEqual(fixture.save().status_code,200)
        api.db.pay_settings.rows[0]['week_starts']='friday'
        self.assertEqual(api.client.get('/payroll/workbench/2026-10-05').status_code,200)
        self.assertEqual(api.client.get('/payroll/workbench/2026-10-12').status_code,422)
        self.assertEqual(api.client.get('/payroll/workbench/2026-10-09').status_code,200)

if __name__=='__main__':unittest.main()

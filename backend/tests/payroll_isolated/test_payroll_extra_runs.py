import copy
from test_payroll_api import PayrollAPITests,client,db

class ExtraRunTests(PayrollAPITests):
    def create(self,**changes):
        return client.post('/payroll/workbench/out-of-cycle/create',json={
            'week':'2026-10-05','payday':'2026-10-15','workers':['w1'],
            'reason':'Missed hours',**changes})

    def test_extra_runs_are_distinct_and_do_not_change_weekly(self):
        self.assertEqual(self.save().status_code,200)
        before=copy.deepcopy(db.pay_review_sheets.rows[0])
        a=self.create();b=self.create()
        self.assertEqual(a.status_code,200,a.text)
        self.assertNotEqual(a.json()['run_id'],b.json()['run_id'])
        self.assertEqual(db.pay_review_sheets.rows[0],before)
        run=client.get('/payroll/workbench/'+a.json()['run_id']).json()['worksheet']
        self.assertTrue(run['out_of_cycle'])
        self.assertEqual([r['worker_id'] for r in run['rows']],['w1'])
        self.assertEqual(run['rows'][0]['entry']['ordinary'],0)
        self.assertEqual(run['rows'][0]['profile']['tax_mode'],'manual')
        self.assertEqual(client.get('/payroll/workbench/'+a.json()['run_id']+'/submissions').json()['workers'],{})

    def test_selection_calendar_and_permissions(self):
        self.assertEqual(self.create(workers=['w2']).status_code,422)
        self.assertEqual(self.create(workers=['w1','w1']).status_code,422)
        self.assertEqual(self.create(week='2026-10-06').status_code,422)
        self.assertEqual(client.post('/payroll/workbench/out-of-cycle/create',headers={'x-role':'viewer'},json={'week':'2026-10-05','payday':'2026-10-15','workers':['w1'],'reason':'Test'}).status_code,403)

    def test_extra_does_not_use_regular_weekly_tax_or_imported_leave(self):
        key=self.create().json()['run_id'];url='/payroll/workbench/'+key
        body=client.get(url).json()['worksheet']
        body['rows'][0]['profile']=self.body['rows'][0]['profile']
        self.assertEqual(client.post(url+'/preview',json=body).status_code,422)
        body['rows'][0]['profile']['tax_mode']='manual'
        body['rows'][0]['entry']['annual']=1
        self.assertEqual(client.post(url+'/preview',json=body).status_code,422)
        body['rows'][0]['entry']['annual']=0
        body['out_of_cycle']=False
        self.assertEqual(client.post(url+'/preview',json=body).status_code,422)

    def test_finalize_extra_leaves_regular_week_available(self):
        client.put('/payroll/workbench/branding',json={'employer_name':'TEST','employer_abn':'12128689412'})
        key=self.create().json()['run_id'];url='/payroll/workbench/'+key
        body=client.get(url).json()['worksheet']
        body['rows']=copy.deepcopy(self.body['rows'])
        body['rows'][0]['profile'].update(tax_mode='manual',super_fund_name='TEST FUND',super_fund_usi='TEST')
        body['rows'][0]['entry'].update(manual_payg=250,payg_reference='Synthetic reviewed extra withholding')
        body['reviewed']=True
        saved=client.put(url,json=body)
        self.assertEqual(saved.status_code,200,saved.text)
        final=client.post(url+'/finalize',json={'revision':saved.json()['revision']})
        self.assertEqual(final.status_code,200,final.text)
        self.body['rows'][0]['profile'].update(super_fund_name='TEST FUND',super_fund_usi='TEST')
        self.assertEqual(self.save(True).status_code,200)
        regular=client.post('/payroll/workbench/2026-10-05/finalize',json={'revision':1})
        self.assertEqual(regular.status_code,200,regular.text)

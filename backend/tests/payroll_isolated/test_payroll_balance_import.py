import csv, io, unittest
import test_payroll_api as api

class BalanceImportTests(unittest.TestCase):
 def setUp(self):
  self.fixture=api.PayrollAPITests();self.fixture.setUp()
  self.url='/payroll/employee-records/opening-import'
  self.template=api.client.get(self.url+'/template').json()
 def preview(self, rows, **kw):
  text=io.StringIO(); writer=csv.writer(text);writer.writerow(self.template['columns']);writer.writerows(rows)
  return api.client.post(self.url+'/preview',files={'file':('balances.csv',text.getvalue(),'text/csv')},data={'as_at':'2026-10-02','reason':'Synthetic migration'},**kw)
 def row(self):
  r=self.template['rows'][0];return r[:2]+[100,50,10000,2000,1200]
 def test_preview_does_not_save_and_audited_save_retains_profile(self):
  result=self.preview([self.row()]);self.assertEqual(result.status_code,200,result.text)
  row=result.json()['rows'][0];self.assertEqual(api.db.pay_employee_records.rows,[])
  body={k:row[k] for k in ('profile','revision','opening_balances')}
  response=api.client.put('/payroll/employee-records/'+row['worker_id'],json=body)
  self.assertEqual(response.status_code,200,response.text)
  self.assertEqual(response.json()['opening_balances']['ytd_super'],1200)
  self.assertEqual(api.client.put('/payroll/employee-records/'+row['worker_id'],json=body).status_code,409)
 def test_duplicates_unknown_names_invalid_values_and_blank_ytd(self):
  row=self.row();self.assertEqual(len(self.preview([row,row]).json()['errors']),1)
  row[1]='Wrong person';self.assertEqual(len(self.preview([row]).json()['errors']),1)
  row=self.row();row[2]=-1;self.assertEqual(len(self.preview([row]).json()['errors']),1)
  row=self.row();row[4]='';data=self.preview([row]).json();self.assertIsNone(data['rows'][0]['opening_balances']['ytd_gross'])
 def test_authorization_and_tenant(self):
  self.assertEqual(self.preview([self.row()],headers={'x-role':'viewer'}).status_code,403)
  self.assertEqual(len(self.preview([self.row()],headers={'x-org':'org-b'}).json()['errors']),1)

if __name__=='__main__':unittest.main()

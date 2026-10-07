from test_payroll_api import PayrollAPITests,client,db
from test_payroll_rate_import import xlsx

URL='/payroll/employee-records/configuration/catalog/deduction-categories'
class CatalogTests(PayrollAPITests):
 def test_import_preview_is_read_only_and_save_is_revision_checked(self):
  source=xlsx([['Id','Name','TaxExempt','PaymentSummaryClassification'],[1,'Test deduction','False','ChildSupportDeduction']])
  result=client.post(URL+'/preview',files={'file':('deductions.xlsx',source)})
  self.assertEqual(result.status_code,200,result.text)
  self.assertEqual(db.pay_configuration.rows,[])
  body={'revision':0,**result.json()}
  self.assertEqual(client.put(URL,json=body).status_code,200)
  self.assertEqual(client.get(URL).json()['tables']['Export'][0]['PaymentSummaryClassification'],'ChildSupportDeduction')
  self.assertEqual(client.put(URL,json=body).status_code,409)
  self.assertEqual(client.get(URL,headers={'x-org':'org-b'}).json()['tables'],{})
  self.assertEqual(client.put(URL,headers={'x-role':'viewer'},json=body).status_code,403)
 def test_duplicate_categories_rejected(self):
  row={'Id':1,'Name':'Test','TaxExempt':'False'}
  self.assertEqual(client.put(URL,json={'revision':0,'tables':{'Export':[row,row]}}).status_code,422)

import io
from openpyxl import Workbook
from test_payroll_api import PayrollAPITests,client,db

def xlsx(rows):
    book=Workbook();book.active.title='Export'
    for row in rows:book.active.append(row)
    out=io.BytesIO();book.save(out);return out.getvalue()

class RateImportTests(PayrollAPITests):
    def preview(self,name='TEST',surname='WORKER',aliases='{}',role='editor'):
        rates=xlsx([['Employee Id','First Name','Surname','Pay Rate Template','PC1_Casual Ordinary Hours','PC2_Casual - Overtime 1.5'],[100,name,surname,'Casual',30,52.5]])
        cats=xlsx([['Id','PayCategoryName','RateUnit','RateLoadingMultiplier'],[1,'Casual Ordinary Hours','Hourly',1.25],[2,'Casual - Overtime 1.5','Hourly',1]])
        return client.post('/payroll/employee-records/import/preview',headers={'x-role':role},files={'rates':('rates.xlsx',rates),'categories':('cats.xlsx',cats)},data={'aliases':aliases})
    def test_preview_loads_base_and_loading_once_without_writing(self):
        result=self.preview();self.assertEqual(result.status_code,200,result.text)
        row=result.json()['rows'][0]
        self.assertEqual(row['profile']['hourly_rate'],37.5)
        self.assertEqual(row['profile']['casual_rates']['ot1'],52.5)
        self.assertFalse(row['profile']['conditions_reviewed'])
        self.assertEqual(db.pay_employee_records.rows,[])
    def test_unmatched_requires_explicit_match_and_current_identity(self):
        self.assertEqual(self.preview(name='Alias').json()['rows'],[])
        self.assertEqual(len(self.preview(name='Alias',aliases='{"Alias WORKER":"w1"}').json()['rows']),1)
        self.assertEqual(self.preview(name='Alias',aliases='{"Alias WORKER":"w2"}').json()['rows'],[])
        db.workers.rows[0]['active']=False
        self.assertEqual(self.preview().json()['rows'],[])
    def test_preview_editor_only(self):
        self.assertEqual(self.preview(role='viewer').status_code,403)

    def test_explicit_salary_choice_excludes_hourly_rate(self):
        from payroll_rate_import import rate_profile
        source={'PC1_Salary':110000,'PC2_Permanent Ordinary Hours':41.5}
        cats={'1':{'Id':1,'PayCategoryName':'Salary','RateUnit':'Annually'},'2':{'Id':2,'PayCategoryName':'Permanent Ordinary Hours','RateUnit':'Hourly'}}
        with self.assertRaises(ValueError):rate_profile(source,cats,{})
        profile,warnings,other=rate_profile(source,cats,{},'annual_salary')
        self.assertEqual(profile['pay_basis'],'annual_salary')
        self.assertEqual(profile['annual_salary'],110000)
        self.assertTrue(warnings)
        hourly,_,_=rate_profile(source,cats,{},'hourly')
        self.assertEqual(hourly['hourly_rate'],41.5)
        self.assertEqual(hourly['annual_salary'],0)

import unittest
from test_payroll_phone import PhoneFlowTests
import test_payroll_api as f
class OfficeReviewTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):PhoneFlowTests.setUpClass();cls.client=PhoneFlowTests.client
 def setUp(self):
  f.PayrollAPITests().setUp()
  self.day={'id':'day','org_id':'org-a','worker_id':'w1','date':'2026-10-05','kind':'work','status':'submitted','revision':1,'updated_at':'old','start':'07:00','finish':'15:00','break_minutes':0,'hours':8}
  f.db.timesheet_entries.rows=[self.day.copy()]
  self.body={'revision':1,'updated_at':'old','action':'save','reason':'Correct unpaid break','segments':[{'id':'s','category':'yard','start':'07:00','finish':'15:00','break_minutes':30}]}
 def test_edit_approve_and_stale(self):
  r=self.client.post('/payroll/timesheets/day/review',json=self.body)
  self.assertEqual(r.status_code,200,r.text);self.assertEqual(r.json()['hours'],7.5);self.assertEqual(r.json()['status'],'submitted')
  self.assertEqual(len(f.db.timesheet_entries.rows[0]['office_history']),1)
  self.assertEqual(self.client.post('/payroll/timesheets/day/review',json=self.body).status_code,409)
  d=r.json();r=self.client.post('/payroll/timesheets/day/review',json={'revision':d['revision'],'updated_at':d['updated_at'],'action':'approve'})
  self.assertEqual(r.status_code,200,r.text);self.assertEqual(r.json()['status'],'approved')
 def test_permissions_overlap_and_lock(self):
  self.assertEqual(self.client.post('/payroll/timesheets/day/review',json=self.body,headers={'x-role':'viewer'}).status_code,403)
  self.assertEqual(self.client.post('/payroll/timesheets/day/review',json=self.body,headers={'x-org':'other'}).status_code,404)
  self.body['segments']*=2
  self.assertEqual(self.client.post('/payroll/timesheets/day/review',json=self.body).status_code,422)
  f.db.pay_review_sheets.rows=[{'org_id':'org-a','week':'2026-10-02','state':'finalized'}]
  self.assertEqual(self.client.post('/payroll/timesheets/day/review',json=self.body).status_code,409)

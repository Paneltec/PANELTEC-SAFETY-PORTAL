import unittest,types,sys
from unittest.mock import patch,AsyncMock
import test_payroll_api as f
class InviteTests(unittest.TestCase):
 def setUp(self):
  f.PayrollAPITests().setUp()
  f.db.users=f.Collection();f.db.payroll_access=f.Collection()
  f.db.users.rows=[{'id':'accountant','org_id':'org-a','role':'admin','status':'invited','email':'accountant@example.invalid'}]
  f.db.payroll_access.rows=[{'_id':'org-a:accountant','level':'view'}]
  self.url='/payroll/workbench/access/accountant/invite'
 def test_owner_only(self):
  self.assertEqual(f.client.post(self.url).status_code,403)
 def test_requires_approved_admin_pending_and_grant(self):
  with patch('payroll_run_register.is_payroll_owner',return_value=True):
   for change in ({'role':'worker'},{'org_id':'org-b'},{'status':'active'}):
    original=dict(f.db.users.rows[0]);f.db.users.rows[0].update(change)
    self.assertEqual(f.client.post(self.url).status_code,400)
    f.db.users.rows[0]=original
   f.db.payroll_access.rows=[]
   self.assertEqual(f.client.post(self.url).status_code,400)
 def test_reuses_email_invite_service(self):
  service=types.SimpleNamespace(send_invite=AsyncMock(return_value={'ok':True}),InviteIn=lambda **kw:kw)
  with patch('payroll_run_register.is_payroll_owner',return_value=True),patch.dict(sys.modules,{'auth_invite':service}):
   self.assertEqual(f.client.post(self.url).status_code,200)
   self.assertEqual(service.send_invite.call_args.args[1],{'channel':'email'})

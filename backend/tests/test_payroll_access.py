import unittest
from payroll_access import payroll_allowed
class PayrollAccessTests(unittest.TestCase):
    def test_access_matrix(self):
        cases = [
          ("admin", {}, "view", False),
          ("admin", {}, "edit", False),
          ("admin", {"view":True}, "view", True),
          ("admin", {"view":True}, "open", True),
          ("admin", {"view":True}, "edit", False),
          ("admin", {"view":True,"edit":True}, "edit", True),
          ("worker", {"view":True,"edit":True}, "view", False),
          ("admin", {"view":False,"edit":True}, "edit", False),
          ("admin", {"view":"true"}, "view", False),
        ]
        for role, grants, action, expected in cases:
            with self.subTest(role=role, grants=grants, action=action):
                self.assertEqual(payroll_allowed({"role":role},{"payroll":grants},action),expected)

    def test_owner_is_pinned_to_immutable_ids(self):
        import os
        from unittest.mock import patch
        from payroll_access import is_payroll_owner
        with patch.dict(os.environ, {"PAYROLL_OWNER_USER_ID":"owner-id", "PAYROLL_OWNER_ORG_ID":"org-a"}):
            self.assertTrue(is_payroll_owner({"id":"owner-id","org_id":"org-a","role":"admin"}))
            self.assertFalse(is_payroll_owner({"id":"other","org_id":"org-a","role":"admin","email":"stephen@paneltec.com.au"}))
            self.assertFalse(is_payroll_owner({"id":"owner-id","org_id":"org-b","role":"admin"}))
        with patch.dict(os.environ, {"PAYROLL_OWNER_USER_ID":"", "PAYROLL_OWNER_ORG_ID":""}):
            self.assertFalse(is_payroll_owner({"role":"admin"}))


class PayrollPermissionResolutionTests(unittest.IsolatedAsyncioTestCase):
    async def test_general_overrides_cannot_grant_payroll(self):
        import ast
        from pathlib import Path
        from payroll_access import payroll_allowed
        source=Path(__file__).resolve().parents[1]/'permissions.py'
        tree=ast.parse(source.read_text(encoding='utf-8'))
        node=next(n for n in tree.body if isinstance(n,ast.AsyncFunctionDef) and n.name=='can')
        async def overrides(uid):return {'payroll':{'view':True,'edit':True}}
        async def dedicated(user):return {'payroll':{'view':False,'edit':False}}
        ns={'PERMISSIONS_SCHEMA':{'payroll':{'email_supported':False}},'_get_overrides':overrides,'payroll_grants':dedicated,'payroll_allowed':payroll_allowed}
        exec(compile(ast.Module(body=[node],type_ignores=[]),'permissions.py','exec'),ns)
        self.assertFalse(await ns['can']({'id':'other-admin','role':'admin'},'payroll','view'))
        self.assertFalse(await ns['can']({'id':'other-admin','role':'admin'},'payroll','edit'))

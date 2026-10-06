import hashlib
import os
import unittest
from unittest.mock import patch
import test_payroll_api as fixture
import payroll_owner_bootstrap as bootstrap
from payroll_access import is_payroll_owner


class OwnerBootstrapTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {}, clear=True)
        self.env.start()
        self.pin = patch.object(bootstrap, 'OWNER_ACCOUNT_SHA256', hashlib.sha256(b'verified-owner').hexdigest())
        self.pin.start()
        fixture.db.users = fixture.Collection()
        self.owner = {'id': 'verified-owner', 'org_id': 'org-a', 'role': 'admin'}

    def tearDown(self):
        self.pin.stop()
        self.env.stop()

    async def test_exact_existing_account_only(self):
        fixture.db.users.rows = [dict(self.owner), {'id': 'other', 'org_id': 'org-a', 'role': 'admin'}]
        self.assertTrue(await bootstrap.configure_bundled_payroll_owner(fixture.db))
        self.assertTrue(is_payroll_owner(self.owner))
        self.assertFalse(is_payroll_owner(dict(self.owner, id='other')))
        self.assertFalse(is_payroll_owner(dict(self.owner, org_id='org-b')))
        self.assertEqual(len(fixture.db.users.rows), 2)

    async def test_no_first_admin_or_email_fallback(self):
        fixture.db.users.rows = [{'id': 'other', 'org_id': 'org-a', 'role': 'admin', 'email': 'owner@example.test'}]
        self.assertFalse(await bootstrap.configure_bundled_payroll_owner(fixture.db))
        self.assertNotIn('PAYROLL_OWNER_USER_ID', os.environ)

    async def test_worker_and_missing_org_denied(self):
        for row in [dict(self.owner, role='worker'), dict(self.owner, org_id=''), dict(self.owner, org_id=None)]:
            fixture.db.users.rows = [row]
            self.assertFalse(await bootstrap.configure_bundled_payroll_owner(fixture.db))

    async def test_duplicate_account_denied(self):
        fixture.db.users.rows = [dict(self.owner), dict(self.owner, org_id='org-b')]
        self.assertFalse(await bootstrap.configure_bundled_payroll_owner(fixture.db))

    async def test_explicit_and_partial_configuration_preserved(self):
        fixture.db.users.rows = [dict(self.owner)]
        os.environ['PAYROLL_OWNER_USER_ID'] = 'configured-owner'
        self.assertFalse(await bootstrap.configure_bundled_payroll_owner(fixture.db))
        self.assertEqual(os.environ['PAYROLL_OWNER_USER_ID'], 'configured-owner')
        self.assertNotIn('PAYROLL_OWNER_ORG_ID', os.environ)
        os.environ['PAYROLL_OWNER_ORG_ID'] = 'configured-org'
        self.assertFalse(await bootstrap.configure_bundled_payroll_owner(fixture.db))
        self.assertEqual(os.environ['PAYROLL_OWNER_ORG_ID'], 'configured-org')

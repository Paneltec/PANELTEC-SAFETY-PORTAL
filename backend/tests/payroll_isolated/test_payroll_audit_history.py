"""Synthetic-only encrypted before-values and revision guard regression tests."""
import json
import unittest
import test_payroll_api as api

class AuditHistoryTests(unittest.TestCase):
    def setUp(self):
        self.fixture = api.PayrollAPITests()
        self.fixture.setUp()

    def test_profile_change_preserves_previous_ciphertext_without_public_history(self):
        url = '/payroll/employee-records/w1'
        body = {'revision': 0, 'profile': self.fixture.body['rows'][0]['profile'], 'super_member_number': 'TEST-ONLY-MEMBER'}
        self.assertEqual(api.client.put(url, json=body).status_code, 200)
        before = api.db.pay_employee_records.rows[0]['encrypted']
        body['revision'] = 1
        body['profile']['classification'] = 'TEST REVISED CLASSIFICATION'
        response = api.client.put(url, json=body)
        self.assertEqual(response.status_code, 200)
        row = api.db.pay_employee_records.rows[0]
        self.assertEqual(row['audit'][-1]['previous_encrypted'], before)
        self.assertEqual(api.banking.decrypt({'encrypted': before})['profile']['classification'], 'TEST ONLY')
        self.assertNotIn('TEST-ONLY-MEMBER', json.dumps(row))
        self.assertNotIn(before, response.text)
        self.assertNotIn('audit', api.client.get(url).json())
        self.assertEqual(api.client.put(url, json=body).status_code, 409)
        self.assertEqual(len(row['audit']), 2)

    def test_bank_change_retains_history_and_stale_write_adds_nothing(self):
        url = '/payroll/banking/workers/w1'
        body = {'revision': 0, 'account_name': 'SYNTHETIC ONLY', 'bsb': '062000', 'account_number': '00001234', 'verified': True}
        self.assertEqual(api.client.put(url, json=body).status_code, 200)
        before = api.db.pay_bank_details.rows[0]['encrypted']
        body.update(revision=1, account_number='00005678')
        self.assertEqual(api.client.put(url, json=body).status_code, 200)
        row = api.db.pay_bank_details.rows[0]
        self.assertEqual(row['audit'][-1]['previous_encrypted'], before)
        self.assertEqual(api.banking.decrypt({'encrypted': before})['account_number'], '00001234')
        self.assertNotIn('00001234', json.dumps(row))
        response = api.client.get(url)
        self.assertNotIn(before, response.text)
        self.assertNotIn('audit', response.json())
        self.assertEqual(api.client.put(url, json=body).status_code, 409)
        self.assertEqual(len(row['audit']), 2)

import unittest
import test_payroll_api as api

class AwardSummaryTests(unittest.TestCase):
    def setUp(self):
        self.f = api.PayrollAPITests()
        self.f.setUp()

    def test_summary_preserves_award_without_exposing_payroll_details(self):
        profile = {**self.f.body['rows'][0]['profile'], 'classification': 'MA000020 CW3', 'conditions_reviewed': False}
        response = api.client.put('/payroll/employee-records/w1', json={
            'revision': 0, 'profile': profile, 'super_member_number': 'SYNTHETIC123456'})
        self.assertEqual(response.status_code, 200)
        path = '/payroll/employee-records/configuration/awards/employee-summary'
        response = api.client.get(path)
        self.assertEqual(response.status_code, 200)
        row = next(w for w in response.json()['workers'] if w['id'] == 'w1')
        self.assertEqual(row['classification'], 'MA000020 CW3')
        self.assertFalse(row['conditions_reviewed'])
        self.assertNotIn('hourly_rate', response.text)
        self.assertNotIn('SYNTHETIC123456', response.text)
        self.assertNotIn('tax_file_number', response.text)
        self.assertEqual(api.client.get(path, headers={'x-role':'none'}).status_code, 403)
        other = api.client.get(path, headers={'x-org':'org-b'}).json()['workers']
        self.assertEqual([w['id'] for w in other], ['w2'])
        self.assertEqual(other[0]['classification'], '')

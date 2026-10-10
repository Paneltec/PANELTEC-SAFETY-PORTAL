import unittest
from decimal import Decimal
from payroll_engine import weekly_tax, calculate_line, next_payday

class PayrollEngineTests(unittest.TestCase):
    def setUp(self):
        self.profile = dict(hourly_rate=35, employment_type='full_time', conditions_reviewed=True,
            tax_mode='resident_threshold', tax_declaration_reviewed=True, ordinary_weekly_hours=38)
        self.entry = dict(ordinary=38, ot1=2, ot2=1, hours_reviewed=True, qualifying_earnings=1330,
            super_reviewed=True, opening_annual=152, opening_personal=76)
        self.rules = dict(ot1_multiplier=1.5, ot2_multiplier=2, super_percent=12)
    def line(self):
        return calculate_line(self.profile, self.entry, self.rules, '2026-10-15')
    def test_official_schedule_examples(self):
        for earnings, tax in [(116,17),(117,18),(187,28),(188,28),(249,41),(250,41)]:
            self.assertEqual(weekly_tax(earnings,'resident_no_threshold','2026-10-15'),Decimal(tax))
        self.assertEqual(weekly_tax('1333.45','resident_threshold','2026-10-15'),245)
    def test_pay_and_leave(self):
        r=self.line()
        self.assertEqual(r['gross'],1505)
        self.assertEqual(r['super'],159.6)
        self.assertEqual(r['annual_accrued'],2.923077)
        self.assertEqual(r['personal_accrued'],1.461538)
        self.assertEqual(r['annual_closing'],154.923077)
        self.assertTrue(r['review_ready'])
    def test_paid_leave_accrues_but_overtime_does_not(self):
        self.entry.update(ordinary=30.4,annual=7.6,ot1=20,ot2=0)
        r=self.line()
        self.assertEqual(r['annual_accrued'],2.923077)
        self.assertEqual(r['annual_closing'],147.323077)
    def test_casual_no_leave(self):
        self.profile['employment_type']='casual'
        self.assertEqual(self.line()['annual_accrued'],0)
        self.assertEqual(self.line()['personal_accrued'],0)
    def test_missing_data_never_zero_filled(self):
        self.profile['tax_declaration_reviewed']=False
        self.entry.update(qualifying_earnings=None,opening_annual=None)
        r=self.line()
        self.assertIsNone(r['payg']); self.assertIsNone(r['net']); self.assertEqual(r['super'],159.6)
        self.assertIsNone(r['annual_closing']);self.assertFalse(r['review_ready'])
    def test_automatic_super_updates_without_including_overtime(self):
        self.entry.update(qualifying_earnings=None,super_reviewed=False)
        self.assertEqual(self.line()['super'],159.6)
        self.assertFalse(self.line()['review_ready'])
        self.entry.update(ordinary=30,annual=8,ot1=20)
        self.assertEqual(self.line()['super'],159.6)
        self.entry.update(ordinary=20)
        self.assertEqual(self.line()['super'],117.6)

    def test_allowances_need_super_treatment(self):
        self.entry.update(qualifying_earnings=None,taxable_allowances=25)
        self.assertIsNone(self.line()['super'])
        self.entry['qualifying_earnings']=1355
        self.assertEqual(self.line()['super'],162.6)

    def test_zero_override_preserved(self):
        self.entry.update(ordinary=10,qualifying_earnings=0)
        self.assertEqual(self.line()['super'],0)
        self.assertEqual(self.line()['super_mode'],'manual')

    def test_mixed_penalty_hours_not_guessed(self):
        self.entry.update(qualifying_earnings=None,night=4,holiday_work=4,penalty_ordinary=4)
        self.assertIsNone(self.line()['super'])

    def test_earning_rules_use_rate_multiplier_and_treatment(self):
        self.entry.update(qualifying_earnings=None,earning_units={'bonus':2,'extra':3})
        self.rules['earning_rules']=[dict(code='bonus',name='Bonus',basis='fixed_rate',rate=10,multiplier=1,taxable=False,superable=False),dict(code='extra',name='Extra',basis='base_rate',rate=0,multiplier=2,taxable=True,superable=True)]
        r=self.line()
        self.assertEqual(r['other_earnings'],230)
        self.assertEqual(r['gross'],1735)
        self.assertEqual(r['super'],184.8)
        self.assertEqual(r['payg'],float(weekly_tax(1715,'resident_threshold','2026-10-15')))
        self.assertEqual(r['earning_lines'][1]['unit_rate'],70)

    def test_unconfigured_earning_treatment_rejected(self):
        self.entry['earning_units']={'extra':1}
        with self.assertRaises(ValueError):self.line()
        self.rules['earning_rules']=[dict(code='extra',name='Extra',basis='fixed_rate',rate=10,multiplier=1,taxable=None,superable=None)]
        with self.assertRaises(ValueError):self.line()

    def test_manual_needs_evidence(self):
        self.profile['tax_mode']='manual';self.entry['manual_payg']=300
        self.assertIsNone(self.line()['payg'])
        self.entry['payg_reference']='Reviewed external calculation'
        self.assertEqual(self.line()['payg'],300)
    def test_manual_tax_still_requires_reviewed_declaration(self):
        self.profile.update(tax_mode='manual', tax_declaration_reviewed=False)
        self.entry.update(manual_payg=300, payg_reference='Reviewed external calculation')
        result=self.line()
        self.assertIsNone(result['payg'])
        self.assertIsNone(result['net'])
        self.assertFalse(result['review_ready'])

    def test_configured_leave_loading_is_paid(self):
        self.profile['leave_loading_percent']=17.5
        self.entry.update(ordinary=30.4, annual=7.6, ot1=0, ot2=0)
        self.assertEqual(self.line()['leave_loading'],46.55)

    def test_invalid_year(self):
        with self.assertRaises(ValueError): weekly_tax(1000,'resident_threshold','2027-07-01')
    def test_excess_hours(self):
        self.entry['ordinary']=169
        with self.assertRaises(ValueError): self.line()
    def test_payday(self):
        self.assertEqual(next_payday('2026-10-05'),'2026-10-15')
        self.assertEqual(next_payday('2026-10-02'),'2026-10-08')
        with self.assertRaises(ValueError):next_payday('invalid')
    def test_seventy_workers(self):
        rows=[self.line() for _ in range(70)]
        self.assertEqual(sum(Decimal(str(r['gross'])) for r in rows),105350)
        self.assertEqual(sum(Decimal(str(r['super'])) for r in rows),11172)

if __name__ == '__main__': unittest.main()

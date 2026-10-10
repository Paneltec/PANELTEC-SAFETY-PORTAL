import unittest
import test_payroll_api as api
from payroll_shift_rules import calculate_shifts
from payroll_engine import calculate_line
from payroll_workbench import Rules,Profile,Entry
from payroll_fund_lookup import parse_register,match

def shift(start='07:00',finish='17:00',**kw):return {**dict(date='2026-10-05',start=start,finish=finish,break_minutes=0),**kw}
class ShiftRulesTests(unittest.TestCase):
 def calc(self,*s):return calculate_shifts(s,{})
 def test_custom_time_window_and_weekend_rates(self):
  rules=Rules(night_start='19:00',night_end='05:00',night_multiplier=1.75,saturday_multiplier=1.8,sunday_multiplier=2.5).model_dump()
  r=calculate_shifts([shift('18:00','20:00')],rules,separate_weekends=True)
  self.assertEqual(r['ordinary'],1);self.assertEqual(r['night'],1)
  profile=Profile(hourly_rate=40).model_dump()
  result=calculate_line(profile,Entry(**r).model_dump(),rules,'2026-10-08')
  self.assertEqual(result['night_pay'],70)
  r=calculate_shifts([shift('08:00','10:00',date='2026-10-11')],rules,separate_weekends=True)
  result=calculate_line(profile,Entry(**r).model_dump(),rules,'2026-10-15')
  self.assertEqual(result['sunday_pay'],200);self.assertEqual(result['ot2_pay'],0)
 def test_custom_overtime_duration_and_invalid_window(self):
  r=calculate_shifts([shift('07:00','17:00')],Rules(daily_ordinary_hours=8,ot1_hours=1).model_dump())
  self.assertEqual(r['ordinary'],8);self.assertEqual(r['ot1'],1);self.assertEqual(r['ot2'],1)
  with self.assertRaises(ValueError):Rules(night_start='18:00',night_end='18:00')
  r=calculate_shifts([shift('17:00','19:00')],Rules(night_start='17:30',night_end='19:00').model_dump())
  self.assertEqual(r['night'],1.5)
 def test_daily_tiers(self):
  r=self.calc(shift());self.assertAlmostEqual(r['ordinary'],7.6);self.assertAlmostEqual(r['ot1'],2);self.assertAlmostEqual(r['ot2'],.4);self.assertEqual(r['meal_count'],1)
 def test_meal_boundaries(self):
  for finish,count in [('16:59',0),('17:00',1),('20:59',1),('21:00',2)]:self.assertEqual(self.calc(shift(finish=finish))['meal_count'],count)
  self.assertEqual(self.calc(shift(finish='17:00',break_minutes=30,break_start='12:00'))['meal_count'],0)
 def test_night_boundaries(self):
  r=self.calc(shift('05:00','07:00'));self.assertEqual(r['night'],1);self.assertEqual(r['ordinary'],1)
  r=self.calc(shift('17:00','19:00'));self.assertEqual(r['night'],1);self.assertEqual(r['ordinary'],1)
 def test_replacement_night(self):
  r=self.calc(shift('18:00','02:00',next_day=True,replacement_day_shift=True));self.assertEqual(r['night'],8);self.assertAlmostEqual(r['penalty_ordinary'],7.6)
  r2=self.calc(shift('18:00','02:00',next_day=True));self.assertEqual(r2['penalty_ordinary'],0)
  p=Profile(hourly_rate=30,employment_type='full_time').model_dump();e=Entry(**r).model_dump();out=calculate_line(p,e,Rules().model_dump(),'2026-10-08');self.assertEqual(out['night_pay'],480);self.assertAlmostEqual(out['annual_accrued'],7.6*4/52,places=6)
 def test_friday_night_continues_double_after_midnight(self):
  r=self.calc(shift("18:00","02:00",date="2026-10-02",next_day=True,replacement_day_shift=True));self.assertEqual(r["night"],8);self.assertEqual(r["ot1"],0)
 def test_holiday_no_stacking(self):
  r=self.calc(shift('18:00','02:00',next_day=True,public_holiday=True));self.assertEqual(r['holiday_work'],8);self.assertEqual(r['night'],0)
  out=calculate_line(Profile(hourly_rate=30).model_dump(),Entry(**r).model_dump(),Rules().model_dump(),'2026-10-08');self.assertEqual(out['holiday_work_pay'],600)
 def test_multiple_clients_one_daily_threshold(self):
  r=self.calc(shift('07:00','12:00'),shift('12:00','17:00'));self.assertEqual(r['meal_count'],1);self.assertAlmostEqual(r['ordinary'],7.6)
 def test_invalid_and_ambiguous_times(self):
  for s in [shift('18:00','02:00'),shift('17:00','20:00',break_minutes=30),shift(break_minutes=30,break_start='20:00')]:
   with self.assertRaises(ValueError):self.calc(s)
  with self.assertRaises(ValueError):self.calc(shift(),shift())
 def test_meal_amount_and_history_defaults(self):
  p=Profile(hourly_rate=30).model_dump();e=Entry(meal_count=2).model_dump();r=Rules(meal_allowance=20).model_dump()
  self.assertEqual(calculate_line(p,e,r,'2026-10-08')['meal_allowance_pay'],40)
  self.assertTrue(any('meal allowance amount' in x for x in calculate_line(p,e,Rules().model_dump(),'2026-10-08')['issues']))
 def test_api_ignores_tampered_buckets(self):
  f=api.PayrollAPITests();f.setUp();body=f.body if hasattr(f,'body') else None
  # Domain result must come from shifts, not submitted bucket values.
  from payroll_workbench import Worksheet,Row,Shift,report
  row=Row(worker_id='w1',shifts=[Shift(**shift())],entry=Entry(ordinary=100))
  result=report(Worksheet(payday='2026-10-08',rows=[row]),{'w1':'Example'})
  self.assertAlmostEqual(result['rows'][0]['entry']['ordinary'],7.6)
class FundTests(unittest.TestCase):
 def test_register_match_and_mismatch(self):
  line='12345678901'.ljust(12)+'Example Super'.ljust(201)+'EXAMPLE001'.ljust(21)+'Example Product'.ljust(201)+'N'.ljust(25)+'01/01/2020'.ljust(11)+''.ljust(11)
  rows=parse_register(line);self.assertEqual(match(rows,'example001','Example Super')['status'],'matched');self.assertEqual(match(rows,'EXAMPLE001','Other')['status'],'name_mismatch');self.assertEqual(match(rows,'BAD','Example Super')['status'],'not_found')
 def test_lookup_permission_and_failure(self):
  from unittest.mock import AsyncMock,patch
  with patch('payroll_fund_lookup.lookup',new=AsyncMock(return_value={'status':'matched','matches':[]})):
   self.assertEqual(api.client.post('/payroll/employee-records/fund/check',json={'usi':'EXAMPLE001','fund_name':'Example'},headers={'x-role':'none'}).status_code,403)
   self.assertEqual(api.client.post('/payroll/employee-records/fund/check',json={'usi':'EXAMPLE001','fund_name':'Example'}).json()['status'],'matched')
 def test_bad_response_not_verified(self):
  with self.assertRaises(ValueError):parse_register('<html>unavailable</html>')
if __name__=='__main__':unittest.main()

"""Pure-function tests for Paneltec Pay (no DB)."""
import os, sys
from datetime import date
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_payroll")
from payroll import period_for, periods_between, hours_between, split_overtime, PaySettings  # noqa: E402

S = PaySettings().model_dump()  # weekly, Monday start


def test_weekly_period_monday_start():
    p = period_for(date(2026, 9, 30), S)   # a Wednesday
    assert (p["start"], p["end"]) == ("2026-09-28", "2026-10-04")
    assert period_for(date(2026, 9, 28), S)["start"] == "2026-09-28"
    assert period_for(date(2026, 10, 4), S)["start"] == "2026-09-28"


def test_weekly_period_other_start_day():
    s = {**S, "week_starts": "wednesday"}
    assert period_for(date(2026, 9, 30), s)["start"] == "2026-09-30"
    assert period_for(date(2026, 9, 29), s)["start"] == "2026-09-23"


def test_fortnightly_uses_anchor():
    s = {**S, "period_type": "fortnightly", "period_anchor": "2026-09-21"}
    assert (period_for(date(2026, 9, 30), s)["start"], period_for(date(2026, 9, 30), s)["end"]) == ("2026-09-21", "2026-10-04")
    assert period_for(date(2026, 10, 5), s)["start"] == "2026-10-05"
    assert period_for(date(2026, 10, 18), s)["start"] == "2026-10-05"


def test_periods_between_is_contiguous():
    ps = periods_between(date(2026, 9, 1), date(2026, 9, 30), S)
    assert ps[0]["start"] == "2026-08-31" and ps[-1]["start"] == "2026-09-28"
    for a, b in zip(ps, ps[1:]):
        assert date.fromisoformat(a["end"]).toordinal() + 1 == date.fromisoformat(b["start"]).toordinal()


def test_hours_between():
    assert hours_between("07:00", "15:36", 30) == 8.1
    assert hours_between("07:00", "15:36", 0) == 8.6
    assert hours_between("22:00", "02:00", 0) == 4.0     # over midnight
    assert hours_between(None, "15:00", 30) == 0.0
    assert hours_between("08:00", "08:10", 30) == 0.0    # never negative


def test_overtime_split_weekday():
    r = S["overtime"]
    assert split_overtime(7.6, date(2026, 9, 30), r) == {"ordinary": 7.6, "ot_1": 0.0, "ot_2": 0.0}
    assert split_overtime(9.0, date(2026, 9, 30), r) == {"ordinary": 7.6, "ot_1": 1.4, "ot_2": 0.0}
    assert split_overtime(11.0, date(2026, 9, 30), r) == {"ordinary": 7.6, "ot_1": 2.0, "ot_2": 1.4}


def test_overtime_split_weekend():
    r = S["overtime"]
    assert split_overtime(6, date(2026, 10, 3), r) == {"ordinary": 0.0, "ot_1": 6.0, "ot_2": 0.0}   # Saturday
    assert split_overtime(6, date(2026, 10, 4), r) == {"ordinary": 0.0, "ot_1": 0.0, "ot_2": 6.0}   # Sunday


def test_lines_roll_up_into_day():
    import payroll
    settings = {"period_type": "weekly", "week_starts": "monday", "period_anchor": None,
                "overtime": {"daily_ordinary_hours": 7.6, "first_tier_hours": 2, "first_tier_rate": 1.5,
                             "second_tier_rate": 2, "saturday_rate": 1.5, "sunday_rate": 2}}
    e = {"date": "2026-10-07", "kind": "work", "lines": [
        {"client_name": "Hydro Tas", "job_ref": "1203", "start": "12:30", "finish": "15:30", "break_minutes": 0},
        {"client_name": "City of Launceston", "start": "07:00", "finish": "12:00", "break_minutes": 30},
    ]}
    payroll._compute(e, settings)
    assert e["start"] == "07:00" and e["finish"] == "15:30"
    assert e["break_minutes"] == 30
    assert e["hours"] == 7.5
    assert e["lines"][0]["client_name"] == "City of Launceston"
    assert e["site_name"] == "City of Launceston · Hydro Tas"
    assert e["job_ref"] == "1203"

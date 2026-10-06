"""Pure-function tests for Paneltec Pay (no DB)."""
import os, sys
import pytest
from fastapi import HTTPException
from datetime import date
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_payroll")
from payroll import period_for, periods_between, hours_between, split_overtime, PaySettings  # noqa: E402

S = PaySettings(week_starts="monday").model_dump()  # legacy configured Monday start


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
    with pytest.raises(HTTPException):
        hours_between("08:00", "08:10", 30)  # impossible break must not become silent zero pay


def test_overtime_split_weekday():
    r = S["overtime"]
    assert split_overtime(7.6, date(2026, 9, 30), r) == {"ordinary": 7.6, "ot_1": 0.0, "ot_2": 0.0}
    assert split_overtime(9.0, date(2026, 9, 30), r) == {"ordinary": 7.6, "ot_1": 1.4, "ot_2": 0.0}
    assert split_overtime(11.0, date(2026, 9, 30), r) == {"ordinary": 7.6, "ot_1": 2.0, "ot_2": 1.4}


def test_overtime_split_weekend():
    r = S["overtime"]
    assert split_overtime(6, date(2026, 10, 3), r) == {"ordinary": 0.0, "ot_1": 6.0, "ot_2": 0.0}   # Saturday
    assert split_overtime(6, date(2026, 10, 4), r) == {"ordinary": 0.0, "ot_1": 0.0, "ot_2": 6.0}   # Sunday


def test_friday_default_and_thursday_boundary():
    settings = PaySettings().model_dump()
    assert settings["week_starts"] == "friday"
    assert period_for(date(2026, 10, 8), settings) == {"id":"2026-10-02","start":"2026-10-02","end":"2026-10-08"}
    assert period_for(date(2026, 10, 9), settings)["start"] == "2026-10-09"

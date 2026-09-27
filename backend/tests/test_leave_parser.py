"""Unit tests for the payroll leave-email parser (no DB needed)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_leave_parser")

from leave_requests import parse_leave_email  # noqa: E402

SAMPLE_TEXT = """Leave Request Updated
A leave request for Jason Donnellan has been updated. They have applied for 38 hours of Annual Leave from 12/01/2026 to 16/01/2026.

On top of Paneltec planned Christmas Holidays.

They are estimated to have 137.66 hours of Annual Leave available on 12/01/2026.

To approve or reject this request, Review the request online

Regards,
The Paneltec Pty Ltd Team.

To configure your email notifications, click here

Request Id
JGV2MiRNREkzTVVaWGJtRmFSekUzVGs4eE1rOVZhVFZCU1ZndmNsZHFhMmhtZWpScWEyUkdaRlJDY1V0VFl6MD0="""

SAMPLE_HTML = (
    "<h1>Leave Request Approved</h1><p>A leave request for Mia Brown has been approved. "
    "They have applied for 7.6 hours of Personal/Carer's Leave from 03/02/2026 to 03/02/2026.</p>"
    "<p>They are estimated to have 20 hours of Personal/Carer's Leave available on 03/02/2026.</p>"
    "<p>Request Id</p><p>ABCDEFGHIJKLMNOP1234=</p>"
)


def test_parses_plain_text_sample():
    p = parse_leave_email("Leave Request Updated", SAMPLE_TEXT)
    assert p["employee_name"] == "Jason Donnellan"
    assert p["event"] == "updated"
    assert p["hours"] == 38
    assert p["leave_type"] == "Annual Leave"
    assert p["category"] == "annual"
    assert p["start_date"] == "2026-01-12"
    assert p["end_date"] == "2026-01-16"
    assert p["employee_note"] == "On top of Paneltec planned Christmas Holidays"
    assert p["balance_hours"] == 137.66
    assert p["payroll_request_id"].startswith("JGV2MiRNREkz")


def test_parses_html_and_approved_subject():
    p = parse_leave_email("Leave Request Approved", SAMPLE_HTML)
    assert p["employee_name"] == "Mia Brown"
    assert p["event"] == "approved"
    assert p["category"] == "sick"
    assert p["hours"] == 7.6
    assert p["employee_note"] is None
    assert p["payroll_request_id"] == "ABCDEFGHIJKLMNOP1234="


def test_ignores_unrelated_email():
    assert parse_leave_email("Invoice", "Please find attached invoice 123.") is None

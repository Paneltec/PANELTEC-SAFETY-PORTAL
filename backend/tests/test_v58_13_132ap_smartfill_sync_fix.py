"""v58.13.132ap — SmartFill sync row-rejection fix.

Two root-cause bugs closed:

  1. `columnar_to_rows` looked only for `values` key but the
     SmartFill Transactions:Read API returns rows under `data`.
     Old shape returned 1 wrapper dict; now returns N parsed rows.

  2. `_parse_date` / `_parse_time` didn't cover the SmartFill
     `16 May 2025` / `2:30pm` formats — every row failed the
     `Missing/invalid date/time/litres` gate. Added the day-month-
     year formats and case-insensitive am/pm handling.
"""
from __future__ import annotations
import pytest

from integrations_smartfill import columnar_to_rows
from fleet_fuel import _parse_date, _parse_time


def test_columnar_to_rows_accepts_data_key():
    """SmartFill API changed shape — `data` key must parse rows."""
    result = {
        "columns": ["Date", "Time", "Litres"],
        "data": [
            ["16 May 2025", "2:30pm", "44.79"],
            ["16 May 2025", "2:35pm", "0.00"],
        ],
    }
    rows = columnar_to_rows(result)
    assert len(rows) == 2
    assert rows[0]["Date"] == "16 May 2025"
    assert rows[0]["Time"] == "2:30pm"
    assert rows[0]["Litres"] == "44.79"


def test_columnar_to_rows_still_accepts_values_key():
    """Back-compat — Tank:Level etc. still use `values`."""
    result = {
        "columns": ["Unit Number", "Volume"],
        "values": [["T-01", "3421"]],
    }
    rows = columnar_to_rows(result)
    assert rows == [{"Unit Number": "T-01", "Volume": "3421"}]


def test_parse_smartfill_date_formats():
    """SmartFill emits `16 May 2025` and `03 September 2026`."""
    assert _parse_date("16 May 2025") == "2025-05-16"
    assert _parse_date("03 September 2026") == "2026-09-03"
    # Existing CSV formats still parse.
    assert _parse_date("2026-09-08") == "2026-09-08"
    assert _parse_date("08/09/2026") == "2026-09-08"
    # Junk still returns None.
    assert _parse_date("not-a-date") is None
    assert _parse_date("") is None


def test_parse_smartfill_time_formats():
    """SmartFill emits `2:30pm` (no space, lower-case am/pm)."""
    assert _parse_time("2:30pm") == "14:30:00"
    assert _parse_time("10:07am") == "10:07:00"
    assert _parse_time("12:00pm") == "12:00:00"
    assert _parse_time("12:00am") == "00:00:00"
    # Existing CSV formats still parse.
    assert _parse_time("14:30:00") == "14:30:00"
    assert _parse_time("2:30 PM") == "14:30:00"
    # Junk still returns None.
    assert _parse_time("gibberish") is None
    assert _parse_time("") is None

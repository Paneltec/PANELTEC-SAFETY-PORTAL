"""v58.13.0-a — Periodic Task Template schema on ScheduleIn.

Pure pydantic + pure-function tests. No HTTP, no DB writes. Confirms:

  1. ScheduleIn accepts the 5 new user-facing fields with correct enums.
  2. ScheduleIn accepts `status="archived"` (v58.12.6 enum extension).
  3. `_sanitize_description_html` strips <script> + event handlers.
  4. `_sanitize_description_html` preserves allowed tags (<p>, <a href>).
  5. Legacy schedules parse cleanly with all 5 new fields absent.
"""
from __future__ import annotations

import asset_service
from asset_service import ScheduleIn, _sanitize_description_html


def test_schedule_in_new_fields_round_trip():
    s = ScheduleIn(
        name="6MO / 10,000km",
        interval_kind="km",
        interval_value=10_000,
        priority="High",
        task_type="Maintenance",
        task_identification="Holden Ute : 6MO / 10,000KM Service",
        description_html="<p>Do the thing.</p>",
        assigned_to_position="Plumber",
    )
    d = s.model_dump()
    assert d["priority"] == "High"
    assert d["task_type"] == "Maintenance"
    assert d["task_identification"] == "Holden Ute : 6MO / 10,000KM Service"
    assert d["description_html"] == "<p>Do the thing.</p>"
    assert d["assigned_to_position"] == "Plumber"


def test_schedule_in_status_enum_extended_to_archived():
    s = ScheduleIn(name="X", interval_kind="hours", interval_value=250, status="archived")
    assert s.model_dump()["status"] == "archived"


def test_schedule_in_legacy_no_new_fields():
    """Legacy parse: all 5 new fields default to None (or [] for lists)."""
    s = ScheduleIn(name="Old", interval_kind="hours", interval_value=250)
    d = s.model_dump()
    for k in ("priority", "task_type", "task_identification",
              "description_html", "assigned_to_position"):
        assert d[k] is None, f"{k} did not default to None"


def test_sanitize_html_strips_script_and_event_handlers():
    hostile = '<p onclick="alert(1)">Hi</p><script>steal()</script><img src="x">'
    out = _sanitize_description_html(hostile)
    assert "<script>" not in out
    assert "onclick" not in out
    assert "<img" not in out    # img not in allowlist
    assert "Hi" in out           # text content preserved


def test_sanitize_html_preserves_allowed():
    v = '<p><b>Hello</b> <a href="https://example.com" title="ex">link</a></p>'
    out = _sanitize_description_html(v)
    assert "<p>" in out
    assert "<b>Hello</b>" in out
    assert 'href="https://example.com"' in out


def test_sanitize_html_none_passthrough():
    assert _sanitize_description_html(None) is None
    assert _sanitize_description_html("") == ""


def test_priority_and_task_type_enums_reject_invalid():
    """Pydantic Literal enums reject unknown values."""
    import pytest
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        ScheduleIn(name="X", interval_kind="hours", interval_value=250, priority="Extreme")
    with pytest.raises(ValidationError):
        ScheduleIn(name="X", interval_kind="hours", interval_value=250, task_type="Cleanup")


def test_create_schedule_auto_stamp_contract():
    """Verify the create_schedule handler's auto-stamp pattern via
    source inspection — guards against a future edit reverting the stamps."""
    import inspect
    src = inspect.getsource(asset_service.create_schedule)
    assert '"entered_by_user_id": user["id"]' in src
    assert '"entered_by_name":' in src
    # Sanitiser wired into the create path.
    assert "_sanitize_description_html(payload.get(\"description_html\"))" in src


def test_update_schedule_preserves_entered_by():
    """Verify the update_schedule handler preserves the original
    entered_by_* stamps from the existing doc (does NOT re-stamp)."""
    import inspect
    src = inspect.getsource(asset_service.update_schedule)
    assert 'merged["entered_by_user_id"] = existing.get("entered_by_user_id")' in src
    assert 'merged["entered_by_name"] = existing.get("entered_by_name")' in src

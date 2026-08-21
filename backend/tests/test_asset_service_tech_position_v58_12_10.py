"""v58.12.8 (shipped v58.12.10) — Technician-position field on service records.

Pure pydantic-model tests. No HTTP, no DB — bypasses the live-DB guard
entirely and proves the schema-level semantic contract:

  1. `RecordIn.technician_position` round-trips via `.dict()` / `.model_dump()`
     when supplied AND when omitted (defaults to None, preserving legacy
     records that pre-date v58.12.10).
  2. `RecordPatch(technician_position=None).model_dump(exclude_unset=True)`
     surfaces the None so `update_record`'s "keep if None" whitelist can
     $set the clear — matches the pre-existing semantic for
     `technician_name` and `technician_id`.
"""
from __future__ import annotations

from asset_service import RecordIn, RecordPatch


def test_record_in_technician_position_round_trip():
    """v58.12.10 — RecordIn accepts + surfaces the new field."""
    rec = RecordIn(
        type="service",
        title="Service performed",
        technician_name="John Smith",
        technician_id="wkr-abc",
        technician_position="Plumber",
    )
    payload = rec.model_dump()
    assert payload["technician_position"] == "Plumber"
    assert payload["technician_name"] == "John Smith"
    assert payload["technician_id"] == "wkr-abc"


def test_record_in_technician_position_defaults_none_when_omitted():
    """v58.12.10 — Legacy records without the field parse cleanly as None."""
    rec = RecordIn(
        type="service",
        title="Service performed",
        technician_name="Legacy Tech",
    )
    payload = rec.model_dump()
    # Field must be present in the dump with a None value so downstream
    # code can distinguish "not supplied" from "cleared" via exclude_unset.
    assert "technician_position" in payload
    assert payload["technician_position"] is None


def test_record_patch_technician_position_clear_via_none():
    """v58.12.10 — PATCH-clear semantic: explicit None must survive
    `.model_dump(exclude_unset=True)` so the `update_record` "keep if
    None" whitelist can $set the field to null. This is the same pattern
    used pre-v58.12.10 for `technician_name` / `technician_id`."""
    patch = RecordPatch(technician_position=None)
    dumped = patch.model_dump(exclude_unset=True)
    assert "technician_position" in dumped
    assert dumped["technician_position"] is None
    # Sanity — untouched fields do NOT appear (proves exclude_unset works).
    assert "technician_name" not in dumped
    assert "technician_id" not in dumped
    assert "cost" not in dumped


def test_record_patch_technician_position_set_to_value():
    """v58.12.10 — PATCH-set surfaces the string via exclude_unset."""
    patch = RecordPatch(technician_position="Site Supervisor")
    dumped = patch.model_dump(exclude_unset=True)
    assert dumped == {"technician_position": "Site Supervisor"}


def test_record_patch_technician_position_omitted_stays_out_of_dump():
    """v58.12.10 — Untouched field never leaks into the $set payload."""
    patch = RecordPatch(title="Renamed only")
    dumped = patch.model_dump(exclude_unset=True)
    assert "technician_position" not in dumped
    assert dumped == {"title": "Renamed only"}

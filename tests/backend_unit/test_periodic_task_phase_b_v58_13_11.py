"""v58.13.11 — Periodic Task Template Phase B pytests.

Pure Pydantic-schema + helper checks — no HTTP, no live DB writes. The
create_schedule / update_schedule handlers in `asset_service.py`
already forward every model field through `**payload`, so the schema
contract is sufficient to prove Phase B fields land on the persisted
document (integration coverage lives in the existing manual sequence,
this suite guards the schema shape).

Scope guarded here:
    · Every Phase B field parses when explicitly provided.
    · Every Phase B field defaults to None when omitted — proves
      backward compatibility with legacy schedules.
    · Field length constraints on the free-text columns.
    · Position-filter contract on the `/workers/directory` payload
      shape (the client-side filter in AssetServiceTabs relies on
      `position` being present on every row) — protects the Phase B
      "assigned_to_worker filtered by assigned_to_position" flow.

Location rationale: `/app/tests/backend_unit/` sits OUTSIDE the
`--reload-dir /app/backend` watched path, so adding this file does
NOT cause a uvicorn reload storm (the mistake that orphaned bulk
import job `4f395643-…` during the v58.13.10 ship — see
frontend/src/lib/version.js v58.13.10 changelog).
"""
from __future__ import annotations

import pytest

from asset_service import ScheduleIn


# ─── Fixtures ─────────────────────────────────────────────────────────

def _base_valid_kwargs():
    """Minimum-viable-payload — every non-Phase-B field satisfied.
    Phase B fields are layered on per test."""
    return {
        "name": "Fortnightly grease-nipple check",
        "interval_kind": "calendar",
        "interval_value": 14,
        "calendar_unit": "days",
    }


# ─── Positive: every Phase B field parses ─────────────────────────────

def test_all_phase_b_fields_parse():
    s = ScheduleIn(
        **_base_valid_kwargs(),
        phone="0400 123 456",
        reported_by_contact="Site Supervisor · shed 4",
        project_id="PT-2026-A17",
        assigned_to_worker_id="w-uuid-abc-123",
        assigned_to_worker_name="Alice Zhang",
        notes="Ladder access required; contact site before 08:00.",
        attachments=[
            {"name": "photo.jpg", "mime": "image/jpeg", "size": 1024, "description": ""},
        ],
    )
    d = s.model_dump()
    assert d["phone"] == "0400 123 456"
    assert d["reported_by_contact"] == "Site Supervisor · shed 4"
    assert d["project_id"] == "PT-2026-A17"
    assert d["assigned_to_worker_id"] == "w-uuid-abc-123"
    assert d["assigned_to_worker_name"] == "Alice Zhang"
    assert d["notes"].startswith("Ladder access")
    assert d["attachments"] and d["attachments"][0]["name"] == "photo.jpg"


# ─── Backward compat: omitting every Phase B field still parses ───────

def test_phase_b_fields_all_optional():
    s = ScheduleIn(**_base_valid_kwargs())
    d = s.model_dump()
    # Every Phase B field must default to None so legacy documents
    # already in `asset_service_schedules` continue to parse cleanly
    # on GET / PUT round-trip.
    for k in (
        "phone", "reported_by_contact", "project_id",
        "assigned_to_worker_id", "assigned_to_worker_name",
        "notes", "attachments",
    ):
        assert d[k] is None, f"{k} default must be None (got {d[k]!r})"


def test_phase_a_fields_still_parse_alongside_phase_b():
    # Phase A + Phase B on the same doc must both survive the model
    # boundary.
    s = ScheduleIn(
        **_base_valid_kwargs(),
        priority="High",
        task_type="Service",
        task_identification="Holden Ute : 6MO / 10,000KM Service",
        description_html="<p>Full service checklist per handbook §4.2.</p>",
        assigned_to_position="Mechanic",
        phone="0400 111 222",
        assigned_to_worker_id="w-42",
        assigned_to_worker_name="Bob Singh",
        notes="Waiting for parts delivery Fri.",
    )
    d = s.model_dump()
    # Phase A intact
    assert d["priority"] == "High"
    assert d["task_type"] == "Service"
    assert d["assigned_to_position"] == "Mechanic"
    # Phase B intact
    assert d["phone"] == "0400 111 222"
    assert d["assigned_to_worker_name"] == "Bob Singh"
    assert d["notes"].startswith("Waiting")


# ─── Length constraints ───────────────────────────────────────────────

def test_phone_max_length_enforced():
    # `phone` is deliberately a loose string — codebase does not
    # enforce E.164. Only the length cap (64) is defensive.
    with pytest.raises(Exception):
        ScheduleIn(**_base_valid_kwargs(), phone="0" * 65)


def test_notes_length_cap_generous():
    # 10 000 chars must still parse; 10 001 must reject.
    ScheduleIn(**_base_valid_kwargs(), notes="x" * 10_000)
    with pytest.raises(Exception):
        ScheduleIn(**_base_valid_kwargs(), notes="x" * 10_001)


def test_project_id_free_text_accepts_dashes_and_spaces():
    # v58.13.0-b spec: project_id is free-text (NOT a dropdown, NOT a
    # UUID). Guard against a future "tighten this to alphanumeric-only"
    # regression that would break historical project codes.
    for pid in ("PT-2026-A17", "T4 · Depot 2", "north/south splice-01"):
        s = ScheduleIn(**_base_valid_kwargs(), project_id=pid)
        assert s.model_dump()["project_id"] == pid


# ─── Position-filter contract on /workers/directory payload ───────────

def test_workers_directory_row_shape_supports_position_filter():
    # The FE's `filteredAssignWorkers` memo in AssetServiceTabs
    # filters by `t.position === form.assigned_to_position`. This test
    # locks the contract: every row projected by `list_workers_directory`
    # must carry a `position` key (blank string when absent, never
    # missing). Reads only the source — no HTTP, no DB.
    import inspect

    import workers as workers_mod
    src = inspect.getsource(workers_mod)
    # The projection block that shipped in v58.12.8 / v58.12.10 must
    # still be there. If someone drops `position` from the projection
    # or renames it, the client-side Phase B filter silently returns
    # zero workers — regression this test catches.
    assert '"position": r.get("position") or ""' in src, (
        "workers_directory must project `position` on every row — "
        "the Phase B assigned_to_worker filter depends on it."
    )

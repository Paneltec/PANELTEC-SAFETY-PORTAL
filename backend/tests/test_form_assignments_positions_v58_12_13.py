"""v58.12.13 — Simpro-position gate on form templates.

Pure pydantic-model tests + filter-arithmetic contract test. No HTTP,
no live DB. Confirms:

  1. `TemplateIn.assigned_positions` round-trips (create path).
  2. `TemplatePatch.assigned_positions` round-trips (patch path).
  3. `AppliesToIn.assigned_positions` accepts + defaults to [] (the
     admin PUT/bulk endpoint that FormAssignmentsAdmin.jsx hits).
  4. OR-gate filter contract: template is visible when
     `template.id in role_allowlist` OR
     `caller_position in template.assigned_positions`.
"""
from __future__ import annotations

from asset_service import AppliesToIn
from forms import TemplateIn, TemplatePatch


def test_template_in_assigned_positions_round_trip():
    """v58.12.13 — TemplateIn accepts + preserves the new field."""
    t = TemplateIn(
        name="Drug & Alcohol Test Record",
        category="admin",
        assigned_positions=["Plumber", "Site Supervisor"],
    )
    payload = t.model_dump()
    assert payload["assigned_positions"] == ["Plumber", "Site Supervisor"]


def test_template_in_assigned_positions_defaults_empty():
    """v58.12.13 — Legacy templates parse cleanly with the field absent
    and default to [] so the OR-gate short-circuits harmlessly."""
    t = TemplateIn(name="Old Template", category="general")
    payload = t.model_dump()
    assert "assigned_positions" in payload
    assert payload["assigned_positions"] == []


def test_template_patch_assigned_positions_optional():
    """v58.12.13 — PATCH omits vs clears vs sets."""
    # Omitted → not in exclude_unset dump.
    p = TemplatePatch(name="Renamed")
    dumped = p.model_dump(exclude_unset=True)
    assert "assigned_positions" not in dumped

    # Cleared (empty list) → present with [].
    p = TemplatePatch(assigned_positions=[])
    dumped = p.model_dump(exclude_unset=True)
    assert dumped == {"assigned_positions": []}

    # Set → present with values.
    p = TemplatePatch(assigned_positions=["Plumber"])
    dumped = p.model_dump(exclude_unset=True)
    assert dumped == {"assigned_positions": ["Plumber"]}


def test_applies_to_in_assigned_positions_defaults_and_accepts():
    """v58.12.13 — AppliesToIn (the FormAssignmentsAdmin PUT payload)
    accepts assigned_positions and defaults to []."""
    a = AppliesToIn()   # no fields
    d = a.model_dump()
    assert d["assigned_positions"] == []

    a2 = AppliesToIn(assigned_positions=["Plumber", "Technician"])
    d2 = a2.model_dump()
    assert d2["assigned_positions"] == ["Plumber", "Technician"]


# ─── OR-gate filter arithmetic ─────────────────────────────────────────

def _filter(rows: list[dict], allowed: set[str], caller_position: str | None) -> list[dict]:
    """Mirror of the v58.12.13 OR-gate list comprehension in
    forms.py::list_templates. Kept here so we can pin the contract
    without invoking the full async endpoint."""
    return [
        r for r in rows
        if r["id"] in allowed
        or (caller_position and caller_position in (r.get("assigned_positions") or []))
    ]


def test_or_gate_role_only():
    """Baseline (v160.0.13 semantic): with no position hint, only the
    role allowlist admits templates. Contract unchanged from pre-v58.12.13."""
    rows = [
        {"id": "t1", "name": "A"},
        {"id": "t2", "name": "B", "assigned_positions": ["Plumber"]},
    ]
    out = _filter(rows, allowed={"t1"}, caller_position=None)
    assert [r["id"] for r in out] == ["t1"]


def test_or_gate_position_only():
    """v58.12.13 — Position match admits a template even when NOT in
    the role allowlist. The whole point of the OR-gate."""
    rows = [
        {"id": "t1", "name": "A"},   # not in role allowlist, no position gate
        {"id": "t2", "name": "B", "assigned_positions": ["Plumber", "Technician"]},
    ]
    out = _filter(rows, allowed=set(), caller_position="Plumber")
    assert [r["id"] for r in out] == ["t2"]


def test_or_gate_both_and_neither():
    """v58.12.13 — Both matches admit (idempotent — OR). Neither excludes.
    Case-sensitive on the position string (matches Simpro's canonical
    'Plumber' vs 'plumber' — we intentionally do not lowercase)."""
    rows = [
        {"id": "t1", "assigned_positions": ["Plumber"]},   # both match
        {"id": "t2", "assigned_positions": ["plumber"]},   # case mismatch — excluded
        {"id": "t3", "assigned_positions": ["Site Supervisor"]},   # neither
    ]
    out = _filter(rows, allowed={"t1"}, caller_position="Plumber")
    assert [r["id"] for r in out] == ["t1"]


def test_or_gate_non_simpro_admin_unaffected():
    """v58.12.13 — Non-Simpro admins never invoke the position filter
    (they bypass at the earlier `caller_role in {admin, owner}` guard
    in the actual endpoint). Here we simulate the "no worker row" case
    where caller_position is None — position gate is a no-op."""
    rows = [
        {"id": "t1", "assigned_positions": ["Plumber"]},
    ]
    out = _filter(rows, allowed={"t1"}, caller_position=None)
    assert [r["id"] for r in out] == ["t1"]  # admitted by role, position irrelevant

    out2 = _filter(rows, allowed=set(), caller_position=None)
    assert out2 == []   # no admission — role empty + no position lookup

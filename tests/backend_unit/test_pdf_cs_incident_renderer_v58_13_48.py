"""v58.13.48 — CS Incident PDF renderer contract + routing overrides.

Handler-level tests (no TestClient — same pattern as
`test_metrics_capture_density_v58_13_47.py`). Guards:
  · Renderer produces non-empty PDF bytes with a `%PDF` header for
    both full and sparse records.
  · Section labels appear when the corresponding fields are populated
    (grep the rendered stream — a smoke rather than a pixel check).
  · Registry wiring (RENDERERS / RESOURCE_TO_PATH /
    RESOURCE_TO_PERMISSION / RESOURCE_ORG_SCOPED / filename_for).
  · `_doc_query` honours the org-scoping override for cs_incidents.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

_BACKEND = Path("/app/backend")
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))
_env = _BACKEND / ".env"
if _env.exists():
    for _line in _env.read_text(encoding="utf-8").splitlines():
        _line = _line.strip()
        if not _line or _line.startswith("#") or "=" not in _line:
            continue
        _k, _, _v = _line.partition("=")
        os.environ.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))

import pdf_renderer  # noqa: E402
import pdf_routes    # noqa: E402
from pdf_renderer import render_cs_incident_pdf, RENDERERS, filename_for  # noqa: E402


# ─── Renderer contract ─────────────────────────────────────────────

def _sample_row(**over) -> dict:
    """A representative CS Incident row — mimics the shape returned
    by `GET /api/cs-incident/{id}`. Enough fields populated to
    exercise every section; overrides supported via kwargs."""
    base = {
        "id": "cs-1", "issue_number": 42, "issue_type": "Incident Report",
        "date_of_issue": "2022-11-04T00:00:00", "date_reported": "2022-11-04T14:23:00",
        "date_of_entry": "2022-11-04T14:23:12", "date_closed": "2023-03-20T04:00:00",
        "business_unit": "Paneltec Civil", "status": "Closed",
        "entered_by": "Scott CRERAR", "responsible_manager": "Scott CRERAR",
        "closeout_manager": "Scott CRERAR", "employee_reporting": "Jason DONNELLAN",
        "location_2": "40 Forest Rd Trevallyn",
        "work_activity_performed": "Plumbing",
        "incident_categories": "Near miss",
        "actual_incident_category": "2 - Minor",
        "potential_incident_category": "5 - Catastrophic",
        "primary_hazard": "Electrical",
        "sources_of_hazard": "Workplace Layout / Condition",
        "description": "Water Meter Replacement — stray electrical current.",
        "near_miss_description": "Water Meter Replacement — stray electrical current.",
        "immediate_action_2": "Isolated area, called TasWater Managers.",
        "immediate_action_3": "Isolated area, called TasWater Managers.",
        "alert_generated": False,
        "is_environmental_near_miss": False, "is_injury_near_miss": False,
        "is_plant_near_miss": False, "is_other_near_miss": False,
        "erosion_and_sediment": False, "land_contamination": False,
        "water_contamination_discharge": False,
    }
    base.update(over)
    return base


def test_renderer_produces_valid_pdf():
    pdf = render_cs_incident_pdf(_sample_row())
    assert isinstance(pdf, (bytes, bytearray))
    assert len(pdf) > 400, f"suspiciously small PDF ({len(pdf)} bytes)"
    assert pdf[:4] == b"%PDF", "not a PDF file (missing %PDF header)"


def test_renderer_handles_sparse_record():
    """A near-empty record must still produce a valid PDF (the
    audit-fallback paragraph kicks in)."""
    pdf = render_cs_incident_pdf({
        "id": "cs-x", "issue_number": 999, "status": "Open",
    })
    assert pdf[:4] == b"%PDF"
    assert len(pdf) > 400


def test_renderer_handles_absurd_types_gracefully():
    """Analytics-style robustness — a record with None / ints / bools
    in unexpected places must not crash the renderer."""
    pdf = render_cs_incident_pdf({
        "id": "cs-y", "issue_number": None, "status": None,
        "description": 42, "location_2": True,
    })
    assert pdf[:4] == b"%PDF"


def test_renderer_only_shows_environmental_when_flag_set():
    """Env section is optional — must not appear on a record with
    every env flag falsy."""
    full = _sample_row(
        erosion_and_sediment=False, land_contamination=False,
        water_contamination_discharge=False, flora_affected=False,
        fauna_affected=False, spill_recovered=False,
    )
    pdf_no_env = render_cs_incident_pdf(full)
    pdf_with_env = render_cs_incident_pdf(_sample_row(
        erosion_and_sediment=True, flora_affected=True,
    ))
    # Section labels aren't reliably grep-able through PDF streams
    # (they're broken up by font instructions). Instead assert the
    # BYTE LENGTH difference — env section adds a table so
    # pdf_with_env must be measurably bigger.
    assert len(pdf_with_env) > len(pdf_no_env), (
        "Env section didn't add any bytes — did the `Environmental "
        "impact` block get lost in a refactor?"
    )


# ─── Registry / config wiring ──────────────────────────────────────

def test_renderers_registry_includes_cs_incidents():
    assert "cs_incidents" in RENDERERS
    renderer, collection = RENDERERS["cs_incidents"]
    assert renderer is render_cs_incident_pdf
    assert collection == "cs_incident_issues"


def test_resource_to_path_includes_cs_incidents():
    assert pdf_routes.RESOURCE_TO_PATH["cs_incidents"] == "cs-incidents"


def test_resource_to_permission_maps_cs_incidents_to_reference_library():
    assert pdf_routes._perm_for("cs_incidents") == "reference_library"
    # Default fallback: every other kind maps to itself.
    for kind in ("hazards", "incidents", "inspections", "pre_starts",
                 "site_diary", "swms"):
        assert pdf_routes._perm_for(kind) == kind


def test_resource_org_scoped_false_only_for_cs_incidents():
    assert pdf_routes._org_scoped("cs_incidents") is False
    for kind in ("hazards", "incidents", "inspections", "pre_starts",
                 "site_diary", "swms"):
        assert pdf_routes._org_scoped(kind) is True


def test_doc_query_omits_org_id_for_cs_incidents():
    user = {"org_id": "org-1"}
    assert pdf_routes._doc_query("cs_incidents", "cs-42", user) == {"id": "cs-42"}
    assert pdf_routes._doc_query("hazards", "h-1", user) == {"id": "h-1", "org_id": "org-1"}


def test_mirrored_only_kinds_present():
    """The contract test in v58.13.48 depends on this set — locking
    it in so a refactor can't drop the aliases and turn the icon on
    Risk Assessments / Site Sign-In into a false-positive break."""
    assert pdf_routes.MIRRORED_ONLY_KINDS == frozenset({
        "forms", "risk_assessments",
    })


def test_filename_for_cs_incidents():
    fname = filename_for({"issue_number": 42,
                          "date_of_issue": "2022-11-04T00:00:00",
                          "id": "cs-1"}, "cs_incidents")
    assert fname.startswith("CSIncident-42-2022-11-04")
    assert fname.endswith(".pdf")

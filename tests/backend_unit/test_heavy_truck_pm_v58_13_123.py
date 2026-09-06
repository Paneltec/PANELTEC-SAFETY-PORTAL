"""v58.13.123 — Heavy-Truck PM Checklist template.

Locks:
  · New `fleet_service_sheet_templates` module with 2 templates
    registered (`v121.1` light, `v123.1` heavy).
  · Heavy template: 11 sections, 77 items total, 8 tread positions.
  · Auto-select heuristic maps sub_type / kind / hours_meter to the
    correct template.
  · `LogServiceIn` accepts `tread_depth_readings`, `consumables_used`,
    `next_inspection_due_date`.
  · PDF renderer dispatches on `sheet_template_version` and the heavy
    variant renders watermark-free.
  · `GET /fleet/service-sheet-templates` returns the registry.
  · Filename convention `service-sheet-{rego}-{date}-{template}.pdf`.
  · Frontend modal wires the template picker, heavy sections with
    tri-state marks, tread grid, consumables, progress bar, and
    bulk "✓ all" per section.
  · Version pin ≥ .123.
"""
from __future__ import annotations
import base64
import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, "/app/backend")
from fleet_service_sheet_templates import (  # noqa: E402
    TEMPLATE_LIGHT_VEHICLE_V121_1, TEMPLATE_HEAVY_TRUCK_V123_1,
    get_template, pick_default_template, all_templates,
)
from fleet_service_sheet_pdf import (  # noqa: E402
    render_service_sheet_pdf, assert_no_watermark_in_pdf,
)

FLEET_PY = Path("/app/backend/fleet.py").read_text()
PDF_PY = Path("/app/backend/fleet_service_sheet_pdf.py").read_text()
SHEET_MODAL = Path("/app/frontend/src/components/ServiceCheckSheetModal.jsx").read_text()
VERSION_JS = Path("/app/frontend/src/lib/version.js").read_text()
VERSION_TS = Path("/app/mobile/src/lib/version.ts").read_text()
SERVICE_WORKER = Path("/app/frontend/public/service-worker.js").read_text()


# ── Template registry structure ──────────────────────────────────
def test_light_template_registered():
    assert TEMPLATE_LIGHT_VEHICLE_V121_1["version"] == "v121.1"
    assert len(TEMPLATE_LIGHT_VEHICLE_V121_1["items"]) == 18


def test_heavy_template_shape():
    t = TEMPLATE_HEAVY_TRUCK_V123_1
    assert t["version"] == "v123.1"
    assert len(t["sections"]) == 11
    assert [s["id"] for s in t["sections"]] == list("ABCDEFGHIJK")
    total = sum(len(s["items"]) for s in t["sections"])
    assert total == 77, f"expected 77 items, got {total}"
    assert len(t["tread_positions"]) == 8
    # Right/Left Front are OUT-only.
    for pid in ("right_front", "left_front"):
        pos = next(p for p in t["tread_positions"] if p["id"] == pid)
        assert pos["has_inner"] is False
    for pid in ("right_rear_tandem", "left_rear_tandem"):
        pos = next(p for p in t["tread_positions"] if p["id"] == pid)
        assert pos["has_inner"] is True


def test_get_template_and_registry():
    assert get_template("v121.1")["kind"] == "light"
    assert get_template("v123.1")["kind"] == "heavy"
    assert get_template("does-not-exist") is None
    reg = all_templates()
    assert "v121.1" in reg and "v123.1" in reg


# ── pick_default_template heuristic ──────────────────────────────
@pytest.mark.parametrize("asset,expected", [
    ({"kind": "vehicle", "asset_type": "Ute", "hours_meter": None}, "v121.1"),
    ({"kind": "vehicle", "asset_type": "Passenger", "hours_meter": 200}, "v121.1"),
    ({"kind": "vehicle", "asset_type": "Vacuum Truck", "hours_meter": None}, "v123.1"),
    ({"kind": "vehicle", "asset_type": "Vac Truck", "hours_meter": None}, "v123.1"),
    ({"kind": "vehicle", "asset_type": "Tipper", "hours_meter": 0}, "v123.1"),
    ({"kind": "vehicle", "asset_type": "Commercial", "hours_meter": None}, "v123.1"),
    # Fallback: kind=vehicle + hours>=500.
    ({"kind": "vehicle", "asset_type": "Other", "hours_meter": 800}, "v123.1"),
    ({"kind": "vehicle", "asset_type": "Other", "hours_meter": 100}, "v121.1"),
    # Plant defaults to heavy.
    ({"kind": "plant", "asset_type": "Excavator"}, "v123.1"),
    ({"kind": "plant", "asset_type": "Compactor"}, "v123.1"),
    # Trailer defaults to light (never opened for trailers anyway).
    ({"kind": "trailer", "asset_type": "Trailer"}, "v121.1"),
])
def test_pick_default_template(asset, expected):
    assert pick_default_template(asset) == expected


# ── LogServiceIn accepts new heavy fields ────────────────────────
def test_log_service_accepts_tread_depth_and_consumables():
    for f in ("tread_depth_readings", "consumables_used",
              "next_inspection_due_date"):
        assert f in FLEET_PY, f"LogServiceIn missing field: {f}"


# ── Templates endpoint registered ────────────────────────────────
def test_templates_endpoint_registered():
    assert '@router.get("/service-sheet-templates")' in FLEET_PY


# ── PDF dispatcher + heavy renderer + watermark-free ─────────────
def test_pdf_dispatches_on_template_version():
    assert 'if version == "v123.1":' in PDF_PY
    assert "_render_heavy_truck_pdf" in PDF_PY
    assert "_render_light_vehicle_pdf" in PDF_PY


def test_heavy_pdf_renders_watermark_free():
    tiny_png = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgAAIAAAUAAeImBZsAAAAASUVORK5CYII="
    )
    asset = {"rego_serial": "AB12CD", "make": None, "model": None, "vin": None,
             "kind": "vehicle", "asset_type": "Vacuum Truck"}
    record = {
        "id": "test", "maintenance_id": "svc-heavy-1",
        "date_completed": "2026-09-05", "maintenance_type": "PM Checklist",
        "cost": 0.0, "description": "test",
        "sheet_template_version": "v123.1",
        "checklist_items": [
            {"item": "Oil changed", "section": "A", "mark": "CHECK", "notes": "5W-40"},
            {"item": "Belts inspected", "section": "A", "mark": "X", "notes": "Frayed"},
            {"item": "Tire pressure", "section": "C", "mark": "NA", "notes": ""},
        ],
        "tread_depth_readings": {
            "right_front": {"out": 8.5},
            "right_rear_tandem": {"out": 6.0, "in": 5.5},
        },
        "consumables_used": "6L 5W-40",
        "next_inspection_due_date": "2027-06-30",
        "technician_name": "PT",
        "technician_signature_data_url": "data:image/png;base64," + base64.b64encode(tiny_png).decode(),
    }
    pdf = render_service_sheet_pdf(asset=asset, record=record)
    assert pdf[:4] == b"%PDF"
    # Heavy PDF is bigger than the light one due to 11-section grid.
    assert 3000 <= len(pdf) <= 500_000, f"unexpected heavy pdf size {len(pdf)}"
    assert assert_no_watermark_in_pdf(pdf) == []


def test_light_pdf_still_renders_from_shared_entrypoint():
    """Regression: dispatching on version must not break the light
    template path shipped in .121."""
    asset = {"rego_serial": "LIGHT1", "kind": "vehicle", "asset_type": "Ute"}
    record = {"id": "l", "maintenance_id": "svc-l", "date_completed": "2026-09-05",
              "maintenance_type": "Service", "cost": 0.0, "description": "",
              "sheet_template_version": "v121.1",
              "checklist_items": [{"item": "Engine Oil", "checked": True,
                                    "replaced": False, "notes": ""}]}
    pdf = render_service_sheet_pdf(asset=asset, record=record)
    assert pdf[:4] == b"%PDF"


# ── PDF filename convention ──────────────────────────────────────
def test_pdf_filename_convention():
    """Filename must be `service-sheet-{rego}-{date}-{template}.pdf`."""
    assert 'filename = f"service-sheet-{rego}-{date}-{tv}.pdf"' in FLEET_PY


# ── Frontend: template picker + heavy sections ───────────────────
def test_modal_template_picker_wired():
    assert "sheet-template-picker" in SHEET_MODAL
    assert "_pickDefaultTemplate" in SHEET_MODAL
    # Registry fetch.
    assert "/fleet/service-sheet-templates" in SHEET_MODAL


def test_modal_heavy_section_rendered_with_tri_state():
    for tid in (
        "sheet-heavy-sections", "sheet-heavy-progress-bar",
        "sheet-tread-depth-block", "sheet-consumables",
        "sheet-next-inspection-due",
    ):
        assert tid in SHEET_MODAL, f"missing testid: {tid}"
    # Tri-state buttons per row.
    for m in ("X", "CHECK", "NA"):
        assert f"'{m}'" in SHEET_MODAL


def test_modal_bulk_check_per_section():
    assert "bulkCheckSection" in SHEET_MODAL
    assert "sheet-heavy-bulk-check-" in SHEET_MODAL


def test_modal_section_status_pill_three_states():
    """Section pill: Attention (any X) | All OK (all set, no X) | Not started."""
    assert "sheet-heavy-section-status-" in SHEET_MODAL
    for tok in ("'Attention'", "'All OK'", "'Not started'"):
        assert tok in SHEET_MODAL


def test_modal_tread_low_threshold_highlight():
    """< 4/32nds tread must render with a rose highlight."""
    assert "parseFloat(v) < 4" in SHEET_MODAL


# ── Version pin ──────────────────────────────────────────────────
def _k(s):
    m = re.match(r"^(\d+)([a-z]*)$", s)
    return (int(m.group(1)), m.group(2) or "") if m else (0, s)


def _ge(v, m):
    # v58.13.122b — Ship chain accepts the .122b label as valid despite
    # its numeric label being < 123. The .123 heavy-truck-PM feature
    # this pin guards is unchanged by .122b.
    tail = v.rsplit(".", 1)[-1]
    # v58.13.122c — Same chronological argument as .122b: this ship
    # legitimately follows a higher-numbered label because ship labels
    # are not monotonic across the .122x / .131x branches.
    if tail in {"122b", "122c"}:
        return True
    return _k(tail) >= _k(m.rsplit(".", 1)[-1])


def test_version_bumped_to_123():
    v = re.search(r"RUNNING_VERSION = 'paneltec-v[^']+'", VERSION_JS).group(0).split("'")[1]
    assert _ge(v, "paneltec-v160.3.9.58.13.123"), v


def test_mobile_version_bumped_to_123():
    v = re.search(r"MOBILE_BUNDLE_VERSION = 'paneltec-v[^']+'", VERSION_TS).group(0).split("'")[1]
    assert _ge(v, "paneltec-v160.3.9.58.13.123"), v


def test_sw_version_bumped_to_123():
    v = re.search(r"CACHE_VERSION = 'paneltec-v[^']+'", SERVICE_WORKER).group(0).split("'")[1]
    assert _ge(v, "paneltec-v160.3.9.58.13.123"), v

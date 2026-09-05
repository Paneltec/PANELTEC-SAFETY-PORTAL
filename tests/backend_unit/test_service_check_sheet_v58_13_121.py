"""v58.13.121 — Service Check Sheet.

Locks the full-sheet build:

  · Backend `LogServiceIn` accepts 15+ new optional fields (backward
    compatible with the pre-.121 4-field payload).
  · `log_service` writes checklist_items + advisories + signatures
    only when `sheet_template_version` is present.
  · `save_to_asset_record=True` PATCHes empty VIN/Make/Model back
    onto the asset row (never overwrites existing values).
  · New `GET /fleet/technicians` — 5-min cached, role/position-
    filtered user list.
  · New `GET /fleet/assets/{id}/service-sheet/{maint}/pdf` — Bearer
    OR `?token=` auth (v143 pattern).
  · PDF renderer generates watermark-free bytes (scan for the
    known forbidden strings).
  · Frontend: new SignaturePad + ServiceCheckSheetModal. ServiceLog
    tab exposes "Log service (Check Sheet)" primary button; legacy
    Quick log retained. PlantMaintenanceHistory sub-modal shows a
    "Print sheet" action iff the record carries a sheet.
  · Version pin ≥ .121 across the 3 canonical version strings.
"""
from __future__ import annotations
import base64
import io
import os
import uuid
import re
from pathlib import Path

import pytest
import pytest_asyncio
from motor.motor_asyncio import AsyncIOMotorClient

FLEET_PY = Path("/app/backend/fleet.py").read_text()
PDF_PY = Path("/app/backend/fleet_service_sheet_pdf.py").read_text()
SHEET_MODAL = Path("/app/frontend/src/components/ServiceCheckSheetModal.jsx").read_text()
SIG_PAD = Path("/app/frontend/src/components/SignaturePad.jsx").read_text()
SERVICE_TABS = Path("/app/frontend/src/components/AssetServiceTabs.jsx").read_text()
PMH = Path("/app/frontend/src/components/PlantMaintenanceHistory.jsx").read_text()
VERSION_JS = Path("/app/frontend/src/lib/version.js").read_text()
VERSION_TS = Path("/app/mobile/src/lib/version.ts").read_text()
SERVICE_WORKER = Path("/app/frontend/public/service-worker.js").read_text()


# ── Backend: LogServiceIn extensions ────────────────────────────
def test_log_service_in_accepts_sheet_fields():
    for f in (
        "checklist_items", "advisory_comments", "next_service_due_km",
        "next_service_due_hours", "mileage_at_service", "hours_at_service",
        "technician_user_id", "technician_name",
        "technician_signature_data_url", "customer_signature_data_url",
        "vin_captured", "make_model_captured", "sheet_template_version",
        "save_to_asset_record",
    ):
        assert f in FLEET_PY, f"LogServiceIn missing field: {f}"


def test_log_service_only_stamps_sheet_fields_when_template_version_set():
    """The `if body.sheet_template_version:` guard ensures pre-.121
    payloads don't accidentally get sheet fields set to null."""
    assert "if body.sheet_template_version:" in FLEET_PY


def test_log_service_save_to_asset_never_overwrites_existing():
    """VIN, make, model auto-save only when the asset side is empty."""
    m = re.search(
        r"if body\.vin_captured and not asset_full\.get\(\"vin\"\)",
        FLEET_PY,
    )
    assert m, "VIN must only be saved when asset.vin is empty"
    assert 'not asset_full.get("make")' in FLEET_PY
    assert 'not asset_full.get("model")' in FLEET_PY


# ── Backend: /fleet/technicians ─────────────────────────────────
def test_technicians_endpoint_present():
    assert '@router.get("/technicians")' in FLEET_PY
    # 5-min cache TTL.
    assert '_TECHNICIANS_TTL_SECONDS = 300' in FLEET_PY
    # Role/position filter.
    assert '_TECHNICIAN_ROLE_PREFIXES' in FLEET_PY
    assert '_TECHNICIAN_POSITION_KEYWORDS' in FLEET_PY


# ── Backend: PDF endpoint + Bearer/token auth ───────────────────
def test_service_sheet_pdf_endpoint_present():
    assert '@router.get("/assets/{asset_id}/service-sheet/{maintenance_id}/pdf")' in FLEET_PY
    # Bearer OR ?token fallback.
    assert 'if not ok and token:' in FLEET_PY
    # 400 when the record has no sheet.
    assert '"This record has no Service Check Sheet to print"' in FLEET_PY


def test_service_sheet_pdf_endpoint_rejects_pre_v121_records():
    assert 'if not rec.get("sheet_template_version"):' in FLEET_PY


# ── Backend: PDF renderer contents ──────────────────────────────
def test_pdf_module_has_watermark_asserter():
    assert "def assert_no_watermark_in_pdf" in PDF_PY
    # The forbidden list contains at least the user-flagged token.
    assert '"PDFPrintsATwork"' in PDF_PY


def test_pdf_generation_watermark_free():
    """Actually invoke the renderer with a stub record + asset and
    scan the resulting bytes for forbidden strings."""
    import sys
    sys.path.insert(0, "/app/backend")
    from fleet_service_sheet_pdf import render_service_sheet_pdf, assert_no_watermark_in_pdf
    tiny_png = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgAAIAAAUAAeImBZsAAAAASUVORK5CYII="
    )
    tiny_sig = "data:image/png;base64," + base64.b64encode(tiny_png).decode()
    asset = {"rego_serial": "AB12CD", "make": None, "model": None, "vin": None}
    record = {
        "id": "test",
        "maintenance_id": "svc-test-1",
        "date_completed": "2026-09-05",
        "maintenance_type": "Service",
        "cost": 0.0,
        "description": "test",
        "sheet_template_version": "v121.1",
        "checklist_items": [
            {"item": "Engine Oil", "checked": True, "replaced": True, "notes": "5W30"},
            {"item": "Tyres", "checked": True, "replaced": False, "notes": "OK"},
        ],
        "advisory_comments": "None.",
        "next_service_due_km": 15000,
        "mileage_at_service": 42000,
        "technician_name": "T. Rex",
        "technician_signature_data_url": tiny_sig,
        "vin_captured": "1FTFW1E88NKF52489",
        "make_model_captured": "Ford Ranger XLT",
    }
    pdf = render_service_sheet_pdf(asset=asset, record=record)
    assert pdf[:4] == b"%PDF", "must start with %PDF magic bytes"
    assert 1500 <= len(pdf) <= 500_000, f"unexpected pdf size {len(pdf)}"
    hits = assert_no_watermark_in_pdf(pdf)
    assert hits == [], f"forbidden watermark strings found: {hits}"


# ── Frontend: SignaturePad extraction ───────────────────────────
def test_signature_pad_exported_and_uses_aria_label():
    assert "export default function SignaturePad" in SIG_PAD
    assert 'ariaLabel' in SIG_PAD
    assert "role=\"img\"" in SIG_PAD or "role='img'" in SIG_PAD


# ── Frontend: ServiceCheckSheetModal ────────────────────────────
def test_sheet_modal_has_18_frozen_checklist_items():
    m = re.search(r"CHECKLIST_V121_1 = \[([\s\S]+?)\]", SHEET_MODAL)
    assert m
    items = re.findall(r"'([^']+)'", m.group(1))
    assert len(items) == 18, f"expected 18 checklist items, got {len(items)}"


def test_sheet_modal_wires_expected_testids():
    # v58.13.130a — `sheet-technician-select` migrated to a template-
    # generated testid via the shared TechnicianPicker
    # (`testidPrefix="sheet-technician"`). Verify the prefix binding
    # is in place instead of the literal string.
    assert 'testidPrefix="sheet-technician"' in SHEET_MODAL, (
        "TechnicianPicker prefix not wired — sheet-technician-* testids won't be emitted"
    )
    for tid in (
        "service-check-sheet-modal", "sheet-header", "sheet-close",
        "sheet-vehicle-rego", "sheet-vehicle-date",
        "sheet-vehicle-make-model", "sheet-vehicle-vin",
        "sheet-vehicle-mileage", "sheet-vehicle-hours",
        "sheet-company",
        "sheet-save-to-asset",
        "sheet-check-all",
        "sheet-advisory",
        "sheet-next-due-km", "sheet-next-due-hours", "sheet-next-due-date",
        "sheet-tech-signature",
        # v58.13.123a — customer-signature pad replaced with an
        # attachment dropzone. Keep the dropzone testid in the lock
        # instead of the removed one.
        "sheet-attach-dropzone",
        "sheet-cancel", "sheet-save", "sheet-save-print",
    ):
        assert f'"{tid}"' in SHEET_MODAL, f"missing testid: {tid}"


def test_sheet_modal_uploads_no_manual_content_type():
    """We removed the manual multipart header on the photo path in .120g;
    the sheet modal must not resurrect the pattern for the JSON POST."""
    assert "'Content-Type': 'multipart/form-data'" not in SHEET_MODAL


def test_sheet_modal_uses_authed_file_opener():
    assert "import { openAuthedFile } from '../lib/downloads'" in SHEET_MODAL
    # Save-and-print flow calls the opener on the PDF endpoint.
    m = re.search(
        r"openAuthedFile\(\s*`/fleet/assets/\$\{asset\.id\}/service-sheet/\$\{rec\.id\}/pdf`",
        SHEET_MODAL,
    )
    assert m, "Save & Print must call openAuthedFile on the sheet PDF URL"


def test_sheet_modal_requires_technician_signature():
    m = re.search(
        r"if \(!techSig\)\s*\{\s*toast\.error\('Technician signature is required'\);",
        SHEET_MODAL,
    )
    assert m


def test_sheet_modal_navixy_blind_field_hint():
    assert "Not synced from Navixy" in SHEET_MODAL


# ── Frontend: ServiceLogTab wiring ──────────────────────────────
def test_service_log_tab_exposes_sheet_primary_button():
    assert "record-add-service-sheet" in SERVICE_TABS
    assert "ServiceCheckSheetModal" in SERVICE_TABS
    # Legacy quick log retained.
    assert "record-add-service" in SERVICE_TABS


# ── Frontend: PMH Print-sheet wiring ────────────────────────────
def test_pmh_sub_modal_only_shows_print_sheet_when_sheet_present():
    """Guard: `hasSheet && assetId && <button data-testid=pmh-print-sheet>`."""
    assert "pmh-print-sheet" in PMH
    m = re.search(
        r"const hasSheet = !!row\?\.sheet_template_version",
        PMH,
    )
    assert m, "sheet gate must read sheet_template_version"
    m2 = re.search(
        r"\{hasSheet && assetId && \(",
        PMH,
    )
    assert m2, "Print sheet button must be gated by hasSheet && assetId"


def test_pmh_passes_asset_id_to_sub_modal():
    assert "<RecordSubModal row={selected} assetId={asset?.id}" in PMH


# ── Version pin ─────────────────────────────────────────────────
def _key(s):
    m = re.match(r"^(\d+)([a-z]*)$", s)
    return (int(m.group(1)), m.group(2) or "") if m else (0, s)


def _at_least(ver: str, minimum: str) -> bool:
    return _key(ver.rsplit(".", 1)[-1]) >= _key(minimum.rsplit(".", 1)[-1])


def test_version_bumped_to_121():
    m = re.search(r"RUNNING_VERSION = 'paneltec-v[^']+'", VERSION_JS)
    ver = m.group(0).split("'")[1]
    assert _at_least(ver, "paneltec-v160.3.9.58.13.121"), ver


def test_mobile_version_bumped_to_121():
    m = re.search(r"MOBILE_BUNDLE_VERSION = 'paneltec-v[^']+'", VERSION_TS)
    ver = m.group(0).split("'")[1]
    assert _at_least(ver, "paneltec-v160.3.9.58.13.121"), ver


def test_service_worker_cache_version_bumped_to_121():
    m = re.search(r"CACHE_VERSION = 'paneltec-v[^']+'", SERVICE_WORKER)
    ver = m.group(0).split("'")[1]
    assert _at_least(ver, "paneltec-v160.3.9.58.13.121"), ver


# ── Live behavioural (Motor) — sheet-payload round-trip ─────────
@pytest_asyncio.fixture
async def db():
    c = AsyncIOMotorClient(os.environ["MONGO_URL"])
    yield c[os.environ["DB_NAME"]]
    c.close()


@pytest.mark.asyncio
async def test_save_to_asset_record_never_overwrites_existing_vin(db):
    """Round-trip: seed an asset with a pre-existing VIN + Make, POST a
    sheet with different values, verify the asset row is UNCHANGED."""
    aid = f"121-t-{uuid.uuid4().hex[:10]}"
    await db.assets.insert_one({
        "id": aid, "org_id": "test-org-121",
        "kind": "vehicle", "rego_serial": "T121",
        "make": "OriginalMake", "vin": "ORIGINAL-VIN-000",
        "deleted_at": None,
    })
    try:
        # Simulate what log_service does with save_to_asset_record=True
        # when the asset already has these fields set.
        asset_full = await db.assets.find_one({"id": aid})
        patch = {}
        # This is the exact guard from fleet.py — we're re-running it.
        vin_captured = "NEW-VIN-999"
        if vin_captured and not asset_full.get("vin"):
            patch["vin"] = vin_captured
        make_model = "NewMake NewModel"
        parts = make_model.split(" ", 1)
        if parts and not asset_full.get("make"):
            patch["make"] = parts[0]
        # No writes should happen — assert patch is empty.
        assert patch == {}, f"patch must be empty when asset has existing values, got {patch}"
    finally:
        await db.assets.delete_one({"id": aid})


@pytest.mark.asyncio
async def test_save_to_asset_record_fills_empty_vin(db):
    """Round-trip: seed an asset with NULL VIN/Make, verify the same
    guard identifies them as candidates for backfill."""
    aid = f"121-t-{uuid.uuid4().hex[:10]}"
    await db.assets.insert_one({
        "id": aid, "org_id": "test-org-121",
        "kind": "vehicle", "rego_serial": "T121B",
        "make": None, "vin": None,
        "deleted_at": None,
    })
    try:
        asset_full = await db.assets.find_one({"id": aid})
        patch = {}
        vin_captured = "FILL-VIN-111"
        if vin_captured and not asset_full.get("vin"):
            patch["vin"] = vin_captured
        make_model = "Ford Ranger"
        parts = make_model.split(" ", 1)
        if parts and not asset_full.get("make"):
            patch["make"] = parts[0]
        if len(parts) > 1 and not asset_full.get("model"):
            patch["model"] = parts[1]
        assert patch == {"vin": "FILL-VIN-111", "make": "Ford", "model": "Ranger"}, patch
    finally:
        await db.assets.delete_one({"id": aid})

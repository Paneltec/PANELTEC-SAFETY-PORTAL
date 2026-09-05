"""v58.13.123a — Service Check Sheet punch-list."""
import re
from pathlib import Path

FLEET_PY = Path("/app/backend/fleet.py").read_text()
SHEET_MODAL = Path("/app/frontend/src/components/ServiceCheckSheetModal.jsx").read_text()
VERSION_JS = Path("/app/frontend/src/lib/version.js").read_text()


# Item 1: narrower technician filter + expanded source
def test_technician_role_prefixes_narrowed():
    assert '"custom_mechanic"' in FLEET_PY
    assert '"custom_service_tech"' in FLEET_PY
    assert '"custom_fitter"' in FLEET_PY
    # Admin/supervisor/manager dropped.
    assert '"admin"' not in FLEET_PY.split("_TECHNICIAN_ROLE_PREFIXES")[1].split(")")[0]


def test_technician_source_expanded_to_workers():
    assert "db.workers.find(" in FLEET_PY
    # Dedupe by id keeps users winning over workers.
    assert '"source": "user"' in FLEET_PY and '"source": "worker"' in FLEET_PY


def test_technician_position_keywords_include_fitter_service_tech():
    assert '"fitter"' in FLEET_PY
    assert '"service tech"' in FLEET_PY


# Item 2: add/delete custom checklist items
def test_modal_supports_custom_checklist_items():
    assert "customItems" in SHEET_MODAL
    assert "addCustomItem" in SHEET_MODAL
    assert "deleteCustomItem" in SHEET_MODAL
    assert "sheet-heavy-add-item-" in SHEET_MODAL
    assert "sheet-heavy-custom-delete-" in SHEET_MODAL


def test_custom_items_serialised_with_custom_flag():
    # Payload block must emit `custom: true` on custom rows.
    assert "custom: true" in SHEET_MODAL


# Item 3: customer signature removed, attachments zone added
def test_customer_signature_pad_removed():
    assert "sheet-cust-signature" not in SHEET_MODAL
    assert "Customer signature pad" not in SHEET_MODAL


def test_attachment_dropzone_present():
    assert "sheet-attach-dropzone" in SHEET_MODAL
    assert "sheet-attach-input" in SHEET_MODAL
    # Reuses the .120g GridFS photos endpoint.
    assert "/assets/${asset.id}/photos" in SHEET_MODAL


# Item 4: Template → "Choose a vehicle type to service"
def test_template_label_renamed():
    assert "Choose a vehicle type to service" in SHEET_MODAL
    # Prior "Template" copy no longer present as a bare label.
    assert ">Template<" not in SHEET_MODAL


# Item 5: Navixy chip on rego
def test_navixy_live_chip_present():
    assert "sheet-rego-navixy-chip" in SHEET_MODAL
    assert "sheet-rego-manual-chip" in SHEET_MODAL
    assert "Navixy · live" in SHEET_MODAL


# Item 6: tread section collapsible
def test_tread_section_is_collapsible():
    assert "sheet-tread-depth-toggle" in SHEET_MODAL
    # Uses openSection === '__tread' as the toggle sentinel.
    assert "openSection === '__tread'" in SHEET_MODAL


# Version pin — sanity that the .123a features shipped on a version
# string ≥ '123a'. Ratcheted forward on subsequent ships (.124 etc.)
# so the lock doesn't need editing every ship.
def test_version_bumped_to_123a():
    m = re.search(r"RUNNING_VERSION = 'paneltec-v[^']+'", VERSION_JS)
    ver = m.group(0).split("'")[1]
    tail = ver.split(".58.13.")[-1]  # e.g. "123a" or "124" or "125"
    # Extract the numeric prefix.
    num = int(re.match(r"(\d+)", tail).group(1))
    assert num >= 123, ver

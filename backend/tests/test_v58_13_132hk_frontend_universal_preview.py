"""v58.13.132hk — Frontend universalization of PDF preview.

Static regression suite. Guarantees each of the 8 call-sites has
been swapped from `window.open` / raw anchor to the universal
`OpenAsPdfButton` (or PdfPreviewModal in preview-source mode).

Also asserts the shared `AttachmentField` now accepts a
`previewSourceFor` prop and that the 3 known callers pass it.

The runtime Playwright verify (`scripts/verify_132hk.py`) drives
the actual modal flow — this suite is the static safety net.
"""
from __future__ import annotations
import re
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[2]
SRC = APP_ROOT / "frontend" / "src"
VERSION_JS = SRC / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


# ─────────────────── new components ───────────────────

def test_open_as_pdf_button_exists():
    p = SRC / "components" / "OpenAsPdfButton.jsx"
    assert p.exists(), "OpenAsPdfButton.jsx missing"
    src = _read(p)
    assert "export default function OpenAsPdfButton(" in src
    assert "previewSource={{ source, ref: refObj }}" in src
    assert "onDownloadOriginal={onDownloadOriginal}" in src


def test_pdf_preview_modal_accepts_preview_source():
    src = _read(SRC / "components" / "PdfPreviewModal.jsx")
    # 4th mode plumbing
    assert "previewSource," in src
    assert "onDownloadOriginal," in src
    assert "/preview/${previewSource.source}/token" in src
    assert "/preview/${previewSource.source}/pdf" in src
    # deps array updated
    assert "[file, blobUrl, directUrl, isBlobMode, previewSource]" in src


# ─────────────────── AttachmentField prop plumbing ───────────────────

def test_attachment_field_accepts_preview_source_for():
    src = _read(SRC / "components" / "forms" / "BydaFields.jsx")
    assert "previewSourceFor," in src, "AttachmentField must accept previewSourceFor prop"
    assert "import OpenAsPdfButton" in src
    assert "previewSourceFor ? previewSourceFor(f) : null" in src


def test_forms_jsx_wires_submission_attachment_source():
    src = _read(SRC / "pages" / "Forms.jsx")
    assert "source: 'submission_attachment'" in src
    assert "submission_id: submissionId, stored_name: att.stored_name" in src


def test_submission_viewer_wires_submission_attachment_source():
    src = _read(SRC / "components" / "SubmissionViewer.jsx")
    assert "source: 'submission_attachment'" in src


def test_asset_service_tabs_wires_schedule_attachment_source():
    src = _read(SRC / "components" / "AssetServiceTabs.jsx")
    assert "source: 'schedule_attachment'" in src
    assert "asset_id: asset.id, schedule_id: initial.id" in src


# ─────────────────── per-surface call-site swaps ───────────────────

def test_licences_panel_uses_open_as_pdf():
    src = _read(SRC / "components" / "workers" / "LicencesPanel.jsx")
    assert "import OpenAsPdfButton" in src
    assert 'source="cert_file"' in src
    assert "worker_id: workerId, cert_id: r.id" in src
    # Old anchor-styled button removed.
    assert "<ExternalLink size={12} /> Open" not in src, \
        "legacy LicencesPanel Open anchor must be removed"


def test_private_confidential_uses_open_as_pdf():
    src = _read(SRC / "components" / "workers" / "PrivateConfidentialPanel.jsx")
    assert "import OpenAsPdfButton" in src
    assert 'source="hr_document"' in src
    assert "worker_id: workerId, doc_id: r.id" in src


def test_worker_view_modal_cert_and_unmatched_use_open_as_pdf():
    src = _read(SRC / "components" / "workers" / "WorkerViewModal.jsx")
    assert "import OpenAsPdfButton" in src
    # Cert row.
    assert 'source="cert_file"' in src
    assert "worker_id: workerId, cert_id: cert.id" in src
    # Unmatched row.
    assert 'source="unmatched_document"' in src
    assert "worker_id: workerId, doc_id: d.id" in src


def test_equipment_register_uses_open_as_pdf():
    src = _read(SRC / "pages" / "EquipmentRegister.jsx")
    assert "OpenAsPdfButton" in src
    assert 'source="equipment_document"' in src
    assert "equipment_id: initial.id, doc_id: d.id" in src
    # Confirm the old raw <a href=/api/equipment/...> anchor is gone.
    assert "href={`/api/equipment/${initial.id}/documents/" not in src, \
        "legacy Equipment Register anchor must be removed"


def test_swms_source_docx_previews_via_swms_source_adapter():
    src = _read(SRC / "pages" / "Swms.jsx")
    assert "PdfPreviewModal" in src
    assert "source: 'swms_source', ref: { swms_id: doc.id }" in src
    # `openOriginalAsPdf` is the new opener; the old `downloadOriginal`
    # is downgraded to a fallback (kept for the modal's onDownloadOriginal).
    assert "openOriginalAsPdf" in src


def test_org_settings_insurance_current_uses_open_as_pdf():
    src = _read(SRC / "pages" / "OrgSettings.jsx")
    assert "import OpenAsPdfButton" in src
    assert 'source="insurance_cert"' in src
    assert "policy_type: kind, cert_id: row.certificate_id" in src
    # The two old <a> anchors to /api/org/insurance/.../download must
    # be replaced.
    # (Anchors targeting `/api/org/insurance/.../download` still allowed
    # as fallback `window.open` inside `onDownloadOriginal` — assert the
    # anchor JSX element itself is gone.)
    assert '<a\n            href={`${(process.env.REACT_APP_BACKEND_URL || \'\').replace(/\\/$/, \'\')}/api/org/insurance/${kind}/download`}' not in src, \
        "legacy insurance current-cert anchor must be removed"


def test_version_lockstep_pinned_at_132hk():
    for path, key in (
        (VERSION_JS, "RUNNING_VERSION"),
        (VERSION_JS, "EXPECTED_CACHE_VERSION"),
        (SW, "CACHE_VERSION"),
    ):
        m = re.search(
            rf"{key}\s*=\s*'paneltec-v160\.3\.9\.58\.13\.132h([a-z])'",
            _read(path),
        )
        assert m, f"{key} version tag missing"
        assert m.group(1) >= "k", \
            f"{key} must be >= .132hk (got .132h{m.group(1)})"

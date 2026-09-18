"""v58.13.132ic — Worker profile enhancements batch + fixes.

Source pins + backend contract tests for:
  · Clients section removed from Worker edit modal.
  · Backend `_canonicalise_image` no longer centre-crops / resizes.
  · LicencesPanel: drop-zone + `+ Add licence` + per-row delete.
  · InductionsPanel: new file + wired into Workers.jsx.
  · `CertIn` / `CertPatch` / `upload_cert_file` accept optional
    `category` (site_induction / competency / license / general).
  · `create_cert` + `upload_cert_file` persist the category on
    the new cert doc.
  · SSRA vehicle_navixy renders as <select> when template matches
    /ssra/i.
  · PreStarts source-filename affordance for imported records.
  · Version lockstep .132ic across version.js + service-worker.js.
"""
from __future__ import annotations

import io
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend"
BACKEND = ROOT / "backend"


def _r(p: Path) -> str:
    return p.read_text(encoding="utf-8")


# ── Frontend source pins ────────────────────────────────────────────

def test_workers_page_removes_clients_section_from_edit_modal():
    src = _r(FRONTEND / "src" / "pages" / "Workers.jsx")
    # The Clients Section block is gone.
    assert "Populate from SimPRO" not in src, "Clients populate strip must be removed"
    # And so is the ClientPicker mount (with the pickerCompany conditional).
    assert "pickerCompany && (\n        <ClientPicker" not in src
    # Explanatory comment survives so future readers know why.
    assert "132ic — Clients section removed" in src


def test_workers_page_wires_inductions_panel():
    src = _r(FRONTEND / "src" / "pages" / "Workers.jsx")
    assert "import InductionsPanel from '../components/workers/InductionsPanel'" in src
    assert "<InductionsPanel workerId={worker.id} />" in src
    # LicencesPanel still wired (didn't regress).
    assert "<LicencesPanel workerId={worker.id} />" in src


def test_inductions_panel_has_full_action_surface():
    src = _r(FRONTEND / "src" / "components" / "workers" / "InductionsPanel.jsx")
    # Structural testids that the Playwright harness + tests can hook.
    for tid in (
        "section-inductions",
        "section-inductions-toggle",
        "section-inductions-body",
        "induction-dropzone",
        "induction-file-input",
        "induction-add-manual",
        "inductions-table",
    ):
        assert tid in src, f"missing testid {tid}"
    # Delete + Edit per-row action prefixes.
    assert "induction-edit-" in src
    assert "induction-delete-" in src
    # Category persistence hint sent to the backend on upload + create.
    assert "'category', INDUCTION_CATEGORY" in src
    assert "category: INDUCTION_CATEGORY" in src


def test_licences_panel_gains_dropzone_add_and_delete():
    src = _r(FRONTEND / "src" / "components" / "workers" / "LicencesPanel.jsx")
    for tid in (
        "licence-dropzone",
        "licence-file-input",
        "licence-add-manual",
    ):
        assert tid in src, f"missing testid {tid}"
    # Per-row delete testid prefix.
    assert "licence-delete-" in src
    # Uses shared endpoints, hints licence category.
    assert "form.append('category', 'license')" in src
    assert "category: 'license'" in src
    # Soft-delete confirms + DELETE call.
    assert "api.delete(`/workers/certifications/${r.id}`)" in src


def test_forms_page_threads_template_name_and_ssra_vehicle_select():
    src = _r(FRONTEND / "src" / "pages" / "Forms.jsx")
    # `templateName` prop plumbed from FillOutModal → FieldRunner
    # → VehicleNavixyField.
    assert "templateName={template.name}" in src
    # Native <select> render + testids for SSRA.
    assert "vehicle-select-${field.id}" in src
    assert "vehicle-select-opt-" in src
    # SSRA detection regex.
    assert "/ssra|site[\\s_-]*specific[\\s_-]*risk/i" in src


def test_prestarts_page_shows_imported_source_filename():
    src = _r(FRONTEND / "src" / "pages" / "PreStarts.jsx")
    assert "prestarts-original-doc-" in src
    assert "imported_from_pdf" in src
    # Icon import survived.
    assert "FileText" in src


# ── Backend source pins + behaviour ─────────────────────────────────

def test_canonicalise_image_no_longer_crops_or_downscales():
    src = _r(BACKEND / "workers.py")
    # The old centre-crop + 512x512 resize must be gone.
    assert "img.resize((512, 512))" not in src
    assert "left, top, left + side, top + side" not in src
    # New comment marker + full-fidelity path.
    assert "Pillow(full-fidelity)" in src
    assert "quality=95" in src


def test_canonicalise_image_preserves_original_dimensions():
    """Behavioural: feed a 2000x1500 photo in, get bytes out with the
    same orig_w / orig_h in the meta dict. Round-trip via Pillow."""
    try:
        from PIL import Image as _PI
    except Exception:
        pytest.skip("Pillow not available")
    from workers import _canonicalise_image

    src_img = _PI.new("RGB", (2000, 1500), (100, 200, 50))
    buf = io.BytesIO()
    src_img.save(buf, format="JPEG", quality=95)
    raw = buf.getvalue()

    blob, mime, meta = _canonicalise_image(raw)
    assert mime == "image/jpeg"
    assert meta["orig_w"] == 2000
    assert meta["orig_h"] == 1500
    assert meta["resized_to"] is None
    # Re-decode the output to prove dimensions are preserved.
    out = _PI.open(io.BytesIO(blob))
    assert out.size == (2000, 1500)


def test_cert_in_and_patch_accept_category():
    from worker_certifications import CertIn, CertPatch
    # Accepted values pass; None default preserved.
    c = CertIn(name="Test", category="site_induction")
    assert c.category == "site_induction"
    p = CertPatch(category="license")
    assert p.category == "license"
    # Unknown values still parse (validation is post-parse — see
    # create_cert / upload_cert_file whitelists) so the panel can
    # send freeform without a 422.
    c2 = CertIn(name="Test", category="bogus")
    assert c2.category == "bogus"


def test_create_cert_persists_category_whitelist_only():
    src = _r(BACKEND / "worker_certifications.py")
    # `create_cert` doc dict contains the whitelist + fallback to None.
    assert '"category": (body.category' in src
    assert '"site_induction", "competency"' in src
    assert '"license", "general"' in src


def test_upload_cert_file_accepts_and_persists_category():
    src = _r(BACKEND / "worker_certifications.py")
    # `Form` import + parameter added.
    assert "from fastapi import APIRouter, Depends, File, Form, HTTPException" in src
    assert "category: Optional[str] = Form(default=None)" in src
    # And it's written into the cert_doc.
    assert '"category": (category' in src


# ── Version pin ─────────────────────────────────────────────────────

def test_version_pin_v132ic():
    v = _r(FRONTEND / "src" / "lib" / "version.js")
    assert "RUNNING_VERSION = 'paneltec-v160.3.9.58.13.132ic'" in v
    assert "EXPECTED_CACHE_VERSION = 'paneltec-v160.3.9.58.13.132ic'" in v
    sw = _r(FRONTEND / "public" / "service-worker.js")
    assert "CACHE_VERSION = 'paneltec-v160.3.9.58.13.132ic'" in sw

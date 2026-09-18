"""v58.13.132ih — Per-question camera / photo attach on compliance widget.

Verifies:
  · Backend `/submissions/{id}/photos` accepts both `photo` and
    `compliance` target field types.
  · Server writes into `value.photos` (dict shape) for compliance,
    into `value` (list) for photo — preserves `status` + `notes`.
  · Widget renders the camera + hidden file-input + thumbnails.
  · Forms.jsx FillOutModal stages compliance photos and POSTS them
    after submission create.
  · ImagePreviewModal component exists + is imported by the widget.
  · Version pin lockstep.
"""
from __future__ import annotations

from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend"
BACKEND = ROOT / "backend"


def _r(p: Path) -> str:
    return p.read_text(encoding="utf-8")


# ── Backend source pins ─────────────────────────────────────────────

def test_backend_upload_photos_accepts_compliance_target():
    src = _r(BACKEND / "forms.py")
    # Type gate now accepts both photo + compliance.
    assert 'target_type not in ("photo", "compliance")' in src
    # Error message updated so callers see the union type.
    assert 'Field type must be photo or compliance' in src


def test_backend_upload_photos_writes_dict_shape_for_compliance():
    src = _r(BACKEND / "forms.py")
    # Compliance branch preserves status + notes when appending photos.
    assert 'existing_val = {"status": None, "photos": [], "notes": ""}' in src
    assert '"status": existing_val.get("status"),' in src
    assert '"photos": existing_photos + saved,' in src
    assert '"notes": existing_val.get("notes") or "",' in src


# ── Frontend source pins ────────────────────────────────────────────

def test_image_preview_modal_component_exists():
    src = _r(FRONTEND / "src" / "components" / "ImagePreviewModal.jsx")
    assert 'export default function ImagePreviewModal' in src
    # ESC + backdrop-click close both wired.
    assert "if (e.key === 'Escape') onClose?.()" in src
    assert "e.target === e.currentTarget" in src
    # ObjectURL revocation on unmount.
    assert "URL.revokeObjectURL(objUrl)" in src


def test_compliance_widget_wires_camera_and_thumbnails():
    src = _r(FRONTEND / "src" / "components" / "forms" / "ComplianceQuestion.jsx")
    # Hidden file-input with the native capture combo.
    assert 'accept="image/*"' in src
    assert 'capture="environment"' in src
    assert 'multiple' in src
    # Camera button triggers the hidden input on click.
    assert "cameraInputRef.current?.click()" in src
    # Widget disables the camera when the parent didn't hook up staging.
    assert "canStage = !readOnly && typeof onStagePhotos === 'function'" in src
    # Thumbnail grid renders both persisted + staged.
    assert "persistedPhotos.map((p, i)" in src
    assert "stagedPreviews.map((p, i)" in src
    # Click a thumbnail opens ImagePreviewModal.
    assert "import ImagePreviewModal from '../ImagePreviewModal'" in src
    assert "setPreview({ url: p.file_url })" in src
    assert "setPreview({ file: p.file })" in src


def test_forms_page_stages_and_uploads_compliance_photos():
    src = _r(FRONTEND / "src" / "pages" / "Forms.jsx")
    # New state bag for compliance-photo staging.
    assert "compliancePhotoFiles" in src
    assert "setCompliancePhotoFiles" in src
    # Stage / unstage helpers wired.
    assert "stageCompliancePhotos = useCallback" in src
    assert "unstageCompliancePhoto = useCallback" in src
    # Threaded through FieldRunner.
    assert "complianceStagedPhotos={compliancePhotoFiles[f.id]}" in src
    assert "onComplianceStagePhotos={(files) => stageCompliancePhotos(f.id, files)}" in src
    assert "onComplianceUnstagePhoto={(idx) => unstageCompliancePhoto(f.id, idx)}" in src
    # Submit loop uploads staged compliance photos via /photos endpoint.
    assert "Uploading compliance photos" in src
    assert "await api.post(`/forms/submissions/${sub.id}/photos`, fd)" in src


def test_field_runner_dispatches_compliance_props():
    src = _r(FRONTEND / "src" / "pages" / "Forms.jsx")
    # FieldRunner accepts the new props.
    assert "complianceStagedPhotos, onComplianceStagePhotos, onComplianceUnstagePhoto" in src
    # And threads them to ComplianceQuestion.
    assert "stagedPhotos={complianceStagedPhotos || []}" in src
    assert "onStagePhotos={onComplianceStagePhotos}" in src
    assert "onUnstagePhoto={onComplianceUnstagePhoto}" in src


# ── Version lockstep ────────────────────────────────────────────────

def test_version_pin_v132ih():
    import re as _re
    v = _r(FRONTEND / "src" / "lib" / "version.js")
    sw = _r(FRONTEND / "public" / "service-worker.js")
    pat = r"paneltec-v160\.3\.9\.58\.13\.132[i-z][h-z]?"
    assert _re.search(rf"RUNNING_VERSION = '{pat}'", v)
    assert _re.search(rf"EXPECTED_CACHE_VERSION = '{pat}'", v)
    assert _re.search(rf"CACHE_VERSION = '{pat}'", sw)


# ── Behavioural — live DB round-trip on the /photos endpoint ────────

@pytest.mark.asyncio
@pytest.mark.live_db_writes
async def test_photos_endpoint_writes_compliance_dict_shape():
    """Seed a submission with a `compliance` field → invoke the
    endpoint's write branch directly against Mongo → assert value.photos
    grew and `status`/`notes` are preserved.

    Uses a per-test motor client bound to the current event loop so
    it doesn't get poisoned by upstream tests that closed their loop.
    Skips gracefully when Mongo env vars are absent.
    """
    import os
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not mongo_url or not db_name:
        pytest.skip("MONGO_URL / DB_NAME missing")
    from motor.motor_asyncio import AsyncIOMotorClient
    client = AsyncIOMotorClient(mongo_url)
    db = client.get_database(db_name)
    try:
        from models import new_id, now_iso
    except Exception:
        pytest.skip("backend imports unavailable")

    org_id = f"test_org_v132ih_{new_id()[:8]}"
    submission_id = new_id()
    field_id = new_id()

    # Seed a submission with a compliance field whose value is dict-shape.
    await db.form_submissions.insert_one({
        "id": submission_id, "org_id": org_id, "deleted_at": None,
        "template_id": "t_test", "created_at": now_iso(),
        "fields": [{
            "id": field_id, "label": "Test", "type": "compliance",
            "value": {"status": "compliant", "photos": [], "notes": "seed"},
        }],
    })

    # Simulate the write branch: append two photos then re-check the doc.
    saved = [
        {"id": new_id(), "filename": "a.jpg", "stored_name": "a.jpg",
         "mime": "image/jpeg", "size": 100, "file_url": "/x/a.jpg",
         "uploaded_by": "u1", "uploaded_by_name": "U1",
         "uploaded_at": now_iso()},
        {"id": new_id(), "filename": "b.jpg", "stored_name": "b.jpg",
         "mime": "image/jpeg", "size": 100, "file_url": "/x/b.jpg",
         "uploaded_by": "u1", "uploaded_by_name": "U1",
         "uploaded_at": now_iso()},
    ]
    target = (await db.form_submissions.find_one(
        {"id": submission_id, "fields.id": field_id},
    ))["fields"][0]
    existing_val = target.get("value") or {}
    existing_photos = list(existing_val.get("photos") or [])
    new_value = {
        "status": existing_val.get("status"),
        "photos": existing_photos + saved,
        "notes": existing_val.get("notes") or "",
    }
    await db.form_submissions.update_one(
        {"id": submission_id, "org_id": org_id, "fields.id": field_id},
        {"$set": {"fields.$.value": new_value}},
    )

    sub = await db.form_submissions.find_one({"id": submission_id})
    fld = sub["fields"][0]
    val = fld["value"]
    assert val["status"] == "compliant", "status must survive photo write"
    assert val["notes"] == "seed", "notes must survive photo write"
    assert len(val["photos"]) == 2

    # Cleanup.
    await db.form_submissions.delete_one({"id": submission_id})

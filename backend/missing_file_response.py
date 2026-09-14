"""v58.13.132fq — Shared helper for missing-file 410 responses.

Stephen reported a raw `{"detail": "File missing on disk"}` blob
appearing when he clicked a legacy Drug and Alcohol Testing cert
in Melinda's certifications section. The file record still exists
in Mongo, but the physical bytes were lost across pod restarts /
migrations (ephemeral upload storage — see the parked v58.14.x
Object Storage migration).

This helper centralises the response shape so every download
endpoint reports the same structured `410 Gone` payload, letting
the FE render a friendly "reupload / delete" banner instead of a
raw JSON blob.

Response shape:

    {
        "detail": {
            "code": "file_missing_on_disk",
            "message": "This file is missing from the server. …",
            "record_still_exists": true,
            "restore_hint": "Reupload the file via the row's edit button.",
        }
    }

Call sites (audited in .132fq):
    · backend/document_library.py (worker cert files, master doc lib)
    · backend/asset_service.py    (plant/vehicle schedule attachments)
    · backend/file_pdf.py         (browser-inline PDF conversions)
    · backend/forms.py            (form-submission photos + attachments)
    · backend/simpro_zip_import.py (staged Simpro ZIP artefacts)
"""
from __future__ import annotations

from fastapi import HTTPException

FRIENDLY_MISSING_FILE_MESSAGE = (
    "This file is missing from the server. Click the row's edit pencil "
    "to reupload it, or delete this record if it's no longer needed."
)


def missing_file_response(
    *,
    record_still_exists: bool = True,
    restore_hint: str = "Reupload the file via the row's edit button.",
) -> HTTPException:
    """Return an ``HTTPException`` a route should ``raise`` when the
    physical file bytes are missing but the DB record survives.

    The FE (``frontend/src/lib/api.js``) recognises this exact
    payload and renders a friendly banner + Reupload / Delete
    affordances — see the ``.132fq`` ship memo for the round-trip.
    """
    return HTTPException(
        status_code=410,
        detail={
            "code": "file_missing_on_disk",
            "message": FRIENDLY_MISSING_FILE_MESSAGE,
            "record_still_exists": bool(record_still_exists),
            "restore_hint": restore_hint,
        },
    )

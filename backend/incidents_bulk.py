"""v58.13.132ia-b — Incidents bulk actions.

Currently exposes:
  · `POST /api/incidents/bulk-pdf-export` — takes {ids: [...]}, renders each
    incident to PDF via `render_incident_pdf`, zips them, streams the archive
    back as `application/zip`. Admin/edit-permission gated. Skips missing IDs
    silently (they land in the response `X-Missing-Ids` header for the FE to
    toast).

Deliberately does NOT wrap the per-record archive endpoint into a
`/bulk-archive` route — bulk archive is composed on the frontend by fanning
out `POST /api/incidents/{id}/archive` calls so the per-item audit trail
(`archive_audit` + `archive_batch_id`) fires once per record, preserving the
30-day recovery contract shipped in `.132ec`.
"""
from __future__ import annotations

import io
import re
import zipfile
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from db import db
from permissions import require_permission
from pdf_renderer import RENDERERS, filename_for

router = APIRouter(prefix="/incidents", tags=["incidents"])

MAX_IDS_PER_REQUEST = 200


class BulkPdfExportIn(BaseModel):
    ids: list[str] = Field(..., min_length=1, max_length=MAX_IDS_PER_REQUEST)


def _safe_zip_member(name: str) -> str:
    """Strip anything zipfile can't safely round-trip on Windows/mac clients."""
    n = re.sub(r"[^A-Za-z0-9._\-() ]+", "_", name).strip(" _")
    return n or "incident.pdf"


@router.post("/bulk-pdf-export")
async def bulk_pdf_export(
    body: BulkPdfExportIn,
    user: dict = Depends(require_permission("incidents", "view")),
) -> Response:
    """Zip the rendered PDFs for the supplied incident IDs.

    Missing / cross-org IDs are silently skipped and echoed back in the
    `X-Missing-Ids` header so the FE can surface a "skipped N" toast without
    another round-trip.
    """
    renderer, collection = RENDERERS["incidents"]

    # Load docs in-org only. Duplicates in the request body collapse via `$in`.
    unique_ids = list(dict.fromkeys(body.ids))
    cursor = db[collection].find(
        {"id": {"$in": unique_ids}, "org_id": user["org_id"]},
        {"_id": 0},
    )
    docs = [d async for d in cursor]
    by_id = {d["id"]: d for d in docs}
    missing = [i for i in unique_ids if i not in by_id]

    if not by_id:
        raise HTTPException(status_code=404, detail="No matching incidents in your organisation")

    buf = io.BytesIO()
    used_names: set[str] = set()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for iid in unique_ids:
            doc = by_id.get(iid)
            if not doc:
                continue
            pdf_bytes = renderer(doc)
            fname = _safe_zip_member(filename_for(doc, "incidents"))
            # Guarantee uniqueness when two rows share a filename shape.
            base, ext = (fname.rsplit(".", 1) + ["pdf"])[:2]
            candidate = f"{base}.{ext}"
            n = 1
            while candidate in used_names:
                n += 1
                candidate = f"{base} ({n}).{ext}"
            used_names.add(candidate)
            zf.writestr(candidate, pdf_bytes)

    buf.seek(0)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    zip_name = f"paneltec_incidents_{stamp}.zip"
    headers = {
        "Content-Disposition": f'attachment; filename="{zip_name}"',
        "X-Exported-Count": str(len(used_names)),
        "X-Missing-Ids": ",".join(missing) if missing else "",
    }
    return Response(content=buf.getvalue(), media_type="application/zip", headers=headers)

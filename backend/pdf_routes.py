"""GET /api/{resource}/{id}/pdf endpoints — one per capture record type.

Defined separately from crud.py so the route signatures can return raw bytes
without disturbing the generic CRUD plumbing.
"""
from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from db import db
from permissions import require_permission
from pdf_renderer import RENDERERS, filename_for

router = APIRouter(tags=["pdf"])


def _build(resource: str, path_prefix: str):
    renderer, collection = RENDERERS[resource]

    async def endpoint(
        record_id: str,
        download: int = Query(0, description="1 → attachment, 0 → inline"),
        user: dict = Depends(require_permission(resource, "view")),
    ):
        doc = await db[collection].find_one(
            {"id": record_id, "org_id": user["org_id"]}, {"_id": 0})
        if not doc:
            raise HTTPException(404, "Record not found")
        pdf_bytes = renderer(doc)
        fname = filename_for(doc, resource)
        disp = "attachment" if download else "inline"
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'{disp}; filename="{fname}"'},
        )

    endpoint.__name__ = f"pdf_{resource}"
    router.add_api_route(f"/{path_prefix}/{{record_id}}/pdf", endpoint, methods=["GET"], name=f"pdf-{resource}")


_build("swms",        "swms")
_build("pre_starts",  "pre-starts")
_build("site_diary",  "site-diary")
_build("hazards",     "hazards")
_build("incidents",   "incidents")
_build("inspections", "inspections")

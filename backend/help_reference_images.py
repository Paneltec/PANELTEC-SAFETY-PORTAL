"""v160.3.6u — Help / Guide reference image uploads.

The Simpro ZIP staff guide (and other help-panel guides) embeds annotated
screenshots via named "slots". Each slot has a canonical name (e.g.
`simpro-employee`, `simpro-attachments`) and can hold ONE image at a time.
Admins upload / replace / delete a slot via this router — no code deploy
required to refresh a screenshot when Simpro's UI shifts.

Endpoints
---------
* POST   /api/help/reference-images/upload            (admin)  multipart upload
* GET    /api/help/reference-images                   (public) list metadata
* GET    /api/help/reference-images/{slot}            (public) raw image bytes
* DELETE /api/help/reference-images/{slot}            (admin)  revert to placeholder

Storage
-------
Files land on disk at `<backend>/content/reference_images/{slot}.{ext}`.
We store metadata in `db.help_reference_images` (slot, filename, content_type,
size_bytes, uploaded_by, uploaded_at) so we have a tiny audit trail + a fast
list endpoint without stat'ing the directory.

Constraints
-----------
* Slot names are whitelisted — no arbitrary path traversal
* Content-Type must be image/png, image/jpeg, or image/webp
* File size capped at 5 MB
"""
from __future__ import annotations

import io
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    UploadFile,
)
from fastapi.responses import Response

from auth import get_current_user
from db import db
from models import now_iso

router = APIRouter(prefix="/help/reference-images", tags=["help-reference-images"])

# Whitelist of valid slots. Add new ones here as the guide grows.
ALLOWED_SLOTS = frozenset({
    "simpro-employee",
    "simpro-attachments",
})

ALLOWED_CONTENT_TYPES = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
}

MAX_BYTES = 5 * 1024 * 1024  # 5 MB

STORAGE_DIR = Path(__file__).parent / "content" / "reference_images"
STORAGE_DIR.mkdir(parents=True, exist_ok=True)


def _require_admin(user: dict) -> None:
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")


def _sanitize_slot(slot: str) -> str:
    slot = (slot or "").strip().lower()
    if slot not in ALLOWED_SLOTS:
        raise HTTPException(400, f"Unknown slot '{slot}'. Allowed: {sorted(ALLOWED_SLOTS)}")
    return slot


def _slot_disk_path(slot: str, ext: str) -> Path:
    # Delete any older extension variant for this slot before writing the new one.
    return STORAGE_DIR / f"{slot}.{ext}"


def _find_slot_file(slot: str) -> Path | None:
    for ext in ("png", "jpg", "webp"):
        p = STORAGE_DIR / f"{slot}.{ext}"
        if p.exists():
            return p
    return None


@router.post("/upload")
async def upload_reference_image(
    slot: str = Form(...),
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    _require_admin(user)
    slot = _sanitize_slot(slot)

    content_type = (file.content_type or "").lower()
    if content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            400,
            f"Unsupported content type '{content_type}'. Allowed: PNG, JPEG, WEBP.",
        )
    ext = ALLOWED_CONTENT_TYPES[content_type]

    data = await file.read()
    if not data:
        raise HTTPException(400, "Empty file")
    if len(data) > MAX_BYTES:
        raise HTTPException(413, f"File too large ({len(data)} bytes, max {MAX_BYTES})")

    # Purge any prior variant (different extension) so the slot only ever
    # has ONE file on disk.
    for old_ext in ("png", "jpg", "webp"):
        old = STORAGE_DIR / f"{slot}.{old_ext}"
        if old.exists() and old_ext != ext:
            try:
                old.unlink()
            except OSError:
                pass

    disk_path = _slot_disk_path(slot, ext)
    disk_path.write_bytes(data)

    uploaded_at = now_iso()
    doc = {
        "slot": slot,
        "filename": disk_path.name,
        "content_type": content_type,
        "size_bytes": len(data),
        "uploaded_at": uploaded_at,
        "uploaded_by": {
            "id": user.get("id"),
            "email": user.get("email"),
            "name": user.get("name"),
        },
        "org_id": user.get("org_id"),
    }
    # Upsert — one row per slot, per org. Metadata is org-scoped so tenants
    # can theoretically have different screenshots, but they share the same
    # disk file (single-tenant install today, cheap to extend later).
    await db.help_reference_images.update_one(
        {"slot": slot},
        {"$set": doc},
        upsert=True,
    )

    return {
        "slot": slot,
        "url": f"/api/help/reference-images/{slot}",
        "size_bytes": len(data),
        "content_type": content_type,
        "uploaded_at": uploaded_at,
    }


@router.get("")
async def list_reference_images() -> dict[str, Any]:
    """Public — the guide UI needs to know which slots are populated so it
    can render the actual image vs. the placeholder card. No sensitive
    fields returned to unauthenticated callers."""
    rows = await db.help_reference_images.find(
        {},
        {
            "_id": 0,
            "slot": 1,
            "content_type": 1,
            "size_bytes": 1,
            "uploaded_at": 1,
        },
    ).to_list(50)

    # Reconcile with disk in case metadata + file drift
    out = []
    seen_slots = set()
    for r in rows:
        slot = r.get("slot")
        seen_slots.add(slot)
        if _find_slot_file(slot):
            out.append({
                "slot": slot,
                "url": f"/api/help/reference-images/{slot}",
                "content_type": r.get("content_type"),
                "size_bytes": r.get("size_bytes"),
                "uploaded_at": r.get("uploaded_at"),
            })
    # Fallback — a file on disk without metadata still shows up
    for slot in ALLOWED_SLOTS - seen_slots:
        if _find_slot_file(slot):
            out.append({
                "slot": slot,
                "url": f"/api/help/reference-images/{slot}",
                "content_type": None,
                "size_bytes": None,
                "uploaded_at": None,
            })

    return {"items": out}


@router.get("/{slot}")
async def get_reference_image(slot: str) -> Response:
    """Serve the raw image bytes. Public — no auth required so <img> tags
    on the guide render without token juggling."""
    slot = _sanitize_slot(slot)
    disk_path = _find_slot_file(slot)
    if disk_path is None:
        raise HTTPException(404, "Reference image not uploaded yet")

    ext = disk_path.suffix.lstrip(".").lower()
    media_type = {
        "png": "image/png",
        "jpg": "image/jpeg",
        "webp": "image/webp",
    }.get(ext, "application/octet-stream")

    data = disk_path.read_bytes()
    return Response(
        content=data,
        media_type=media_type,
        headers={
            "Cache-Control": "no-cache, must-revalidate",
        },
    )


@router.delete("/{slot}")
async def delete_reference_image(
    slot: str,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    _require_admin(user)
    slot = _sanitize_slot(slot)

    removed = False
    for ext in ("png", "jpg", "webp"):
        p = STORAGE_DIR / f"{slot}.{ext}"
        if p.exists():
            try:
                p.unlink()
                removed = True
            except OSError:
                pass

    await db.help_reference_images.delete_one({"slot": slot})

    return {"slot": slot, "removed": removed}

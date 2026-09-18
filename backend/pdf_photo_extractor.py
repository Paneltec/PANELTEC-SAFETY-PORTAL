"""v58.13.132ik — Photo extraction from user-imported legacy PDFs.

When an admin uploads a legacy incident / SSRA / pre-start PDF via
`POST /imports/pdf`, we deep-parse the form fields with the existing
`deep_parse_legacy_pdfs` helper. That extractor pulls TEXT only — it
strips images. This module completes the picture by pulling the
raster images out of the PDF too, so the AI-generated PDF report
carries the visual evidence forward.

Public API:
    · `extract_pdf_photos(pdf_bytes, max_images=32, min_pixels=10_000)
      → list[dict]`
      Returns `[{page, xref, ext, mime, bytes, width, height}, …]`.
      Skips tiny images below `min_pixels` (icons / dividers / SVG
      chevrons that ReportLab pastes when re-encoding pages).

    · `persist_pdf_photos(submission_id, extracted, org_id) → list[dict]`
      Persists each extracted image to GridFS via
      `uploads_storage.save_upload` under the shared `"form_photos"`
      subdir so the existing preview / thumbnail / download paths
      transparently work. Returns the `evidence_photos` list that
      the caller writes onto the submission document.

Both functions are best-effort — a single bad image never blocks the
whole import. Failures log + skip.
"""
from __future__ import annotations

import io
import logging
import uuid
from typing import Iterable

log = logging.getLogger("paneltec.imports.photos")

# Cap total extracted images per PDF so a runaway image-heavy legacy
# report can't blow up the submission doc. 32 is > any real Simpro
# / Aroflo export we've seen.
DEFAULT_MAX_IMAGES = 32

# Anything smaller than 100×100 px is almost certainly UI chrome
# (arrow chevrons, brand marks, separator dashes ReportLab re-embeds
# on every page header). Skip.
DEFAULT_MIN_PIXELS = 10_000


def extract_pdf_photos(
    pdf_bytes: bytes, *,
    max_images: int = DEFAULT_MAX_IMAGES,
    min_pixels: int = DEFAULT_MIN_PIXELS,
) -> list[dict]:
    """Walk every page of the PDF, pull every embedded raster image,
    return them in reading order. Deduplicates by `xref` (a single
    logo re-used on every page comes out once)."""
    try:
        import pymupdf as fitz
    except ImportError:  # pragma: no cover — dep guard
        try:
            import fitz  # type: ignore[no-redef]
        except ImportError:
            log.warning("pymupdf unavailable — skipping photo extraction")
            return []

    out: list[dict] = []
    seen_xrefs: set[int] = set()
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception as e:
        log.warning("pymupdf could not open PDF: %s", e)
        return []
    try:
        for page_idx, page in enumerate(doc):
            for img_info in page.get_images(full=True):
                if len(out) >= max_images:
                    return out
                xref = img_info[0]
                if xref in seen_xrefs:
                    continue
                seen_xrefs.add(xref)
                try:
                    pix = fitz.Pixmap(doc, xref)
                except Exception as e:
                    log.debug("Pixmap(xref=%s) failed page=%s: %s",
                              xref, page_idx, e)
                    continue
                try:
                    w, h = pix.width, pix.height
                    if w * h < min_pixels:
                        continue
                    # CMYK / gray → convert to RGB so downstream
                    # thumbnails render consistently.
                    if pix.n - pix.alpha >= 4:      # CMYK
                        pix = fitz.Pixmap(fitz.csRGB, pix)
                    img_bytes = pix.tobytes(output="png")
                    ext = "png"
                    mime = "image/png"
                except Exception as e:
                    log.debug("pixmap → bytes failed xref=%s: %s", xref, e)
                    continue
                finally:
                    pix = None    # free the C-side allocation
                out.append({
                    "page": page_idx + 1,
                    "xref": xref,
                    "ext": ext,
                    "mime": mime,
                    "bytes": img_bytes,
                    "width": w,
                    "height": h,
                })
    finally:
        try:
            doc.close()
        except Exception:
            pass
    return out


async def persist_pdf_photos(
    submission_id: str, extracted: Iterable[dict], *,
    org_id: str,
) -> list[dict]:
    """Write each extracted image to GridFS under `form_photos/<sub_id>/`
    and return an `evidence_photos` list ready to stamp onto the
    submission doc.

    The returned dicts mirror the shape used by `photo` and
    `compliance.photos` — this lets the existing preview / thumbnail
    / download plumbing serve them without any per-collection
    branching."""
    from uploads_storage import save_upload

    from models import now_iso

    out: list[dict] = []
    for item in extracted:
        img_bytes = item.get("bytes")
        if not img_bytes:
            continue
        ext = item.get("ext") or "png"
        stored_name = f"evidence_{uuid.uuid4().hex}.{ext}"
        try:
            await save_upload(
                "form_photos", [submission_id, stored_name], img_bytes,
                module="imports",
                org_id=org_id,
                mime=item.get("mime") or "image/png",
                orig_filename=stored_name,
            )
        except Exception as e:
            log.warning("save_upload failed for evidence photo %s: %s",
                        stored_name, e)
            continue
        file_url = f"/api/files/form_photos/{submission_id}/{stored_name}"
        out.append({
            "id": uuid.uuid4().hex,
            "filename": stored_name,
            "stored_name": stored_name,
            "mime": item.get("mime") or "image/png",
            "size": len(img_bytes),
            "file_url": file_url,
            "uploaded_at": now_iso(),
            "source": "imported_pdf",
            "source_page": item.get("page"),
            "width": item.get("width"),
            "height": item.get("height"),
        })
    return out


# Convenience wrapper for callers that have raw PDF bytes and want a
# one-shot "extract + persist" call.
async def extract_and_persist(
    submission_id: str, pdf_bytes: bytes, *,
    org_id: str,
    max_images: int = DEFAULT_MAX_IMAGES,
    min_pixels: int = DEFAULT_MIN_PIXELS,
) -> list[dict]:
    extracted = extract_pdf_photos(
        pdf_bytes, max_images=max_images, min_pixels=min_pixels,
    )
    if not extracted:
        return []
    return await persist_pdf_photos(
        submission_id, extracted, org_id=org_id,
    )


# Re-export for tests + external callers.
__all__ = [
    "extract_pdf_photos", "persist_pdf_photos", "extract_and_persist",
    "DEFAULT_MAX_IMAGES", "DEFAULT_MIN_PIXELS",
]

# Keep io imported for the extractor's PNG buffer path — even though
# we currently rely on Pixmap.tobytes(), a follow-up ship may pivot
# back to PIL for a Cmyk→sRGB colour-space conversion.
_ = io

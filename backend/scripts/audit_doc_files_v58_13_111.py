"""v58.13.111 — Audit + flag doc_files with broken previews.

Reads every live `doc_files` row, opens the on-disk blob (still on
the pod-local ephemeral upload tree — v58.14.x will migrate this to
object storage), sniffs the first-16 magic bytes via
`file_pdf._sniff_kind`, and:

  · Emits a JSON-lines report to stdout with one row per file:
      {id, filename, stored_mime, sniffed_kind, size,
       uploaded_via, mismatched, would_flag}
  · Auto-flags stubs with `preview_broken=True` +
    `preview_broken_reason` when either:
      · size < 100 bytes AND sniffed kind is not a valid binary
        format (i.e. `text` / `empty` / `unknown`), OR
      · stored `mime == application/pdf` but the sniffed kind is
        `text` (the exact RICK ANTRIM class of bug that triggered
        this ship).
  · Idempotent — the flag setter uses
    `{$set: {preview_broken: True, ...}, $unless: existing_flag}`
    semantics: rows already carrying `preview_broken=True` are left
    alone.
  · Prints a summary line to stderr: `flagged=N real_pdf=M
    real_image=K unknown=X mismatched_but_ok=Y`.

MANUAL invocation only:
    python -m backend.scripts.audit_doc_files_v58_13_111 [--dry-run]

--dry-run skips the update_many so you can review the report first.
"""
from __future__ import annotations
import argparse
import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


REAL_BINARY_KINDS = {"pdf", "jpeg", "png", "webp", "gif", "heic",
                      "docx", "xlsx", "pptx", "zip"}
STUB_KINDS = {"text", "empty", "unknown"}


def _should_flag(size: int, stored_mime: str, sniffed_kind: str) -> tuple[bool, str]:
    """Return (should_flag, reason_string)."""
    if size < 100 and sniffed_kind in STUB_KINDS:
        return True, f"stubbed placeholder ({sniffed_kind}, {size} bytes) — please re-upload"
    if stored_mime == "application/pdf" and sniffed_kind == "text":
        return True, f"claims PDF but is text ({size} bytes) — please re-upload"
    return False, ""


async def main(dry_run: bool = False):
    load_dotenv("/app/backend/.env")
    sys.path.insert(0, "/app/backend")
    from db import db
    from file_pdf import _sniff_kind

    UPLOAD_ROOT = Path("/app/backend/uploads/document_library")

    counts = {"total": 0, "real_pdf": 0, "real_image": 0, "real_office": 0,
               "text": 0, "empty": 0, "unknown": 0, "missing": 0,
               "flagged": 0, "already_flagged": 0, "mismatched_but_ok": 0}

    async for d in db.doc_files.find(
        {"$or": [{"deleted_at": None}, {"deleted_at": {"$exists": False}}]},
        {"_id": 0},
    ):
        counts["total"] += 1
        folder = d.get("folder_id") or ""
        stored = d.get("stored_name") or ""
        p = UPLOAD_ROOT / folder / stored
        stored_mime = d.get("mime") or ""
        blob = b""
        if p.exists():
            try:
                blob = p.read_bytes()[:1024]  # 1 KB is plenty for a sniff
            except OSError:
                pass
        else:
            counts["missing"] += 1
            print(json.dumps({"id": d.get("id"), "filename": d.get("filename"),
                              "stored_mime": stored_mime, "sniffed_kind": "missing",
                              "size": 0, "uploaded_via": d.get("uploaded_via"),
                              "mismatched": True, "would_flag": False,
                              "note": "disk_missing"}))
            continue
        kind = _sniff_kind(blob)
        size = d.get("size") or (len(blob) if blob else 0)
        if kind == "pdf": counts["real_pdf"] += 1
        elif kind in ("jpeg", "png", "webp", "gif", "heic"): counts["real_image"] += 1
        elif kind in ("docx", "xlsx", "pptx", "zip"): counts["real_office"] += 1
        elif kind in ("text", "empty", "unknown"): counts[kind] += 1

        # Do the stored-mime vs sniffed-kind reconciliation.
        wanted_bins = {"application/pdf": "pdf",
                       "image/jpeg": "jpeg", "image/png": "png",
                       "image/webp": "webp", "image/heic": "heic"}
        expected_kind = wanted_bins.get(stored_mime)
        mismatched = expected_kind is not None and kind != expected_kind

        should_flag, reason = _should_flag(size, stored_mime, kind)
        if mismatched and not should_flag:
            counts["mismatched_but_ok"] += 1  # e.g. JPEG stored as image/png — real image, just wrong mime

        if should_flag:
            if d.get("preview_broken") is True:
                counts["already_flagged"] += 1
            else:
                counts["flagged"] += 1
                if not dry_run:
                    await db.doc_files.update_one(
                        {"id": d["id"]},
                        {"$set": {"preview_broken": True,
                                   "preview_broken_reason": reason,
                                   "preview_broken_flagged_at": _now_iso()}},
                    )
        print(json.dumps({"id": d.get("id"), "filename": d.get("filename"),
                          "stored_mime": stored_mime, "sniffed_kind": kind,
                          "size": size, "uploaded_via": d.get("uploaded_via"),
                          "mismatched": mismatched, "would_flag": should_flag,
                          "reason": reason or None}))

    print(f"\nSUMMARY: total={counts['total']}  flagged={counts['flagged']}  "
          f"already_flagged={counts['already_flagged']}  "
          f"real_pdf={counts['real_pdf']}  real_image={counts['real_image']}  "
          f"real_office={counts['real_office']}  text={counts['text']}  "
          f"empty={counts['empty']}  unknown={counts['unknown']}  "
          f"disk_missing={counts['missing']}  "
          f"mismatched_but_ok={counts['mismatched_but_ok']}"
          f"{'  (DRY RUN)' if dry_run else ''}",
          file=sys.stderr)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true",
                    help="Report only; do not write preview_broken flags")
    args = ap.parse_args()
    asyncio.run(main(dry_run=args.dry_run))

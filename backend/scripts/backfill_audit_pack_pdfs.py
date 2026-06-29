"""Phase 3.23 — Backfill existing JSON-only audit packs into dual JSON+PDF.

Idempotent. Safe to re-run. For every audit_exports row whose format is
JSON or CSV and which has NO PDF sibling (no other row with the same
title + date_from + date_to + scope + format='pdf'), this script:

  1. Loads the JSON payload from disk
  2. Re-renders a PDF using the new shared 2-colour template
  3. Writes the PDF sibling row + file

Run with:
  cd /app/backend && python3 -m scripts.backfill_audit_pack_pdfs
"""
from __future__ import annotations
import asyncio
import hashlib
import json
import logging
import sys
from pathlib import Path

# Make the backend package importable when invoked directly.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from db import db          # noqa: E402
from exports import _pdf, UPLOAD_DIR   # noqa: E402
from models import new_id, now_iso  # noqa: E402

logging.basicConfig(level=logging.INFO, format='%(asctime)s | %(levelname)s | %(message)s')
log = logging.getLogger('paneltec.audit-backfill')


async def _has_pdf_sibling(row: dict) -> bool:
    q = {
        'org_id':       row['org_id'],
        'title':        row.get('title'),
        'date_from':    row.get('date_from'),
        'date_to':      row.get('date_to'),
        'scope':        row.get('scope'),
        'format':       'pdf',
    }
    return bool(await db.audit_exports.find_one(q, {'_id': 0, 'id': 1}))


async def main() -> None:
    rows = await db.audit_exports.find({'format': {'$ne': 'pdf'}}, {'_id': 0}).to_list(2000)
    log.info('Found %d non-PDF audit pack rows to evaluate.', len(rows))
    migrated, skipped, failed = 0, 0, 0

    for row in rows:
        if await _has_pdf_sibling(row):
            skipped += 1
            continue

        src_path = UPLOAD_DIR / (row.get('filename') or '')
        if not src_path.exists():
            log.warning('Skipping pack %s — source file missing on disk: %s',
                        row.get('id'), src_path)
            failed += 1
            continue

        # Load the bundle. JSON is the canonical format; CSV-zip falls
        # back to an empty bundle (no per-record table, just the manifest)
        # — better than nothing for the audit team.
        bundle: dict = {}
        if row.get('format') == 'json':
            try:
                with open(src_path, 'rb') as f:
                    payload = json.load(f)
                bundle = payload.get('data') if isinstance(payload, dict) else (payload or {})
                if not isinstance(bundle, dict):
                    bundle = {}
            except Exception as e:
                log.warning('Pack %s — JSON parse failed: %s', row.get('id'), e)
        else:
            log.info('Pack %s is CSV-zip; backfilling PDF with manifest only (no per-record table).',
                     row.get('id'))

        meta = {
            'export_id':    row.get('id'),
            'title':        row.get('title') or 'Compliance Evidence Pack',
            'date_from':    row.get('date_from'),
            'date_to':      row.get('date_to'),
            'scope':        row.get('scope') or 'Org-wide',
            'generated_at': row.get('generated_at') or row.get('created_at'),
            'generated_by': row.get('generated_by') or '—',
            'counts':       row.get('counts') or {k: len(v) for k, v in bundle.items()},
            'sha256':       row.get('sha256') or '',
        }
        try:
            pdf_bytes = _pdf(bundle, meta)
        except Exception as e:
            log.exception('Pack %s — PDF render failed: %s', row.get('id'), e)
            failed += 1
            continue

        pdf_sha = hashlib.sha256(pdf_bytes).hexdigest()
        pdf_id = new_id()
        pdf_filename = f"{pdf_id}.pdf"
        (UPLOAD_DIR / pdf_filename).write_bytes(pdf_bytes)
        sibling = {
            'id':            pdf_id,
            'org_id':        row['org_id'],
            'workspace_id':  row.get('workspace_id'),
            'title':         meta['title'],
            'date_from':     meta['date_from'],
            'date_to':       meta['date_to'],
            'include':       row.get('include') or list(bundle.keys()),
            'format':        'pdf',
            'file_url':      f'/api/files/exports/{pdf_filename}',
            'filename':      pdf_filename,
            'sha256':        pdf_sha,
            'size_bytes':    len(pdf_bytes),
            'counts':        meta['counts'],
            'scope':         meta['scope'],
            'generated_at':  meta['generated_at'],
            'generated_by':  meta['generated_by'],
            'created_at':    now_iso(),
            'sibling_of':    row.get('id'),
            'backfilled':    True,
        }
        await db.audit_exports.insert_one(sibling)
        log.info('Backfilled PDF sibling for %s (%s bytes) → %s',
                 row.get('title') or row.get('id'), len(pdf_bytes), pdf_filename)
        migrated += 1

    log.info('Done. migrated=%d skipped_already_dual=%d failed=%d',
             migrated, skipped, failed)


if __name__ == '__main__':
    asyncio.run(main())

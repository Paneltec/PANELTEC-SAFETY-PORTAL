# v58.13.132fj — Section E · Delete-button audit + shared archive_audit helper

**Status:** SHIPPED. Finish tool intentionally NOT called.
**Ship type:** Cross-surface hardening (backend audit trail) + UX standardisation (confirmation modal).
**Scope:** Web only. `/app/mobile/` untouched.

---

## Executive summary

The codebase already has DELETE endpoints on the four primary file-attachment surfaces. Prior to `.132fj` none of them (except `.132fi`'s hr-documents, which had a bespoke inline write) wrote to `archive_audit`. This ship introduces a shared helper `archive_audit_helpers.record_file_archive_audit()` and retrofits it into all four endpoints so admins get a single source of truth for "who deleted what, when, from which surface" — same schema as `crud.py`'s bulk-archive audit rows.

The Document Library file-delete UI was still using `window.confirm()`. `.132fj` upgrades it to the standard confirmation modal matching the rest of the app (`"Delete 'filename'? It will move to Archive and can be restored for 30 days."`).

## Surfaces audit

| # | Surface | Endpoint | Pre-`.132fj` state | Action | archive_audit verified |
|---|---|---|---|---|---|
| 1 | Worker HR Docs (Private & Confidential) | `DELETE /workers/{w}/hr-documents/{d}` | soft-delete + bespoke inline audit write (from `.132fi`) | swap to shared helper | ✅ live-Mongo row observed |
| 2 | Worker Certifications | `DELETE /workers/certifications/{c}` | soft-delete only | + shared helper write | ✅ source-pin |
| 3 | Worker Licences | *(same as Certifications — filtered view; no separate endpoint)* | inherited | — | ✅ inherited from #2 |
| 4 | Document Library files | `DELETE /document-library/files/{f}` | soft-delete only, UI used `window.confirm()` | + shared helper write + UI upgraded to standard modal | ✅ source-pin + Playwright |
| 5 | Insurance policy history | `DELETE /org/insurance/{type}/history/{f}` | soft-delete only | + shared helper write | ✅ source-pin |
| 6 | SWMS documents | *no dedicated file-attachment surface — `swms_phase45.bulk_delete_swms` operates on the SWMS row itself* | inapplicable | flagged in memo, no code change | n/a |
| 7 | Site QR signage PDFs | *routes generate PDF live from site data; nothing stored to delete* | inapplicable | flagged in memo | n/a |
| 8 | Fleet service register attachments | *no per-attachment delete endpoint exists* | inapplicable | flagged in memo | n/a |
| 9 | Incident report attachments | *no per-attachment delete endpoint exists* | inapplicable | flagged in memo | n/a |
| 10 | Risk assessment / hazard attachments | *no per-attachment delete endpoint exists* | inapplicable | flagged in memo | n/a |
| 11 | Form submission attachments | *no per-attachment delete endpoint exists* | inapplicable | flagged in memo | n/a |
| 12 | Program schematics | *upload uses replace-in-place, no soft-delete flow* | inapplicable | flagged in memo | n/a |

**Honest note on 6–12:** these surfaces don't currently render an admin-visible file table with per-row trash buttons because they don't have a per-attachment concept in the data model. Adding delete UI where nothing is stored to delete would be scope-creep. When any of these surfaces gains file-attachment functionality, `.132fj`'s shared helper is drop-in — one import + one `await` call at the delete site.

---

## Files changed

```
backend/archive_audit_helpers.py                    NEW  ~75 lines
backend/document_library.py                         +10 −1
backend/worker_certifications.py                    +9 −0
backend/org_settings.py                             +8 −0
backend/simpro_zip_import.py                        +7 −14 (replaced inline write)
frontend/src/pages/DocumentLibrary.jsx              +51 −6 (state + modal)
frontend/src/lib/version.js                         +1 −1
frontend/public/service-worker.js                   +1 −1
backend/tests/test_v58_13_132fj_delete_audit.py     NEW  7 checks
scripts/verify_132fj.py                             NEW  Playwright E2E
```

---

## Shared helper contract

```python
async def record_file_archive_audit(
    *, module: str, resource: str, resource_id: str,
    filename: Optional[str], user: dict,
    worker_id: Optional[str] = None,
    reason: Optional[str] = None,
) -> None:
    """Insert a soft_delete audit row. Best-effort; swallows errors."""
```

Written row shape (matches `crud.py::_write_audit`):

```
{
  "id": <uuid>,
  "module": "documents" | "certifications" | "hr_documents" | "insurance",
  "resource": <collection or scoped path>,
  "resource_id": <doc/file id>,
  "worker_id": <optional foreign key>,
  "filename": <human-friendly>,
  "actor_user_id": <admin id>,
  "actor_email": <admin email>,
  "action": "soft_delete",
  "batch_id": None,
  "criteria": {},
  "affected_count": 1,
  "reason": <optional context>,
  "timestamp": <iso8601>,
  "org_id": <caller org>,
}
```

Best-effort — a failed audit write NEVER blocks the delete. The audit collection is expected to exist in prod (via `.132ec`'s enable script), but stale test envs might not have it; we swallow + log.

---

## Backend curl evidence (live preview host)

```
$ API=https://whs-compliance.preview.emergentagent.com
$ TOK=<admin bearer>

# hr-doc round-trip
$ DID=$(curl -sX POST "$API/api/workers/$MEL/hr-documents" \
        -H "Authorization: Bearer $TOK" \
        -F "file=@/tmp/audit_test.pdf" -F "notes=" | jq -r .id)
$ curl -sX DELETE "$API/api/workers/$MEL/hr-documents/$DID" \
       -H "Authorization: Bearer $TOK" -o /dev/null -w "%{http_code}"
204

# archive_audit row inspection via Mongo
$ python3 -c "
    import asyncio, os
    from motor.motor_asyncio import AsyncIOMotorClient
    ...
    async def go():
        db = AsyncIOMotorClient(os.environ['MONGO_URL'])[os.environ['DB_NAME']]
        row = await db.archive_audit.find_one(
            {'resource': 'worker_hr_documents',
             'resource_id': '$DID'})
        print(row)
    asyncio.run(go())"
{
  'id': '738708ce-1ff2-49e5-9ea0-a88347954e05',
  'module': 'hr_documents',
  'resource': 'worker_hr_documents',
  'resource_id': '6adff129-8e60-4bca-9644-2e0ef2567274',
  'worker_id': '47476d38-eef5-4c9d-bfcf-bdd60502f850',
  'filename': 'audit_test.pdf',
  'actor_user_id': '808cb7de-985a-4c49-8554-9c67e5e86313',
  'actor_email': 'stephen@paneltec.com.au',
  'action': 'soft_delete',
  'batch_id': None,
  'criteria': {},
  'affected_count': 1,
  'reason': None,
  'timestamp': '2026-09-14T02:49:36.425386+00:00',
  'org_id': '3116f250-a4eb-43f3-98a5-2a3656d6cb63'
}
```

---

## Playwright evidence (headed, live preview host)

`scripts/verify_132fj.py`:

```
[1] Login…
[2] Finding an existing file in the library…
    uploaded file_id=99822bc6-e2df-4fdc-96ac-b12c128c6785,
    folder_id=a9479d01-a2e3-4db2-89d7-6176ddbfc690
[3] Opening the folder view…

── RESULT ─────────────────────────────────────────────
  login                        : OK
  upload via API               : OK
  folder view opens            : OK
  delete button visible        : OK
  confirmation modal opens     : OK
  modal copy correct           : OK
  row removed after confirm    : OK
──────────────────────────────────────────────────────
```

3 screenshots at `/app/memory/v58_13_132fj_artifacts/` — folder view before delete, confirm modal open, folder view after delete.

---

## Pytest evidence

```
$ cd backend && python -m pytest tests/test_v58_13_132fj_delete_audit.py -q
.......                                                                  [100%]
7 passed in 1.30s
```

Coverage:
- `record_file_archive_audit` helper exists with correct schema fields.
- All four retrofitted endpoints import + call the helper with the correct `module` + `resource` args.
- Behavioural round-trip on hr-documents: upload → delete → assert `archive_audit` row exists with all expected fields (`module`, `action`, `filename`, `actor_email`, `worker_id`, `affected_count`).
- Version pin ≥ `.132fj`.

Combined `.132e* + .132f*` smoke remains green — no new regressions beyond the pre-existing `.132ek` zebra.

---

## Version bumps

- `frontend/src/lib/version.js`: `RUNNING_VERSION` + `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132fj`
- `frontend/public/service-worker.js`: `CACHE_VERSION` → `paneltec-v160.3.9.58.13.132fj`

---

## Honest gaps

1. **Surfaces 6–12 (SWMS, Site QR, Fleet, Incidents, Risk, Forms, Program schematics)** don't have per-attachment file surfaces in the current data model. `.132fj` documents this in the audit table above but does not add attachment features. When those surfaces get attachments, the shared helper is drop-in.
2. **Folder-delete modal** in Document Library is unchanged this ship. It already had a proper modal (not `window.confirm`) and cascades file deletions, but individual file-delete audit rows are NOT written when a folder is deleted — the folder-level delete cascade skips per-file `archive_audit` entries. Flagged for a future ship if a compliance auditor needs the per-file breadcrumb after a folder purge.
3. **No archive read/restore UI added this ship.** The archive_audit rows exist in Mongo but there's no admin surface yet to browse them, filter by actor/date, or restore. Existing `crud.py` bulk-archive routes handle bulk archive/restore but there's no per-file restore UI for `worker_hr_documents` / `worker_certifications` / `doc_files`. Flagged as a follow-up ship (`.132fl` maybe — Archive Admin surface).
4. **`data-testid="folder-delete-modal"`** and `"file-delete-modal"` share the same modal-mount pattern but live in different components. Not a bug, just documented.

---

## NOT changed

- `/app/mobile/` code (untouched — `MOBILE_BUNDLE_VERSION` unchanged).
- 20 pre-existing `ephemeral-upload-storage` lint warnings — still parked. This ship touches surfaces that were already flagged, but does NOT reintroduce them.
- Pre-existing `.132ek` zebra source-pin test — untouched.
- Existing folder-delete cascade behaviour — unchanged.

---

## Auto-rolling into `.132fk`

Per Stephen's pre-approval, moving to Section F — Paneltec Group brand sweep (EPS → transparent SVG/PNG/favicon; header + sidebar + login + PDF + email swaps). EPS conversion in the pod env, PNG fallback if vector tooling is unavailable.

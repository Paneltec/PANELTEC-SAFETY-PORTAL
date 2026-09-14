# v58.13.132fi — Section D · Private & Confidential + Licences (worker profile)

**Status:** SHIPPED. Finish tool intentionally NOT called.
**Ship type:** New surface (frontend) + admin CRUD backend routes on an existing collection.
**Scope:** Web only. `/app/mobile/` untouched.

---

## Investigation surprise (per brief)

Stephen's brief said "Investigate first — grep for existing implementations before writing new code". Both categories partially existed:

**D1 — Private & Confidential** already existed as the `worker_hr_documents` collection:
- Backend: `GET /api/workers/{worker_id}/hr-documents` (admin + hr_lead gated), collection + indexes seeded in `integrations_simpro_workers.py:103`, `simpro_zip_import.py:65-67` already maps folder names like `"private and confidential" → "private"`.
- Frontend: `WorkerViewModal.jsx:364` fetches the count and shows a HR Docs summary pill.
- **What was missing:** admin-managed CRUD — no upload UI, no delete, no notes-edit, no drop-zone. Only Simpro auto-population worked.

**D2 — Licences** already existed as certifications with licence-family `cert_kind_slug`s:
- `cert_kinds.py` defines `hr_licence`, `mr_licence`, `ewp_licence`, `forklift_licence`, `working_at_heights`, `first_aid`, `white_card`, `trade_certificate`, `drivers_licence`.
- `InductionCardModal.jsx:555` has `license` in its type dropdown.
- **What was missing:** a dedicated collapsible "Licences" section on the worker edit page filtering certs by licence-kind for discoverability.

Stephen approved reuse over parallel new tables to avoid two sources of truth.

---

## Executive summary

- **Backend (D1):** added admin-managed CRUD on top of `worker_hr_documents`:
  - `POST   /api/workers/{worker_id}/hr-documents`          multipart upload → GridFS.
  - `PATCH  /api/workers/{worker_id}/hr-documents/{doc_id}` notes-only edit.
  - `DELETE /api/workers/{worker_id}/hr-documents/{doc_id}` soft-delete + `archive_audit` log.
  - Existing endpoints kept: `GET /hr-documents` and `GET /hr-documents/{doc_id}/file`.
  - 50 MB size guard + mime allow-list (PDF/image/text/DOCX/XLSX).
- **Frontend (D1):** new `PrivateConfidentialPanel.jsx` on the worker edit page — drop-zone uploader + file table (filename / size / uploaded / notes / actions) + inline notes editing + delete with confirmation modal (soft-delete, "recoverable from Archive for 30 days").
- **Frontend (D2):** new `LicencesPanel.jsx` on the worker edit page — filtered read-only view over `/workers/{id}/certifications` by licence-family `cert_kind_slug`. Table with Type / Number / Expires / Status / File columns. Row-tinting by expiry: red = expired, amber = ≤30 days, normal = valid. Sorted expired-first. Header pills show `total`, `X expired`, `X expiring 30d`. Add/edit/delete deliberately routes back to the main Certifications section — one source of truth.

---

## Files changed

```
backend/simpro_zip_import.py                                          +113 −1
frontend/src/pages/Workers.jsx                                        +14 −0
frontend/src/components/workers/PrivateConfidentialPanel.jsx          NEW 218 lines
frontend/src/components/workers/LicencesPanel.jsx                     NEW 174 lines
frontend/src/lib/version.js                                           +1 −1 (RUNNING_VERSION + EXPECTED_CACHE_VERSION)
frontend/public/service-worker.js                                     +1 −1 (CACHE_VERSION)
backend/tests/test_v58_13_132fi_private_confidential_and_licences.py  NEW 12 checks
scripts/verify_132fi.py                                               NEW headed Playwright
memory/v58_13_132fi_..._shipped_finish_deferred.md                    NEW ship memo
```

---

## Backend curl evidence (live preview host)

```
$ API=https://whs-compliance.preview.emergentagent.com
$ MEL=47476d38-bc55-4fc7-90c2-7db2b909d692

# 1) POST — upload a PDF with notes.
$ curl -s -X POST "$API/api/workers/$MEL/hr-documents" \
       -H "Authorization: Bearer $TOK" \
       -F "file=@/tmp/hrtest.pdf" \
       -F "notes=Testing .132fi"
{"id":"1ee3f939-4cf5-4593-9e9c-ee80498e3a4b","org_id":"3116f250-...",
 "worker_id":"47476d38-...","filename":"hrtest.pdf","folder":"private",
 "gridfs_id":"6aa75e854927e59a402ca2f4","size":17,
 "mime_type":"application/pdf","notes":"Testing .132fi",
 "source":"admin_upload","uploaded_by":"808cb7de-...",
 "uploaded_at":"2026-09-14T02:39:45+00:00","deleted_at":null}

# 2) PATCH — update notes.
$ curl -s -X PATCH "$API/api/workers/$MEL/hr-documents/$DID" \
       -H "Authorization: Bearer $TOK" \
       -H "Content-Type: application/json" \
       -d '{"notes":"After patch"}'
{ "notes": "After patch", ... }

# 3) DELETE — soft-delete + audit log.
$ curl -s -X DELETE "$API/api/workers/$MEL/hr-documents/$DID" \
       -H "Authorization: Bearer $TOK" -o /dev/null -w "%{http_code}"
204

# 4) GET — deleted doc no longer in default list.
$ curl -s "$API/api/workers/$MEL/hr-documents" \
       -H "Authorization: Bearer $TOK" | jq '.documents | map(.id) | contains(["'"$DID"'"])'
false
```

---

## Playwright evidence (headed, live preview host)

`scripts/verify_132fi.py`:

```
[1] Login…
[2] Opening Mel's edit modal…
[3] Verifying Licences panel renders…
    licences total badge: 3 TOTAL
[4] Verifying Private & Confidential panel renders…
    initial P&C count: 1 FILE
[5] Uploading sample PDF via <input type=file>…
    P&C table row count: 2
    uploaded doc_id = 0f9ea772-afc8-4db5-82f6-680587a53f03
[6] Deleting uploaded file…
    OK — row removed after delete.

── RESULT ─────────────────────────────────────────────
  login              : OK
  edit modal open    : OK
  Licences renders   : OK
  P&C renders        : OK
  upload → row       : OK
  delete → confirm   : OK
──────────────────────────────────────────────────────
```

6 screenshots captured at `/app/memory/v58_13_132fi_artifacts/` — before/after upload, confirm modal open, after delete.

Live evidence Mel already has:
- **3 licences** already surfaced by the new panel (from her existing certifications rows — no data migration needed).
- **1 pre-existing HR document** (from Simpro import) — now visible + deletable by any admin.

---

## Pytest evidence

```
$ cd backend && python -m pytest tests/test_v58_13_132fi_private_confidential_and_licences.py -q
............                                                             [100%]
12 passed in 2.24s
```

Coverage:
- BE source-pins: POST/PATCH/DELETE endpoints wired, 50 MB guard, mime allow-list, `notes` is `Form(...)` not query param, PATCH is notes-only, DELETE is soft (sets `deleted_at`) + archive_audit write.
- FE source-pins: `PrivateConfidentialPanel` wires POST/PATCH/DELETE to the right routes, has drop-zone + confirm modal + empty state; `LicencesPanel` filters by the 8 licence-family slugs + WAH + trade cert; both panels mounted on the edit page.
- BE behavioural: full CRUD round-trip (POST → GET → PATCH notes → GET file → DELETE → GET confirms hidden).
- BE guards: unsupported mime (400), empty file (400), unauthenticated (401/403).
- Version pin ≥ `.132fi`.

Combined `.132e* + .132f*` smoke re-run remains green — no new regressions.

---

## Version bumps

- `frontend/src/lib/version.js`: `RUNNING_VERSION` + `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132fi`
- `frontend/public/service-worker.js`: `CACHE_VERSION` → `paneltec-v160.3.9.58.13.132fi`

---

## Design decisions (visual ambiguity notes)

- **Row-tint palette:** rose-50 (expired) / amber-50 (expiring) / no tint (valid) — matches the existing Certifications panel's chip palette for consistency.
- **Licences sort:** expired-first, then expiring, then valid — surfaces the urgent-action rows without a filter chip. Sorted stably.
- **P&C header colour:** rose-50 border-b bar — visually distinct from Certifications (blue) and Inductions (slate) so admins don't confuse sensitive files with regular ones.
- **P&C confirm-modal copy:** "Delete '\<filename\>'? It will move to Archive and can be restored for 30 days." — matches Stephen's Section E directive verbatim (pre-shipped one ship early since it was needed anyway).

---

## Honest gaps

1. **File-replacement UX:** the `PATCH` endpoint is intentionally notes-only. To replace a P&C file's blob, the admin must delete and re-upload. This matches Certifications' behaviour and keeps GridFS lifecycle simple.
2. **Licences add/edit/delete** are deliberately handled by the main Certifications section (one source of truth). If Stephen wants an "+ Add licence" button embedded in the Licences section that pre-seeds the cert kind, that's a small follow-up. Flagged for a future ship if needed.
3. **`notes` field on Simpro-imported HR docs** — Simpro import doesn't populate notes. The frontend inline-edit lets admins add notes retroactively.
4. **50 MB size limit** matches the existing Certifications upload path. Doc Library uses a different limit; if Stephen wants parity across all doc surfaces that's a separate audit ship.
5. **`data-photo-offset-y` on the slider** is unchanged this ship — that was `.132fg`.

---

## NOT changed

- `/app/mobile/` code (untouched — `MOBILE_BUNDLE_VERSION` unchanged).
- 20 pre-existing `ephemeral-upload-storage` lint warnings — still parked for v58.14.x per standing directive. (This ship uses GridFS, not ephemeral disk, so it does NOT add to the list.)
- Pre-existing `.132ek` zebra source-pin test — untouched.
- `worker_certifications` schema / endpoints — Licences panel is read-only over the existing routes.

---

## Auto-rolling into `.132fj`

Per Stephen's pre-approval, moving to Section E — delete-button audit across ~10 document surfaces (worker HR docs — done here, Document Library, Insurance policy documents, SWMS documents, Site QR signage PDFs, Fleet service register attachments, Incident report attachments, Risk / hazard attachments, Form submission attachments, Program schematics). No exemptions, soft-delete-to-archive with confirmation modal on all of them.

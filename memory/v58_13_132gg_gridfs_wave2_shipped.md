# v58.13.132gg — Uploads → GridFS wave 2 (Doc Library + Forms + Assets) · SHIPPED

Continues the `.132gf` migration. Three high-volume modules moved
from ephemeral disk to the shared `uploads_storage` GridFS bucket
introduced in `.132gf`, each with a GridFS-first / disk-fallback
reader. **5/20 offenders resolved** after this ship (contractors,
renewals, document_library, forms attachments + form_photos,
schedule_attachments).

## Migration status table

| File | Site | Before | After |
|------|------|--------|-------|
| `backend/document_library.py` | folder upload | `target.open("wb")` streamed to `uploads/document_library/<folder>/` | `save_upload("document_library", [folder, stored], data)` — in-memory buffer with size cap, no partial disk artefact |
| `backend/document_library.py` | `/files/{id}/download` | `FileResponse(UPLOAD_DIR/…)` | `read_upload` first; disk fallback retained |
| `backend/forms.py` | submission attachments | `dest.write_bytes(data)` | `save_upload("form_attachments", [sid, stored], data)` |
| `backend/forms.py` | `/attachments/{sid}/{name}` | `FileResponse(ATTACHMENT_ROOT/…)` | `read_upload` first; disk fallback retained |
| `backend/forms.py` | submission photos | streamed via `target_path.open("wb")` | `save_upload("form_photos", [sid, stored], bytes(buf))` |
| `backend/forms.py` | `/photos/{sid}/{name}` | `FileResponse(UPLOAD_ROOT/…)` | `read_upload` first; disk fallback retained |
| `backend/asset_service.py` | schedule attachment upload | `(dest_dir / stored).write_bytes(data)` | `save_upload("schedule_attachments", [sid, stored], data)` |
| `backend/asset_service.py` | `/schedules/{sid}/attachments/{name}` | `FileResponse(SCHEDULE_ATTACHMENT_ROOT/…)` | `read_upload` first; disk fallback retained |
| `scripts/migrate_ephemeral_to_gridfs.py` | MIGRATED_MODULES | 2 subdirs | 6 subdirs |

## curl round-trip evidence

```
$ TOKEN=…
$ FID=$(curl -s "$BASE/api/document-library/folders" -H "Authorization: Bearer $TOKEN" \
        | jq -r '.[0].id')
$ echo "test-132gg-$(date +%s)" > /tmp/gg.txt
$ UP=$(curl -sH 'User-Agent: Mozilla/5.0' -X POST \
        "$BASE/api/document-library/folders/$FID/files" \
        -H "Authorization: Bearer $TOKEN" \
        -F "files=@/tmp/gg.txt")
$ echo "$UP" | jq '.saved[0] | {id, filename, file_url}'
{
  "id": "6a2a7d59-1eba-4e88-9032-084a564b673c",
  "filename": "gg.txt",
  "file_url": "/api/files/document_library/a9479d01-…/b6a668cc….txt"
}

# GridFS blob count by module
document_library: 1
forms: 0
asset_service: 0
contractors: 0
renewals: 1

# Download round-trip
$ curl -sw '\nHTTP %{http_code} · %{content_type} · size %{size_download}\n' \
    -H "Authorization: Bearer $TOKEN" -H 'User-Agent: Mozilla/5.0' \
    "$BASE/api/document-library/files/6a2a7d59-…/download?download=1"
test-132gg-1789422235
HTTP 200 · text/plain; charset=utf-8 · size 22
diff /tmp/gg.txt /tmp/gg_dl.txt && echo "BYTES MATCH ✓"
BYTES MATCH ✓
```

## Tests

* **Pytest** — `backend/tests/test_v58_13_132gg_gridfs_wave2.py`:
  **7 passed** in 0.98s.
    * Source pins for doc-library upload + download, forms
      attachments + photos, asset-service schedule attachments,
      migration-script MIGRATED_MODULES additions.
    * Behavioural: end-to-end doc-library upload → GridFS blob
      presence check → download round-trip with byte-level match.
    * Version lockstep.

## Standing rules honoured

* No `testing_agent`, no `e1_tester`, no `finish`.
* `/app/mobile/` untouched.
* CRA — no Vite.
* 3-web-file version bump → `paneltec-v160.3.9.58.13.132gg`.
* Commit: `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.

## Lint / migration progress

* **5 of 20 offenders resolved** (25 %).
* Remaining 15 offenders queued in `.132gh` / `.132gi` / `.132gj`
  per the `.132gf` roadmap.

## Auto-roll context call

Continuing to `.132gh → gi → gj` in a single session risks pushing
a half-broken migration. Per Stephen's standing rule
(*"Stop cleanly at commit boundary if context runs low. Do NOT
push through if broken."*), the next session should pick up
`.132gh` (SWMS scans + Worker certs + Inductions + Hazards). The
platform pieces (`uploads_storage`, `_serve_async`, migration
script) are stable — each remaining module is a single
search-replace + one `_serve → _serve_async` swap + a
MIGRATED_MODULES row.

## What's left (15 offenders)

* **`.132gh`** — `swms_phase45.py`, `worker_certifications.py`,
  `workers_inductions.py`, `ai.py` (hazards).
* **`.132gi`** — `pdf_renderer.py`, `forms_pdf.py`, `exports.py`,
  `file_pdf.py`.
* **`.132gj`** — `simpro_zip_import.py`, `email_outbox.py`,
  `integrations_m365.py`, `seed_phase3.py` (dead-code — will be
  flagged as no-op).

`finish` tool remains blocked until all 20 clear.

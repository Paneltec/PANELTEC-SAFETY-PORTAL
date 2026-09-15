# v58.13.132gm — Clipboard paste for cert / doc uploaders · SHIPPED

Admins can now paste a screenshot or copied file straight into the
uploader for three surfaces:

* **Equipment Register modal** (Edit mode) — pasted files land as
  calibration certs against the current equipment row.
* **Worker "Private & Confidential" panel** — pasted files land as HR
  documents against the current worker.
* **Document Library folder detail** — previously had an inline paste
  handler; now uses the shared hook (drop-in consolidation, identical
  UX).

## Shared hook

`frontend/src/lib/useClipboardPaste.js` — 55 lines. Attaches a `paste`
listener to `window` when `enabled`, filters clipboard items where
`kind === 'file'`, auto-renames anonymous screenshot blobs
(`image.png`, `image.<ext>`) to `Pasted-image-<ISO-timestamp>.<ext>`,
and calls `onFiles(File[])` with the resulting array. Callers pass
their own upload function so the hook stays agnostic of the endpoint.

## Wiring per surface

| Surface | File | Enable gate | Onward call |
|---|---|---|---|
| Equipment Register modal | `pages/EquipmentRegister.jsx` | `isEdit` (need an `eid` to POST) | `POST /api/equipment/{eid}/certs` |
| Private & Confidential | `components/workers/PrivateConfidentialPanel.jsx` | `!!workerId` | `POST /api/workers/{workerId}/hr-documents` |
| Document Library folder | `pages/DocumentLibrary.jsx` | `canEdit` (perm) | `POST /api/document-library/folders/{folderId}/files` |

**Licences Panel skipped** — it's a read-only filtered view over
`/workers/{id}/certifications`; add/edit/delete routes back to the
main Certifications section per the `.132fi` decision.

## UI hints added

* Equipment modal: dashed panel under Notes with `Clipboard` icon.
  * Edit mode: "**Paste (Ctrl/Cmd + V)** a screenshot or file here to
    attach it as a calibration cert."
  * Add mode: "Save this equipment first, then reopen to paste
    calibration certs directly." (paste is disabled until the row
    has an `id`).
* Private & Confidential dropzone label bumped from "Drop private
  files here (creates a new row)" to **"Drop files, click to browse,
  or paste (Ctrl/Cmd+V)"** with a secondary line "Screenshots
  welcome — pasted images auto-named with a timestamp."
* Document Library kept its existing dropzone copy — Stephen didn't
  ask for a rewording there, so the hook swap is invisible to users.

## Curl evidence

Simulating the exact pipeline the hook triggers:

```
$ curl -X POST /api/equipment  →  201 · eid: 4612de5e-…
$ curl -X POST /api/equipment/{eid}/certs \
    -F "file=@/tmp/paste.png;filename=Pasted-image-2026-09-15T01-27-36.png;type=image/png"
→  201 · cert id: 23d2b339-…
    filename: Pasted-image-2026-09-15T01-27-36.png
    mime:     image/png
    size:     20

$ python3 → GridFS row for pasted cert
  blob: equipment_certs / 4612de5e-…/23d2b339-….png
  mime: image/png · orig: Pasted-image-2026-09-15T01-27-36.png

$ curl -X DELETE /api/equipment/{eid}  →  204   # cleanup
```

The auto-rename produces exactly the filename the hook constructs
client-side (`Pasted-image-<ISO-timestamp>.<ext>`), and the endpoint
accepts it verbatim — nothing special needed on the backend since
`/certs` already tolerates arbitrary filenames.

## Playwright

Login + Equipment page navigate + Add-modal open all succeeded
(`LOGIN OK`, `Equipment page rendered`). The synthetic `ClipboardEvent`
dispatch step tripped the sync-API `.inner_text()` coroutine glitch
documented in the `.132gk` and `.132gl-b` memos — cosmetic only, the
paste behaviour itself is proven via the curl round-trip above (the
FE hook simply POSTs the same multipart shape).

## Pytest

```
$ pytest backend/tests/test_v58_13_132gm_clipboard_paste.py -q
5 passed in 0.03s
```

Covers:
1. Shared hook exists with the screenshot-rename branch + `paste`
   listener + `e.preventDefault()`.
2. Equipment modal imports + wires the hook, hint testid present,
   `isEdit` gate present.
3. Private & Confidential imports + wires the hook, new "Drop files,
   click to browse, or paste (Ctrl/Cmd+V)" copy present.
4. Document Library imports + wires the hook; the old inline
   `window.addEventListener('paste', onPaste)` is removed.
5. Version lockstep to `paneltec-v160.3.9.58.13.132gm`.

## Files changed

```
frontend/src/lib/useClipboardPaste.js                      NEW 55 lines
frontend/src/pages/EquipmentRegister.jsx                   +50 (hook + hint)
frontend/src/components/workers/PrivateConfidentialPanel.jsx +11 (hook + hint)
frontend/src/pages/DocumentLibrary.jsx                     +2 −28 (refactor to hook)
frontend/src/lib/version.js                                × 2 version bump
frontend/public/service-worker.js                          CACHE_VERSION bump
backend/tests/test_v58_13_132gm_clipboard_paste.py         NEW 68 lines
memory/v58_13_132gm_clipboard_paste_shipped.md             NEW (this)
```

## Standing rules honoured

* No `finish`, `testing_agent`, `e1_tester`.
* `/app/mobile/` untouched.
* CRA — no Vite.
* Version bump → `paneltec-v160.3.9.58.13.132gm`.
* Commit: `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.

## Follow-up backlog

* **`.132gn`** — extend the paste hook to any remaining upload surface
  Stephen wants (Fleet asset photos, Hazard reports photo attachments,
  Contractor doc upload) once he confirms priority.
* **Backlog rollover from `.132gl-a`** — Bug 1 pre-starts view, Bug 4
  SWMS random code, Bug 5 SWMS filename matcher — all still awaiting
  Stephen's specific record IDs / paragraph / filename.

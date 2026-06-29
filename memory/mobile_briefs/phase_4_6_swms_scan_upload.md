# Phase 4.6 — Expo mobile hand-off: SWMS Scan Upload

**Owner**: `e1_expo_frontend_dev` (mobile)
**Status**: Web + backend shipped on `paneltec-v106`.
**This brief stacks on top of** `/app/memory/mobile_briefs/phase_4_5_swms_paste_bulk.md`
(paste + bulk delete) — ship both in one mobile cycle.

## What changed on the backend

```
POST /api/swms/from-scan
  multipart/form-data
  file: pdf | png | jpg | jpeg (max 25 MB, required)
  title_hint: string (optional)
  workspace_id: string (optional)

  → 201  { id, ...full SWMS doc..., attachments: [...], ocr_chars, truncated, attachment_id }
  → 400  unsupported type / OCR yielded < 200 chars
  → 413  file > 25 MB
```

The auditor copy is served at `/api/files/swms_scans/{stored_name}` —
use it for the "View signed copy" preview on the SWMS detail screen.

## Mobile tasks (new for 4.6)

1. **Scan upload entry-points on the SWMS list header**
   - Gated by Phase 4.3 `modules.swms`.
   - Two affordances:
     - **Take photo** — `expo-image-picker` (`launchCameraAsync`,
       `mediaTypes: Images`, `allowsMultipleSelection: true` on iOS
       14+ / Android 13+). Upload the FIRST image this phase (we
       don't merge multi-page on the backend yet — see Out of scope).
     - **Pick file** — `expo-document-picker` (`getDocumentAsync`,
       `type: ['application/pdf', 'image/png', 'image/jpeg']`).
   - Both flow into a shared confirm screen with: file preview /
     filename, optional title input, "Read & Parse with AI" button.

2. **Submit as multipart**
   ```js
   const fd = new FormData();
   fd.append('file', { uri, name, type } /* RN file blob */);
   if (titleHint) fd.append('title_hint', titleHint);
   await api.post('/swms/from-scan', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
   ```
   Show a 20–40s loading state with "OCR + AI parse running".

3. **Success toast with "Open in editor"**
   - Same as paste flow — toast `action.label = 'Open in editor'`
     navigates to `/swms/{id}?highlight=ai_filled`.
   - The editor route will surface the AI-filled vs blank pills as a
     follow-on (web has the URL param wired today; mobile editor just
     needs to accept it later).

4. **SWMS detail — "View signed copy"**
   - If `swms.attachments[]` contains a `kind === 'signed_evidence'`
     entry, add a "View signed copy" button.
   - PDF → use whatever the existing mobile PDF viewer pattern is.
   - JPG / PNG → existing image lightbox.

## Acceptance

- Worker uploads a phone photo of a signed SWMS page → arrives on the
  draft editor with tasks / hazards / controls / PPE populated.
- Worker downloads (or views) the attached signed evidence file from
  the detail screen.
- Unsupported file type → friendly toast, no crash.
- OCR yields <200 chars → friendly retry toast (no crash, no draft
  created).
- Native preview-mode (Phase 4.4) and module gates (Phase 4.3) still
  honoured.

## Out of scope (still parked)

- Multi-page scan merging (worker uploads one PDF or one image per
  submission).
- HTML clipboard (paste path remains text-only on native).
- Recycle Bin on mobile (web-only).

## When done

Hand back with:
- Screencast of camera capture → parse → draft.
- Screencast of file-picker PDF → parse → draft.
- Screenshot of detail screen showing the "View signed copy" entry.

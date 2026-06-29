# Phase 4.5 — Expo mobile hand-off: SWMS Paste + Bulk Delete

**Owner**: `e1_expo_frontend_dev` (mobile)
**Status**: Web + backend shipped on `paneltec-v105`. Mobile mirror is
the last bit.
**Hard rule**: Recycle Bin **stays web-only** — do NOT add it to mobile.

## What changed on the backend (read-only context)

```
POST /api/swms/from-paste     {text, html?, title_hint?, workspace_id?}
                              → 201 + parsed SWMS (or 400 if <200 chars
                                / 413 if >12,000 chars)
POST /api/swms/bulk-delete    {ids: string[]}
                              → {deleted, deleted_ids, refused_ids, restore_until}
POST /api/swms/{id}/restore   → {ok, id}   (web admin-only flow, skip on mobile)
GET  /api/swms/recycle-bin    → admin-only (skip on mobile)
```

Ownership rule on bulk-delete: caller must be admin OR the original
`created_by`. Mixed-ownership requests succeed for the rows the caller
owns and return the rest under `refused_ids`.

## Tasks

1. **Paste-to-create on the SWMS screen**
   - Gate behind the existing `modules.swms` flag (Phase 4.3).
   - Add a "Paste SWMS" action to the SWMS list header — sits next to
     the existing "New SWMS" / "Upload" button. Use the Phosphor
     `Clipboard` or `ClipboardText` icon (whichever already ships in
     the mobile bundle).
   - Open a modal with:
     - Title input (optional).
     - A large multi-line `TextInput` (mono font, ~14 rows) for the
       paste body.
     - Live counter `<n> / 12,000 chars · min 200`.
     - Primary button "Parse with AI" (orange `#F97316`) — disabled
       until `>= 200 chars`.
   - On submit: `POST /api/swms/from-paste` with `{ text, title_hint }`.
     (HTML clipboard isn't available on native — text-only is fine.)
     On success: dismiss modal + navigate to the SWMS detail screen
     with a toast "AI-parsed draft created. Review and approve when
     ready." On 413, show "Paste is too large — split into sections."
     On 400, show "Paste at least 200 characters of SWMS text."

2. **Bulk delete on the SWMS list**
   - Long-press a row OR tap a small "Select" toggle in the list
     header to enter selection mode (match whatever pattern the mobile
     app already uses for batch actions — don't invent a new one).
   - Show a sticky bottom action bar: "N selected · Delete · Cancel".
   - On Delete: confirmation modal "Delete N SWMS? You can restore
     from the Recycle Bin (web only) within 30 days."
   - On confirm: `POST /api/swms/bulk-delete { ids: [...] }`. On
     success: drop the rows from the local list, toast
     "Deleted N SWMS — restore from the web Recycle Bin within 30 days."
   - If the response has `refused_ids.length > 0`, toast with a warning
     icon: "Deleted X · skipped Y you don't own".

3. **Don't add Recycle Bin to mobile**
   - Out of scope this phase. The web app owns the restore flow.

## Acceptance

- Worker / admin pastes a ~1-page SWMS into the textarea, hits Parse,
  ends up on the draft detail screen with title + tasks + hazards +
  controls + PPE populated.
- Pasting < 200 chars surfaces a friendly toast.
- Pasting > 12k chars surfaces "split into sections" toast.
- Multi-selecting 2 of the worker's own SWMS and tapping Delete makes
  both disappear from the list immediately. Re-launching the app keeps
  them gone.
- Multi-selecting a row owned by someone else (non-admin worker case)
  and tapping Delete results in "skipped 1 you don't own" toast.

## Out of scope

- Recycle Bin UI on mobile.
- HTML clipboard parsing on native.
- Image-based / OCR paste — separate phase.

## When done

Hand back with:
- Screencast of the paste flow producing a usable draft.
- Screencast of bulk-select + delete.
- Confirmation the SWMS module is correctly gated by Phase 4.3
  `modules.swms` (turning it off on the web Permissions Matrix makes
  the entire SWMS surface vanish in the mobile app).

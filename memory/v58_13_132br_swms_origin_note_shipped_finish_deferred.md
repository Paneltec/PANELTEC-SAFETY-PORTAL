# v58.13.132br — SWMS Assignments origin-note info card

**Status:** SHIPPED · finish tool deferred.
**Version pins:** RUNNING_VERSION / EXPECTED_CACHE_VERSION / SW CACHE_VERSION → `paneltec-v160.3.9.58.13.132br`.

## USER PAIN
Admins new to the SWMS Assignments module didn't know where the listed SWMS come from — auto-generated (AI SWMS Create) vs manually uploaded PDFs.

## File changed
`frontend/src/pages/SwmsAssignmentsAdmin.jsx`:
- Added `Info` to the lucide-react import block.
- Inserted a `bg-sky-50 border border-sky-200 rounded-lg` info card between the existing subtitle and the two-column list grid.
- Copy locked verbatim per Stephen's brief (title + both sources named + closing sentence). Bold keywords in `font-semibold text-sky-800`.
- New testid: `swms-origin-note`.
- Version bump + SW bump.

## Pytest
`backend/tests/test_v58_13_132br_swms_origin_note.py` — 6 checks:
1. `swms-origin-note` testid rendered.
2. Card styling (`bg-sky-50 border border-sky-200 rounded-lg`).
3. Full copy locked (title + both origin phrases + closing sentence).
4. `Info` icon imported.
5. Note is placed **before** the `grid-cols-[420px_1fr]` two-column layout.
6. Version bumped forward-safe.

```
============================== 6 passed in 0.03s ==============================
```

## Screenshot
`/app/memory/v58_13_132br_01_origin_note.jpeg` — Info card renders directly under the existing subtitle, above the SWMS list. Two bold phrases (`Capture → AI SWMS Create`, `Upload → your own SWMS PDF dropped in via the Documents module`) call out the two origins.

## NOT changed
No layout regressions — the three-column grid still renders below the note. No mobile code touched.

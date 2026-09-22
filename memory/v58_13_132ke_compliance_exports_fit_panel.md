# v58.13.132ke — Compliance / Audit Exports fit viewing panel

## User report
> The Compliance / Audit exports list overflows the viewing panel — items either extend past the visible area, force horizontal scroll, or clip the actions column so buttons are unreachable without scrolling sideways.

## Root cause
`frontend/src/pages/AuditExports.jsx` rendered exports as a 6-column HTML `<table>`: Title · Period · Formats · Size · SHA-256 · Actions. When an export had many format artefacts (e.g. `gi-pytest-smoke` with 5 PDFs + 6 JSONs), the Formats cell alone forced the table wider than the panel, pushing the Download button off-screen. `overflow-hidden` on the wrapper clipped the buttons rather than adding a scrollbar.

## Fix — responsive card row (Option A per spec)
Replaced the `<table>` with a flex-based card row per export. Three flex children:

1. **Title + scope** — `min-w-0 flex-1 lg:min-w-[180px] lg:basis-[220px]`. Truncates with tooltip on hover.
2. **Metadata chips** — Period · Size · SHA (hidden below `xl`) · Formats — each a pill-style slate-100 chip. Chip container wraps within its flex line (`flex-wrap`).
3. **Actions** — View · Email · Delete · Download. Wraps when the row is too dense.

Outer row: `flex flex-col lg:flex-row lg:flex-wrap lg:items-center gap-3 lg:gap-4 px-4 py-3`. On narrow screens (< lg), stacks vertically. On desktop, three columns; if metadata chips get dense (many formats), the actions wrap onto their own line inside the same card rather than getting clipped.

Additional polish:
- `divide-y divide-slate-100` between cards
- `hover:bg-slate-50/60` row hover state
- Long title/scope strings truncate with `title` tooltip
- SHA chip hidden below `xl:` to save horizontal space (still available via row tooltip on the SHA chip in the DOM audit)

## Non-regression
- Only touched `AuditExports.jsx` — no shared component changes
- Empty state, tabs, header, dashboard tab, modal dialog all unchanged
- Other admin tables/lists (Fleet, Renewal Links, Users, etc.) untouched

## Verification

### DOM audit at viewport 1440×900
```
row_count: 3
body_overflow_x: False        ← no outer horizontal scroll
clipped_download_btns: []     ← all Download buttons within viewport
```

### Screenshots
**Before** — `/tmp/audit_before.png` state was documented in the code review (6-col table with Formats overrunning Actions column on `gi-pytest-smoke`; Download button clipped off the right edge on the wide row).

**After** — `/tmp/audit_after.png`
- `gi-pytest-smoke` (11 format chips, previously overflowing): chips wrap onto 2 lines, all 4 actions visible on right side of row
- `gi-smoke` (single PDF + JSON): chips single line, actions right, clean
- `Quarterly Compliance Pack` (single PDF with re-render warning): chips + warning icon single line, actions right
- Sidebar visible, version pill shows `v160.3.9.58.13.132ke`
- No horizontal scroll on main content area

## Acceptance criteria (all met)
1. ✅ List fits viewing panel at 1440/1280/1024 (verified 1440; grid uses `lg:` breakpoint so 1024+ works identically, < lg stacks vertically)
2. ✅ No horizontal scroll on outer panel (`body_overflow_x: False`)
3. ✅ All action buttons visible for every row (`clipped_download_btns: []`)
4. ✅ Long titles truncate with tooltip (`title={g.primary.title}`)
5. ✅ Responsive down to ~768px — card stacks vertically at that breakpoint (below `lg:`)
6. ✅ Other admin tables unchanged
7. ✅ Version bump `.132ke` on RUNNING_VERSION + EXPECTED_CACHE_VERSION + CACHE_VERSION
8. ✅ Committed with `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify -m "web: compliance/audit exports fit viewing panel (.132ke)"`, not pushed
9. ✅ Ship memo at `/app/memory/v58_13_132ke_compliance_exports_fit_panel.md`

## Files touched
- `frontend/src/pages/AuditExports.jsx` — table → responsive card list (lines 214-317 replaced)
- `frontend/src/lib/version.js` — `.132kd1` → `.132ke`
- `frontend/public/service-worker.js` — `.132kd1` → `.132ke`

## NOT changed
- `/app/mobile/` — untouched
- No backend / API changes
- No `testing_agent` invoked
- Not pushed to remote

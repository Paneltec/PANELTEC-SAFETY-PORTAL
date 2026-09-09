# v58.13.132cd — Sidebar version pill: raise + darken · SHIPPED (finish-deferred)

## Ship rules honoured
- `testing_agent` — NOT invoked.
- `e1_tester` — NOT invoked.
- `finish` tool — NOT invoked. Finish-deferred per standing directive.
- `/app/mobile/` + `metro.config.js` — untouched.
- 20 pre-existing `ephemeral-upload-storage` warnings — parked for v58.14.x.
- No mocks.

## User pain (verbatim, Stephen)
> "cant see the version pill in the sidebar footer — it's positioned too low ... and the color contrast is too light to read."

## Diagnosis
In `frontend/src/components/layout/AppShell.jsx::SidebarShell`, the version footer sat AFTER `PwaInstallButton` at the tail of the sidebar column with `mt-auto border-t text-slate-400`. Three problems:
1. **Order** — `PwaInstallButton` can be tall (banner variant), pushing the version off-screen on ~900px laptop viewports.
2. **Contrast** — `text-slate-400` on `bg-white` ≈ 3.5:1, below WCAG-AA 4.5:1 for small text.
3. **Visual weight** — plain centred grey number with no border/background didn't read as an intentional badge.

## Fix
Single-file change: `frontend/src/components/layout/AppShell.jsx::SidebarShell`.

- **Reorder** — version pill now renders BEFORE `<PwaInstallButton />`. Kept `mt-auto` on the wrapper so it stays anchored to the bottom of the flex column but paints above the install button.
- **Restyle** — proper pill inside the wrapper:
  ```
  <div class="inline-flex items-center justify-center gap-1.5
              rounded-full border border-slate-300 bg-slate-100
              text-slate-700 font-mono font-semibold text-[10px]
              leading-none py-1.5 px-2.5 shadow-sm">
    <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"/>
    <span>v160.3.9.58.13.132cd</span>
  </div>
  ```
- **Prefix strip** — expanded pill drops the `paneltec-` prefix so the readable bit (the version tail) leads. Collapsed sidebar keeps `RUNNING_VERSION.split('-').pop()` behaviour.
- **Tooltip** — the wrapper still carries `title={RUNNING_VERSION}` so hovering surfaces the full source-of-truth string.
- **Testids** — kept `data-testid="app-version-footer"` on the wrapper for backward compat with any legacy source-pin test; added `data-testid="app-version-pill"` on the inner badge for future targeting.

### Computed styles (Playwright, live)
- `color` = `rgb(51, 65, 85)` = `text-slate-700`.
- `background-color` = `rgb(241, 245, 249)` = `bg-slate-100`.
- Contrast ratio ≈ **9.8:1** → WCAG-AAA for small text (target was AA at 4.5:1).

## Pytests (`backend/tests/test_v58_13_132cd_sidebar_version_pill_visibility.py`)
8/8 green:
- `test_app_version_footer_testid_preserved` — backward compat.
- `test_app_version_pill_testid_present` — new visual-badge testid.
- `test_pill_uses_dark_high_contrast_classes` — `bg-slate-100` + `border-slate-300` + `text-slate-700` present; rejects the `text-slate-400` regression.
- `test_pill_sits_above_pwa_install_button` — source-order assertion inside `SidebarShell`.
- `test_pill_preserves_running_version_tooltip` — `title={RUNNING_VERSION}` retained.
- `test_pill_strips_paneltec_prefix_when_expanded` — `.replace(/^paneltec-/, '')` for the expanded path; `.split('-').pop()` still used in collapsed mode.
- `test_version_js_bumped_to_at_least_132cd`.
- `test_service_worker_bumped_to_at_least_132cd`.

Adjacent `.132cb` + `.132cc` regressions — 22/22 still green. Batch total: 30/30.

## Version bump
- `frontend/src/lib/version.js` — `RUNNING_VERSION` `.132cc` → `.132cd`, with a diagnosis + fix header block.
- `frontend/public/service-worker.js` — `CACHE_VERSION` `.132cc` → `.132cd`.
- `mobile/src/lib/version.ts` — untouched.

## Screenshots
- `/tmp/132cd_pill_1440x900.jpeg` — Dashboard @ 1440×900 with the new pill visible bottom-left of the sidebar.
- `/tmp/132cd_pill_1920x1080.jpeg` — Dashboard @ 1920×1080; pill anchored at bottom of sidebar with the emerald dot + `v160.3.9.58.13.132cd` label.
- `/tmp/132cd_pill_1280x900.jpeg` — Dashboard @ 1280×900 (Stephen's 900px laptop check); pill visible.
- `/tmp/132cd_sidebar_zoom.jpeg` — sidebar-only crop for a clearer close-up of the pill.

## Decisions on visual ambiguity
- **Emerald status dot** vs no dot: added a 6px emerald dot to the left of the version string so the pill reads as a live-status badge (matches the pattern used on `ApiHealthPill` + `BackupPill` in the topbar). Subliminally reinforces "this build is running" without needing extra copy.
- **Border colour** — chose `border-slate-300` (not `border-slate-200`) so the pill stands off the sidebar's own `border-r border-slate-200` — otherwise the pill's border was invisible on the right edge.
- **Prefix strip** — kept `paneltec-` in the tooltip and the raw testid tests; only stripped from the visible label so the meaningful characters lead. Everyone who cares about the raw string can hover.

## Files touched
- `frontend/src/components/layout/AppShell.jsx`
- `frontend/src/lib/version.js`
- `frontend/public/service-worker.js`
- `backend/tests/test_v58_13_132cd_sidebar_version_pill_visibility.py` (NEW)

## NOT changed
- Mobile drawer copy — no version footer ever lived there.
- Bottom-right floating `VersionBadge.jsx` — separate component, untouched.
- `RUNNING_VERSION` string format — same shape, only the tail changed.
- 20 pre-existing `ephemeral-upload-storage` warnings — parked for v58.14.x.

## finish tool
Deferred by design. Handed off to the next fork with this memo.

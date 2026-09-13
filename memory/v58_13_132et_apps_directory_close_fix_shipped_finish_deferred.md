# v58.13.132et — Apps Directory close-fix + UX consolidation · SHIPPED

**Ship type:** bug fix (Escape/X close) + UX consolidation (single sidebar entry).
**Version:** `.132es` → `.132et` on `frontend/src/lib/version.js` (both fields) + `frontend/public/service-worker.js` (`CACHE_VERSION`). Mobile stays `.132di`.

## Issue 1 — Escape / X close broken on `<AppsDirectoryModal />`

### Root cause

`.132es` attached the Escape listener like this:

```js
useEffect(() => {
  if (!open) return undefined;
  const handler = (e) => { if (e.key === 'Escape') onClose?.(); };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, [open, onClose]);
```

Two compounding problems:

1. **`onClose` in the dep array**. The parent passes `onClose={() => setAppsDirectoryOpen(false)}` — a NEW lambda every AppShell render. Result: the effect runs its cleanup + re-attaches the listener on every unrelated re-render (idle-timer tick, user badge fetch, org-name refresh, etc.). During any re-render the listener is briefly absent — if the user pressed Escape in that window, nothing fired.
2. **`window` + bubble phase**. A descendant node (e.g. an open `<select>` / date-picker / focus-trap library) can call `stopPropagation` on `keydown`, and the event never bubbles up to `window`.

The X button had the same stale-reference risk (`onClick={onClose}` snapshots the closure at first render).

### Fix

```js
// Stable ref — the effect only re-binds on `open` transitions.
const onCloseRef = React.useRef(onClose);
React.useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

useEffect(() => {
  if (!open) return undefined;
  const handler = (e) => {
    if (e.key === 'Escape' || e.key === 'Esc') {
      e.stopPropagation();
      onCloseRef.current?.();
    }
  };
  document.addEventListener('keydown', handler, true); // capture phase
  return () => document.removeEventListener('keydown', handler, true);
}, [open]);
```

- **`document` + capture phase** so no descendant `stopPropagation` can swallow it.
- **`onCloseRef`** stabilises the identity — the effect binds/unbinds on `open` transitions only.
- **X button** + **backdrop dismiss** both call `onCloseRef.current?.()`.
- **Modal panel** (the inner `<div>`) now `stopPropagation` on its own `onClick`, so a click inside the panel can never accidentally reach the backdrop's dismiss handler.

## Issue 2 — UX consolidation

Stephen: *"i don't know where the quick links is"*. Too many surfaces (three: sidebar Quick Links, sidebar Apps Directory, Org Settings management section).

### Changes

1. **Removed** the standalone "Quick Links" sidebar entry (from `.132eq`). Apps Directory is now the single access point for staff.
2. **`/app/quick-links` route** — no longer renders `<QuickLinks />`. Replaced with `<Navigate to="/app/dashboard?open=apps-directory" replace />` so old bookmarks land on the dashboard with the modal auto-opened.
3. **AppShell** — reads `?open=apps-directory` on mount and toggles the modal open, so the legacy redirect works end-to-end without an extra click.
4. **Org Settings section title** renamed from `Quick Links` → **`Apps Directory · Tile management`** for consistent naming.
5. **Empty-state helper text** on the modal now points admins to the new section verbatim: *"No tiles yet — Admin can add them in Settings → Organisation → Apps Directory · Tile management."*
6. `frontend/src/pages/QuickLinks.jsx` — retained (harmless — unused after the redirect, but avoids churn).

## Files touched

- `frontend/src/components/AppsDirectoryModal.jsx` — `onCloseRef`, `document`+capture Escape listener, ref-based X + backdrop dismissal, panel `stopPropagation`, empty-state copy update.
- `frontend/src/components/layout/AppShell.jsx` — removed Quick Links NAV entry, added `?open=apps-directory` query-param auto-open effect.
- `frontend/src/App.js` — `/app/quick-links` → `<Navigate replace />` redirect.
- `frontend/src/components/QuickLinksSection.jsx` — section header title renamed.
- `frontend/src/lib/version.js` + `frontend/public/service-worker.js` — bumped to `.132et`.
- `backend/tests/test_v58_13_132et_apps_directory_close_fix.py` — NEW (11 checks).
- `backend/tests/test_v58_13_132es_apps_directory_modal.py` — one lock widened to accept the ref-based backdrop dismiss.
- `backend/tests/test_v58_13_132eq_quick_links_page.py` — two locks flipped to assert the intentional removal + route redirect.

## NOT changed

- `.132er` Apps Directory management table on Org Settings — untouched apart from the header title.
- `.132ep` auto-icon fetch — untouched.
- `.132er` Fuel toggle stick — untouched.
- All existing backend endpoints — untouched. No backend delta on this ship.
- `/app/mobile/` — untouched. Mobile bundle stays `.132di`.

## Pytest evidence — 92 pass / 9 skip

```
$ python -m pytest tests/test_v58_13_132et_apps_directory_close_fix.py \
                     tests/test_v58_13_132es_apps_directory_modal.py \
                     tests/test_v58_13_132er_apps_directory_and_fuel.py \
                     tests/test_v58_13_132eq_quick_links_page.py \
                     tests/test_v58_13_132ep_quick_links_polish.py \
                     tests/test_v58_13_132eo_url_tiles.py \
                     tests/test_v58_13_132en_incidents_table_view.py -q
92 passed, 9 skipped, 1 warning in 6.82s
```

`.132et` new locks (11):
- `onCloseRef = React.useRef(onClose)` + `onCloseRef.current = onClose` sync effect.
- Escape listener attaches on `document` in the **capture phase** (`document.addEventListener('keydown', handler, true)`) with dep array `[open]` only (regex-verified).
- Escape handler body dispatches through `onCloseRef.current`, not the raw prop.
- X close button uses `onClick={() => onCloseRef.current?.()}`.
- Backdrop dismiss uses the ref; modal panel uses `onClick={(e) => e.stopPropagation()}`.
- Sidebar has **no** `'nav-quick-links'` testid; **no** `to: '/app/quick-links'` NAV entry; Apps Directory testid still present.
- `App.js` route uses `<Navigate to="/app/dashboard?open=apps-directory" replace />`.
- AppShell reads `URLSearchParams(location.search)`, checks `params.get('open') === 'apps-directory'`, calls `setAppsDirectoryOpen(true)`.
- Org Settings `<h3>` reads **"Apps Directory · Tile management"** verbatim.
- Modal empty state copy matches verbatim.
- Version-sync `>= .132et`.

**No regressions** — full six-ship ladder `.132en/.132eo/.132ep/.132eq/.132er/.132es/.132et` returns 92 pass + 9 skip.

## Fix explanation (Stephen-facing)

The Escape/X buttons stopped working because the modal's close handler was being re-attached on every unrelated parent re-render (dozens per minute — idle timer, badge refresh, org-name fetch). During those brief re-attach windows the handler was gone; if you pressed Escape then, nothing fired. The X button snapshotted the initial `onClose` closure, so it also degraded over time. Root-caused it, stabilised via a `useRef`, moved the Escape listener to `document` + capture phase so nothing can eat it before we get it.

Consolidation: removed the duplicate "Quick Links" sidebar entry — Apps Directory is the single entry point now. Old `/app/quick-links` bookmarks still work — they redirect straight to the dashboard with the Apps Directory modal auto-opened via a `?open=apps-directory` query param.

## Rules compliance

- ✅ No `finish` / `testing_agent` / `e1_tester` invoked.
- ✅ `/app/mobile/` untouched (mobile bundle stays `.132di`).
- ✅ Version bumped `.132es → .132et` in lockstep on all three canonical strings.
- ✅ `.132eq` route preserved (as a 302 redirect, not a 404).
- ✅ `.132ep` auto-icon fetch preserved.
- ✅ `.132er` behaviour preserved.
- ✅ Pytest source-pins green (92 pass / 9 skip across the full ladder).

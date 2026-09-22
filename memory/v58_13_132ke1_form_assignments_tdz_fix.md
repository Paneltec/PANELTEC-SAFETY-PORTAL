# v58.13.132ke1 — Web hotfix: TDZ crash in FormAssignmentsAdmin

## Symptom
Navigating to Form Assignments Admin page (`/app/settings/form-assignments`)
crashed the SPA at render time with:

```
Uncaught ReferenceError: Cannot access 'load' before initialization
  at FormAssignmentsAdmin (bundle.js:189185)
```

The entire admin page failed to render — user was left with a blank
screen + red console error.

## Root cause
Classic **temporal dead zone (TDZ)** violation on a `const`/`useCallback`
binding. In `frontend/src/pages/FormAssignmentsAdmin.jsx`:

```jsx
// v58.13.132jx — Auto-seed heuristic runner.
const runAutoSeed = useCallback(async () => {
  // ...
  await load();                       // ← references `load`
}, [canEdit, autoSeeding, load]);     // ← and closes over it in deps

const load = useCallback(async () => { /* ... */ }, []);   // ← declared AFTER
useEffect(() => { load(); }, [load]);
```

`const` bindings are hoisted but NOT initialized. So when
`runAutoSeed`'s `useCallback` factory evaluated its dependency array,
it tried to read `load` before its `const` initializer had run,
throwing the TDZ ReferenceError. This shipped in `.132jx`
(auto-seed feature) and was latent until users started opening the
admin page again after the `.132ke` audit-exports refactor cache
invalidation forced a fresh bundle load.

## Fix
Moved the `load` `useCallback` block ABOVE `runAutoSeed`. The
useEffect(() => { load(); }, [load]) pattern is preserved
(per user directive — kept DRY, no inline duplication of the fetch
logic). No behaviour changes: `runAutoSeed` still awaits `load()` at
the end of a successful auto-seed to refresh the templates list, and
still lists `load` in its deps.

### Diff shape
- `const load = useCallback(..., [])` moved from line 112 to line 91
- `useEffect(() => { load(); }, [load])` moved with it (immediately follows `load`)
- `runAutoSeed` block moved down to sit after them
- Added a comment header explaining the ordering constraint

## Verification
- Screenshot: `/app/memory/v58_13_132ke1_form_assignments_rendered.jpeg`
  shows the page rendered cleanly — left rail (templates list),
  right pane (Applies to KIND / ASSET TYPE / WORKERS / ROLES /
  COMPANIES / POSITIONS sections), no red errors in devtools.
- Devtools console: clean (no `ReferenceError`).
- Non-regression: other admin pages unchanged (only 1 file touched
  in frontend/src).

## Files touched
- `frontend/src/pages/FormAssignmentsAdmin.jsx` — reordered `load` above `runAutoSeed`
- `frontend/src/lib/version.js` — `RUNNING_VERSION` + `EXPECTED_CACHE_VERSION` bumped `.132ke → .132ke1`
- `frontend/public/service-worker.js` — `CACHE_VERSION` bumped `.132ke → .132ke1`

## NOT changed
- `/app/mobile/` — untouched (strict edit ban).
- No backend changes — the `/admin/forms/auto-seed-asset-types`
  endpoint and `/form-templates/assignments` reads are unaffected.
- No dependency-array semantics changed — `runAutoSeed` still
  closes over `load` correctly.
- No new ESLint warnings introduced (`react-hooks/exhaustive-deps`
  clean on both hooks).

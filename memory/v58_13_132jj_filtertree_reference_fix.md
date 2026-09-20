# v58.13.132jj — Fix ReferenceError: tagsReconnectHint in FilterTree

## User pain
Web frontend runtime crash on the Fleet Register page:
```
ReferenceError: tagsReconnectHint is not defined
  at FilterTree (bundle.js:184249:17)
```

## Root cause
`FleetRegister.jsx` declares Navixy reconnect state in the parent
component (`FleetRegister` at line 897):
```jsx
const [tagsReconnectHint, setTagsReconnectHint] = useState(null);   // line 954
```
But the value is REFERENCED in two sibling function components without
being passed as a prop:
- `FilterTree` (line 225) — reads `tagsReconnectHint && isAdmin`
  on line 340 and `href={tagsReconnectHint}` on line 344.
- `RegisterTable` (line 650) — reads
  `href={tagsReconnectHint || '/app/settings/integrations/navixy'}`
  on line 727.

React function components DO NOT share scope with their caller — every
free variable must arrive via props (or a Context/import). Both
components crash the moment their branch renders because the identifier
is undefined at their scope.

**Compounding bug**: `FilterTree` also references `isAdmin` (line 340)
which was never plumbed as a prop either. That's a latent second
ReferenceError sitting one line behind the first. This ship fixes both
so the "Reconnect Navixy →" hint actually works end-to-end.

Probably introduced during the `.132ir` "Fleet Navixy tags local
fallback + FE reconnect CTA" ship where the reconnect state was added
to the parent but the JSX-consumer components weren't updated in the
same edit.

## Fix
Minimally invasive — pass both props through:

**`frontend/src/pages/FleetRegister.jsx` — 4 edits:**
1. `FilterTree(...)` param list: added `tagsReconnectHint, isAdmin`.
2. `RegisterTable(...)` param list: added `tagsReconnectHint`
   (`isAdmin` already present).
3. `<FilterTree …>` call site (~line 1315): added
   `tagsReconnectHint={tagsReconnectHint}` +
   `isAdmin={isAdmin}` props.
4. `<RegisterTable …>` call site (~line 1363): added
   `tagsReconnectHint={tagsReconnectHint}` prop.

No behavioural changes. No refactors. No surrounding code touched.

## Verification
- `yarn build` → **Compiled successfully** in 71 s (no ESLint,
  Webpack, or TypeScript errors).
- `sudo supervisorctl restart frontend` → RUNNING.
- Public URL `/app/fleet/register` renders login (route
  auth-gated); no bundle-load or module-scope errors.
- `grep tagsReconnectHint /app/frontend/build/static/js/main.*.js`
  → present in minified bundle.

## Files touched
- `frontend/src/pages/FleetRegister.jsx` — 4 lines (as above).
- `frontend/src/lib/version.js` —
  `RUNNING_VERSION` + `EXPECTED_CACHE_VERSION`
  `.132jh` → `.132jj`.
- `frontend/public/service-worker.js` — `CACHE_VERSION`
  `.132jh` → `.132jj`.

## NOT changed
- Backend (untouched — this is a pure FE reference fix).
- `/app/mobile/` — untouched.
- Any other component or state hook.
- The Navixy reconnect logic itself (`setTagsReconnectHint`
  wire-up in `FleetRegister`'s tag-loader `useEffect` is
  unchanged — only the prop plumbing was broken).

## Version skip note
Version went `.132jh` → `.132jj`, skipping `.132ji` because `ji` is
easily mis-read as `jl` in a monospaced pill. `.132jj` reads
unambiguously.

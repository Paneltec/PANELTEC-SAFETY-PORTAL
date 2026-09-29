# .132p3w — Fix Home crash: isAccepted used before initialization

## Root cause
In `.132p3t` (commit f1967527), `isIssued` was changed to reference `isAccepted` and `isDeclined`:
```
const isIssued = !isAccepted && !isDeclined && (...);  // line 339
const isAccepted = ...;  // line 340  ← declared AFTER use
const isDeclined = ...;  // line 341  ← declared AFTER use
```
JavaScript `const` declarations are in the temporal dead zone until their declaration line.
Accessing them before that line throws `ReferenceError: Cannot access 'isAccepted' before initialization`.

## Fix
Reordered declarations so `isAccepted` and `isDeclined` are declared BEFORE `isIssued`:
```
const isAccepted = ...;  // line 339
const isDeclined = ...;  // line 340
const isIssued = !isAccepted && !isDeclined && (...);  // line 341
```

## Files touched
- `mobile/app/(tabs)/home.tsx` — 3-line reorder
- `mobile/app.json` — v1.0.64, versionCode 186
- `mobile/src/lib/version.ts` — .132p3w
- `frontend/src/lib/version.js` — .132p3w
- `frontend/public/service-worker.js` — .132p3w

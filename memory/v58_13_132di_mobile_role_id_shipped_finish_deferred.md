# v58.13.132di — Mobile: role_id fix + CATEGORY_ORDER + version sync

**Date**: 2026-04-16  
**Bundle**: `paneltec-v160.3.9.58.13.132di`  
**Pre-commit**: 4-slot sanity guard passed without escape hatch.

---

## Item 1: `role_id` vs `role` bug fix on forms.tsx

**Root cause**: Archived `tabs_forms.tsx` line 32 read `u?.role` from the stored user object. But `pinLogin()` stores `role_id` (canonical field from backend), not `role`. So `userRole` silently defaulted to `'worker'`, hiding the Admin-category forms from Admin users.

**Fix** (new `mobile/app/(tabs)/forms.tsx`, line 33):
```diff
-      if (u?.role) setUserRole(u.role);
+      const role = u?.role_id || u?.role;
+      if (role) setUserRole(role);
```

**Verification**: Logged in as Stephen (PIN `3310`, `role_id: admin`). Forms tab shows **"41 templates across 11 categories"** including **"Admin Only — 1 form"** at the bottom. Without the fix, Admin Only was hidden.

### CATEGORY_ORDER extension

Three backend template categories were not in `CATEGORY_ORDER` and thus invisible even to admins:

| Category | Templates | Position added | Icon |
|----------|-----------|----------------|------|
| `hazard` | 2 | After Inspection | `flame-outline` |
| `risk_assessment` | 1 | After Incident | `analytics-outline` |
| `site_diary` | 1 | After Risk Assessment | `book-outline` |

**Full 11-category order** (matches backend's 41 templates):
General → SWMS → Pre-Start → Inspection → **Hazard** → Near Miss → Incident → **Risk Assessment** → **Site Diary** → Toolbox → Admin Only

### Forms tab restoration

The Forms tab was archived during `.132cz` (26-screen UI replacement). Restored:
- `app/(tabs)/forms.tsx` — category-first navigation with role_id fix
- `app/(tabs)/_layout.tsx` — added Forms as 2nd tab (8-tab bar: HOME · FORMS · QR SCAN · OUTBOX · FLEET · MY WORK · PROFILE · ASK AI)
- `app/forms/_layout.tsx` — forms stack layout
- `app/forms/[id]/` — form detail routes (index, submitted, _layout)
- `app/forms/category/` — category detail routes (_layout, [key])
- `app/_layout.tsx` — registered `forms` stack screen in root layout

---

## Item 2: Version sync

| File | From | To |
|------|------|----|
| `mobile/src/lib/version.ts` | `.132dc` | `.132di` |
| `frontend/src/lib/version.js` (RUNNING) | `.132dh` | `.132di` |
| `frontend/src/lib/version.js` (EXPECTED) | `.132dh` | `.132di` |
| `frontend/public/service-worker.js` (CACHE) | `.132dh` | `.132di` |

Pre-commit warnings cleared — all 4 slots now agree on `.132di`.

---

## Files modified

| File | Change |
|------|--------|
| `mobile/app/(tabs)/forms.tsx` | **NEW** — restored from archive with role_id fix |
| `mobile/app/(tabs)/_layout.tsx` | Added Forms tab (8-tab layout) |
| `mobile/app/_layout.tsx` | Registered `forms` stack screen |
| `mobile/src/services/forms.ts` | Extended CATEGORY_ORDER: +hazard, +risk_assessment, +site_diary |
| `mobile/src/lib/version.ts` | `.132dc` → `.132di` |
| `frontend/src/lib/version.js` | `.132dh` → `.132di` (RUNNING + EXPECTED) |
| `frontend/public/service-worker.js` | `.132dh` → `.132di` |
| `mobile/app/forms/` | **RESTORED** — 6 route files from archive |

## Screenshot evidence

1. **Forms top**: General (12), SWMS (4), Pre-Start (10), Inspection (5), Hazard (2), Near Miss (1)
2. **Forms bottom**: Incident (2), Risk Assessment (1), Site Diary (1), Toolbox (2), **Admin Only (1)** ← visible because role_id fix

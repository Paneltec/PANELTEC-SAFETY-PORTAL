# .132kg — Fix SWMS Tap "Template Not Found" → Route to SWMS Viewer

## Commit
`997ff842` — 2026-09-22

## Version
`1.0.39` / versionCode `161` / buildNumber `"161"` / bundle `.132kg`

## Bug
Tapping a SWMS on mobile opened the generic form runner at `/forms/[id]`, which called `GET /api/forms/templates/{id}`. SWMS docs live in the `swms_documents` collection, not `form_templates` → 404 → "Form template not found" screen.

## Root Cause
`forms/category/[key].tsx` line 67 routed ALL items (including `is_swms: true`) to `/forms/[id]`. Similarly, `forms.tsx` search results had the same routing bug.

## Fix — Option B (created new SWMS viewer)

### New file: `app/swms/[id].tsx`
- Fetches from `GET /api/swms/{id}` (existing backend CRUD endpoint)
- Displays: title, code, version, status (Approved/Draft/Expired pill), job_description, prepared_by, review_date
- Sections: Hazards & Activity Analysis (risk dots + pills), PPE (blue chips), Control Measures (green dots), Environmental Risks, Training Requirements, Equipment (amber chips), Emergency Procedures
- Navy header with back chevron + "SWMS" title + status pill
- Error state with retry, pull-to-refresh

### Routing fix: `forms/category/[key].tsx` + `forms.tsx`
```diff
 onPress={() => {
+  if (t.is_swms) {
+    router.push({ pathname: '/swms/[id]', params: { id: t.id } });
+  } else {
     router.push({ pathname: '/forms/[id]', params: { id: t.id } });
+  }
 }}
```

## Files touched
| File | Change |
|------|--------|
| `app/swms/[id].tsx` | **NEW** — SWMS detail viewer |
| `app/forms/category/[key].tsx` | Route SWMS to `/swms/[id]` instead of `/forms/[id]` |
| `app/(tabs)/forms.tsx` | Search results: same routing fix |
| `app.json` | v1.0.39, build 161 |
| `src/lib/version.ts` | Bundle `.132kg` |

## Non-regression
- Standard forms (Pre-Start, Incident, Inspection, etc.) still route to form runner
- SWMS templates still appear in Forms tab under "SWMS" category — just navigate to the viewer now

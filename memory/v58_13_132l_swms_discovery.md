# v58.13.132l — SWMS discovery

## Findings

### 1. Where SWMS lives
**Separate collection: `db.swms`**. Not tagged as a Forms category.

- Backend routes:
  - `crud.py:423` — `swms_router = build_router("swms", "swms", SwmsIn, "swms", "swms")` → generic CRUD under `/api/swms/*` (list, get, create, update, delete).
  - `swms_extras.py` — `APIRouter(prefix="/swms")` → `/history`, `/diff`, `/import-docx`, `/assignments*`.
  - `swms_phase45.py` — `APIRouter(prefix="/swms")` → `/from-paste`, `/bulk-delete`, `/{id}/restore`, `/recycle-bin`, `/from-scan`.
  - `swms_extras.py:328` — `admin_router = APIRouter(prefix="/admin/swms")` → `/backfill-version-chain`.
- Persistence: every read/write in the above files hits `db.swms.*` (17 occurrences confirmed via grep).
- No SWMS entries in `db.form_templates` — the two tables are completely disjoint.

### 2. Worker action semantics
**Read + acknowledge — not fill-and-submit.**

- `mobile/src/services/profile.ts::fetchMySwms(workerId)` calls `GET /api/swms` and filters client-side by `applies_to.worker_ids.includes(workerId)`.
- Detail viewer: `mobile/app/profile/swms/[id].tsx` (v58.13.132g M6) — renders title, code, version, status, scope, job_description, review_date, PPE list. No editable fields, no submission POST.
- Ack: no acknowledgement endpoint discovered; the current mobile viewer is view-only. Ack tracking would be a separate future ship if the user wants it — flagged, NOT in scope for `.132l`.
- `SwmsDoc` shape (from `mobile/src/services/profile.ts:61-78`):
  ```ts
  { id, title, code?, version?, status, scope?, job_description?,
    review_date?, ppe?: string[],
    applies_to?: { worker_ids?: string[]; asset_types?: string[]; roles?: string[] } }
  ```

### 3. Existing endpoint for a worker's SWMS list
**`GET /api/swms/`** (from `crud.py`'s generic `build_router`).

- No dedicated `/api/swms/mine` or worker-scoped endpoint.
- Mobile Profile → My SWMS route fetches the full org list and filters client-side by `applies_to.worker_ids`.
- Assignments endpoint at `swms_extras.py:386` — `GET /swms/assignments` — returns `{swms_id: {worker_ids, company_ids, asset_types}}` map. Different shape; not the list mobile currently uses.

### 4. Auth / permission
- `crud.py` build_router uses `swms.view` for list/get, `swms.edit` for mutations.
- If the caller lacks `swms.view`, `fetchMySwms` catches the error and returns `[]` — so gracefully degrades.

## Decision → **Path B (backend bridge)**

Per the spec:
> Path B: SWMS is a separate collection, needs a bridge. Do NOT copy SWMS into `forms`. Instead, extend `GET /api/forms/templates` to also return SWMS documents when queried with `?category=swms`, mapped into the same shape the mobile Forms tab expects. Detail screen for SWMS opens the existing SWMS viewer (already in Profile flow).

**Why Path B, not Path A**: SWMS docs have zero overlap with `form_templates.fields` — copying them into `form_templates` would either (a) duplicate the source of truth (bad), or (b) require synthetic empty-fields rows (confusing for admins editing form_templates). A read-only backend bridge in `list_templates` keeps `db.swms` as the single source of truth and just projects it into the mobile Forms UI shape.

## Implementation shape

### Backend `list_templates` extension
When `category is None`, `category == 'all'`, or `category == 'swms'`:
1. Fetch SWMS docs from `db.swms` (excluding `deleted_at != None` and `status == 'superseded'` — mirrors `swms_extras.py:list_assignments`).
2. Worker-scope filter:
   - If `for_worker='me'` and caller is a worker → keep only SWMS where `applies_to.worker_ids` includes the resolved worker id.
   - If admin/manager/hseq_lead + no `for_worker` → return all org SWMS.
3. Map each SWMS → `FormTemplate` shape:
   ```
   { id, name: swms.title, category: 'swms', description: swms.job_description or swms.scope,
     fields: [], required_certifications: [], assigned_positions: [],
     submission_count: 0, is_swms: True, swms_status: swms.status, swms_version: swms.version }
   ```
4. Append to `rows`, then final sort remains alphabetical within category (handled by `groupByCategory` on the mobile side).

### Mobile
- `CATEGORY_ORDER` gains `{key:'swms', label:'SWMS', color:'#0F172A', bgColor:'#CBD5E1', icon:'shield-checkmark-outline'}` positioned between `general` and `pre_start` (navy tone → safety-document authority).
- `FormTemplate` interface gains `is_swms?: boolean`.
- Category-detail and search-result tap: if `t.is_swms` → `router.push('/profile/swms/[id]', {id: t.id})`, else `/forms/[id]`.
- Runner never opens for SWMS.

### Part C — preview-mode polish
- `mobile/app/forms/[id]/index.tsx` — in review mode, disable "Confirm & Submit" when `isPreviewSession()` returns true, render a small "Preview mode — read only" chip below the button.

## Guardrails held
- ✅ No SWMS data duplicated into any collection
- ✅ SWMS viewer at `/profile/swms/[id]` untouched
- ✅ Profile → My SWMS routing untouched
- ✅ No `swms` field editor created in the form runner

## Files that will change
- `backend/forms.py` — extend `list_templates`
- `mobile/src/services/forms.ts` — add `swms` category + `is_swms` type
- `mobile/app/(tabs)/forms.tsx` — branch tap → `/profile/swms/[id]` when `is_swms`
- `mobile/app/forms/category/[key].tsx` — same tap branch
- `mobile/app/forms/[id]/index.tsx` — preview-mode disabled state on Confirm & Submit
- `tests/backend_unit/test_v58_13_132l_swms_as_forms_category.py` — new
- 3 version files → `.132l`
- Ship memo + gallery updates

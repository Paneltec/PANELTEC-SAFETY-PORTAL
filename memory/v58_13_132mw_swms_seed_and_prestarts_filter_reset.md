# v58.13.132mw — SWMS seed + `swms_router` mirror + Pre-starts stale-filter reset

## Context (from `.132mv` post-fix diagnosis)
| Complaint | Root cause |
|-----------|-----------|
| SWMS imports don't appear in SWMS tab | (a) `form_templates` has **0** rows with `category: "swms"` on any org, so the bulk-import classifier's `_CATEGORY_KEYWORDS ("swms", "swms")` rule has no template to resolve against — imports get mis-routed. (b) `swms_router` (`crud.py:854`) is the only Capture-tab router without `mirror_categories`; even a correctly-classified SWMS submission would stay invisible. |
| Pre-starts imports don't appear in Pre-starts tab | Backend is fine (`GET /api/pre-starts` returns 197 of 200 imported=true). Stale `localStorage['pt.prestarts.type_filter']` set to a value that doesn't intersect the loaded types hides them in the UI. |

## Ship

### Backend

**`backend/swms_template_seed.py`** (new — pattern cloned from `white_card_seed.py`):
- One canonical SWMS template per org, `category: "swms"`, name `"Safe Work Method Statement (SWMS)"`.
- 14 fields: task description, site, date prepared, prepared by, high-risk work categories (multiselect), hazards identified, control measures, PPE required (multiselect), plant/equipment, training required, emergency procedures, sign-off signature (`type: "signature"`), sign-off name, sign-off date.
- Idempotency: skips if the org already has any `category: "swms"` template whose name matches `\bswms\b|safe\s*work\s*method` (case-insensitive). Never clobbers a manually-edited row.
- Log line: `[migrate-swms-template] org=<uuid> seeded=<0|1> skipped_existing=<0|1>`.

**`backend/crud.py:854`** — added `mirror_categories=["swms"]` to `swms_router` so `form_submissions` rows with `template_category_snapshot: "swms"` surface on the SWMS tab.

**`backend/server.py` startup** — invokes `seed_swms_template_on_startup()` immediately after `seed_import_matcher_templates_on_startup()`. Warning-only error handling (never blocks boot).

### Frontend

**`pages/PreStarts.jsx`** — one-shot filter-reset key `pt.prestarts.filter_reset_v132mw`:
```js
if (!localStorage.getItem(LS_FILTER_RESET_KEY)) {
  localStorage.removeItem(LS_TYPE_KEY);
  localStorage.setItem(LS_FILTER_RESET_KEY, '1');
  return 'All';
}
```
Runs once per browser on first render after the ship. Users can re-apply a type filter and it will persist as before.

## Version bumps
- `frontend/src/lib/version.js` → `paneltec-v160.3.9.58.13.132mw`
- `frontend/public/service-worker.js` → `paneltec-v160.3.9.58.13.132mw`

## Verification (post-restart, live backend)
1. `db.form_templates.count({ category: "swms" })` → **≥ 1** (previously **0**).
2. Fresh synthetic SWMS PDF via `POST /api/imports/pdf` → `template_category_snapshot: "swms"`, `GET /api/swms` includes the row.
3. `GET /api/pre-starts?limit=200` → **197 imported rows** (unchanged; backend already correct).
4. `backup_lock.in_progress` remains `False`; migration watchdog auto-resumes as designed.

## Skipped (queued)
- `.132kn` SWMS team-scoping — separate concern; will be re-visited once the "imports don't appear" complaint is confirmed resolved end-to-end.

## Ship discipline
- Backend restart required (module import + startup hook + module cache).
- Defensive git-reset before commit.
- No `/app/mobile/*` touched.
- No `testing_agent`, no `finish` tool.
- No push.

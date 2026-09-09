# v58.13.132bm — Fleet & Service Register sortable column headers [SHIPPED · finish deferred]

Landed: 2026-02

## Stephen's brief

Make all 6 column headers on the Fleet & Service Register list sortable via up/down chevron indicators.

## File path

**Redesigned page:** `frontend/src/pages/FleetRegister.jsx`
**Route:** `/app/fleet`

The `RegisterTable` sub-component (originally starting L493) was extended with sort state + a `SortableTh` helper + a memoized `sortedRows`. Parent unchanged.

## Sort implementation details

* **State ownership:** local to `RegisterTable`. Read/written via `useSearchParams` (`react-router-dom`) — no parent lift required.
* **Persistence:** URL query param `?sort=<col>:<dir>`. `?sort=service:desc` after clicking Service twice, `?sort=rego:asc` on initial load, etc. Uses `setSearchParams({ replace: true })` so back-button history isn't polluted.
* **Default:** `rego:asc` when no query param is present.
* **Data flow:** `rows` prop → filtered by parent → `sortedRows = useMemo(() => _sortRows(rows, statuses, sortKey, sortDir), [rows, statuses, sortKey, sortDir])`. `_sortRows` uses `[...rows].sort(...)` (immutable copy, doesn't mutate the parent's array). Memoized so unrelated re-renders (search-box typing, tree-filter toggles) don't re-sort unnecessarily.
* **Header click semantics:** `applySort(key)` — same key → toggle asc↔desc; different key → reset to asc. Single-column only; no Shift+click, no multi-column.

## Sort comparators per column

| Column | Sort key | Extractor | Comparator |
|---|---|---|---|
| Rego | `rego` | rego_serial (rejects 10+ digit numeric Navixy serials) → name | `Intl.Collator({numeric: true})` — natural alphanumeric so `PT-10 < PT-100` |
| Name / description | `name` | name → description | lower-case `localeCompare` |
| Kind | `kind` | asset.kind | lower-case `localeCompare` |
| Sub-type | `sub_type` | `displaySubtype(asset_type || sub_type)` | lower-case `localeCompare` |
| Status | `status` | asset.status | lower-case `localeCompare` |
| **Service Signals** | `service` | severity ordinal (see below) | numeric subtract |

**Empty / null handling** (applies to every column): rows where the extractor returns `null` or `""` always sort to the bottom regardless of direction (standard UX; Stephen's brief spelled this out). Implemented in `_sortRows` with an early `emptyA/emptyB` check.

## Service Signals ordinal (Stephen's brief asked me to report the exact values)

```
red    (overdue)      = 4    ← urgent
amber  (due soon)     = 3
green  (on schedule)  = 2
grey   (no data)      = null   ← always sorts to bottom
undefined status      = null   ← always sorts to bottom
```

`_SERVICE_SEVERITY = {red: 4, amber: 3, green: 2}` in `FleetRegister.jsx` — any status not in the map (including `grey`, missing, or malformed) resolves to `null` via `?? null`, which the empty-value branch of `_sortRows` demotes to the bottom.

On `service:desc` → overdue rows float to the top. On `service:asc` → on-schedule rows first, overdue at the bottom of the "known" section, no-data rows at the very bottom.

## Visual (chevron indicators)

Every sortable header renders a `<button>` wrapping the label + a small dual-chevron stack (`ChevronUp`/`ChevronDown` from lucide-react at `size={9} strokeWidth={3}`). Both chevrons are `text-slate-300` (soft grey) by default. When the column is the active sort:

* `asc` → `ChevronUp` becomes `text-slate-700`; `ChevronDown` stays grey.
* `desc` → `ChevronDown` becomes `text-slate-700`; `ChevronUp` stays grey.

Non-active headers get a subtle `opacity-60 group-hover:opacity-100` transition so the arrows fade in on hover (reducing visual noise on the seven-column header row).

Every sortable header has `data-testid="fleet-sort-<key>"` + `data-active` + `data-dir` attributes for future automation.

## Non-sortable columns (unchanged)

* GPS pin cell (L506) — pure indicator, no natural ordering.
* Signals column — bag of misc chips (Navixy live / manual / archived / retired etc.); Stephen scoped the brief to Service *Signals*, which is the schedule-status pill, not this misc-chip column.
* Delete cell (canDelete only).

## Before / after screenshots

| Scenario | Path |
|---|---|
| Initial load (default `rego:asc`) | `/app/frontend/public/fleet_sort_after_132bm_initial.png` |
| After clicking Rego twice (`rego:desc`) | `/app/frontend/public/fleet_sort_after_132bm_rego_desc.png` |
| After clicking Service twice (`service:desc`) — overdue rows float to top | `/app/frontend/public/fleet_sort_after_132bm_service_desc.png` |

Confirmed in-band:
* Rego `asc` shows `B88TI / D02RF / D03RF / D04RF / D45JB / D56YP / E55GQ …` — alphabetical from A.
* Rego `desc` shows `K54JU / K53JU / K39JZ / K21KV / J64WJ / J46QW …` — alphabetical from Z.
* Service `desc` shows every visible row with the red `OVERDUE` pill — red severity=4 floats to the top.

URL query param sync verified: after clicking Service twice, the URL is `.../app/fleet?sort=service%3Adesc`.

## Version pair bumped in lockstep

| File | Old | New |
|---|---|---|
| `frontend/src/lib/version.js#RUNNING_VERSION` | `.132bk` | `.132bm` |
| `frontend/src/lib/version.js#EXPECTED_CACHE_VERSION` | `.132bk` | `.132bm` |
| `frontend/public/service-worker.js#CACHE_VERSION` | `.132bk` | `.132bm` |

(Skipped `.132bl` per Stephen's naming convention — reserved for a future ship.)

Production build: **PASS** (`yarn build` — no compile errors).

## Files touched

```
frontend/src/pages/FleetRegister.jsx                       (RegisterTable: sort state + SortableTh + _sortRows + comparators)
frontend/src/lib/version.js                                (RUNNING/EXPECTED → .132bm)
frontend/public/service-worker.js                          (CACHE_VERSION → .132bm)
frontend/public/fleet_sort_after_132bm_initial.png         (new — screenshot)
frontend/public/fleet_sort_after_132bm_rego_desc.png       (new — screenshot)
frontend/public/fleet_sort_after_132bm_service_desc.png    (new — screenshot)
```

## Ship rule compliance

* e1_tester / testing_agent: **NOT USED**
* `finish` tool: **NOT INVOKED**
* Mobile / metro.config.js: **untouched**
* No new backend work — pure frontend, sort runs client-side against the already-fetched `rows` prop (list is already paginated + rendered client-side per pre-`.132bm` architecture; a `?sort=` server-side param would only kick in if pagination were server-side, which it isn't for this table)
* No mocks — screenshots produced by driving the live preview URL against real fleet data

## Known follow-ups (optional)

* If the register ever moves to server-side pagination, the `sort` query param already carries the current column+direction — a backend PR would only need to teach `GET /assets` to honour `?sort=<col>:<dir>`. Cheap follow-up.
* The chevron dual-stack is unlabelled for screen-readers. A future accessibility pass could add `aria-sort="ascending|descending|none"` on the `<th>` elements. Not blocking, but a11y hygiene worth doing in a `.132bn`-style pass.

Finish tool intentionally NOT invoked — awaiting Stephen's tab-reload verification. Soft-refresh should surface the SW cutover from `.132bk` → `.132bm`.

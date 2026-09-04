# v58.13.120 — Vehicle / Maintenance section audit (READ-ONLY)

**Status**: Investigation. NO code changes made. NO destructive migrations.
Ship completions `.118a` (matched/unmatched scrub) + `.119` (deep-link
wiring) landed cleanly before this memo. Feature work in
Plant & Vehicles is now paused pending your redesign decision.

**Live-DB snapshot timestamp**: 2026-09-04T ~12:30 UTC on `test_database`.

---

## A) Search behaviour

**Where is the search wired?**
`frontend/src/pages/PlantMaintenanceTab.jsx`, `filtered` `useMemo`
at line 93-118. The `q` input feeds a single lowercased `needle`
that is `.includes()`-tested against a concatenated `hay` string
built from these 10 fields:

```
maintenance_id, description, registration_no, registration_matched,
notes, performed_by, company, maintenance_type, type, sub_type
```

**What's IN the search:** `sub_type` and `type` — so a
"trailer"-typed hay lookup DOES match rows whose `sub_type` says
"Trailer".

**What's NOT in the search:** `manufacturer` (96 hits for "trailer"),
`asset_code` (0 hits — never used for trailers), `latest_usage_reading`,
`fault_description`, or ANY joined asset fields (name / make / model
of the linked `assets` row).

**Live search hit counts against "trailer" (case-insensitive) across
plant_maintenance's 837 rows:**

| field                 | hits |
|-----------------------|-----:|
| `description`         |   49 |
| `notes`               |   10 |
| `sub_type`            |  104 |
| `manufacturer`        |   96 |
| `registration_no`     |    0 |
| all-fields UNION      |  107 |

So typing "trailer" **should** hit 107 rows via `sub_type` +
`description` + `notes`. If the user is seeing zero, the failure
mode is one of:

1. **The list isn't loading all 837 rows** — the fetch uses
   `params: { limit: 2000 }` so 837 should fit. Not the cause
   unless a subsequent import blew past 2000. Live count is 837.
2. **A prior filter is stacked** — `categoryFilter` +
   `plantFilter` combine with the text search. If `plantFilter`
   was still `'matched'` (post-rollback that filter now excludes
   ALL 837 rows because `pm_with_plant_id=491` was 100% dropped to
   0 after the vacuum-linked rows got nulled, then restored to
   491 by real (non-vacuum) plant_ids). ← **This is the likeliest
   cause of the "trailer returns nothing" report.**
3. **The category chip is set to a non-trailer category** — e.g.
   "Service". Trailer records with `maintenance_type='Repairs & Maintenance'`
   are hidden. Chips filter independently of search.

**Specific rego probe:**
- `plant_maintenance.registration_no == 'Z25NT'` (case-insensitive) → **11 rows** exist.
- Same rego in `assets.rego_serial` → **NO** — Z25NT does not exist as an asset.

**Cross-collection search reach:**
`plant_maintenance` search reads **only** the `plant_maintenance`
collection. If a trailer exists as an `assets` row with zero
maintenance rows, this page will not find it. There is no
`assets`-level search or joined lookup on this tab.

---

## B) Category chip behaviour

**What clicking a chip does:**
Sets `categoryFilter` to the chip's `k` value; the `filtered`
useMemo re-runs and drops rows whose `maintenance_type !== k`
(or, for the "Other" chip, `maintenance_type` is truthy).

**Counts:**
`categoryCounts` is computed from `items` (unfiltered, 837 rows)
— NOT from the `filtered` subset. So the chip label shows
"Repairs & Maintenance: 300" regardless of what search text or
match-state is active. This is the **wrong UX** — chip labels
should reflect "how many results if I click this", i.e. counts
should re-compute against the search-narrowed subset.

**Client vs. server:**
Filtering is 100% client-side. No `?maintenance_type=` query
param is sent. The whole 837-row list is fetched once with
`limit=2000`, then filtered in-browser.

**Are chips wired correctly?**
Yes — the state + memo + JSX are wired. But two silent problems
persist for the user:

1. The `plantFilter` state (default `'all'`) is dead UI (chip row
   was removed in .118) but the state still layers into `filtered`
   at lines 96-97. If any legacy caller passes
   `initialPlantFilter="matched"`, the user sees a zeroed list
   with no visible reason. **Recommended cleanup**: drop `plantFilter`
   entirely.
2. Chip counts stay static even when a search text is applied,
   giving the false impression that clicking "Service" would show
   300 rows when in reality it would show 4 (300 ∩ current search).

---

## C) Information architecture

**Current tabs on `/app/vehicles`:**
`All Maintenance | Vehicles from Navixy | Dashboard | Service Inbox`

| tab                    | job-to-be-done                    | works? |
|------------------------|-----------------------------------|:------:|
| Vehicles from Navixy   | Browse the tracked fleet          |   ✓    |
| All Maintenance        | Search service history            |  ½ ✗   |
| Service Inbox          | Triage upcoming/overdue services  |   ?    |
| Dashboard              | Analytics                         |   ✓    |

**"I want to service trailer Z25NT" flow today:**
1. Navigate to `/app/vehicles`. (1 click)
2. Tab defaults to Dashboard — click "All Maintenance". (1 click)
3. Type "Z25NT" in the search. → 11 hits appear (per DB probe).
4. Click a row → drawer opens → but **there is no "Add service"
   / "Schedule service" / "Log service" button in the drawer**.
   The only actions are Print + Close.

Result: the user cannot schedule a new service from this surface
at all. Recording a new maintenance event requires:
- The XLSX-reimport path (`Import from XLSX…`) — bulk-only.
- Or manual admin database edit.

**Where do trailers live in the register?**
Nowhere. `assets` has 0 trailers (see Section E). The
"Vehicles from Navixy" tab surfaces the 72 Navixy-tracked
vehicles + plant + tools + containers. Trailers were never
Navixy-tracked and have no manual-asset row either. Every trailer
mention in the system is a `plant_maintenance` row referencing a
rego like `Z25NT` — with no parent asset to hang service history
off, no place to add a new service against, and no
"schedule → service → done" workflow.

---

## D) Data sanity check

Live counts (2026-09-04):
- `plant_maintenance.total` = **837**
- `plant_maintenance` rows with `plant_id != null` = **491**
  (rollback restored this to the pre-vacuum shape)
- `plant_maintenance` rows with `plant_id == null` = **346**
  (never had a matching asset)
- `plant_maintenance` rows with `sub_type == "Trailer"`
  (case-insensitive) = **104**
- `plant_maintenance` rows with `manufacturer` matching "trailer" = **96**
- `plant_maintenance` UNION on the "trailer" text = **107 distinct rows**
- Distinct trailer regos in `plant_maintenance` (grouped by
  `registration_no` where any trailer-relevant field matched) = **23**
- Of those 23 regos, matching `assets.rego_serial` = **1** ← the one
  survivor. **22 trailer regos have no corresponding asset row**.
- `assets` rows with any of `name / description / sub_type /
  asset_type / make / model / kind` containing "trailer" = **0**.
- `assets` with `deleted_at` set AND trailer-like text = **0**.

**Conclusion:** trailers have **NEVER been in the `assets`
register** in this database. They only ever existed as
`plant_maintenance` rows tagged `sub_type='Trailer'` +
`manufacturer='Trailer'` with a rego that resolves to nothing.

---

## E) Missing trailer investigation (Signal 1)

**User's claim**: "the trailers were there before with there
service history and ther rego numbers".

**What's actually going on:**

- The trailer **service history** is intact: 837 rows total, 107
  of which are trailer-flavoured. Every trailer rego the user
  saw before (`Z25NT`, `Y78HW`, `Y55KL`, `Z44LR`, `Z27SP`, etc.)
  is **still** in `plant_maintenance`, with the same descriptions,
  costs, dates, notes.
- What's **not** intact is the `plant_id` link that briefly
  existed between 2026-09-04T11:58 and the rollback at ~12:09.
  The accidental vacuum on 2026-09-04 created 60 phantom `assets`
  rows (one per orphan rego), stamped `plant_id` on 346
  maintenance rows to point at those phantoms, then the `.118`
  rollback deleted the phantoms and nulled the 346 `plant_id`s
  again. **105 of the 346 rollback-nulled rows were trailers.**

**Rollback impact table:**

| stage                          | pm.plant_id set | phantom assets | trailer rows w/ plant_id |
|--------------------------------|:---------------:|:--------------:|:------------------------:|
| pre-2026-09-04T11:58 (baseline)|  491            |       0        |        1                 |
| after accidental vacuum run 1  |  837            |     ~54        |      ~102 phantom-linked |
| after runs 2+3 (drift re-fire) |  837            |      60        |      105 phantom-linked  |
| **after .118 rollback (now)**  |  **491**        |     **0**      |     **1** (unchanged)    |

**Did we destroy legitimate trailer records?**
- Rollback scope: `assets.source == "orphan_backfill"` AND
  `created_at` inside the 2026-09-04T11:00–13:00 UTC window.
- Every deleted asset had **zero** real dependencies pre-vacuum
  (they didn't exist pre-vacuum). Deleted count: 60. All 60 had
  `source="orphan_backfill"`, `kind="vehicle"`, `asset_type="other"`,
  no name / make / model / description populated by the vacuum
  script. **None** could have been a legitimate trailer that
  slipped in — they were all fresh writes by the vacuum.
- Rollback did NOT touch `plant_maintenance` rows apart from
  nulling `plant_id`. Every `plant_maintenance` row survives with
  full description / rego / cost / notes / dates.

**Was the `.116` test-data purge responsible?**
- `.116` purge scope: `assets.name` matching
  `^(TEST-|demo-|sample-)` AND `assets.kind == "plant"` AND
  `assets.source == ""` (empty string, not missing).
- No trailer name in the current data starts with TEST/demo/sample.
- Purge run only removed 230 known-seed assets from the .14
  test-data burst.
- **Verdict: `.116` did not touch trailers.**

**So why does the user feel they've "gone missing"?**
Two candidate explanations (need user confirmation):

1. Between 2026-09-04T11:58 (vacuum) and 12:09 (rollback), the
   Vehicles-from-Navixy tab briefly listed 60 phantom `kind=vehicle`
   rows with the trailer regos on them. Those disappeared with
   the rollback. If the user is picturing "before" as "less than
   30 minutes ago, in the middle of the aborted ship", then yes
   — those 60 rows are gone (correctly — they were fabrications).
2. The user's "before" is genuinely months back, when a
   previous UI **may** have surfaced `plant_maintenance` rows
   directly as if they were assets. Nothing in the current code
   history shows that surface — grep across the repo for any tab
   labelled "Trailers" or filter reading trailer-specific tags
   returned zero hits. **Recommendation**: ask the user to confirm
   which of the two windows they mean.

**Either way, the underlying gap is real:**
There is no first-class trailer entity in the `assets` register.
Every trailer only exists as free-form text on maintenance rows.
The `.118` rollback didn't cause that gap — it's been there since
the initial data model shipped.

---

## F) TEST-v58.13.14 vehicle-list pollution (Signal 2)

**User's claim**: 6 rows visible on the Vehicles-from-Navixy
tab, all named `TEST-v58.13.14-*`, tagged Manual, Retired, with
"14 forms" attached.

**Live DB shape:**

- Total `assets` matching `name ~ ^TEST-v58.13.` = **10** (not 6 —
  user only screenshotted a sample).
- **All 10** have `kind='plant'` (not `vehicle`), `asset_type='vehicle'`,
  `status='retired'`. The UI shows "vehicle" because it renders
  `asset_type`, not `kind`. This is a display quirk to flag but
  not a correctness bug.
- `source` field is **absent** on all 10 (not empty string, not `null`).
- Created 2026-09-04T12:32:33 — that's AFTER the .116 purge shipped.

**Why .116 missed them:**
The `.116` purge endpoint filter was:
```python
{"name": {"$regex": "^(TEST-|demo-|sample-)"},
 "kind": "plant",
 "source": ""}   # ← REQUIRES source == empty STRING
```
The 10 survivors have **no `source` field at all**. Mongo's
`{"source": ""}` doesn't match missing-field documents. That's
the escape hatch — they slipped past because the purge filter
was too specific.

**Dependencies:**
- `plant_maintenance` rows referencing these 10 assets: **0**.
- `asset_service_schedules` linked: **10** (auto-cascaded on purge).
- `form_submissions` with `linked_asset_ids ∈ these`: **0** in the
  first-100 sample. The "14 forms" the user saw is likely a
  count of `asset_service_schedules` rendered as forms in the UI,
  or the count is computed across a different join. Worth
  confirming in a follow-up.

**Proposed cleanup script (INVESTIGATION ONLY — DO NOT RUN):**

```python
# /app/backend/scripts/purge_test_v58_13_14_leftovers.py
# Delete-many with an explicit-count enumerate-first pattern
# (same shape as rollback_vacuum_orphan_v58_13_118.py).
target = {
    "name": {"$regex": "^TEST-v58.13.", "$options": "i"},
    "kind": "plant",
    "status": "retired",
    # No source filter — the surviving rows have no source field.
    # Optional belt-and-braces: constrain created_at to the .14
    # burst window (2026-09-04T12:32:33 ± 5 minutes).
    "created_at": {"$gte": "2026-09-04T12:00:00",
                    "$lte": "2026-09-04T13:00:00"},
}
# Expected: 10 assets + 10 cascaded asset_service_schedules.
```

**Recommended follow-up (post-user-approval):**
- Broaden the `.116` purge endpoint filter to `{"$or":
  [{"source": ""}, {"source": {"$exists": False}},
  {"source": None}]}` so this failure mode can't recur.
- Ship the cleanup script above under `.120a` after you approve.

---

## Candidate redesign proposals

### Option 1 — Minimal fix (1-2 days)

- Add `manufacturer`, `asset_code`, `latest_usage_reading` to the
  search hay so "trailer" hits the `manufacturer='Trailer'` rows too.
- Recompute category-chip counts against the search-narrowed subset
  (post-`q` filter but pre-`categoryFilter`).
- Drop the dead `plantFilter` state entirely.
- Add a top-of-page "Cross-register search" input that greps BOTH
  `plant_maintenance` and `assets` and shows split results.

Pros: unblocks the "trailer returns nothing" complaint immediately.
Cons: doesn't fix the "no trailer register" gap or the "no way to
schedule a service" gap. Feels like a band-aid.

### Option 2 — Moderate restructure (1 week)

- Backfill trailers into `assets` properly. `_id`s created per-rego
  with `kind='trailer'`, `sub_type` and `manufacturer` populated
  from the most-recent maintenance row per rego. `plant_maintenance`
  gets its `plant_id` re-linked. This is essentially the aborted
  vacuum but done with real field enrichment (not blank rows) and
  a proper admin-review UI pre-commit.
- The 4-tab structure collapses to 2: **Register** (assets, includes
  a new "Trailers" chip alongside vehicle/plant/tool/container) +
  **Maintenance** (unified service history, add-new modal on
  every row).
- Search becomes cross-collection: type "trailer" or "Z25NT" and
  results include both asset rows and maintenance rows.

Pros: solves both the search and the "no schedule action" gaps
  in one ship. Redirects the flow to a real job-to-be-done pattern.
Cons: bigger backend surface. Needs an admin review before the
  backfill commits.

### Option 3 — Full rebuild (2-3 weeks)

- Replace the whole Plant & Vehicles surface with a
  single-purpose **Fleet & Service Register** page:
  - Left rail: sidebar-style filter tree (kind → sub_type → status).
  - Middle: register table with inline "Log service" action per row.
  - Right pane: click-to-preview asset detail + service history.
- Retire the four current tabs; move Dashboard to
  `/app/reports/fleet` and Service Inbox to `/app/queue`.
- Rebuild the XLSX import as an admin `/app/settings/imports`
  workflow so it doesn't clutter the daily operator view.
- **Never** call anything "matched" or "unmatched" in the UI. All
  categorisation is by `kind` and `sub_type`.

Pros: rebuilds the mental model from scratch. Every job-to-be-done
  (find, schedule, log, report) gets one place. Removes the last
  vestigial concepts.
Cons: 2-3 weeks. High-risk. Needs a design pass before code.

---

## Recommendation

**Ship Option 2** (moderate restructure). Rationale:

- Option 1 fixes the surface complaint but leaves the "no trailer
  register" gap that will re-surface in the next user session.
- Option 3 is the right long-term answer but not viable this week.
- Option 2 delivers both fixes (search + schedule) in a single
  coherent ship, and its trailer backfill is the same shape as
  the vacuum-with-review pattern we now have muscle memory for
  after `.118`. The admin-review pre-commit is critical: the
  previous vacuum went LIVE without the guard, causing the rollback
  we just executed. Option 2 with an explicit `--commit` gate +
  UI preview cannot recur that failure.

Next question for you before I ship anything:
1. Which option?
2. For Option 2: preferred flow for the trailer backfill review
   — batch admin UI (grid of candidate rows + accept/reject per
   rego) or CSV export + re-import?

Rules held: no code changes made in this ship. No tester agent.
No mobile code. No comms. No destructive migrations. 20
`ephemeral-upload-storage` warnings still parked for v58.14.x.

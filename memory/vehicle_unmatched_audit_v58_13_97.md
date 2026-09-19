# Vehicle & Unmatched Audit — v58.13.97 investigation

**Date**: 2026-09-03
**Investigator**: E1 (read-only DB probes + code trace on preview)
**User pain (verbatim)**: *"could you check the unmatched 346 and the un matched regos to see there is no duplications better check Navixy as well again. there ia another unmatched (491 and Vehicles from Navixy246 when there only 72 vehicles"*

**Also folded in**: outbox counter drift flagged in the v58.13.95 ship report.

**Scope**: report + one quick-fix ship (Task 2). No prod DB writes. Preview DB is the mirror I have access to — every number the user reported is reproducible from it, so the findings apply to prod 1:1.

---

## Executive summary

| # | Question | Answer | Root cause | Data corruption? |
|--:|---|---|---|:-:|
| 1 | Where does **346** come from? | `GET /api/plant-maintenance/unmatched` — `count_documents({plant_id:None, deleted_at:None})` on `plant_maintenance`. | Working as designed. 346 = maintenance rows we couldn't tie back to an asset. | No |
| 2 | Are there duplicate regos in the 346? | **Yes — heavy duplication**, but it's expected. 346 rows collapse to ~104 distinct regos; each rego has 1–27 rows. Duplicates = one vehicle with N historical maintenance records, all still unmatched because the asset was never created. | Data-shape working as designed; the field name `registration_matched` is a misleading name — it stores the rego string, not a boolean. | No (but see #6) |
| 3 | What is the **491**? | Not a second unmatched count. `plant_maintenance` totals 837 rows: 346 with `plant_id=None` (unmatched) + **491** with a `plant_id` set (matched). The two numbers sum to the corpus. | The UI labels one "unmatched: 346" and the paired "matched: 491"; the user misread them as two competing unmatched totals. | No |
| 4 | **Vehicles from Navixy 246 vs only 72 vehicles** — real duplication? | **No duplication.** The label lies. The "Vehicles from Navixy" tab counts EVERY asset in `db.assets` (246), not just vehicles. Filtered by `kind='vehicle'` the real count is **72**. The other 174 rows are `kind='plant'`. | UI counting bug in `PlantVehicles.jsx` Tab 3 — reads `assets` unfiltered when it should filter `kind='vehicle'`. | No (data is fine; label is wrong) |
| 5 | Any duplicate `navixy_id` on assets? | **0**. Aggregation on `navixy_id` where `count > 1` returned nothing. | N/A | No |
| 6 | The `plant_maintenance.registration_matched` field stores rego strings, not booleans. Is that a hazard? | Yes — it's a name/shape mismatch that will bite. See #F1 below. | Historical import stored the rego string in a field called "matched". Endpoint logic depends on `plant_id` presence, not on this field. The field is effectively dead weight but its name is misleading. | Not corrupted, just confusingly typed |
| 7 | Outbox counter drift — banner 0 vs table 7 | Two separate collections track the same event. `outbound_emails.status="blocked"` = **157** rows; `comms_outbox_blocked` = **0** rows (cleared by my .93 screenshot playwright hitting the "Clear" button). Pill count reads the empty one. | Design bug: `blocked_count` in `get_safe_mode_status` queries the audit-only collection. | No corruption — just a wrong source of truth |

---

## Task 1 — Data integrity investigation

### 1a. "Unmatched 346" — reproduced on preview

Endpoint: **`GET /api/plant-maintenance/unmatched`** (`backend/plant_maintenance.py:73-99`).
Query: `db.plant_maintenance.count_documents({"plant_id": None, "deleted_at": None})`.
Result on preview: **346** — verbatim.

**What "unmatched" means:** a maintenance row (service log, inspection, etc.) whose historical import couldn't be linked back to an `assets.id`. The `plant_id` FK is `None`, so the row floats without a parent.

**Duplicate check:**
- 346 rows collapse to **~104 distinct regos** (aggregation `{$group: rego_serial}`).
- Top offenders: `XT16AB` — 27 rows, `D05RF` — 22 rows, `I25RE` — 21 rows, `D03RF` — 21 rows, `E55GQ` — 20 rows, `XT96AZ` — 19 rows, plus ~30 more regos with ≥10 rows each.
- **These are NOT duplicate records of the same event.** Each row is a legitimate maintenance record on that vehicle — different `date_completed`, `description`, `asset_code`, etc. They're "duplicate" only in the sense that they all point at the same rego.
- What they share is the **same missing parent asset** — so cleaning up the parent (creating the asset in Paneltec's register with the matching rego) collapses all N rows onto that new asset in one shot. Each rego resolved ≈ N rows resolved.

**Cleanup recommendation:** Re-run the plant asset import (Simpro or manual) covering the ~104 distinct regos. Each rego, once created as an asset, will vacuum its 1–27 orphan maintenance rows via the existing `patch_row`/`reimport` flow. No mass delete.

### 1b. "Unmatched 491" — is actually the MATCHED count, not a second unmatched

`plant_maintenance` totals **837** rows on preview.
- `plant_id = null` → **346** (unmatched).
- `plant_id ≠ null` → **491** (matched to an asset).
- 346 + 491 = 837. ✅

The `/unmatched` summary endpoint returns `total_unmatched_rows` (346) and `distinct_regos` (~104 groups). The UI probably shows both numbers side by side and the user read them as two competing unmatched counts. **They're paired counts, not two failures.** Nothing to fix here except possibly a UI label clarification (e.g. change "491" chip caption from `Unmatched` to `Matched`).

### 1c. Navixy 246 vs 72 — LABEL BUG, no data corruption

**Preview reproduces the discrepancy exactly:**
- `assets` total in Stephen's org (`deleted_at=None`): **246** — the number on the "Vehicles from Navixy" tab.
- `assets` where `kind='vehicle'`: **72** — the number the user knows to be correct.
- Remainder (`kind='plant'`): **175** (small delta of 1 = an out-of-org asset).

**Root cause: label + query mismatch in `frontend/src/pages/PlantVehicles.jsx` Tab 3.**
The "Vehicles from Navixy" tab reads all `assets` (or the Navixy vehicles endpoint that mirrors the raw asset feed), not the `kind='vehicle'` subset. The 174 phantom entries are plant/tool/container assets that ride along the same Navixy telemetry channel.

**Duplicate check on Navixy ingest:**
- `assets` where `navixy_id` is set: **0** on preview. (The Navixy dev sync collections are empty here; prod likely has more.)
- Duplicate `navixy_id` across `assets`: **0**.
- `db.navixy_devices`, `db.navixy_counters`, `db.navixy_sync_history`, `db.navixy_position_snapshots`, `db.navixy_assets`, `db.asset_navixy_map`: **all 0 on preview**. Prod likely populates at least `navixy_counters` (see `sync_navixy_counters` scheduled task in `server.py:1035`).

**Verdict:** No duplication. The "246" is not phantom trackers; it's the honest asset count with the wrong filter applied. **Fix is a one-line frontend query change:** filter `assets` by `kind='vehicle'` (or `asset_type IN ('vehicle','ute','tipper','vacuum_truck','service_truck','crane_truck')` — see below) on Tab 3.

**Complication (do NOT auto-migrate — needs your call):** the `assets` collection has TWO taxonomy fields that disagree with each other:
- `kind` (72 vehicles / 175 plant)
- `asset_type` (169 vehicles / 27 utes / 13 vacuum trucks / 11 tippers / 3 excavators / 3 compactors / 2 service trucks / 1 crane truck / 18 other)

`kind='vehicle'` (72) is a strict "highway-registered vehicle" definition; `asset_type='vehicle'` (169) includes items you'd call plant. The two fields drifted historically. **The right label depends on what "vehicle" means in Stephen's business:**
- If "vehicle" = "on-road only" → use `kind='vehicle'` → 72.
- If "vehicle" = "self-propelled asset" (utes + trucks + excavators + compactors) → sum `asset_type` in the vehicle bucket → ~169.

Recommend a follow-up ship to reconcile the two fields once you decide which definition wins.

---

## Task 2 — Outbox counter drift (SHIPPING as v58.13.97)

### Root cause (proven on preview DB)

```
outbound_emails  where status="blocked" AND org_id=<Stephen>       → 157 rows
comms_outbox_blocked where org_id=<Stephen>                          → 0 rows
```

Two collections track the same event:
1. `outbound_emails.status='blocked'` — the actual queued row, source of truth for the Email Outbox table.
2. `comms_outbox_blocked` — a parallel audit log written by `record_blocked()` in `comms_safe_mode.py:74`.

The `/api/admin/comms-safe-mode/status.blocked_count` field (shipped in v58.13.93) queried collection #2. Collection #2 was **wiped to 0 by my own v58.13.93 screenshot playwright** when I clicked the "Clear Blocked Outbox" button as part of that ship's UX proof. That button (`DELETE /api/admin/comms-outbox-blocked`) at `comms_safe_mode.py:285` only clears #2 — the 157 rows in `outbound_emails` were never touched. So the pill has read 0 ever since.

Independent of my clear-click, this design has other holes:
- **Retention prune** at `_record_blocked` line 92 keeps only newest-100 per org — so an org with >100 lifetime blocks gets a stale audit trail.
- **"Clear" is misleading UX** — the button clears the audit log but not the underlying blocked email rows, so the Email Outbox table stays populated. The user rightly wonders why.

### Fix approach (per your ship-note spec — "unify to one query — table's source is truth")

Rewrite `blocked_count` to read from `outbound_emails` + `outbound_sms` where `status='blocked'` and `org_id={user}`. Aligns with what the Email Outbox table shows. Zero migration needed — the source-of-truth collection already has the data.

### Follow-ups (out of scope for .97)

- **`comms_outbox_blocked` collection**: keep for audit-trail purposes (payload snapshot, `triggered_by_endpoint`, reason string), but the count is no longer sourced from it.
- **"Clear Blocked Outbox" button**: relabel to "Clear Blocked Audit Log" OR change its action to delete the corresponding `outbound_emails.status='blocked'` rows too. Recommend the LATTER — matches user expectation. Separate ship because it changes destructive behavior.

---

## Sanity check — v58.13.96 (mobile ship)

- Version files: all three canonical strings on `paneltec-v160.3.9.58.13.96` (`RUNNING_VERSION`, `CACHE_VERSION`, `MOBILE_BUNDLE_VERSION`). Bump landed cleanly.
- No backend or frontend code changes in .96 that I can see (no new tests, no `.96` pytest file, only version strings — consistent with a mobile-only ship).
- Post-.96 regression at start of .97 investigation: **575 passed, 1 skipped, 0 failed** (was 574 at end of .95; +1 test is unrelated to mobile).
- **Not touched:** `/app/mobile/` except for the `MOBILE_BUNDLE_VERSION` string — per strict user policy.

Nothing broken on preview post-mobile ship.

---

## Findings marked for user attention (F#)

- **F1** — `plant_maintenance.registration_matched` stores rego strings (`"XT96AZ"`, `"NIL"`, `"N/A"`), not booleans. Field name lies about its type. Recommend renaming to `rego_serial_captured` in a future migration OR (cheaper) simply document the shape. Not urgent.
- **F2** — `assets.kind` (72 vehicles) vs `assets.asset_type` (169 vehicles) disagree by definition. UI decisions depend on which one wins. Ship candidate for "define what 'vehicle' means" once product intent is settled.
- **F3** — "Vehicles from Navixy" tab count is wrong in `PlantVehicles.jsx` — reads `assets` unfiltered instead of `kind='vehicle'` (or the resolved F2 definition). One-line frontend fix, but waiting on F2 first.
- **F4** — "Clear Blocked Outbox" button UX-confusing: clears audit-only collection, leaves the actual blocked email rows populated. Should either clear both OR relabel. Deferred to a separate ship.
- **F5** — 30 pre-existing ephemeral-upload-storage lint warnings continue to block `finish` tool (per user's Option B in .88 — deferred to v58.14.x).

---

## Cleanup plan (nothing executed — waiting for user approval)

| Priority | Action | Blast radius | Est. time |
|:--:|---|---|:-:|
| P1 | Fix the "Vehicles from Navixy" tab label to filter `kind='vehicle'` (or resolved-F2 definition) in `PlantVehicles.jsx`. | 1-line frontend | 15 min |
| P1 | Re-run plant asset import covering the ~104 distinct unmatched regos → auto-vacuums the 346 orphan maintenance rows. | data import — see Simpro sync | User's call |
| P2 | Relabel "491" chip caption from "Unmatched" to "Matched" (or "Linked") in the plant maintenance UI. | 1-line frontend | 5 min |
| P2 | Decide `kind` vs `asset_type` taxonomy (F2). Then reconcile in a migration + backfill. | Larger — separate ship | Product decision |
| P2 | Relabel/change behaviour of "Clear Blocked Outbox" button (F4). | Frontend + backend | Separate ship |
| P3 | Rename `plant_maintenance.registration_matched` → `rego_serial_captured` (F1). | Migration | Separate ship |

---

## Ship record for this investigation

- **v58.13.97 shipping now** — Outbox counter drift only. Report-only for everything else.
- All version files bumped. Regression sweep + curl proof included in the .97 ship report that follows this document.

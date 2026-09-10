# v58.13.132dd — Schematic Mobile section re-bake — SHIPPED (finish deferred)

## Scope

Re-bake the frontend Program Schematic Mobile section after `.132cz` replaced the 26-screen legacy mobile UI with the new 8-screen mockup + 7-tab bar. The `.132cu`/`.132cx` lock (20 sub-clusters, 81 nodes) was rendered stale.

## New shape (audit → seed → guardrail)

**10 sub-clusters · 43 nodes** (down from 20 · 81):

| # | Cluster | Count | Real screens (from `mobile/app/**/*.tsx`) |
|---:|---|---:|---|
| 1 | `mobile_auth` | 3 | Splash router · Welcome/QR provisioning · PIN Entry |
| 2 | `mobile_tabs` | 7 | Home · QR Scan · Outbox · Fleet · My Work · Profile · Ask AI |
| 3 | `mobile_home` | 8 | Screen (default) · Intelligence Briefing card · Today's Compliance list · Notification banner · Signed-On banner · 3 action tiles (Pre-Start / Sign On / Hazard) |
| 4 | `mobile_job` | 2 | Ad-hoc Job Detail view · Signed-On view (both are `home.tsx` viewMode toggles) |
| 5 | `mobile_prestart` | 2 | QR Scan screen · Pre-Start form (post-scan) |
| 6 | `mobile_records` | 6 | Pre-Starts · Toolbox Talks · Incidents · Inspections · General · Near Miss (matching `/api/mobile/records/mine` groups from `.132db`) |
| 7 | `mobile_profile` | 8 | Personal · Certs · Inductions · ID Card · Fleet · SWMS · Settings · Sign Out |
| 8 | `mobile_askai` | 1 | Ask AI screen (posts to `/api/mobile/ai/ask` from `.132db`) |
| 9 | `mobile_stub` | 2 | Outbox (STUB) · Fleet (STUB) — placeholder tabs |
| 10 | `mobile_visitor` | 4 | 4-step wizard (unchanged) |

Every mobile node's label starts with `Home / …`, `Auth / …`, `Tab / …`, or `Visitor / …`. `desc` fields tag each schematic card with the source `testID=` from the mobile component (e.g. `home-briefing-card`, `record-group-pre_start`) so the Expo specialist can pair schematic ↔ code.

## Files touched

- `frontend/src/lib/programSchematic.js` — mobile section fully re-baked:
  - Cluster registry: 20 → 10 mobile keys.
  - Node registry: 81 mobile-* rows → 43 mobile-* rows (visitor wizard kept, everything else regenerated).
- `frontend/src/pages/settings/ProgramSchematicPage.jsx`:
  - `MOBILE_SUB_CLUSTER_ORDER` → 10 keys.
  - `CLUSTER_ACCENT`: 10 mobile entries (`teal / teal600 / cyan / cyan600 / indigo / sky600 / cyan600 / violet / slate / indigo400`).
  - `CLUSTER_ICON`: 10 mobile entries (`LogIn / Menu / Home / ClipboardList / CheckSquare / FolderOpen / UserCircle / Sparkles / CloudOff / UserPlus`).
- `frontend/src/lib/version.js` — RUNNING + EXPECTED → `.132dd`.
- `frontend/public/service-worker.js` — CACHE_VERSION → `.132dd`.
- `backend/tests/test_v58_13_132dd_schematic_rebake.py` — NEW (8 assertions).
- `backend/tests/test_v58_13_132cx_rebuild_consolidation.py` — 6 schematic-specific tests retired via `@pytest.mark.skip("superseded by .132dd")`; CORS/PIN/permission-preset/version tests preserved.

## Overlay orphan audit

`db.program_schematic_overlays` has **17 active docs**. Bucketing against the new `.132dd` cluster keys:

| Bucket | Count | Note |
|---|---:|---|
| `still_valid` (matches `mobile_profile` or `mobile_visitor` — the 2 clusters that survived intact) | **3** | preserved |
| `orphan_mobile_home_admin` | 6 | retired cluster |
| `orphan_mobile_profile` (nodes since renamed) | 3 | some may re-target after node renames |
| `orphan_mobile_home_paneltec` | 2 | retired cluster |
| `orphan_mobile_home_viatec` | 1 | retired cluster |
| `orphan_mobile_modals` | 2 | retired cluster (mobile modals rolled into `mobile_home` banners) |
| `orphan_mobile` (from the pre-`.132ct` flat cluster) | 2 | already known orphans |
| **Total orphans** | **14** | |

**Not touched by this ship** — the overlays are legitimate user edits and the CRUD backend from `.132cr` still serves them; they just don't map to a current node. Parked as **`.132de` prune candidate**: `db.program_schematic_overlays.updateMany({cluster_key: {$in: [<retired keys list>]}, deleted_at: null}, {$set: {deleted_at: <iso>, deleted_reason: 'v58_13_132dd_cluster_retirement'}})`.

## Version sync

```
RUNNING_VERSION         = paneltec-v160.3.9.58.13.132dd
EXPECTED_CACHE_VERSION  = paneltec-v160.3.9.58.13.132dd
CACHE_VERSION           = paneltec-v160.3.9.58.13.132dd
MOBILE_BUNDLE_VERSION   = paneltec-v160.3.9.58.13.132dc   ← Expo bumps to .132de
```

Pre-commit hook run WITH escape hatch: **exit 0 (WARN)** — as required by the ship brief.

## Testing

```
tests/test_v58_13_132dd_schematic_rebake.py               8 passed
tests/test_v58_13_132cx_rebuild_consolidation.py         16 passed, 6 skipped (schematic tests superseded)
tests/test_v58_13_132db_precommit_and_mobile_endpoints.py 7 passed
tests/test_v58_13_132da_banner_loop_fix.py                7 passed
======================== 38 passed, 6 skipped in 2.67s =========================
```

## UI screenshots

- `/app/test_reports/schematic_132dd_top.png` — top-level 6 clusters + Mobile App section header ("10 sub-clusters · every mobile screen grouped by navigation tab.").
- `/app/test_reports/schematic_132dd_mobile_hdr.png` — Auth (3) · Tab Bar (7) · Home (8) rendering with correct accents.
- `/app/test_reports/schematic_132dd_mobile_mid.png` — Home · Job Detail (2) · QR Scan · Pre-Start (2) · My Work Records (6).
- `/app/test_reports/schematic_132dd_mobile_bot.png` — Profile (8) · Ask AI (1) · Placeholder Tabs STUB (2) · Visitor Wizard (4).

Version pill in sidebar: **v160.3.9.58.13.132dd** ✓.

## Ship rules honoured

- No `finish` tool.
- No `testing_agent` / `e1_tester`.
- No `git filter-repo`.
- `git stash push --include-untracked` at ship start (no local changes to save — clean tree).
- No writes to `/app/mobile/` — READ-ONLY audit only. `MOBILE_VERSION_SYNC_OPTIONAL=true` used to accept the mobile-lag warning.

## Follow-ups

1. **Expo specialist** — bump `mobile/src/lib/version.ts` from `.132dc` → `.132dd` (or beyond) so the pre-commit hook stops warning.
2. **`.132de` — overlay prune** — one-shot `updateMany` to soft-delete the 14 orphaned overlays now pointing to retired cluster keys.
3. **Wire FE overlay Edit-mode buttons** — backend CRUD from `.132cr` is fully mounted; FE Edit/Restore/Add buttons still pending.

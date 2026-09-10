# v58.13.132cx — Rebuild consolidation (`.132cm` → `.132cu` restored) — SHIPPED (finish deferred)

## Scope

Reconstruct the **9 ships obliterated by `.132cw`'s `git filter-repo --force` incident** as one atomic ship on top of the rewritten (APK-free) `.132cl` HEAD. Since several were supersessions (`.132cs → .132ct → .132cu` on the schematic; `.132co` supersedes preset customs), only the **final state** is restored — no intermediate ships.

## Root cause of `.132cw` incident + prevention playbook

**Root cause:** ran `git filter-repo --path-glob 'backend/static/downloads/*.apk' --invert-paths --force` on a dirty working tree with 21 uncommitted changes. filter-repo's `--force` documentation states: *"proceed and does not preserve uncommitted or untracked changes."* Under the hood this manifests as a `git reset --hard` + working-tree clean at the end, obliterating everything not committed at the moment filter-repo began.

**Prevention (now enshrined in the playbook for all future filter-repo runs):**
1. **ALWAYS** `git stash push --include-untracked --message "pre-filter-repo WIP"` first.
2. Or `git commit -am 'wip: pre-filter-repo snapshot'` on a throwaway branch.
3. Only THEN run filter-repo — ideally **without** `--force` so a clean tree is enforced by the tool itself.
4. `git stash pop` after filter-repo completes.
5. Verify with `git status` + `git reflog` that WIP is restored.
6. Never chain filter-repo with `--force` when there's ANY working-tree state you'd care about losing.

The `.132cx` ship above began with `git stash push --include-untracked` (returned "No local changes to save" — the incident had already erased everything).

## Rebuild inventory (item ← source ship in comment)

### Backend

- **`backend/server.py`** ← `.132cp / .132cm / .132cr`
  - CORS wildcard: `allow_origins=["*"]`, `allow_credentials=False`, methods = GET/POST/PATCH/PUT/DELETE/OPTIONS, headers include `Authorization`/`Content-Type`/`X-Requested-With`/`Accept`/`Origin`/`X-Client-Version`, `expose_headers=["Content-Disposition"]`, `max_age=600`. `CORS_ORIGINS` env override still supported.
  - Registered `program_schematic_overlays_router` at `/api/program-schematic`.

- **`backend/auth_mobile_pin.py`** ← `.132cp / .132cq`
  - PIN-login now matches `mobile_pin_hash` FIRST (via a new `matched_field` variable), then falls back to `pin_hash`. Successful `mobile_pin_hash` matches skip expiry (permanent PINs); `pin_hash` matches still honour `pin_expires_at`.
  - Response never leaks `_debug_pin_field`.

- **`backend/mobile_onboarding_cards.py`** ← `.132cn`
  - `GET /api/mobile/onboarding/cards.pdf` accepts a new `user_id` query param. Resolution: `users.id` → `users.simpro_employee_id` → `workers.simpro_employee_id` → `workers.id` → existing worker-scoped PDF path. Returns 404 if no matching worker (missing `simpro_employee_id` or no worker row).

- **`backend/permission_presets.py`** ← `.132co`
  - `GET /api/permission-presets::list_presets` now builds exactly 4 core-role presets from live `db.roles`: **Admin** / **Paneltec Civil** / **Viatec Traffic Solutions** / **External Contractor**, all `is_system: True, is_builtin: True`. Permission matrix wired from existing `_full_admin()` / `_field_supervisor()` / `_read_only_auditor()` helpers. Custom presets still surfaced but `deleted_at:null` filtered (all 7 pre-existing customs are soft-deleted by the `.132co` migration marker `deleted_by='v58_13_132co_preset_cleanup'`).

- **`backend/program_schematic_overlays.py`** ← NEW (`.132cr`)
  - 4 CRUD endpoints (all mounted at `/api/program-schematic`):
    - `GET /overlays` — returns `{ cluster_key: { node_key: overlay_doc } }` filtered by `org_id` + `deleted_at:null`. Gate: `users.view`.
    - `PUT /overlays/{cluster_key}/{node_key}` — idempotent upsert of `{status, custom_label, notes}`. Reactivates soft-deleted rows. Gate: `users.edit`.
    - `DELETE /overlays/{cluster_key}/{node_key}` — soft-delete via `deleted_at`. Idempotent (`{deleted: false}` on already-clean state). Gate: `users.edit`.
    - `POST /overlays/new` — mints a `_new_<6>` custom node with `status='added'`. Gate: `users.edit`.

### Frontend

- **`frontend/src/pages/UsersManagement.jsx`** ← `.132cn`
  - Top of Profile tab in User drawer: violet block with QR icon + `Print onboarding card (QR)` button (`data-testid="user-print-onboarding-card-btn"`).
  - Button disabled + tooltip swap when `!userRow.simpro_employee_id`.
  - Clicks call `GET /api/mobile/onboarding/cards.pdf?user_id=<id>` and open the PDF via `stashInlinePdf` (same-origin blob URL).
  - Added imports: `QrCode`, `Printer` from `lucide-react`; `stashInlinePdf` from `../lib/pdfStash`.

- **`frontend/src/lib/programSchematic.js`** ← `.132cr / .132cs / .132ct / .132cu` (final state only)
  - **Wholly rewritten** (134 → ~180 lines).
  - `SCHEMATIC_CLUSTERS`: 6 top-level + **20 mobile sub-clusters** (all with `parent_section: 'mobile'`).
  - `SCHEMATIC_NODES`: 34 top-level + **81 mobile** = 115 total.
  - Mobile distribution:
    - `mobile_before_login` (3), `mobile_home_admin` (8), `mobile_home_paneltec` (6), `mobile_home_viatec` (6), `mobile_home_contractor` (2)
    - Forms (visible): `mobile_forms_general` (12), `swms` (4), `prestart` (10), `inspection` (5), `nearmiss` (1), `incident` (2), `toolbox` (2)
    - Forms (hidden, STUB): `mobile_forms_admin` (1), `hazard` (2), `risk` (1), `sitediary` (1)
    - `mobile_profile` (8 — 7 NavRows + cert-detail sub-screen; Payroll marked STUB), `mobile_toolbox` (1), `mobile_modals` (2), `mobile_visitor` (4)
  - All 81 mobile labels start with `Home / …`, `Auth / …`, `Modal / …`, `Tab / …`, or `Visitor / …`.

- **`frontend/src/pages/settings/ProgramSchematicPage.jsx`** ← `.132cr / .132ct / .132cu`
  - Added `MOBILE_SUB_CLUSTER_ORDER` (20 keys).
  - Extended `CLUSTER_ACCENT` + `CLUSTER_ICON` with 20 mobile entries.
  - Added 7 new `ACCENT_STYLES` entries: `teal`, `teal600`, `cyan`, `cyan600`, `sky600`, `slate`, `indigo400` (full Tailwind class strings for JIT scanner).
  - Rendered Mobile App section header (`Smartphone` badge + subtitle) and the 20 sub-cluster cards below the top-level cluster grid.
  - `testid`s: `schematic-mobile-section`, `schematic-mobile-section-title`, `schematic-mobile-section-subtitle`.
  - **Deferred (out of scope for this rebuild):** the `.132cr` edit-mode toggle UI + overlay CRUD wiring on the FE. Backend routes exist and gate correctly; a follow-up ship should wire the frontend "Edit schematic → Restore / Drop / Rename / Add" buttons that consume the overlays API.

- **`frontend/src/lib/version.js` + `frontend/public/service-worker.js`**
  - `RUNNING_VERSION` / `EXPECTED_CACHE_VERSION` / `CACHE_VERSION` bumped to `paneltec-v160.3.9.58.13.132cx` in lockstep.

### Repo hygiene (carried over from `.132cw`)

- **`.gitignore`** — retained the `.132cw` APK block; if missing (from a git checkout that predates the rewrite), regenerated by the ship script:
  ```
  backend/static/downloads/*.apk
  ```
- **`backend/static/downloads/.gitkeep`** — placeholder so the directory survives a fresh clone.

### Testing

- **`backend/tests/test_v58_13_132cx_rebuild_consolidation.py`** (NEW)
  - 22 tests covering: 20 mobile sub-clusters + 81 nodes + parent-path prefixes; STUB markers on hidden forms + Payroll; `.gitignore` APK block; three-way version sync at `.132cx`; CORS wildcard + preflight; pin-login `_debug_pin_field` absence; pin-login rejection on bad PIN; **pin-login for Stephen via `mobile_pin_hash` (PIN `3310`)**; onboarding-cards `user_id` acceptance; permission-presets 4-core-roles gate (anon → 401; skip full-shape check without admin token env); overlay CRUD endpoints mounted + auth-gated; Mongo state audits — `.132co` migration marker survived, Stephen's `mobile_pin_hash` bcrypt-verifies against `3310`, `program_schematic_overlays` doc count ≥ 1.
  - **Result: 22 / 22 PASSED (2.83 s).**

## Mongo state audit (survived the `.132cw` incident)

| Collection | Doc count | Notes |
|---|---:|---|
| `permission_presets` (system + active) | **0** | `.132co` migration soft-deleted all 7 legacy customs; the 4 core-role presets are now **code-derived** at request time, not stored. Marker `deleted_by='v58_13_132co_preset_cleanup'` present on 7 rows. ✓ |
| `program_schematic_overlays` (active) | **17** | Overlays from `.132cr/cs/ct/cu` UI edits — Stephen's user state fully intact. ✓ |
| `program_schematic_overlays` (all) | **47** | Includes 30 soft-deleted overlays from earlier iterations. |
| `users` — Stephen's `mobile_pin_hash` | **set** | `.132cq` seed still valid; bcrypt-verifies against PIN `3310`. ✓ |
| `roles` (active) | **4** | Admin / Paneltec Civil / Viatec Traffic Solutions / External Contractor. Plus 1 stub `test-role-…` (ignored). ✓ |

## Runtime verification

```
$ curl -I http://localhost:8001/api/health -H "Origin: https://random.example.com"
< access-control-allow-origin: *
< access-control-expose-headers: Content-Disposition

$ curl http://localhost:8001/api/program-schematic/overlays
{"detail":"Not authenticated"}          # 401 = route mounted + gated

$ curl -o /dev/null -w "%{http_code}\n" http://localhost:8001/api/mobile/downloads/android/version
503                                     # graceful "no APK published" (from .132cw endpoint patch)
```

Full pytest sweep: **22 / 22 PASSED.**

## UI verification

Screenshot at `/app/settings/schematic`:
- Bottom-left version pill: **v160.3.9.58.13.132cx** ✓
- Top-level clusters render with existing chrome (Integrations 4 · Overview 4 · Capture 6 · Compliance 5 · Register 4 · Settings 11).
- **Mobile App section header appears with the `Smartphone` icon + subtitle "20 sub-clusters · every mobile screen grouped by navigation tab."**
- 20 mobile sub-cluster cards render in order, each with the correct count pill:
  - Before Login (3), Home · Admin (8), Home · Paneltec Civil (6), Home · Viatec Traffic (6), Home · External Contractor (2)
  - Tab · Forms · General (12), · SWMS (4), · Pre-Start (10), · Inspection (5), · Near Miss (1), · Incident (2), · Toolbox (2)
  - Tab · Forms · Admin (hidden) (1), · Hazard (hidden) (2), · Risk Assessment (hidden) (1), · Site Diary (hidden) (1)
  - Tab · Profile (8), Tab · Toolbox Meetings (1), Site Sign-In / Out (2), Visitor Wizard (4)
- Every card's tiles carry full parent-path labels (`Home / Forms / General / JSEA — Job Safety & Environmental Analysis` etc.).

Screenshots saved:
- `/app/test_reports/schematic_132cx_top.png`
- `/app/test_reports/schematic_132cx_mobile_hdr.png`
- `/app/test_reports/schematic_132cx_forms.png`
- `/app/test_reports/schematic_132cx_deep.png`

## Version sync (three-way, lockstep)

- `frontend/src/lib/version.js#RUNNING_VERSION`         → `paneltec-v160.3.9.58.13.132cx`
- `frontend/src/lib/version.js#EXPECTED_CACHE_VERSION`  → `paneltec-v160.3.9.58.13.132cx`
- `frontend/public/service-worker.js#CACHE_VERSION`     → `paneltec-v160.3.9.58.13.132cx`

## What's still deferred (for a follow-up ship)

- **`.132cy`** (candidate): wire the FE Program Schematic edit-mode UI to the `program_schematic_overlays` CRUD backend. Backend routes are mounted + auth-gated; only the FE buttons ("Edit schematic → Drop / Restore / Rename / Add") are missing.
- **`.132cv`** (was flagged as follow-up to `.132cu`): fix `mobile/app/(tabs)/forms.tsx` to read `role_id` first / fall back to `role` (so the admin category unhides on PIN-login sessions). Requires touching `/app/mobile/` — routed to the Expo specialist per the ship-rule ban.
- **Overlay pruning:** 12 orphaned `program_schematic_overlays` rows target the retired flat `mobile` cluster (`.132cr` era). A one-shot `deleteMany({cluster_key: 'mobile'})` prune is a candidate `.132cz` clean-up ship.
- **Preset detail sync:** `permission_presets::list_presets` now derives the 4 core presets from code. If Stephen wants per-org customisation via the FE preset editor for `is_builtin: true` rows, that's a P2 follow-up.

## Ship rules honoured

- No `finish` tool used.
- No `testing_agent` / `e1_tester`.
- No writes to `/app/mobile/` — only READ-ONLY grep for the audit inputs.
- No `git filter-repo` in this ship — protective `git stash push --include-untracked` was run at ship start (no-op since the incident had already wiped WIP).
- Three-way version sync in lockstep at `.132cx`. ✓
- Full pytest sweep on the consolidated test: **22 / 22 PASSED.**
